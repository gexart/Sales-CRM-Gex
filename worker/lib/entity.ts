// Generic, permission-aware CRUD for CRM entities. Each entity supplies an
// EntityDef (worker/entities.ts); this module turns it into list/get/create/
// update/archive handlers with server-side search, filtering, sorting,
// pagination, reference checks and audit logging.
import { Hono, type Context } from "hono";
import type { ZodObject } from "zod";
import type { AppEnv, SessionUser } from "../env";
import type { Role } from "../../shared/enums";
import { ApiError, forbidden, notFound, parseJson } from "./http";
import { auditStmt, diff } from "./audit-log";
import { clientIp, isManager } from "./auth";
import { b, newId, now } from "./util";

type Row = Record<string, unknown>;
type Ctx = Context<AppEnv>;

export interface EntityDef {
  route: string;
  table: string;
  entityType: string;
  label: string;
  titleOf: (r: Row) => string;
  schema: ZodObject;
  /** SELECT list and FROM clause; the main table must be aliased `t`. */
  select: string;
  from: string;
  search: string[];
  /** query param → SQL column (equality; comma-separated values become IN). */
  filters: Record<string, string>;
  /** query param → custom predicate. */
  customFilters?: Record<string, (value: string, user: SessionUser) => { sql: string; params: unknown[] } | null>;
  sorts: Record<string, string>;
  defaultSort: string;
  defaultDir?: "asc" | "desc";
  /** Predicate limiting what a sales rep can see. Omit for shared reference data. */
  repScope?: string; // uses ? placeholders bound to the user id
  repScopeParams?: number;
  writeRoles: Role[];
  /** Columns that reference other tables; validated before write. */
  refs?: Record<string, string>;
  /** Input keys that are not columns (handled by `extraStatements`). */
  virtual?: string[];
  ownerColumn?: string;
  derive?: (data: Row, existing: Row | null) => Row;
  beforeWrite?: (c: Ctx, data: Row, existing: Row | null) => Promise<void>;
  extraStatements?: (c: Ctx, id: string, input: Row, existing: Row | null, after: Row) => D1PreparedStatement[];
  redact?: (row: Row, user: SessionUser) => Row;
}

const MAX_PAGE = 100;

export function scopeClause(def: EntityDef, user: SessionUser): { sql: string; params: unknown[] } | null {
  if (!def.repScope || isManager(user)) return null;
  return { sql: `(${def.repScope})`, params: Array(def.repScopeParams ?? 1).fill(user.id) };
}

export async function fetchOne(c: Ctx, def: EntityDef, id: string): Promise<Row> {
  const user = c.get("user");
  const scope = scopeClause(def, user);
  const row = await c.env.DB.prepare(
    `SELECT ${def.select} FROM ${def.from} WHERE t.id = ?${scope ? ` AND ${scope.sql}` : ""}`,
  )
    .bind(id, ...(scope?.params ?? []))
    .first<Row>();
  if (!row) throw notFound(def.label);
  return def.redact ? def.redact(row, user) : row;
}

export async function listRows(c: Ctx, def: EntityDef) {
  const user = c.get("user");
  const q = c.req.query();
  const where: string[] = [];
  const params: unknown[] = [];

  if (q.archived === "1") where.push("t.archived_at IS NOT NULL");
  else if (q.archived !== "all") where.push("t.archived_at IS NULL");

  const scope = scopeClause(def, user);
  if (scope) {
    where.push(scope.sql);
    params.push(...scope.params);
  }
  if (q.q?.trim()) {
    const term = `%${q.q.trim().replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    where.push(`(${def.search.map((s) => `${s} LIKE ? ESCAPE '\\'`).join(" OR ")})`);
    params.push(...def.search.map(() => term));
  }
  for (const [key, col] of Object.entries(def.filters)) {
    const v = q[key];
    if (!v) continue;
    if (v === "__none") {
      where.push(`${col} IS NULL`);
      continue;
    }
    const vals = v.split(",").slice(0, 20);
    where.push(`${col} IN (${vals.map(() => "?").join(",")})`);
    params.push(...vals);
  }
  for (const [key, fn] of Object.entries(def.customFilters ?? {})) {
    if (!q[key]) continue;
    const f = fn(q[key], user);
    if (f) {
      where.push(f.sql);
      params.push(...f.params);
    }
  }

  const sortCol = def.sorts[q.sort ?? ""] ?? def.sorts[def.defaultSort];
  const dir = q.dir === "asc" || q.dir === "desc" ? q.dir : (def.defaultDir ?? "desc");
  const pageSize = Math.min(Math.max(parseInt(q.pageSize ?? "25", 10) || 25, 1), MAX_PAGE);
  const page = Math.max(parseInt(q.page ?? "1", 10) || 1, 1);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [rows, count] = await c.env.DB.batch<Row>([
    c.env.DB.prepare(
      `SELECT ${def.select} FROM ${def.from} ${whereSql} ORDER BY ${sortCol} ${dir} NULLS LAST, t.id LIMIT ? OFFSET ?`,
    ).bind(...params, pageSize, (page - 1) * pageSize),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM ${def.from} ${whereSql}`).bind(...params),
  ]);
  const data = def.redact ? rows.results.map((r) => def.redact!(r, user)) : rows.results;
  return { data, meta: { page, pageSize, total: Number(count.results[0]?.n ?? 0) } };
}

async function checkRefs(db: D1Database, def: EntityDef, data: Row) {
  for (const [col, table] of Object.entries(def.refs ?? {})) {
    const v = data[col];
    if (v === null || v === undefined) continue;
    const found = await db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).bind(v).first();
    if (!found) throw new ApiError(400, "invalid_reference", `The selected ${col.replace(/_id$/, "").replace(/_/g, " ")} does not exist`, { field: col });
  }
}

function canWrite(def: EntityDef, user: SessionUser) {
  if (!def.writeRoles.includes(user.role)) throw forbidden();
}

function columnsOf(def: EntityDef, data: Row) {
  const virtual = new Set(["force", "reopen", ...(def.virtual ?? [])]);
  return Object.fromEntries(Object.entries(data).filter(([k, v]) => !virtual.has(k) && v !== undefined));
}

export async function createRow(c: Ctx, def: EntityDef, input: Row) {
  const user = c.get("user");
  canWrite(def, user);
  const owner = def.ownerColumn ?? "owner_id";
  if (owner in def.schema.shape) {
    if (!input[owner]) input[owner] = user.id;
    else if (!isManager(user) && input[owner] !== user.id && def.entityType !== "task") {
      throw forbidden("Sales representatives can only assign records to themselves");
    }
  }
  await checkRefs(c.env.DB, def, input);
  await def.beforeWrite?.(c, input, null);
  const id = newId();
  const t = now();
  const row: Row = { ...columnsOf(def, input), ...(def.derive?.(input, null) ?? {}), id, created_at: t, updated_at: t };
  if ("created_by" in (await tableColumns(c.env.DB, def.table))) row.created_by = user.id;
  const cols = Object.keys(row);
  const stmts = [
    c.env.DB.prepare(`INSERT INTO ${def.table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).bind(
      ...cols.map((k) => b(row[k])),
    ),
    auditStmt(c.env.DB, { actorId: user.id, action: "create", entityType: def.entityType, entityId: id, summary: `Created ${def.label.toLowerCase()} "${def.titleOf(row)}"`, ip: clientIp(c) }),
    ...(def.extraStatements?.(c, id, input, null, row) ?? []),
  ];
  await c.env.DB.batch(stmts);
  return fetchOne(c, def, id);
}

export async function loadRaw(c: Ctx, def: EntityDef, id: string): Promise<Row> {
  // Enforce the same visibility rules as reads before loading the raw row.
  await fetchOne(c, def, id);
  const row = await c.env.DB.prepare(`SELECT * FROM ${def.table} WHERE id = ?`).bind(id).first<Row>();
  if (!row) throw notFound(def.label);
  return row;
}

export async function updateRow(c: Ctx, def: EntityDef, id: string, input: Row) {
  const user = c.get("user");
  canWrite(def, user);
  const existing = await loadRaw(c, def, id);
  const owner = def.ownerColumn ?? "owner_id";
  if (input[owner] && input[owner] !== existing[owner] && !isManager(user) && def.entityType !== "task") {
    throw forbidden("Only managers can reassign ownership");
  }
  await checkRefs(c.env.DB, def, input);
  await def.beforeWrite?.(c, input, existing);
  const merged = { ...existing, ...columnsOf(def, input) };
  const patch: Row = { ...columnsOf(def, input), ...(def.derive?.(merged, existing) ?? {}) };
  const changes = diff(existing, patch);
  const extra = def.extraStatements?.(c, id, input, existing, { ...existing, ...patch }) ?? [];
  if (Object.keys(changes).length === 0 && extra.length === 0) return fetchOne(c, def, id);
  patch.updated_at = now();
  const cols = Object.keys(patch);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE ${def.table} SET ${cols.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).bind(
      ...cols.map((k) => b(patch[k])),
      id,
    ),
    ...(Object.keys(changes).length
      ? [auditStmt(c.env.DB, { actorId: user.id, action: "update", entityType: def.entityType, entityId: id, summary: `Updated ${def.label.toLowerCase()} "${def.titleOf({ ...existing, ...patch })}"`, changes, ip: clientIp(c) })]
      : []),
    ...extra,
  ]);
  return fetchOne(c, def, id);
}

async function setArchived(c: Ctx, def: EntityDef, id: string, archived: boolean) {
  const user = c.get("user");
  canWrite(def, user);
  const existing = await loadRaw(c, def, id);
  const t = now();
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE ${def.table} SET archived_at = ?, updated_at = ? WHERE id = ?`).bind(archived ? t : null, t, id),
    auditStmt(c.env.DB, { actorId: user.id, action: archived ? "archive" : "restore", entityType: def.entityType, entityId: id, summary: `${archived ? "Archived" : "Restored"} ${def.label.toLowerCase()} "${def.titleOf(existing)}"`, ip: clientIp(c) }),
  ]);
  return fetchOne(c, def, id);
}

const columnCache = new Map<string, Record<string, true>>();
async function tableColumns(db: D1Database, table: string) {
  let cols = columnCache.get(table);
  if (!cols) {
    const r = await db.prepare(`SELECT name FROM pragma_table_info(?)`).bind(table).all<{ name: string }>();
    cols = Object.fromEntries(r.results.map((x) => [x.name, true as const]));
    columnCache.set(table, cols);
  }
  return cols;
}

export function entityRoutes(def: EntityDef) {
  const r = new Hono<AppEnv>();
  r.get("/", async (c) => c.json(await listRows(c, def)));
  r.get("/:id", async (c) => c.json({ data: await fetchOne(c, def, c.req.param("id")) }));
  r.post("/", async (c) => {
    const input = (await parseJson(c, def.schema)) as Row;
    return c.json({ data: await createRow(c, def, input) }, 201);
  });
  r.patch("/:id", async (c) => {
    // Only validate keys that were sent; defaults must not overwrite stored values.
    const raw = (await c.req.json().catch(() => null)) as Row | null;
    if (!raw || typeof raw !== "object") throw new ApiError(400, "invalid_json", "Request body must be JSON");
    const input = def.schema.partial().parse(raw) as Row;
    for (const k of Object.keys(input)) if (!(k in raw)) delete input[k];
    return c.json({ data: await updateRow(c, def, c.req.param("id"), input) });
  });
  r.post("/:id/archive", async (c) => c.json({ data: await setArchived(c, def, c.req.param("id"), true) }));
  r.post("/:id/restore", async (c) => c.json({ data: await setArchived(c, def, c.req.param("id"), false) }));
  return r;
}

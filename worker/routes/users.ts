import { Hono } from "hono";
import type { AppEnv } from "../env";
import { userCreateSchema, userUpdateSchema } from "../../shared/schemas";
import { ApiError, notFound, parseJson } from "../lib/http";
import { clientIp, hashPassword, requireRole } from "../lib/auth";
import { auditStmt, diff } from "../lib/audit-log";
import { newId, now } from "../lib/util";

export const userRoutes = new Hono<AppEnv>();
const PUBLIC = "id, email, name, role, status, timezone, last_login_at, created_at";

/** Directory for owner pickers; admins may pass all=1 to include disabled users. */
userRoutes.get("/", async (c) => {
  const all = c.req.query("all") === "1" && c.get("user").role === "admin";
  const r = await c.env.DB.prepare(`SELECT ${PUBLIC} FROM users ${all ? "" : "WHERE status = 'active'"} ORDER BY name`).all();
  return c.json({ data: r.results });
});

userRoutes.get("/me", (c) => c.json({ data: { ...c.get("user"), sessionId: undefined } }));

userRoutes.patch("/me", async (c) => {
  const input = await parseJson(c, userUpdateSchema.pick({ name: true, timezone: true, password: true }));
  const me = c.get("user");
  const patch: Record<string, unknown> = {};
  if (input.name) patch.name = input.name;
  if (input.timezone) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: input.timezone });
    } catch {
      throw new ApiError(400, "validation_error", "Unknown timezone");
    }
    patch.timezone = input.timezone;
  }
  if (input.password) {
    const pw = await hashPassword(input.password);
    Object.assign(patch, { password_hash: pw.hash, password_salt: pw.salt, password_iterations: pw.iterations });
  }
  const cols = Object.keys(patch);
  if (!cols.length) return c.json({ data: { ok: true } });
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET ${cols.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).bind(
      ...cols.map((k) => patch[k]),
      now(),
      me.id,
    ),
    auditStmt(c.env.DB, {
      actorId: me.id,
      action: "update",
      entityType: "user",
      entityId: me.id,
      summary: input.password ? "Changed own profile and password" : "Changed own profile",
      ip: clientIp(c),
    }),
  ]);
  return c.json({ data: { ok: true } });
});

userRoutes.post("/", requireRole("admin"), async (c) => {
  const input = await parseJson(c, userCreateSchema);
  const pw = await hashPassword(input.password);
  const id = newId();
  const t = now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO users (id, email, name, role, password_hash, password_salt, password_iterations, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
    ).bind(id, input.email.toLowerCase(), input.name, input.role, pw.hash, pw.salt, pw.iterations, t, t),
    auditStmt(c.env.DB, {
      actorId: c.get("user").id,
      action: "create",
      entityType: "user",
      entityId: id,
      summary: `Created user ${input.email} (${input.role})`,
      ip: clientIp(c),
    }),
  ]);
  return c.json({ data: await c.env.DB.prepare(`SELECT ${PUBLIC} FROM users WHERE id = ?`).bind(id).first() }, 201);
});

userRoutes.patch("/:id", requireRole("admin"), async (c): Promise<Response> => {
  const id = c.req.param("id");
  const input = await parseJson(c, userUpdateSchema);
  const existing = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!existing) throw notFound("User");
  const demoting = (input.role && input.role !== "admin") || input.status === "disabled";
  if (existing.role === "admin" && existing.status === "active" && demoting) {
    const n = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active'").first<{ n: number }>();
    if ((n?.n ?? 0) <= 1) throw new ApiError(409, "last_admin", "At least one active administrator is required");
  }
  const patch: Record<string, unknown> = {};
  if (input.name) patch.name = input.name;
  if (input.role) patch.role = input.role;
  if (input.status) patch.status = input.status;
  if (input.timezone) patch.timezone = input.timezone;
  if (input.password) {
    const pw = await hashPassword(input.password);
    Object.assign(patch, { password_hash: pw.hash, password_salt: pw.salt, password_iterations: pw.iterations });
  }
  const cols = Object.keys(patch);
  if (!cols.length) return c.json({ data: { id } });
  const changes = diff(existing, patch);
  const stmts = [
    c.env.DB.prepare(`UPDATE users SET ${cols.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).bind(
      ...cols.map((k) => patch[k]),
      now(),
      id,
    ),
    auditStmt(c.env.DB, {
      actorId: c.get("user").id,
      action: changes.role ? "permission_change" : "update",
      entityType: "user",
      entityId: id,
      summary: `Updated user ${existing.email}${input.password ? " (password reset)" : ""}`,
      changes,
      ip: clientIp(c),
    }),
  ];
  // Disabling a user or resetting their password ends their existing sessions.
  if (input.status === "disabled" || input.password) stmts.push(c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id));
  await c.env.DB.batch(stmts);
  return c.json({ data: await c.env.DB.prepare(`SELECT ${PUBLIC} FROM users WHERE id = ?`).bind(id).first() });
});

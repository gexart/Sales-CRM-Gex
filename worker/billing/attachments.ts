import { Hono } from "hono";
import type { AppEnv } from "../env";
import { ApiError } from "../lib/http";
import { newId, now } from "../lib/util";
import { hasPermission } from "../../shared/access";
import { loadAccess, recordAudit } from "./access";

/** Files attached to billing records. Stored privately in R2; only people with billing access can list or open them. */
export const attachmentRoutes = new Hono<AppEnv>();

const TYPES = new Set(["invoice", "document", "purchase", "expense"]);
const MAX_FILES = 5;
const MAX_BYTES = 5 * 1024 * 1024;
const OK_MIME = /^(application\/pdf|image\/(png|jpeg|webp|gif)|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet)|application\/(msword|vnd\.ms-excel)|text\/(plain|csv))$/;

attachmentRoutes.use("*", async (c, next) => {
  if (!hasPermission(await loadAccess(c), "billing.access")) throw new ApiError(403, "forbidden", "You do not have access to billing");
  await next();
});

attachmentRoutes.get("/", async (c) => {
  const type = c.req.query("entity_type") ?? "";
  const id = c.req.query("entity_id") ?? "";
  if (!TYPES.has(type) || !id) throw new ApiError(400, "bad_request", "entity_type and entity_id are required");
  const r = await c.env.DB.prepare("SELECT a.id, a.file_name, a.mime_type, a.size_bytes, a.created_at, u.name AS uploaded_by_name FROM billing_attachments a JOIN users u ON u.id = a.uploaded_by WHERE a.entity_type = ? AND a.entity_id = ? ORDER BY a.created_at")
    .bind(type, id)
    .all();
  return c.json({ data: r.results ?? [] });
});

attachmentRoutes.post("/", async (c) => {
  const form = await c.req.formData();
  const type = String(form.get("entity_type") ?? "");
  const entityId = String(form.get("entity_id") ?? "");
  const file = form.get("file");
  if (!TYPES.has(type) || !entityId || !file || typeof file === "string") throw new ApiError(400, "bad_request", "Choose a file to attach");
  const f = file as File;
  if (f.size > MAX_BYTES) throw new ApiError(400, "too_large", "Each file can be up to 5 MB");
  if (!OK_MIME.test(f.type)) throw new ApiError(400, "unsupported_type", "Attach a PDF, image, Word, Excel or text file");
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM billing_attachments WHERE entity_type = ? AND entity_id = ?").bind(type, entityId).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_FILES) throw new ApiError(409, "limit", `At most ${MAX_FILES} files per record`);
  const user = c.get("user");
  const id = newId();
  const safe = f.name.replace(/[^\w.-]+/g, "_").slice(-80) || "file";
  const key = `billing/${type}/${entityId}/${id}-${safe}`;
  await c.env.FILES.put(key, f.stream(), { httpMetadata: { contentType: f.type }, customMetadata: { user: user.id } });
  await c.env.DB.prepare("INSERT INTO billing_attachments (id, entity_type, entity_id, file_name, mime_type, size_bytes, file_key, uploaded_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .bind(id, type, entityId, f.name.slice(0, 120), f.type, f.size, key, user.id, now())
    .run();
  c.executionCtx.waitUntil(recordAudit(c.env.DB, { actorId: user.id, actorName: user.name, action: "attachment.add", entityType: type, entityId, detail: { name: f.name, size: f.size }, status: 201, ip: c.req.header("cf-connecting-ip") }));
  return c.json({ data: { id } }, 201);
});

attachmentRoutes.get("/:id/file", async (c) => {
  const row = await c.env.DB.prepare("SELECT * FROM billing_attachments WHERE id = ?").bind(c.req.param("id")).first<Record<string, string>>();
  if (!row) throw new ApiError(404, "not_found", "File not found");
  const obj = await c.env.FILES.get(row.file_key);
  if (!obj) throw new ApiError(404, "not_found", "File not found");
  return new Response(obj.body, { headers: { "content-type": row.mime_type, "content-disposition": `inline; filename="${row.file_name.replace(/"/g, "")}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
});

attachmentRoutes.delete("/:id", async (c) => {
  const user = c.get("user");
  const row = await c.env.DB.prepare("SELECT * FROM billing_attachments WHERE id = ?").bind(c.req.param("id")).first<Record<string, string>>();
  if (!row) throw new ApiError(404, "not_found", "File not found");
  if (row.uploaded_by !== user.id && user.role !== "admin") throw new ApiError(403, "forbidden", "Only the person who attached it can remove it");
  await c.env.FILES.delete(row.file_key);
  await c.env.DB.prepare("DELETE FROM billing_attachments WHERE id = ?").bind(row.id).run();
  c.executionCtx.waitUntil(recordAudit(c.env.DB, { actorId: user.id, actorName: user.name, action: "attachment.remove", entityType: row.entity_type, entityId: row.entity_id, detail: { name: row.file_name }, status: 200, ip: c.req.header("cf-connecting-ip") }));
  return c.json({ data: { id: row.id } });
});

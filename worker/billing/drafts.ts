import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { ApiError } from "../lib/http";
import { newId, now } from "../lib/util";
import { hasPermission } from "../../shared/access";
import { loadAccess } from "./access";

/** "Save as draft": half-finished invoices, quotations and bills, private to the person who started them. */
export const draftRoutes = new Hono<AppEnv>();

draftRoutes.use("*", async (c, next) => {
  if (!hasPermission(await loadAccess(c), "billing.access")) throw new ApiError(403, "forbidden", "You do not have access to billing");
  await next();
});

const body = z.object({ kind: z.string().min(1).max(60), title: z.string().max(200).optional(), payload: z.record(z.string(), z.unknown()) });

draftRoutes.get("/", async (c) => {
  const kind = c.req.query("kind");
  const rows = await c.env.DB.prepare(`SELECT id, kind, title, updated_at FROM billing_drafts WHERE user_id = ? ${kind ? "AND kind = ?" : ""} ORDER BY updated_at DESC LIMIT 100`)
    .bind(...(kind ? [c.get("user").id, kind] : [c.get("user").id]))
    .all();
  return c.json({ data: rows.results ?? [] });
});

draftRoutes.get("/:id", async (c) => {
  const r = await c.env.DB.prepare("SELECT * FROM billing_drafts WHERE id = ? AND user_id = ?").bind(c.req.param("id"), c.get("user").id).first<Record<string, string>>();
  if (!r) throw new ApiError(404, "not_found", "Draft not found");
  return c.json({ data: { ...r, payload: JSON.parse(r.payload) } });
});

draftRoutes.post("/", async (c) => {
  const d = body.parse(await c.req.json());
  const id = newId();
  const t = now();
  await c.env.DB.prepare("INSERT INTO billing_drafts (id, user_id, kind, title, payload, created_at, updated_at) VALUES (?,?,?,?,?,?,?)").bind(id, c.get("user").id, d.kind, d.title ?? null, JSON.stringify(d.payload), t, t).run();
  return c.json({ data: { id } }, 201);
});

draftRoutes.put("/:id", async (c) => {
  const d = body.parse(await c.req.json());
  const r = await c.env.DB.prepare("UPDATE billing_drafts SET title = ?, payload = ?, updated_at = ? WHERE id = ? AND user_id = ?").bind(d.title ?? null, JSON.stringify(d.payload), now(), c.req.param("id"), c.get("user").id).run();
  if (!r.meta.changes) throw new ApiError(404, "not_found", "Draft not found");
  return c.json({ data: { id: c.req.param("id") } });
});

draftRoutes.delete("/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM billing_drafts WHERE id = ? AND user_id = ?").bind(c.req.param("id"), c.get("user").id).run();
  return c.json({ data: { id: c.req.param("id") } });
});

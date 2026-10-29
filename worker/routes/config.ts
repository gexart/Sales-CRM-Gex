import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Env } from "../env";
import { ApiError, parseJson } from "../lib/http";
import { auditStmt } from "../lib/audit-log";
import { clientIp, requireRole } from "../lib/auth";
import { encryptSecret, invalidateSettings } from "../lib/settings";
import { CONFIG_FIELDS, CONFIG_SECTIONS, checkConfigValue } from "../../shared/config";
import { now } from "../lib/util";

export const configRoutes = new Hono<AppEnv>();
configRoutes.use("*", requireRole("admin"));

const read = (env: Env, key: string) => (env as unknown as Record<string, string | undefined>)[key] || null;
const mask = (v: string) => `••••${v.length > 8 ? v.slice(-4) : ""}`;

configRoutes.get("/", async (c) => {
  const rows = await c.env.DB.prepare("SELECT s.key, s.updated_at, u.name AS updated_by FROM app_settings s LEFT JOIN users u ON u.id = s.updated_by").all<{ key: string; updated_at: string; updated_by: string | null }>();
  const saved = new Map(rows.results.map((r) => [r.key, r]));
  const raw = c.env.__raw ?? c.env;
  const values = CONFIG_FIELDS.map((f) => {
    const s = saved.get(f.key);
    const effective = read(c.env, f.key);
    const source = s && effective ? "crm" : read(raw, f.key) ? "worker" : "none";
    return {
      key: f.key,
      source,
      // Secrets never leave the server in full; plain settings are returned so they can be edited.
      value: f.kind === "secret" ? null : effective,
      preview: f.kind === "secret" && effective ? mask(effective) : null,
      updated_at: s?.updated_at ?? null,
      updated_by: s?.updated_by ?? null,
    };
  });
  const hook = read(c.env, "BREVO_WEBHOOK_SECRET");
  return c.json({
    data: {
      sections: CONFIG_SECTIONS,
      values,
      encryption: c.env.SETTINGS_ENCRYPTION_KEY ? "worker_secret" : "database_key",
      brevo_webhook_url: hook ? `${new URL(c.req.url).origin}/api/v1/webhooks/brevo?token=${encodeURIComponent(hook)}` : null,
    },
  });
});

const updateSchema = z.object({ values: z.record(z.string(), z.string().max(2000).nullable()) });

configRoutes.put("/", async (c) => {
  const { values } = await parseJson(c, updateSchema);
  const user = c.get("user");
  const t = now();
  const errors: Record<string, string> = {};
  const stmts: D1PreparedStatement[] = [];
  const changed: string[] = [];
  for (const [key, rawValue] of Object.entries(values)) {
    const f = CONFIG_FIELDS.find((x) => x.key === key);
    if (!f) throw new ApiError(400, "validation_error", `Unknown setting ${key}`);
    const v = (rawValue ?? "").trim();
    if (!v) {
      stmts.push(c.env.DB.prepare("DELETE FROM app_settings WHERE key = ?").bind(key));
      changed.push(`${key} cleared`);
      continue;
    }
    const err = checkConfigValue(f, v);
    if (err) {
      errors[key] = err;
      continue;
    }
    const stored = f.kind === "secret" ? await encryptSecret(c.env, v) : v;
    stmts.push(
      c.env.DB.prepare(
        "INSERT INTO app_settings (key, value, is_secret, updated_by, updated_at) VALUES (?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, is_secret = excluded.is_secret, updated_by = excluded.updated_by, updated_at = excluded.updated_at",
      ).bind(key, stored, f.kind === "secret" ? 1 : 0, user.id, t),
    );
    changed.push(key);
  }
  if (Object.keys(errors).length) throw new ApiError(400, "validation_error", "Some settings are not valid", errors);
  if (!stmts.length) return c.json({ data: { ok: true, changed: [] } });
  // Values are never written to the audit log, only which settings changed.
  stmts.push(auditStmt(c.env.DB, { actorId: user.id, action: "settings_update", entityType: "settings", entityId: null, summary: `Updated ${changed.join(", ")}`.slice(0, 500), ip: clientIp(c) }));
  await c.env.DB.batch(stmts);
  invalidateSettings();
  return c.json({ data: { ok: true, changed } });
});

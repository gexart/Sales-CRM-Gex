// Sales asset files in private R2. Objects are never public: downloads stream through
// this Worker after the same visibility check as the asset record.
import { Hono, type Context } from "hono";
import type { AppEnv, Env } from "../env";
import { assetLinkSchema } from "../../shared/schemas";
import { ASSET_MAX_BYTES, ASSET_MIME_TYPES, ASSET_TYPES, ASSET_VISIBILITY } from "../../shared/enums";
import { ApiError, notFound, parseJson } from "../lib/http";
import { auditStmt } from "../lib/audit-log";
import { clientIp, isManager } from "../lib/auth";
import { fetchOne, type EntityDef } from "../lib/entity";
import { b, newId, now } from "../lib/util";
import { ENTITIES } from "../entities";

type Row = Record<string, unknown>;
export const assetRoutes = new Hono<AppEnv>();

const LINK_DEFS: Record<string, EntityDef | null> = {
  account: ENTITIES.accounts,
  contact: ENTITIES.contacts,
  campaign: ENTITIES.campaigns,
  opportunity: ENTITIES.opportunities,
  product: ENTITIES.products,
  prospect: ENTITIES.prospects,
  outreach: ENTITIES.outreach,
  audit_run: null,
};

async function assertLinkable(c: Context<AppEnv>, type: string, id: string) {
  const def = LINK_DEFS[type];
  if (def) return void (await fetchOne(c, def, id));
  const run = await c.env.DB.prepare("SELECT account_id FROM audit_runs WHERE id = ?").bind(id).first<{ account_id: string }>();
  if (!run) throw notFound("Audit");
  await fetchOne(c, ENTITIES.accounts, run.account_id);
}

const safeName = (n: string) => n.replace(/[^\w.() -]+/g, "_").slice(-120) || "file";

/** Stores bytes as a new asset (used by uploads and by the PDF/PPT generators). */
export async function storeAsset(
  env: Env,
  a: { userId: string; name: string; type: string; description?: string | null; visibility?: string; fileName: string; mime: string; body: ReadableStream | ArrayBuffer | Uint8Array; size: number; source: "upload" | "generated"; previousVersionId?: string | null; links?: { type: string; id: string }[]; intendedIndustry?: string | null },
) {
  const id = newId();
  const key = `assets/${id}/${safeName(a.fileName)}`;
  let version = 1;
  if (a.previousVersionId) {
    const prev = await env.DB.prepare("SELECT version FROM sales_assets WHERE id = ?").bind(a.previousVersionId).first<{ version: number }>();
    if (!prev) throw notFound("Previous version");
    version = prev.version + 1;
  }
  await env.FILES.put(key, a.body, { httpMetadata: { contentType: a.mime }, customMetadata: { asset: id } });
  const t = now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO sales_assets (id, name, description, type, file_key, file_name, mime_type, size_bytes, intended_industry, version, previous_version_id, owner_id, visibility, source, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(id, a.name, b(a.description), a.type, key, safeName(a.fileName), a.mime, a.size, b(a.intendedIndustry), version, b(a.previousVersionId), a.userId, a.visibility ?? "internal", a.source, a.userId, t, t),
    // New versions inherit the previous version's links so attachments keep pointing at the latest file.
    ...(a.previousVersionId
      ? [env.DB.prepare("INSERT OR IGNORE INTO asset_associations (asset_id, entity_type, entity_id, created_by, created_at) SELECT ?, entity_type, entity_id, ?, ? FROM asset_associations WHERE asset_id = ?").bind(id, a.userId, t, a.previousVersionId)]
      : []),
    ...(a.links ?? []).map((l) => env.DB.prepare("INSERT OR IGNORE INTO asset_associations (asset_id, entity_type, entity_id, created_by, created_at) VALUES (?,?,?,?,?)").bind(id, l.type, l.id, a.userId, t)),
    env.DB.prepare("INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, summary, created_at) VALUES (?,?,?,?,?,?,?)").bind(
      newId(), a.userId, a.source === "generated" ? "generate" : "upload", "sales_asset", id, `${a.source === "generated" ? "Generated" : "Uploaded"} ${a.name} (v${version})`, t,
    ),
  ]);
  return { id, version, key };
}

assetRoutes.post("/upload", async (c) => {
  const user = c.get("user");
  const form = await c.req.formData().catch(() => {
    throw new ApiError(400, "invalid_body", "Expected multipart/form-data");
  });
  const file = form.get("file");
  if (!file || typeof file === "string") throw new ApiError(400, "validation_error", "Choose a file to upload");
  const f = file as File;
  if (f.size > ASSET_MAX_BYTES) throw new ApiError(400, "too_large", `Files must be ${ASSET_MAX_BYTES / 1024 / 1024} MB or smaller`);
  if (!ASSET_MIME_TYPES[f.type]) throw new ApiError(400, "unsupported_type", `File type ${f.type || "unknown"} is not allowed. Allowed: PDF, PPTX, DOCX, XLSX, CSV, TXT, PNG, JPG, WEBP, MP4.`);
  const str = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const previous = str("previous_version_id");
  let prev: Row | null = null;
  if (previous) {
    prev = await fetchOne(c, ENTITIES.assets, previous);
    if (!isManager(user) && prev.owner_id !== user.id) throw new ApiError(403, "forbidden", "Only the owner or a manager can upload a new version");
  }
  const type = (prev?.type as string) ?? str("type") ?? "other";
  if (!ASSET_TYPES.values.includes(type as never)) throw new ApiError(400, "validation_error", "Unknown asset type");
  const visibility = (prev?.visibility as string) ?? str("visibility") ?? "internal";
  if (!ASSET_VISIBILITY.values.includes(visibility as never)) throw new ApiError(400, "validation_error", "Unknown visibility");
  const links: { type: string; id: string }[] = [];
  if (str("link_type") && str("link_id")) {
    await assertLinkable(c, str("link_type")!, str("link_id")!);
    links.push({ type: str("link_type")!, id: str("link_id")! });
  }
  const r = await storeAsset(c.env, {
    userId: user.id,
    name: ((prev?.name as string) ?? str("name") ?? f.name).slice(0, 200),
    type,
    description: (prev?.description as string) ?? str("description"),
    visibility,
    intendedIndustry: (prev?.intended_industry as string) ?? str("intended_industry"),
    fileName: f.name,
    mime: f.type,
    body: f.stream(),
    size: f.size,
    source: "upload",
    previousVersionId: previous,
    links,
  });
  return c.json({ data: await fetchOne(c, ENTITIES.assets, r.id) }, 201);
});

assetRoutes.get("/:id/download", async (c) => {
  const a = await fetchOne(c, ENTITIES.assets, c.req.param("id"));
  if (!a.file_key) {
    if (a.external_url) return c.redirect(String(a.external_url));
    throw notFound("File");
  }
  const obj = await c.env.FILES.get(String(a.file_key));
  if (!obj) throw notFound("File");
  const inline = c.req.query("inline") === "1" && /^(application\/pdf|image\/)/.test(String(a.mime_type));
  c.executionCtx.waitUntil(auditStmt(c.env.DB, { actorId: c.get("user").id, action: "download", entityType: "sales_asset", entityId: String(a.id), summary: `Downloaded ${a.name}`, ip: clientIp(c) }).run());
  return new Response(obj.body, {
    headers: {
      "content-type": String(a.mime_type ?? "application/octet-stream"),
      "content-length": String(obj.size),
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${String(a.file_name ?? "file").replace(/"/g, "")}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
});

assetRoutes.get("/:id/versions", async (c) => {
  const a = await fetchOne(c, ENTITIES.assets, c.req.param("id"));
  // Walk back through previous_version_id and forward through successors.
  const r = await c.env.DB.prepare(
    `WITH RECURSIVE back(id) AS (SELECT ? UNION SELECT s.previous_version_id FROM sales_assets s JOIN back ON s.id = back.id WHERE s.previous_version_id IS NOT NULL),
       fwd(id) AS (SELECT ? UNION SELECT s.id FROM sales_assets s JOIN fwd ON s.previous_version_id = fwd.id)
     SELECT s.id, s.name, s.version, s.file_name, s.size_bytes, s.created_at, u.name AS owner_name FROM sales_assets s LEFT JOIN users u ON u.id = s.owner_id
     WHERE s.id IN (SELECT id FROM back UNION SELECT id FROM fwd) ORDER BY s.version DESC`,
  )
    .bind(a.id, a.id)
    .all();
  return c.json({ data: r.results });
});

assetRoutes.get("/:id/links", async (c) => {
  const a = await fetchOne(c, ENTITIES.assets, c.req.param("id"));
  const r = await c.env.DB.prepare(
    `SELECT aa.entity_type, aa.entity_id, aa.created_at,
       COALESCE(ac.name, (ct.first_name || COALESCE(' ' || ct.last_name,'')), cp.name, o.name, p.name, pr.company_name, om.title, ar.audit_type) AS label
     FROM asset_associations aa
       LEFT JOIN accounts ac ON aa.entity_type = 'account' AND ac.id = aa.entity_id
       LEFT JOIN contacts ct ON aa.entity_type = 'contact' AND ct.id = aa.entity_id
       LEFT JOIN campaigns cp ON aa.entity_type = 'campaign' AND cp.id = aa.entity_id
       LEFT JOIN opportunities o ON aa.entity_type = 'opportunity' AND o.id = aa.entity_id
       LEFT JOIN products p ON aa.entity_type = 'product' AND p.id = aa.entity_id
       LEFT JOIN prospects pr ON aa.entity_type = 'prospect' AND pr.id = aa.entity_id
       LEFT JOIN outreach_messages om ON aa.entity_type = 'outreach' AND om.id = aa.entity_id
       LEFT JOIN audit_runs ar ON aa.entity_type = 'audit_run' AND ar.id = aa.entity_id
     WHERE aa.asset_id = ? ORDER BY aa.created_at DESC`,
  )
    .bind(a.id)
    .all();
  return c.json({ data: r.results });
});

assetRoutes.post("/:id/links", async (c) => {
  const a = await fetchOne(c, ENTITIES.assets, c.req.param("id"));
  const input = await parseJson(c, assetLinkSchema);
  await assertLinkable(c, input.entity_type, input.entity_id);
  await c.env.DB.prepare("INSERT OR IGNORE INTO asset_associations (asset_id, entity_type, entity_id, created_by, created_at) VALUES (?,?,?,?,?)")
    .bind(a.id, input.entity_type, input.entity_id, c.get("user").id, now())
    .run();
  return c.json({ data: { ok: true } }, 201);
});

assetRoutes.delete("/:id/links/:type/:eid", async (c) => {
  const a = await fetchOne(c, ENTITIES.assets, c.req.param("id"));
  await c.env.DB.prepare("DELETE FROM asset_associations WHERE asset_id = ? AND entity_type = ? AND entity_id = ?").bind(a.id, c.req.param("type"), c.req.param("eid")).run();
  return c.json({ data: { ok: true } });
});

export type { Row };

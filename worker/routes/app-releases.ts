// Android app builds: stored privately in R2 and downloadable by signed-in users, or through a
// short-lived signed link (for the QR code a phone scans). Builds come from an admin upload or from
// the GitHub Actions workflow's android-v* releases (imported on demand and hourly by the cron).
import { Hono } from "hono";
import type { AppEnv, Env } from "../env";
import { ApiError, notFound } from "../lib/http";
import { auditStmt } from "../lib/audit-log";
import { clientIp, requireRole } from "../lib/auth";
import { signToken, verifyToken } from "../lib/settings";
import { b, newId, now } from "../lib/util";

export const APK_MAX_BYTES = 80 * 1024 * 1024;
const APK_MIME = "application/vnd.android.package-archive";
const LINK_TTL_S = 30 * 60;

interface Release {
  id: string;
  version_name: string;
  source: string;
  source_ref: string | null;
  file_key: string;
  file_name: string;
  size_bytes: number;
  sha256: string;
  notes: string | null;
  created_at: string;
  created_by_name?: string | null;
}

const SELECT = "SELECT r.*, u.name AS created_by_name FROM app_releases r LEFT JOIN users u ON u.id = r.created_by";

async function sha256(buf: ArrayBuffer) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function storeRelease(env: Env, r: { buf: ArrayBuffer; versionName: string; source: "upload" | "github"; sourceRef?: string | null; notes?: string | null; userId: string | null }) {
  const head = new Uint8Array(r.buf, 0, Math.min(4, r.buf.byteLength));
  // An APK is a ZIP archive.
  if (head.length < 4 || head[0] !== 0x50 || head[1] !== 0x4b || head[2] !== 0x03 || head[3] !== 0x04) throw new ApiError(400, "validation_error", "That file is not an Android APK");
  if (r.buf.byteLength > APK_MAX_BYTES) throw new ApiError(400, "validation_error", "APK is larger than 80 MB");
  const id = newId();
  const version = r.versionName.replace(/[^\w.+-]/g, "").slice(0, 40) || "build";
  const fileName = `GexartCalls-${version}.apk`;
  const key = `apps/android/${id}/${fileName}`;
  await env.FILES.put(key, r.buf, { httpMetadata: { contentType: APK_MIME }, customMetadata: { release: id } });
  const t = now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO app_releases (id, platform, version_name, source, source_ref, file_key, file_name, size_bytes, sha256, notes, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").bind(
      id, "android", version, r.source, b(r.sourceRef), key, fileName, r.buf.byteLength, await sha256(r.buf), b(r.notes?.slice(0, 2000)), r.userId, t,
    ),
    auditStmt(env.DB, { actorId: r.userId, action: "app_release", entityType: "app_release", entityId: id, summary: `Published Android app ${version} (${r.source})` }),
  ]);
  return env.DB.prepare(`${SELECT} WHERE r.id = ?`).bind(id).first<Release>();
}

/** Imports the newest android-v* GitHub release if it is not already stored. */
export async function syncGithubRelease(env: Env, userId: string | null): Promise<{ imported: boolean; message: string; release: Release | null }> {
  const repo = env.GITHUB_REPO;
  if (!repo) throw new ApiError(400, "not_configured", "Set the GitHub repository in Settings → Configuration");
  const headers: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "gexart-crm", "x-github-api-version": "2022-11-28" };
  if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=20`, { headers });
  if (!res.ok) throw new ApiError(502, "provider_error", res.status === 404 ? `GitHub repository ${repo} was not found (private repositories need a token)` : `GitHub returned ${res.status}`);
  const list = (await res.json()) as { tag_name: string; body: string | null; draft: boolean; assets: { name: string; size: number; url: string }[] }[];
  const rel = list.find((x) => !x.draft && x.tag_name.startsWith("android-v") && x.assets.some((a) => a.name.endsWith(".apk")));
  if (!rel) return { imported: false, message: "No Android build has been published on GitHub yet", release: null };
  const existing = await env.DB.prepare(`${SELECT} WHERE r.platform = 'android' AND r.source_ref = ?`).bind(rel.tag_name).first<Release>();
  if (existing) return { imported: false, message: `Already up to date (${existing.version_name})`, release: existing };
  const asset = rel.assets.find((a) => a.name.endsWith(".apk"))!;
  if (asset.size > APK_MAX_BYTES) throw new ApiError(400, "validation_error", "The GitHub build is larger than 80 MB");
  // The asset URL redirects to storage that rejects our Authorization header, so follow it manually.
  let file = await fetch(asset.url, { headers: { ...headers, accept: "application/octet-stream" }, redirect: "manual" });
  const loc = file.headers.get("location");
  if (file.status >= 300 && file.status < 400 && loc) file = await fetch(loc, { headers: { "user-agent": "gexart-crm" } });
  if (!file.ok) throw new ApiError(502, "provider_error", `Downloading the build from GitHub failed (${file.status})`);
  const release = await storeRelease(env, { buf: await file.arrayBuffer(), versionName: rel.tag_name.replace(/^android-v/, ""), source: "github", sourceRef: rel.tag_name, notes: rel.body, userId });
  return { imported: true, message: `Imported ${release?.version_name}`, release };
}

function present(r: Release) {
  const { file_key: _k, ...rest } = r;
  return rest;
}

async function streamApk(env: Env, r: Release) {
  const obj = await env.FILES.get(r.file_key);
  if (!obj) throw notFound("App file");
  return new Response(obj.body, {
    headers: {
      "content-type": APK_MIME,
      "content-length": String(obj.size),
      "content-disposition": `attachment; filename="${r.file_name}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export const appReleaseRoutes = new Hono<AppEnv>();

appReleaseRoutes.get("/", async (c) => {
  const rows = await c.env.DB.prepare(`${SELECT} WHERE r.platform = 'android' ORDER BY r.created_at DESC LIMIT 10`).all<Release>();
  return c.json({ data: rows.results.map(present) });
});

appReleaseRoutes.get("/:id/download", async (c) => {
  const r = await c.env.DB.prepare("SELECT * FROM app_releases WHERE id = ?").bind(c.req.param("id")).first<Release>();
  if (!r) throw notFound("App build");
  return streamApk(c.env, r);
});

/** A link that works without signing in, for 30 minutes, so a phone can download by scanning a QR code. */
appReleaseRoutes.post("/:id/link", async (c) => {
  const r = await c.env.DB.prepare("SELECT id FROM app_releases WHERE id = ?").bind(c.req.param("id")).first<{ id: string }>();
  if (!r) throw notFound("App build");
  const exp = Math.floor(Date.now() / 1000) + LINK_TTL_S;
  const sig = await signToken(c.env, `apk:${r.id}:${exp}`);
  return c.json({ data: { url: `${new URL(c.req.url).origin}/api/v1/dl/android/${r.id}?exp=${exp}&sig=${sig}`, expires_at: new Date(exp * 1000).toISOString() } });
});

appReleaseRoutes.post("/", requireRole("admin"), async (c) => {
  const form = await c.req.formData().catch(() => {
    throw new ApiError(400, "invalid_body", "Expected multipart/form-data");
  });
  const file = form.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "validation_error", "Choose an .apk file");
  if (file.size > APK_MAX_BYTES) throw new ApiError(400, "validation_error", "APK is larger than 80 MB");
  const versionName = String(form.get("version_name") ?? "").trim() || new Date().toISOString().slice(0, 10);
  const release = await storeRelease(c.env, { buf: await file.arrayBuffer(), versionName, source: "upload", notes: String(form.get("notes") ?? "").trim() || null, userId: c.get("user").id });
  return c.json({ data: release && present(release) }, 201);
});

appReleaseRoutes.post("/sync", requireRole("admin"), async (c) => {
  const out = await syncGithubRelease(c.env, c.get("user").id);
  if (out.imported) await auditStmt(c.env.DB, { actorId: c.get("user").id, action: "app_release_sync", entityType: "app_release", entityId: out.release?.id ?? null, summary: out.message, ip: clientIp(c) }).run();
  return c.json({ data: { imported: out.imported, message: out.message, release: out.release && present(out.release) } });
});

appReleaseRoutes.delete("/:id", requireRole("admin"), async (c) => {
  const r = await c.env.DB.prepare("SELECT * FROM app_releases WHERE id = ?").bind(c.req.param("id")).first<Release>();
  if (!r) throw notFound("App build");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM app_releases WHERE id = ?").bind(r.id),
    auditStmt(c.env.DB, { actorId: c.get("user").id, action: "delete", entityType: "app_release", entityId: r.id, summary: `Removed Android app ${r.version_name}`, ip: clientIp(c) }),
  ]);
  await c.env.FILES.delete(r.file_key);
  return c.json({ data: { ok: true } });
});

// ─── Public, signed download (no session) ───
export const publicDownloadRoutes = new Hono<AppEnv>();

publicDownloadRoutes.get("/android/:id", async (c) => {
  const id = c.req.param("id");
  const exp = Number(c.req.query("exp"));
  const sig = c.req.query("sig") ?? "";
  if (!Number.isFinite(exp) || exp < Date.now() / 1000 || !(await verifyToken(c.env, `apk:${id}:${exp}`, sig))) {
    return c.text("This download link has expired. Open the CRM and scan a fresh QR code.", 403);
  }
  const r = await c.env.DB.prepare("SELECT * FROM app_releases WHERE id = ?").bind(id).first<Release>();
  if (!r) return c.text("This app build is no longer available.", 404);
  return streamApk(c.env, r);
});

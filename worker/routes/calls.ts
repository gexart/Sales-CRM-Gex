// Call recordings captured by the Android companion app (or uploaded manually).
// Devices authenticate with a per-device bearer token created in Settings → Devices;
// only its SHA-256 is stored. Recordings live in private R2 and are streamed only to
// authorised users. Transcripts/summaries are AI drafts and labelled as such.
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { z } from "zod";
import type { AppEnv, Env, SessionUser } from "../env";
import { deviceSchema } from "../../shared/schemas";
import { CALL_AUDIO_MIME_TYPES, CALL_MAX_BYTES } from "../../shared/enums";
import { ApiError, notFound, parseJson } from "../lib/http";
import { auditStmt } from "../lib/audit-log";
import { clientIp, isManager } from "../lib/auth";
import { scopeClause } from "../lib/entity";
import { claudeJson, untrusted } from "../lib/providers";
import { b, newId, normalizePhone, now, sha256Hex } from "../lib/util";
import { ENTITIES } from "../entities";
import { enqueue } from "../jobs";
import { notifyStmt } from "../audits/run";

type Row = Record<string, unknown>;

// ─── Device management (cookie-authenticated) ───
export const deviceAdminRoutes = new Hono<AppEnv>();

deviceAdminRoutes.get("/", async (c) => {
  const u = c.get("user");
  const all = isManager(u) && c.req.query("all") === "1";
  const r = await c.env.DB.prepare(
    `SELECT d.id, d.name, d.last_seen_at, d.revoked_at, d.created_at, u.name AS user_name FROM devices d JOIN users u ON u.id = d.user_id ${all ? "" : "WHERE d.user_id = ?"} ORDER BY d.created_at DESC`,
  )
    .bind(...(all ? [] : [u.id]))
    .all();
  return c.json({ data: r.results });
});

deviceAdminRoutes.post("/", async (c) => {
  const { name } = await parseJson(c, deviceSchema);
  const u = c.get("user");
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  const token = `gxd_${btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
  const id = newId();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO devices (id, user_id, name, token_hash, created_at) VALUES (?,?,?,?,?)").bind(id, u.id, name, await sha256Hex(token), now()),
    auditStmt(c.env.DB, { actorId: u.id, action: "device_pair", entityType: "device", entityId: id, summary: `Paired device "${name}"`, ip: clientIp(c) }),
  ]);
  // The token is shown once; only its hash is stored.
  return c.json({ data: { id, name, token } }, 201);
});

deviceAdminRoutes.post("/:id/revoke", async (c) => {
  const u = c.get("user");
  const d = await c.env.DB.prepare("SELECT * FROM devices WHERE id = ?").bind(c.req.param("id")).first<Row>();
  if (!d || (d.user_id !== u.id && u.role !== "admin")) throw notFound("Device");
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(now(), d.id),
    auditStmt(c.env.DB, { actorId: u.id, action: "device_revoke", entityType: "device", entityId: String(d.id), summary: `Revoked device "${d.name}"`, ip: clientIp(c) }),
  ]);
  return c.json({ data: { ok: true } });
});

// ─── Device API (bearer-token authenticated) ───
export const deviceAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const auth = c.req.header("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token.startsWith("gxd_")) throw new ApiError(401, "unauthenticated", "Missing device token");
  const row = await c.env.DB.prepare(
    `SELECT d.id AS device_id, u.id, u.email, u.name, u.role, u.timezone FROM devices d JOIN users u ON u.id = d.user_id
     WHERE d.token_hash = ? AND d.revoked_at IS NULL AND u.status = 'active'`,
  )
    .bind(await sha256Hex(token))
    .first<Row>();
  if (!row) throw new ApiError(401, "unauthenticated", "This device token is invalid or revoked");
  c.set("user", { id: row.id, email: row.email, name: row.name, role: row.role, timezone: row.timezone, sessionId: "", deviceId: row.device_id } as SessionUser);
  c.executionCtx.waitUntil(c.env.DB.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").bind(now(), row.device_id).run());
  await next();
};

export const deviceRoutes = new Hono<AppEnv>();
deviceRoutes.use("*", deviceAuth);

deviceRoutes.get("/ping", (c) => {
  const u = c.get("user");
  return c.json({ data: { ok: true, user: u.name, app: c.env.APP_NAME } });
});

async function matchPhone(c: Context<AppEnv>, phone: string | null) {
  const norm = normalizePhone(phone);
  if (!norm) return { norm, contact: null as Row | null, prospect: null as Row | null };
  const user = c.get("user");
  const cs = scopeClause(ENTITIES.contacts, user);
  const contact = await c.env.DB.prepare(
    `SELECT t.id, t.account_id, (t.first_name || COALESCE(' ' || t.last_name,'')) AS name, a.name AS account_name FROM contacts t LEFT JOIN accounts a ON a.id = t.account_id
     WHERE t.archived_at IS NULL AND t.phone_normalized = ?${cs ? ` AND ${cs.sql}` : ""} ORDER BY t.updated_at DESC LIMIT 1`,
  )
    .bind(norm, ...(cs?.params ?? []))
    .first<Row>();
  let prospect: Row | null = null;
  if (!contact) {
    const ps = scopeClause(ENTITIES.prospects, user);
    const rows = await c.env.DB.prepare(`SELECT t.id, t.company_name AS name, t.phone FROM prospects t WHERE t.archived_at IS NULL AND t.phone IS NOT NULL${ps ? ` AND ${ps.sql}` : ""} LIMIT 500`)
      .bind(...(ps?.params ?? []))
      .all<Row>();
    prospect = rows.results.find((p) => normalizePhone(p.phone as string) === norm) ?? null;
  }
  return { norm, contact, prospect };
}

/** Lets the app decide whether a call belongs to a CRM client before uploading it. */
deviceRoutes.get("/lookup", async (c) => {
  const { contact, prospect } = await matchPhone(c, c.req.query("phone") ?? null);
  return c.json({ data: { known: !!(contact || prospect), name: contact?.name ?? prospect?.name ?? null, company: contact?.account_name ?? null } });
});

const callMetaSchema = z.object({
  phone_number: z.string().max(40).optional(),
  direction: z.enum(["incoming", "outgoing", "missed", "unknown"]).default("unknown"),
  started_at: z.iso.datetime({ offset: true }),
  duration_seconds: z.coerce.number().int().min(0).max(86400).optional(),
  client_ref: z.string().max(120).optional(),
});

async function ingestCall(c: Context<AppEnv>, form: FormData) {
  const user = c.get("user");
  const meta = callMetaSchema.parse(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")));
  const file = form.get("audio");
  const db = c.env.DB;
  if (meta.client_ref && user.deviceId) {
    const dup = await db.prepare("SELECT id FROM call_recordings WHERE device_id = ? AND client_ref = ?").bind(user.deviceId, meta.client_ref).first<{ id: string }>();
    if (dup) return { id: dup.id, duplicate: true };
  }
  let audio: File | null = null;
  if (file && typeof file !== "string") {
    audio = file as File;
    if (audio.size > CALL_MAX_BYTES) throw new ApiError(400, "too_large", "Recording exceeds 50 MB");
    const type = audio.type || "application/octet-stream";
    if (!CALL_AUDIO_MIME_TYPES.includes(type) && !/^audio\//.test(type)) throw new ApiError(400, "unsupported_type", `Unsupported audio type ${type}`);
  }
  const { norm, contact, prospect } = await matchPhone(c, meta.phone_number ?? null);
  const id = newId();
  const t = now();
  let fileKey: string | null = null;
  if (audio) {
    const safe = (audio.name || "recording").replace(/[^\w.-]+/g, "_").slice(-80);
    fileKey = `calls/${id}/${safe}`;
    await c.env.FILES.put(fileKey, audio.stream(), { httpMetadata: { contentType: audio.type || "application/octet-stream" }, customMetadata: { user: user.id } });
  }
  const who = (contact?.name as string) ?? (prospect?.name as string) ?? meta.phone_number ?? "unknown number";
  const mins = meta.duration_seconds ? `${Math.floor(meta.duration_seconds / 60)}m ${meta.duration_seconds % 60}s` : "duration unknown";
  const activityId = newId();
  const stmts = [
    db.prepare(
      `INSERT INTO call_recordings (id, user_id, device_id, client_ref, phone_number, phone_normalized, direction, started_at, duration_seconds, contact_id, account_id, prospect_id, file_key, file_name, mime_type, size_bytes, status, activity_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      id, user.id, b(user.deviceId), b(meta.client_ref), b(meta.phone_number), b(norm), meta.direction, meta.started_at, b(meta.duration_seconds),
      b(contact?.id), b(contact?.account_id), b(prospect?.id), fileKey, audio?.name ?? null, audio?.type ?? null, audio?.size ?? null, audio ? "uploaded" : "no_audio", activityId, t, t,
    ),
    db
      .prepare(
        `INSERT INTO activities (id, type, subject, body, account_id, contact_id, prospect_id, actor_id, occurred_at, meta, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        activityId, "call", `${meta.direction === "incoming" ? "Incoming" : meta.direction === "outgoing" ? "Outgoing" : ""} call with ${who} (${mins})`.trim(),
        audio ? "Recording captured. Transcript and summary will appear when processed." : "Logged from phone; no recording attached.",
        b(contact?.account_id), b(contact?.id), b(prospect?.id), user.id, meta.started_at, JSON.stringify({ call_recording_id: id }), t,
      ),
  ];
  if (contact) stmts.push(db.prepare("UPDATE contacts SET last_contacted_at = MAX(COALESCE(last_contacted_at, ''), ?), updated_at = ? WHERE id = ?").bind(meta.started_at, t, contact.id));
  await db.batch(stmts);
  if (audio) await enqueue(c.env, c.executionCtx, { kind: "transcribe", callId: id });
  return { id, duplicate: false, matched: contact ? { type: "contact", name: contact.name } : prospect ? { type: "prospect", name: prospect.name } : null };
}

deviceRoutes.post("/calls", async (c) => {
  const form = await c.req.formData().catch(() => {
    throw new ApiError(400, "invalid_body", "Expected multipart/form-data");
  });
  return c.json({ data: await ingestCall(c, form) }, 201);
});

// ─── Web endpoints (cookie-authenticated) ───
export const callRoutes = new Hono<AppEnv>();

function callScope(user: SessionUser) {
  return isManager(user) ? { sql: "1=1", params: [] as unknown[] } : { sql: "(r.user_id = ? OR r.account_id IN (SELECT id FROM accounts WHERE owner_id = ?))", params: [user.id, user.id] };
}

const CALL_SELECT = `r.id, r.user_id, r.phone_number, r.direction, r.started_at, r.duration_seconds, r.contact_id, r.account_id, r.prospect_id, r.file_key IS NOT NULL AS has_audio,
  r.mime_type, r.size_bytes, r.status, r.error, r.created_at, u.name AS user_name, (ct.first_name || COALESCE(' ' || ct.last_name,'')) AS contact_name, a.name AS account_name, p.company_name AS prospect_name`;
const CALL_FROM = `call_recordings r JOIN users u ON u.id = r.user_id LEFT JOIN contacts ct ON ct.id = r.contact_id LEFT JOIN accounts a ON a.id = r.account_id LEFT JOIN prospects p ON p.id = r.prospect_id`;

callRoutes.get("/", async (c) => {
  const user = c.get("user");
  const q = c.req.query();
  const s = callScope(user);
  const where = [s.sql];
  const params = [...s.params];
  for (const k of ["contact_id", "account_id", "prospect_id"]) if (q[k]) (where.push(`r.${k} = ?`), params.push(q[k]));
  if (q.unmatched === "1") where.push("r.contact_id IS NULL AND r.prospect_id IS NULL");
  const pageSize = Math.min(Number(q.pageSize ?? 50) || 50, 100);
  const page = Math.max(Number(q.page ?? 1) || 1, 1);
  const [rows, count] = await c.env.DB.batch<Row>([
    c.env.DB.prepare(`SELECT ${CALL_SELECT} FROM ${CALL_FROM} WHERE ${where.join(" AND ")} ORDER BY r.started_at DESC LIMIT ? OFFSET ?`).bind(...params, pageSize, (page - 1) * pageSize),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM ${CALL_FROM} WHERE ${where.join(" AND ")}`).bind(...params),
  ]);
  return c.json({ data: rows.results, meta: { page, pageSize, total: Number(count.results[0]?.n ?? 0) } });
});

async function loadCall(c: Context<AppEnv>, id: string) {
  const s = callScope(c.get("user"));
  const row = await c.env.DB.prepare(`SELECT ${CALL_SELECT}, r.transcript, r.summary, r.summary_model, r.file_key FROM ${CALL_FROM} WHERE r.id = ? AND ${s.sql}`).bind(id, ...s.params).first<Row>();
  if (!row) throw notFound("Call");
  return row;
}

callRoutes.get("/:id", async (c) => {
  const row = await loadCall(c, c.req.param("id"));
  return c.json({ data: { ...row, file_key: undefined, summary: row.summary ? JSON.parse(String(row.summary)) : null } });
});

callRoutes.get("/:id/audio", async (c) => {
  const row = await loadCall(c, c.req.param("id"));
  if (!row.file_key) throw notFound("Recording");
  const range = c.req.header("range")?.match(/bytes=(\d+)-(\d*)/);
  const obj = await c.env.FILES.get(String(row.file_key), range ? { range: { offset: Number(range[1]), ...(range[2] ? { length: Number(range[2]) - Number(range[1]) + 1 } : {}) } } : undefined);
  if (!obj) throw notFound("Recording");
  const headers = new Headers({ "content-type": String(row.mime_type ?? "audio/mpeg"), "accept-ranges": "bytes", "cache-control": "private, no-store" });
  if (range && "range" in obj && obj.range && "offset" in obj.range) {
    const off = obj.range.offset ?? 0;
    const len = obj.range.length ?? obj.size - off;
    headers.set("content-range", `bytes ${off}-${off + len - 1}/${obj.size}`);
    headers.set("content-length", String(len));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set("content-length", String(obj.size));
  return new Response(obj.body, { headers });
});

callRoutes.post("/upload", async (c) => {
  const form = await c.req.formData();
  return c.json({ data: await ingestCall(c, form) }, 201);
});

callRoutes.patch("/:id", async (c) => {
  const row = await loadCall(c, c.req.param("id"));
  const { contact_id } = await parseJson(c, z.object({ contact_id: z.string().max(64) }));
  const ct = await c.env.DB.prepare("SELECT id, account_id FROM contacts WHERE id = ?").bind(contact_id).first<Row>();
  if (!ct) throw notFound("Contact");
  const t = now();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE call_recordings SET contact_id = ?, account_id = ?, updated_at = ? WHERE id = ?").bind(ct.id, ct.account_id, t, row.id),
    c.env.DB.prepare("UPDATE activities SET contact_id = ?, account_id = ? WHERE id = (SELECT activity_id FROM call_recordings WHERE id = ?)").bind(ct.id, ct.account_id, row.id),
  ]);
  return c.json({ data: { ok: true } });
});

callRoutes.post("/:id/transcribe", async (c) => {
  const row = await loadCall(c, c.req.param("id"));
  if (!row.has_audio) throw new ApiError(400, "no_audio", "This call has no recording");
  await c.env.DB.prepare("UPDATE call_recordings SET status = 'uploaded', error = NULL, updated_at = ? WHERE id = ?").bind(now(), row.id).run();
  await enqueue(c.env, c.executionCtx, { kind: "transcribe", callId: String(row.id) });
  return c.json({ data: { ok: true } });
});

// ─── Transcription & summary job ───
function toBase64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

interface CallSummary {
  summary: string;
  client_needs: string[];
  objections: string[];
  commitments: string[];
  next_steps: string[];
  follow_up_suggested: boolean;
  sentiment: "positive" | "neutral" | "negative" | "unclear";
}

export async function transcribeCall(env: Env, callId: string) {
  const db = env.DB;
  const claimed = await db.prepare("UPDATE call_recordings SET status = 'transcribing', updated_at = ? WHERE id = ? AND status = 'uploaded'").bind(now(), callId).run();
  if (!claimed.meta.changes) return;
  const call = (await db.prepare("SELECT * FROM call_recordings WHERE id = ?").bind(callId).first<Row>())!;
  const fail = (msg: string) => db.prepare("UPDATE call_recordings SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").bind(msg.slice(0, 500), now(), callId).run();
  if (!env.AI) return void (await fail("Transcription needs the Workers AI binding (available on the deployed Worker)."));
  const obj = await env.FILES.get(String(call.file_key));
  if (!obj) return void (await fail("Recording file missing"));
  let transcript = "";
  try {
    const out = (await env.AI.run("@cf/openai/whisper-large-v3-turbo" as never, { audio: toBase64(await obj.arrayBuffer()) } as never)) as { text?: string };
    transcript = (out.text ?? "").trim();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    // In local dev the AI binding exists but only runs remotely.
    if (/run remotely|remote/i.test(msg)) return void (await fail("Transcription needs Workers AI, which runs on the deployed Worker (or in dev with CF_REMOTE_BINDINGS=1 after wrangler login)."));
    return void (await fail(`Transcription failed: ${msg}`));
  }
  await db.prepare("UPDATE call_recordings SET status = 'transcribed', transcript = ?, updated_at = ? WHERE id = ?").bind(transcript, now(), callId).run();
  if (!transcript || !env.ANTHROPIC_API_KEY) return;
  try {
    const { data, model } = await claudeJson<CallSummary>(env, {
      system:
        "You summarise sales calls for a CRM. Use only what is said in the transcript. Do not invent names, prices, dates or commitments. If something is unclear, say so. Keep each list item short.",
      prompt: `Summarise this sales call transcript.\n${untrusted("call_transcript", transcript.slice(0, 60000))}`,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["summary", "client_needs", "objections", "commitments", "next_steps", "follow_up_suggested", "sentiment"],
        properties: {
          summary: { type: "string" },
          client_needs: { type: "array", items: { type: "string" } },
          objections: { type: "array", items: { type: "string" } },
          commitments: { type: "array", items: { type: "string" } },
          next_steps: { type: "array", items: { type: "string" } },
          follow_up_suggested: { type: "boolean" },
          sentiment: { type: "string", enum: ["positive", "neutral", "negative", "unclear"] },
        },
      },
      effort: "low",
    });
    await db.batch([
      db.prepare("UPDATE call_recordings SET status = 'summarized', summary = ?, summary_model = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify(data), model, now(), callId),
      db.prepare("UPDATE activities SET body = ? WHERE id = ?").bind(`AI summary (draft): ${data.summary}`.slice(0, 5000), call.activity_id),
      notifyStmt(db, String(call.user_id), `call:${callId}`, "Call summary ready", data.summary.slice(0, 200), "call", callId),
    ]);
  } catch (e) {
    await db.prepare("UPDATE call_recordings SET error = ?, updated_at = ? WHERE id = ?").bind(`Summary failed: ${e instanceof Error ? e.message : "error"}`.slice(0, 500), now(), callId).run();
  }
}


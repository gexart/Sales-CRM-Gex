// Settings saved from the CRM, layered over the Worker's vars/secrets for every request, queue
// message and cron run. Secrets are encrypted with AES-GCM. The key comes from the optional
// SETTINGS_ENCRYPTION_KEY secret; without it a random key is generated and kept in D1, which still
// keeps plaintext out of backups/exports of the settings table but is not separation of duties.
import type { Env } from "../env";
import { CONFIG_FIELDS, CONFIG_KEYS } from "../../shared/config";

const MASTER_ROW = "__master_key";
const TTL_MS = 10_000;
let cache: { at: number; overrides: Record<string, string> } | null = null;
let keyCache: { id: string; aes: CryptoKey; hmac: CryptoKey } | null = null;

const enc = new TextEncoder();
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

export function invalidateSettings() {
  cache = null;
}

/** Key material: "env" when SETTINGS_ENCRYPTION_KEY is set, else a random key stored in D1. */
async function keys(env: Env): Promise<{ id: string; aes: CryptoKey; hmac: CryptoKey }> {
  const id = env.SETTINGS_ENCRYPTION_KEY ? "env" : "db";
  if (keyCache?.id === id) return keyCache;
  let raw: Uint8Array;
  if (env.SETTINGS_ENCRYPTION_KEY) {
    raw = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(env.SETTINGS_ENCRYPTION_KEY)));
  } else {
    let row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(MASTER_ROW).first<{ value: string }>();
    if (!row) {
      await env.DB.prepare("INSERT OR IGNORE INTO app_settings (key, value, is_secret, updated_at) VALUES (?,?,0,?)")
        .bind(MASTER_ROW, b64(crypto.getRandomValues(new Uint8Array(32))), new Date().toISOString())
        .run();
      row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(MASTER_ROW).first<{ value: string }>();
    }
    raw = unb64(row!.value);
  }
  const aes = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  const hmacRaw = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array([...enc.encode("gexart-hmac:"), ...raw])));
  const hmac = await crypto.subtle.importKey("raw", hmacRaw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  keyCache = { id, aes, hmac };
  return keyCache;
}

export async function encryptSecret(env: Env, plain: string): Promise<string> {
  const k = await keys(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k.aes, enc.encode(plain)));
  return `v1:${k.id}:${b64(iv)}:${b64(ct)}`;
}

export async function decryptSecret(env: Env, stored: string): Promise<string | null> {
  const [v, id, iv, ct] = stored.split(":");
  if (v !== "v1" || !iv || !ct) return null;
  const k = await keys(env);
  if (k.id !== id) return null; // encrypted under a key that is no longer configured
  try {
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, k.aes, unb64(ct)));
  } catch {
    return null;
  }
}

/** HMAC helpers for short-lived signed links (e.g. the phone app download QR code). */
export async function signToken(env: Env, data: string): Promise<string> {
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", (await keys(env)).hmac, enc.encode(data)));
  return [...sig].map((x) => x.toString(16).padStart(2, "0")).join("");
}
export async function verifyToken(env: Env, data: string, hex: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(hex)) return false;
  const sig = Uint8Array.from(hex.match(/../g)!, (h) => parseInt(h, 16));
  return crypto.subtle.verify("HMAC", (await keys(env)).hmac, sig, enc.encode(data));
}

async function loadOverrides(env: Env): Promise<Record<string, string>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.overrides;
  const rows = await env.DB.prepare("SELECT key, value, is_secret FROM app_settings WHERE key != ?").bind(MASTER_ROW).all<{ key: string; value: string; is_secret: number }>();
  const overrides: Record<string, string> = {};
  for (const r of rows.results) {
    if (!CONFIG_KEYS.has(r.key)) continue;
    const v = r.is_secret ? await decryptSecret(env, r.value) : r.value;
    if (v) overrides[r.key] = v;
  }
  cache = { at: Date.now(), overrides };
  return overrides;
}

/** The Worker env with CRM-managed settings applied. `__raw` keeps the original for "where is this set?". */
export async function withSettings(env: Env): Promise<Env> {
  try {
    const o = await loadOverrides(env);
    return { ...env, ...o, __raw: env };
  } catch {
    return env; // e.g. before migrations have run
  }
}

export const isSecretKey = (key: string) => CONFIG_FIELDS.find((f) => f.key === key)?.kind === "secret";

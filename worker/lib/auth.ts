import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AppEnv, SessionUser } from "../env";
import type { Role } from "../../shared/enums";
import { ApiError, forbidden } from "./http";
import { newId, now, sha256Hex } from "./util";

const COOKIE = "gx_session";
const SESSION_DAYS = 14;
// Workers cap PBKDF2 at 100k iterations. The count is stored per user so it can be raised later.
const PBKDF2_ITERATIONS = 100_000;

const toB64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return { hash: toB64(hash), salt: toB64(salt), iterations: PBKDF2_ITERATIONS };
}

export async function verifyPassword(password: string, hash: string, salt: string, iterations: number) {
  const actual = new Uint8Array(await pbkdf2(password, fromB64(salt), iterations));
  const expected = fromB64(hash);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

export async function createSession(c: Context<AppEnv>, userId: string) {
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  const token = toB64(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const id = await sha256Hex(token);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await c.env.DB.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at, ip, user_agent) VALUES (?,?,?,?,?,?)")
    .bind(id, userId, now(), expires.toISOString(), clientIp(c), c.req.header("user-agent")?.slice(0, 200) ?? null)
    .run();
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    expires,
  });
}

export async function destroySession(c: Context<AppEnv>) {
  const token = getCookie(c, COOKIE);
  if (token) await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256Hex(token)).run();
  deleteCookie(c, COOKIE, { path: "/" });
}

export const clientIp = (c: Context) => c.req.header("cf-connecting-ip") ?? null;

/** Loads the session user, or null. Does not throw. */
export async function loadUser(c: Context<AppEnv>): Promise<SessionUser | null> {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  const id = await sha256Hex(token);
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.timezone FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ? AND u.status = 'active'`,
  )
    .bind(id, now())
    .first<Omit<SessionUser, "sessionId">>();
  return row ? { ...row, sessionId: id } : null;
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await loadUser(c);
  if (!user) throw new ApiError(401, "unauthenticated", "Please sign in");
  c.set("user", user);
  await next();
};

/**
 * CSRF guard for cookie auth: state-changing requests must carry a custom header,
 * which a cross-site form or image cannot set (and CORS is not enabled), and
 * any Origin header present must match this host.
 */
export const csrfGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  // Webhooks and the device API use their own credentials (shared secret / bearer token), not cookies.
  const exempt = c.req.path.startsWith("/api/v1/webhooks/") || c.req.path.startsWith("/api/v1/device/");
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && !exempt) {
    if (c.req.header("x-requested-with") !== "gexart-crm") throw new ApiError(403, "csrf", "Missing request header");
    const origin = c.req.header("origin");
    if (origin && new URL(origin).host !== new URL(c.req.url).host) throw new ApiError(403, "csrf", "Cross-origin request blocked");
  }
  await next();
};

export function requireRole(...roles: Role[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!roles.includes(c.get("user").role)) throw forbidden();
    await next();
  };
}

export const isManager = (u: SessionUser) => u.role === "admin" || u.role === "manager";

// ─── login rate limiting (D1-backed; fine for an internal app's volume) ───
const WINDOW_MIN = 15;
export async function assertNotRateLimited(db: D1Database, email: string, ip: string | null) {
  const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();
  const rows = await db
    .prepare("SELECT key, COUNT(*) AS n FROM login_attempts WHERE key IN (?, ?) AND created_at > ? GROUP BY key")
    .bind(`email:${email.toLowerCase()}`, `ip:${ip ?? "unknown"}`, since)
    .all<{ key: string; n: number }>();
  for (const r of rows.results) {
    const limit = r.key.startsWith("email:") ? 8 : 30;
    if (r.n >= limit) throw new ApiError(429, "rate_limited", `Too many sign-in attempts. Try again in ${WINDOW_MIN} minutes.`);
  }
}

export async function recordFailedLogin(db: D1Database, email: string, ip: string | null) {
  const t = now();
  await db.batch([
    db.prepare("INSERT INTO login_attempts (key, created_at) VALUES (?, ?)").bind(`email:${email.toLowerCase()}`, t),
    db.prepare("INSERT INTO login_attempts (key, created_at) VALUES (?, ?)").bind(`ip:${ip ?? "unknown"}`, t),
    db.prepare("DELETE FROM login_attempts WHERE created_at < ?").bind(new Date(Date.now() - 86400_000).toISOString()),
  ]);
}

export { newId };

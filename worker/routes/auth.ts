import { Hono } from "hono";
import type { AppEnv } from "../env";
import { forgotPasswordSchema, loginSchema, resetPasswordSchema, setupSchema } from "../../shared/schemas";
import { appBaseUrl, emailConfigured, issueLinkToken, sendResetEmail } from "../lib/mail";
import { ApiError, parseJson } from "../lib/http";
import {
  assertNotRateLimited,
  clientIp,
  createSession,
  destroySession,
  hashPassword,
  loadUser,
  recordFailedLogin,
  verifyPassword,
} from "../lib/auth";
import { auditStmt } from "../lib/audit-log";
import { newId, now, sha256Hex } from "../lib/util";

export const authRoutes = new Hono<AppEnv>();

/** Whether first-run setup is still needed (no users yet), and who is signed in. */
authRoutes.get("/status", async (c) => {
  const n = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
  const user = await loadUser(c);
  return c.json({
    data: { needsSetup: (n?.n ?? 0) === 0, emailEnabled: emailConfigured(c.env), user: user ? { ...user, sessionId: undefined } : null },
  });
});

/** Creates the first administrator. Refused as soon as any user exists. */
authRoutes.post("/setup", async (c) => {
  const input = await parseJson(c, setupSchema);
  const n = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
  if ((n?.n ?? 0) > 0) throw new ApiError(403, "setup_complete", "Setup has already been completed");
  const pw = await hashPassword(input.password);
  const id = newId();
  const t = now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO users (id, email, name, role, password_hash, password_salt, password_iterations, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
    ).bind(id, input.email.toLowerCase(), input.name, "admin", pw.hash, pw.salt, pw.iterations, t, t),
    auditStmt(c.env.DB, { actorId: id, action: "setup", entityType: "user", entityId: id, summary: "Created first administrator", ip: clientIp(c) }),
  ]);
  await createSession(c, id);
  return c.json({ data: { ok: true } }, 201);
});

authRoutes.post("/login", async (c) => {
  const { email, password } = await parseJson(c, loginSchema);
  const ip = clientIp(c);
  await assertNotRateLimited(c.env.DB, email, ip);
  const user = await c.env.DB.prepare("SELECT id, password_hash, password_salt, password_iterations, status FROM users WHERE email = ?")
    .bind(email.toLowerCase())
    .first<{ id: string; password_hash: string; password_salt: string; password_iterations: number; status: string }>();
  const ok =
    user && user.status === "active" && (await verifyPassword(password, user.password_hash, user.password_salt, user.password_iterations));
  if (!ok) {
    await recordFailedLogin(c.env.DB, email, ip);
    throw new ApiError(401, "invalid_credentials", "Email or password is incorrect");
  }
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").bind(now(), user.id),
    auditStmt(c.env.DB, { actorId: user.id, action: "login", entityType: "user", entityId: user.id, ip }),
  ]);
  await createSession(c, user.id);
  return c.json({ data: { ok: true } });
});

// ─── Forgot / reset password ───
const RESET_WINDOW_MIN = 15;

/**
 * Always answers the same way whether or not the address belongs to a user, so it cannot be used to
 * discover who has an account. The email (if any) is sent after the response.
 */
authRoutes.post("/forgot", async (c) => {
  const { email } = await parseJson(c, forgotPasswordSchema);
  const ip = clientIp(c);
  const db = c.env.DB;
  const generic = c.json({ data: { ok: true } });
  const since = new Date(Date.now() - RESET_WINDOW_MIN * 60_000).toISOString();
  const keys = [`reset-email:${email.toLowerCase()}`, `reset-ip:${ip ?? "unknown"}`];
  const counts = await db
    .prepare("SELECT key, COUNT(*) AS n FROM login_attempts WHERE key IN (?, ?) AND created_at > ? GROUP BY key")
    .bind(keys[0], keys[1], since)
    .all<{ key: string; n: number }>();
  const limited = counts.results.some((r) => r.n >= (r.key.startsWith("reset-email:") ? 3 : 10));
  await db.batch([
    db.prepare("INSERT INTO login_attempts (key, created_at) VALUES (?, ?)").bind(keys[0], now()),
    db.prepare("INSERT INTO login_attempts (key, created_at) VALUES (?, ?)").bind(keys[1], now()),
  ]);
  if (limited || !emailConfigured(c.env)) return generic;
  const user = await db
    .prepare("SELECT id, name, email FROM users WHERE email = ? AND status = 'active'")
    .bind(email.toLowerCase())
    .first<{ id: string; name: string; email: string }>();
  if (!user) return generic;
  const job = (async () => {
    const token = await issueLinkToken(db, user.id, "reset", ip);
    const resetUrl = `${appBaseUrl(c.env, c.req.url)}/reset-password?token=${token}`;
    const res = await sendResetEmail(c.env, { to: { email: user.email, name: user.name }, resetUrl });
    await auditStmt(db, {
      actorId: user.id,
      action: "password_reset_requested",
      entityType: "user",
      entityId: user.id,
      summary: res.sent ? "Password reset email sent" : `Password reset email not sent: ${res.reason ?? "unknown"}`,
      ip,
    }).run();
  })().catch(() => undefined);
  c.executionCtx.waitUntil(job);
  return generic;
});

/** Sets a new password from an emailed one-time link (reset or welcome). */
authRoutes.post("/reset", async (c) => {
  const { token, password } = await parseJson(c, resetPasswordSchema);
  const db = c.env.DB;
  const row = await db
    .prepare(
      `SELECT r.id, r.user_id, r.purpose, u.email FROM password_resets r JOIN users u ON u.id = r.user_id
       WHERE r.id = ? AND r.used_at IS NULL AND r.expires_at > ? AND u.status = 'active'`,
    )
    .bind(await sha256Hex(token), now())
    .first<{ id: string; user_id: string; purpose: string; email: string }>();
  if (!row) throw new ApiError(400, "invalid_link", "This link has expired or was already used. Request a new one from the sign-in page.");
  const pw = await hashPassword(password);
  const t = now();
  await db.batch([
    db.prepare("UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ?, updated_at = ? WHERE id = ?").bind(pw.hash, pw.salt, pw.iterations, t, row.user_id),
    db.prepare("UPDATE password_resets SET used_at = ? WHERE id = ?").bind(t, row.id),
    // Any other session (e.g. an attacker's) ends, and lockouts from earlier failed sign-ins are cleared.
    db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(row.user_id),
    db.prepare("DELETE FROM login_attempts WHERE key = ?").bind(`email:${row.email.toLowerCase()}`),
    auditStmt(db, {
      actorId: row.user_id,
      action: "password_reset",
      entityType: "user",
      entityId: row.user_id,
      summary: row.purpose === "welcome" ? "Set password from welcome email" : "Reset password from emailed link",
      ip: clientIp(c),
    }),
  ]);
  return c.json({ data: { ok: true } });
});

authRoutes.post("/logout", async (c) => {
  await destroySession(c);
  return c.json({ data: { ok: true } });
});

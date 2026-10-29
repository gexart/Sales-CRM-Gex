import { Hono } from "hono";
import type { AppEnv } from "../env";
import { loginSchema, setupSchema } from "../../shared/schemas";
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
import { newId, now } from "../lib/util";

export const authRoutes = new Hono<AppEnv>();

/** Whether first-run setup is still needed (no users yet), and who is signed in. */
authRoutes.get("/status", async (c) => {
  const n = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
  const user = await loadUser(c);
  return c.json({ data: { needsSetup: (n?.n ?? 0) === 0, user: user ? { ...user, sessionId: undefined } : null } });
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

authRoutes.post("/logout", async (c) => {
  await destroySession(c);
  return c.json({ data: { ok: true } });
});

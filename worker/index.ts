import { Hono, type MiddlewareHandler } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv, Env, Job } from "./env";
import { ApiError, errorResponse } from "./lib/http";
import { csrfGuard, requireAuth } from "./lib/auth";
import { entityRoutes } from "./lib/entity";
import { ENTITIES } from "./entities";
import { authRoutes } from "./routes/auth";
import { userRoutes } from "./routes/users";
import { crmRoutes } from "./routes/crm";
import { dashboardRoutes } from "./routes/dashboard";
import { auditRoutes } from "./routes/audits";
import { integrationRoutes } from "./routes/integrations";
import { outreachRoutes } from "./routes/outreach";
import { assetRoutes } from "./routes/assets";
import { importRoutes } from "./routes/imports";
import { discoveryRoutes } from "./routes/discovery";
import { salesRoutes } from "./routes/sales";
import { brevoRoutes, webhookRoutes } from "./routes/brevo";
import { callRoutes, deviceAdminRoutes, deviceRoutes } from "./routes/calls";
import { notificationRoutes, scheduled } from "./routes/notifications";
import { handleQueue } from "./jobs";

const app = new Hono<AppEnv>();

app.use("/api/*", secureHeaders());
app.use("/api/*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});
app.use("/api/*", csrfGuard);

/** Per-isolate request cap per user/device. Coarse protection against runaway clients. */
const hits = new Map<string, { n: number; reset: number }>();
const rateLimit: MiddlewareHandler<AppEnv> = async (c, next) => {
  const key = c.get("user")?.deviceId ?? c.get("user")?.id;
  if (key) {
    const t = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < t) hits.set(key, { n: 1, reset: t + 60_000 });
    else if (++h.n > 600) throw new ApiError(429, "rate_limited", "Too many requests; slow down");
    if (hits.size > 5000) hits.clear();
  }
  await next();
};

const api = new Hono<AppEnv>();
api.get("/health", async (c) => {
  const db = await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
  return c.json({ data: { ok: true, db: db?.ok === 1 } });
});
api.route("/auth", authRoutes);
api.route("/webhooks", webhookRoutes);
// The Android app authenticates with a device token, not a session cookie.
api.route("/device", deviceRoutes);

// Everything below requires a signed-in user.
api.use("*", async (c, next) => {
  const p = c.req.path;
  if (p.startsWith("/api/v1/auth/") || p === "/api/v1/health" || p.startsWith("/api/v1/webhooks/") || p.startsWith("/api/v1/device/")) return next();
  return requireAuth(c, next);
});
api.use("*", rateLimit);
api.route("/users", userRoutes);
api.route("/integrations", integrationRoutes);
api.route("/notifications", notificationRoutes);
api.route("/devices", deviceAdminRoutes);
api.route("/calls", callRoutes);
api.route("/imports", importRoutes);
api.route("/assets", assetRoutes);
api.route("/", crmRoutes);
api.route("/", dashboardRoutes);
api.route("/", auditRoutes);
api.route("/", outreachRoutes);
api.route("/", brevoRoutes);
api.route("/", discoveryRoutes);
api.route("/", salesRoutes);
for (const def of Object.values(ENTITIES)) api.route(`/${def.route}`, entityRoutes(def));

app.route("/api/v1", api);
app.all("/api/*", (c) => c.json({ error: { code: "not_found", message: "Unknown API route" } }, 404));
app.onError(errorResponse);

export default {
  fetch: app.fetch,
  queue: (batch: MessageBatch<Job>, env: Env) => handleQueue(batch, env),
  scheduled: (_event: ScheduledController, env: Env, ctx: ExecutionContext) => ctx.waitUntil(scheduled(env)),
} satisfies ExportedHandler<Env, Job>;

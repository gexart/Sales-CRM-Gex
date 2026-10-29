import { Hono } from "hono";
import type { AppEnv, Env } from "../env";
import { ApiError } from "../lib/http";
import { auditStmt } from "../lib/audit-log";
import { clientIp, requireRole } from "../lib/auth";
import { recordProviderResult, validateProvider } from "../lib/providers";

export const integrationRoutes = new Hono<AppEnv>();

interface Catalog {
  provider: string;
  label: string;
  group: "Email" | "Lead data" | "Audits" | "AI" | "Calls" | "Data";
  description: string;
  secret?: keyof Env;
  extra?: (keyof Env)[];
  setup: string;
  freeTier: string;
  builtIn?: boolean;
}

export const CATALOG: Catalog[] = [
  { provider: "manual_email", label: "Manual email workflow", group: "Email", builtIn: true, description: "Prepare emails in the CRM, copy into your own mail app, then confirm when sent.", setup: "Built in.", freeTier: "Free" },
  { provider: "brevo", label: "Brevo transactional email", group: "Email", secret: "BREVO_API_KEY", extra: ["BREVO_SENDER_EMAIL"], description: "Send approved outreach through Brevo; delivery and bounce events update messages automatically.", setup: "wrangler secret put BREVO_API_KEY; set BREVO_SENDER_EMAIL (verified sender) in wrangler vars; wrangler secret put BREVO_WEBHOOK_SECRET and add the webhook URL in Brevo → Transactional → Webhooks.", freeTier: "Free plan includes a daily sending allowance" },
  { provider: "csv", label: "CSV import / export", group: "Data", builtIn: true, description: "Import prospects with mapping, validation and duplicate review; export lists you can see.", setup: "Built in.", freeTier: "Free" },
  { provider: "google_places", label: "Google Places (lead discovery + GBP audit)", group: "Lead data", secret: "GOOGLE_PLACES_API_KEY", description: "Find businesses by category and location; audit Google Business Profiles.", setup: "Google Cloud → enable Places API (New) → create an API key restricted to it → wrangler secret put GOOGLE_PLACES_API_KEY. Billing must be enabled.", freeTier: "Monthly free usage credit from Google" },
  { provider: "hunter", label: "Hunter.io", group: "Lead data", secret: "HUNTER_API_KEY", description: "Published email addresses for a company domain, with verification status.", setup: "hunter.io → API → copy key → wrangler secret put HUNTER_API_KEY.", freeTier: "Free plan includes monthly API searches" },
  { provider: "apollo", label: "Apollo.io", group: "Lead data", secret: "APOLLO_API_KEY", description: "Decision-makers at a company; reveal work email on demand (uses Apollo credits).", setup: "Apollo → Settings → Integrations → API → create key → wrangler secret put APOLLO_API_KEY.", freeTier: "Free plan has limited credits; some API endpoints need a paid plan" },
  { provider: "rocketreach", label: "RocketReach", group: "Lead data", secret: "ROCKETREACH_API_KEY", description: "Search people by employer and title; reveal contact details per lookup.", setup: "RocketReach → Account → API → wrangler secret put ROCKETREACH_API_KEY.", freeTier: "API access requires a plan with API credits" },
  { provider: "lusha", label: "Lusha", group: "Lead data", secret: "LUSHA_API_KEY", description: "Look up a named person's work email and phone at a company domain.", setup: "Lusha → API → wrangler secret put LUSHA_API_KEY.", freeTier: "API access depends on your Lusha plan" },
  { provider: "youtube", label: "YouTube Data API", group: "Audits", secret: "YOUTUBE_API_KEY", description: "Public channel statistics and posting frequency for the social audit.", setup: "Google Cloud → enable YouTube Data API v3 → API key → wrangler secret put YOUTUBE_API_KEY.", freeTier: "Free daily quota" },
  { provider: "anthropic", label: "Claude (Anthropic API)", group: "AI", secret: "ANTHROPIC_API_KEY", description: "Drafts pitches, deck outlines and call summaries from stored facts (always reviewed before use).", setup: "console.anthropic.com → API keys → wrangler secret put ANTHROPIC_API_KEY.", freeTier: "Pay as you go" },
  { provider: "workers_ai", label: "Workers AI (call transcription)", group: "Calls", description: "Whisper speech-to-text for call recordings, on Cloudflare.", setup: "Enabled by the AI binding in wrangler.jsonc on the deployed Worker.", freeTier: "Daily free allocation on Cloudflare" },
];

function configured(env: Env, i: Catalog) {
  if (i.builtIn) return true;
  if (i.provider === "workers_ai") return !!env.AI;
  return !!(i.secret && env[i.secret]) && (i.extra ?? []).every((k) => !!env[k]);
}

integrationRoutes.get("/", requireRole("admin", "manager"), async (c) => {
  const rows = await c.env.DB.prepare("SELECT * FROM integrations").all<Record<string, unknown>>();
  const usage = await c.env.DB.prepare("SELECT provider, calls FROM integration_usage WHERE day = ?").bind(new Date().toISOString().slice(0, 10)).all<{ provider: string; calls: number }>();
  const state = new Map(rows.results.map((r) => [r.provider, r]));
  return c.json({
    data: CATALOG.map((i) => {
      const s = state.get(i.provider);
      const ok = configured(c.env, i);
      const validated = Boolean(s?.last_success_at && (!s?.last_error_at || String(s.last_success_at) > String(s.last_error_at)));
      return {
        provider: i.provider, label: i.label, group: i.group, description: i.description, setup: i.setup, free_tier: i.freeTier, built_in: !!i.builtIn,
        configured: ok,
        status: i.builtIn ? "available" : !ok ? "not_configured" : validated ? "connected" : "not_validated",
        last_success_at: s?.last_success_at ?? null,
        last_error: s?.last_error ?? null,
        last_error_at: s?.last_error_at ?? null,
        calls_today: usage.results.find((u) => u.provider === (i.provider === "anthropic" ? "claude" : i.provider))?.calls ?? 0,
        can_validate: !i.builtIn && ok,
        webhook_url: i.provider === "brevo" && c.env.BREVO_WEBHOOK_SECRET ? `${new URL(c.req.url).origin}/api/v1/webhooks/brevo?token=<BREVO_WEBHOOK_SECRET>` : null,
      };
    }),
  });
});

/** Which optional features are usable right now (for every signed-in user; no secrets). */
integrationRoutes.get("/available", async (c) => {
  const s = await c.env.DB.prepare("SELECT provider, last_success_at, last_error_at FROM integrations").all<Record<string, unknown>>();
  const ok = (p: string) => {
    const r = s.results.find((x) => x.provider === p);
    return !!r?.last_success_at && (!r.last_error_at || String(r.last_success_at) > String(r.last_error_at));
  };
  return c.json({
    data: {
      brevo: !!c.env.BREVO_API_KEY && !!c.env.BREVO_SENDER_EMAIL && ok("brevo"),
      google_places: !!c.env.GOOGLE_PLACES_API_KEY,
      claude: !!c.env.ANTHROPIC_API_KEY,
      youtube: !!c.env.YOUTUBE_API_KEY,
      transcription: !!c.env.AI,
      enrichment: { website: true, hunter: !!c.env.HUNTER_API_KEY, apollo: !!c.env.APOLLO_API_KEY, rocketreach: !!c.env.ROCKETREACH_API_KEY, lusha: !!c.env.LUSHA_API_KEY },
    },
  });
});

integrationRoutes.post("/:provider/validate", requireRole("admin"), async (c) => {
  const provider = c.req.param("provider");
  const item = CATALOG.find((i) => i.provider === provider);
  if (!item || item.builtIn) throw new ApiError(400, "validation_error", "Unknown provider");
  let error: string | null = null;
  try {
    await validateProvider(c.env, provider);
  } catch (e) {
    error = e instanceof Error ? e.message : "Validation failed";
  }
  await recordProviderResult(c.env, provider, error);
  await auditStmt(c.env.DB, { actorId: c.get("user").id, action: "integration_validate", entityType: "integration", entityId: provider, summary: error ? `${item.label}: ${error}` : `${item.label} validated`, ip: clientIp(c) }).run();
  return c.json({ data: { ok: !error, error } });
});

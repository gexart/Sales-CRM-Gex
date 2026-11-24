import type { Role } from "../shared/enums";

export type Job =
  | { kind: "audit"; runId: string; userId: string; accountId: string }
  | { kind: "transcribe"; callId: string }
  | { kind: "autopilot"; playbookId?: string };

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  /** One Durable Object (SQLite) per billing company: the books of account. */
  BILLING_DO: DurableObjectNamespace<import("./billing/billing-do").BillingDO>;
  ASSETS: Fetcher;
  JOBS?: Queue<Job>;
  AI?: Ai;
  APP_NAME: string;
  DEMO_MODE: string;
  BREVO_SENDER_EMAIL?: string;
  BREVO_SENDER_NAME?: string;
  QUOTA_GOOGLE_PLACES?: string;
  QUOTA_ENRICHMENT?: string;
  QUOTA_CLAUDE?: string;
  QUOTA_YOUTUBE?: string;
  GITHUB_REPO?: string;
  /** Public address of this CRM (e.g. https://crm.example.com). Used in emailed links; defaults to the request's own origin. */
  APP_URL?: string;
  // Optional secrets. Usually saved in Settings → Configuration (which overrides these);
  // `wrangler secret put` / .dev.vars also work. Never sent to the browser.
  ANTHROPIC_API_KEY?: string;
  BREVO_API_KEY?: string;
  BREVO_WEBHOOK_SECRET?: string;
  EMAILJS_SERVICE_ID?: string;
  EMAILJS_TEMPLATE_ID?: string;
  EMAILJS_PUBLIC_KEY?: string;
  EMAILJS_PRIVATE_KEY?: string;
  GOOGLE_PLACES_API_KEY?: string;
  YOUTUBE_API_KEY?: string;
  HUNTER_API_KEY?: string;
  APOLLO_API_KEY?: string;
  ROCKETREACH_API_KEY?: string;
  LUSHA_API_KEY?: string;
  GITHUB_TOKEN?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  /** Business postal address added under every cold email (CAN-SPAM and good practice everywhere). */
  COMPANY_POSTAL_ADDRESS?: string;
  /** Optional: encrypts CRM-saved secrets with a key held outside the database. */
  SETTINGS_ENCRYPTION_KEY?: string;
  /** The Worker env before CRM settings were applied (set by withSettings). */
  __raw?: Env;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  timezone: string;
  sessionId: string;
  deviceId?: string;
  deviceKind?: string;
}

export type AppEnv = { Bindings: Env; Variables: { user: SessionUser } };

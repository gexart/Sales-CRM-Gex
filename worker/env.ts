import type { Role } from "../shared/enums";

export type Job =
  | { kind: "audit"; runId: string; userId: string; accountId: string }
  | { kind: "transcribe"; callId: string };

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
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
  // Optional secrets (wrangler secret put / .dev.vars). Never sent to the browser.
  ANTHROPIC_API_KEY?: string;
  BREVO_API_KEY?: string;
  BREVO_WEBHOOK_SECRET?: string;
  GOOGLE_PLACES_API_KEY?: string;
  YOUTUBE_API_KEY?: string;
  HUNTER_API_KEY?: string;
  APOLLO_API_KEY?: string;
  ROCKETREACH_API_KEY?: string;
  LUSHA_API_KEY?: string;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  timezone: string;
  sessionId: string;
  deviceId?: string;
}

export type AppEnv = { Bindings: Env; Variables: { user: SessionUser } };

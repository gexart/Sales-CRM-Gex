-- Phase 4 / C / D / E / 5 / F: sales operations, intelligence, generation, integrations, calls.

-- ── Price book: priced packages per catalogue service ──
CREATE TABLE product_packages (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  name TEXT NOT NULL,
  description TEXT,
  price_minor INTEGER,               -- NULL = custom quote
  currency TEXT NOT NULL DEFAULT 'INR',
  billing_frequency TEXT NOT NULL DEFAULT 'one_time' CHECK (billing_frequency IN ('one_time','monthly','quarterly','yearly')),
  deliverables TEXT,                 -- one per line
  timeline TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  archived_at TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_packages_product ON product_packages(product_id, position);

ALTER TABLE opportunity_products ADD COLUMN package_id TEXT REFERENCES product_packages(id);
ALTER TABLE opportunity_products ADD COLUMN billing_frequency TEXT;

-- ── Sales assets: generated vs uploaded, authorship; associations without a fixed entity list ──
ALTER TABLE sales_assets ADD COLUMN source TEXT NOT NULL DEFAULT 'upload';
ALTER TABLE sales_assets ADD COLUMN created_by TEXT REFERENCES users(id);
DROP TABLE asset_associations;
CREATE TABLE asset_associations (
  asset_id TEXT NOT NULL REFERENCES sales_assets(id),
  entity_type TEXT NOT NULL,         -- account, contact, campaign, opportunity, product, audit_run, outreach, prospect
  entity_id TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (asset_id, entity_type, entity_id)
);
CREATE INDEX idx_asset_assoc_entity ON asset_associations(entity_type, entity_id);

CREATE TABLE generated_documents (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('proposal_pdf','pitch_deck','pitch_text')),
  title TEXT NOT NULL,
  account_id TEXT REFERENCES accounts(id),
  opportunity_id TEXT REFERENCES opportunities(id),
  asset_id TEXT REFERENCES sales_assets(id),
  sources TEXT,                      -- JSON: audit run ids, product ids, package ids, template
  content TEXT,                      -- JSON outline / pitch content used to render
  generator TEXT NOT NULL,           -- 'template' or 'claude'
  model TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_generated_account ON generated_documents(account_id, created_at);

-- ── CSV imports ──
CREATE TABLE import_jobs (
  id TEXT PRIMARY KEY,
  entity TEXT NOT NULL,
  file_name TEXT,
  status TEXT NOT NULL CHECK (status IN ('previewed','completed','failed')),
  total_rows INTEGER NOT NULL DEFAULT 0,
  valid_rows INTEGER NOT NULL DEFAULT 0,
  duplicate_rows INTEGER NOT NULL DEFAULT 0,
  error_rows INTEGER NOT NULL DEFAULT 0,
  created_rows INTEGER NOT NULL DEFAULT 0,
  mapping TEXT,
  payload_key TEXT,                  -- R2 key of the parsed rows awaiting confirmation
  errors TEXT,                       -- JSON row-level errors
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  completed_at TEXT
);

-- ── Lead discovery (Google Places). Results are purged after 30 days. ──
CREATE TABLE lead_search_jobs (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  query TEXT NOT NULL,
  location TEXT,
  campaign_id TEXT REFERENCES campaigns(id),
  status TEXT NOT NULL CHECK (status IN ('completed','failed')),
  result_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE lead_search_results (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES lead_search_jobs(id),
  provider_place_id TEXT,
  name TEXT NOT NULL,
  category TEXT,
  address TEXT,
  city TEXT,
  phone TEXT,
  website TEXT,
  rating REAL,
  review_count INTEGER,
  maps_url TEXT,
  duplicate_kind TEXT,
  duplicate_id TEXT,
  duplicate_name TEXT,
  imported_prospect_id TEXT REFERENCES prospects(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_lead_results_job ON lead_search_results(job_id);

-- ── Contact finder (public website + authorised data providers) ──
CREATE TABLE enrichment_results (
  id TEXT PRIMARY KEY,
  account_id TEXT REFERENCES accounts(id),
  prospect_id TEXT REFERENCES prospects(id),
  provider TEXT NOT NULL,
  provider_ref TEXT,
  full_name TEXT,
  title TEXT,
  email TEXT,
  email_status TEXT,
  phone TEXT,
  linkedin_url TEXT,
  confidence INTEGER,
  source_url TEXT,
  revealed INTEGER NOT NULL DEFAULT 0,
  saved_contact_id TEXT REFERENCES contacts(id),
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_enrichment_account ON enrichment_results(account_id, created_at);

-- ── Provider usage (daily quotas keep paid APIs within budget) ──
CREATE TABLE integration_usage (
  provider TEXT NOT NULL,
  day TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (provider, day)
);

-- ── Qualification engine ──
ALTER TABLE prospects ADD COLUMN qualification_score INTEGER;
ALTER TABLE prospects ADD COLUMN qualification_level TEXT;
ALTER TABLE prospects ADD COLUMN qualification_factors TEXT;
ALTER TABLE prospects ADD COLUMN qualification_override TEXT;
ALTER TABLE prospects ADD COLUMN qualification_override_reason TEXT;
ALTER TABLE prospects ADD COLUMN qualification_scored_at TEXT;

-- ── Sales pitches ──
CREATE TABLE sales_pitch_drafts (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  title TEXT NOT NULL,
  content TEXT NOT NULL,             -- JSON {problems, sections, assumptions, missing_information}
  generator TEXT NOT NULL,
  model TEXT,
  sources TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);

-- ── Call recordings from the Android companion app ──
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  last_seen_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE call_recordings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  device_id TEXT REFERENCES devices(id),
  client_ref TEXT,
  phone_number TEXT,
  phone_normalized TEXT,
  direction TEXT NOT NULL DEFAULT 'unknown' CHECK (direction IN ('incoming','outgoing','missed','unknown')),
  started_at TEXT NOT NULL,
  duration_seconds INTEGER,
  contact_id TEXT REFERENCES contacts(id),
  account_id TEXT REFERENCES accounts(id),
  prospect_id TEXT REFERENCES prospects(id),
  file_key TEXT,
  file_name TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded','transcribing','transcribed','summarized','failed','no_audio')),
  transcript TEXT,
  summary TEXT,                      -- JSON from the AI summariser (draft)
  summary_model TEXT,
  error TEXT,
  activity_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (device_id, client_ref)
);
CREATE INDEX idx_calls_contact ON call_recordings(contact_id, started_at);
CREATE INDEX idx_calls_account ON call_recordings(account_id, started_at);
CREATE INDEX idx_calls_user ON call_recordings(user_id, started_at);

-- ── Outreach provider tracking & notifications dedupe ──
ALTER TABLE outreach_messages ADD COLUMN delivered_at TEXT;
ALTER TABLE notifications ADD COLUMN dedupe_key TEXT;
CREATE UNIQUE INDEX uq_notifications_dedupe ON notifications(dedupe_key) WHERE dedupe_key IS NOT NULL;

INSERT OR IGNORE INTO integrations (provider, enabled, updated_at) VALUES
 ('google_places', 0, '2026-10-29T00:00:00.000Z'), ('hunter', 0, '2026-10-29T00:00:00.000Z'), ('apollo', 0, '2026-10-29T00:00:00.000Z'),
 ('rocketreach', 0, '2026-10-29T00:00:00.000Z'), ('lusha', 0, '2026-10-29T00:00:00.000Z'), ('youtube', 0, '2026-10-29T00:00:00.000Z'),
 ('anthropic', 0, '2026-10-29T00:00:00.000Z'), ('workers_ai', 0, '2026-10-29T00:00:00.000Z');

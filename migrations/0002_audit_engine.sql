-- Audit engine (Phase B/C). Audit types live in a code registry (worker/audits/registry.ts);
-- every execution is an immutable audit_run so history is preserved and runs can be compared.

CREATE TABLE competitors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  website TEXT,
  domain TEXT,
  notes TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE account_competitors (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  competitor_id TEXT NOT NULL REFERENCES competitors(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (account_id, competitor_id)
);

CREATE TABLE audit_runs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  audit_type TEXT NOT NULL,          -- registry key: website, seo, aeo, ...
  audit_version TEXT NOT NULL,       -- rubric version used, so old scores stay interpretable
  target TEXT NOT NULL,              -- URL or profile handle that was audited
  config TEXT,                       -- JSON
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','completed_warnings','failed','cancelled')),
  progress INTEGER NOT NULL DEFAULT 0,
  overall_score INTEGER,             -- NULL when no rubric score could be computed
  scope TEXT,                        -- JSON: pages inspected, limits applied
  warnings TEXT,                     -- JSON array of strings
  error TEXT,
  initiated_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);
CREATE INDEX idx_audit_runs_account ON audit_runs(account_id, audit_type, created_at);

CREATE TABLE audit_score_breakdowns (
  run_id TEXT NOT NULL REFERENCES audit_runs(id),
  category TEXT NOT NULL,
  label TEXT NOT NULL,
  weight REAL NOT NULL,
  score INTEGER,                     -- NULL when every check in the category was unavailable
  checks_passed INTEGER NOT NULL,
  checks_failed INTEGER NOT NULL,
  checks_unavailable INTEGER NOT NULL,
  PRIMARY KEY (run_id, category)
);

CREATE TABLE audit_findings (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES audit_runs(id),
  check_id TEXT NOT NULL,
  category TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('pass','fail','warn','unavailable')),
  severity TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low','positive')),
  title TEXT NOT NULL,
  detail TEXT,
  recommendation TEXT,
  effort TEXT CHECK (effort IN ('low','medium','high')),
  related_skus TEXT,                 -- JSON array of product SKUs this finding maps to
  position INTEGER NOT NULL
);
CREATE INDEX idx_audit_findings_run ON audit_findings(run_id, position);

CREATE TABLE audit_evidence (
  id TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL REFERENCES audit_findings(id),
  url TEXT,
  observation TEXT NOT NULL,
  captured_at TEXT NOT NULL
);
CREATE INDEX idx_audit_evidence_finding ON audit_evidence(finding_id);

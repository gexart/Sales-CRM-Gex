-- "Save as draft": a half-finished invoice, quotation or bill kept per user until it is completed or deleted.
CREATE TABLE billing_drafts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                 -- 'invoice' | 'document:QUOTATION' | 'purchase' ...
  title TEXT,
  payload TEXT NOT NULL,              -- JSON form state
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_billing_drafts_user ON billing_drafts(user_id, kind, updated_at);

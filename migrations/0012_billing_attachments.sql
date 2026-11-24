-- Files attached to invoices, quotations, purchases and expenses (stored in R2, listed here). At most 5 per record.
CREATE TABLE billing_attachments (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('invoice','document','purchase','expense')),
  entity_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  file_key TEXT NOT NULL,
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_billing_attachments_entity ON billing_attachments(entity_type, entity_id);

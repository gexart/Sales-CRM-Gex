-- Links a CRM account (the client you are selling to) to its customer record in billing, so invoices can be raised from the account
-- and the account can show what has been billed and what is due.
CREATE TABLE billing_party_links (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  company_id TEXT NOT NULL DEFAULT 'default',
  party_id TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_billing_party_links_party ON billing_party_links(party_id);

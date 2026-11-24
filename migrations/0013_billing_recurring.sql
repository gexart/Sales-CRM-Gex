-- Recurring invoices (subscriptions): a saved invoice that is generated again on a schedule.
CREATE TABLE billing_recurring (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL DEFAULT 'default',
  title TEXT NOT NULL,
  party_name TEXT NOT NULL,
  payload TEXT NOT NULL,                  -- JSON: the invoice body without dates
  credit_days INTEGER NOT NULL DEFAULT 15,
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly','monthly','quarterly','half_yearly','yearly')),
  next_run TEXT NOT NULL,                 -- YYYY-MM-DD (India time)
  end_date TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  runs INTEGER NOT NULL DEFAULT 0,
  last_invoice_id TEXT,
  last_invoice_no TEXT,
  last_run_at TEXT,
  last_error TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_billing_recurring_due ON billing_recurring(active, next_run);

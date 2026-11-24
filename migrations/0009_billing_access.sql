-- Billing access control: roles, per-user overrides, approval requests, append-only audit log.

CREATE TABLE billing_roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT,
  is_system INTEGER NOT NULL DEFAULT 0,
  permissions TEXT NOT NULL DEFAULT '[]',   -- JSON array of permission keys
  limits TEXT NOT NULL DEFAULT '{}',        -- JSON: { maxDiscountPct, approvalAboveRupees }
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE users ADD COLUMN billing_role_id TEXT REFERENCES billing_roles(id);
ALTER TABLE users ADD COLUMN billing_extra_permissions TEXT NOT NULL DEFAULT '[]';
ALTER TABLE users ADD COLUMN billing_denied_permissions TEXT NOT NULL DEFAULT '[]';

-- A request waits here until someone with invoice.approve decides. Only then does the real document exist.
CREATE TABLE billing_approvals (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL DEFAULT 'default',
  kind TEXT NOT NULL CHECK (kind IN ('sales_invoice')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  requested_by TEXT NOT NULL REFERENCES users(id),
  payload TEXT NOT NULL,                    -- JSON: the validated request body, replayed on approval
  party_name TEXT,
  amount_paise INTEGER NOT NULL DEFAULT 0,
  reason TEXT,                              -- why approval was needed (no permission / over limit / discount)
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT,
  result_id TEXT,                           -- the invoice id once approved
  result_no TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_billing_approvals_status ON billing_approvals(status, created_at);
CREATE INDEX idx_billing_approvals_user ON billing_approvals(requested_by, created_at);

CREATE TABLE billing_audit (
  id TEXT PRIMARY KEY,
  company_id TEXT,
  actor_id TEXT,
  actor_name TEXT,
  action TEXT NOT NULL,                     -- e.g. "POST /sales/invoices", "approval.approve", "role.update"
  entity_type TEXT,
  entity_id TEXT,
  status INTEGER,
  detail TEXT,
  ip TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_billing_audit_time ON billing_audit(created_at);
CREATE INDEX idx_billing_audit_actor ON billing_audit(actor_id, created_at);

CREATE TRIGGER billing_audit_no_update BEFORE UPDATE ON billing_audit BEGIN SELECT RAISE(ABORT, 'billing_audit is append-only'); END;
CREATE TRIGGER billing_audit_no_delete BEFORE DELETE ON billing_audit BEGIN SELECT RAISE(ABORT, 'billing_audit is append-only'); END;

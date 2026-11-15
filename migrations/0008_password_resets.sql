-- One-time password setup / reset links (welcome emails and "forgot password").
-- Only the SHA-256 of the emailed token is stored, so a database leak cannot be used to take over an account.

CREATE TABLE password_resets (
  id TEXT PRIMARY KEY,               -- SHA-256 of the token in the emailed link
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('welcome','reset')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  ip TEXT
);
CREATE INDEX idx_password_resets_user ON password_resets(user_id, created_at);

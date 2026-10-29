-- Settings managed from the CRM (API keys, sender, quotas) and Android app builds served to the team.

-- Values here override the Worker's vars/secrets. Secret values are AES-GCM encrypted; they are never
-- returned to the browser (only the last four characters, to admins).
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  is_secret INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT REFERENCES users(id),
  updated_at TEXT NOT NULL
);

CREATE TABLE app_releases (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL DEFAULT 'android' CHECK (platform IN ('android')),
  version_name TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('upload','github')),
  source_ref TEXT,                   -- GitHub release tag for imported builds
  file_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  notes TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_app_releases_ref ON app_releases(platform, source_ref) WHERE source_ref IS NOT NULL;
CREATE INDEX idx_app_releases_created ON app_releases(platform, created_at DESC);

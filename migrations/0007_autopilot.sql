-- Sales autopilot: playbooks that find, research, draft, (after approval) send and follow up cold email
-- from a connected Google Workspace mailbox, read replies, and hand interested people to a human.
-- Plus a do-not-contact list shared with every channel, monthly revenue goals, and Harvey bridge tokens.

-- Connected sending mailboxes (Gmail API). The OAuth refresh token is AES-GCM encrypted (lib/settings).
CREATE TABLE mailboxes (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'google' CHECK (provider IN ('google')),
  email TEXT NOT NULL UNIQUE,
  from_name TEXT,
  refresh_token TEXT NOT NULL,
  daily_cap INTEGER NOT NULL DEFAULT 30,
  warmup_started_on TEXT,            -- YYYY-MM-DD; caps ramp up for new mailboxes
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','error')),
  last_error TEXT,
  last_inbox_check_at TEXT,
  connected_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE autopilot_playbooks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'paused' CHECK (status IN ('active','paused')),
  searches TEXT NOT NULL DEFAULT '[]', -- JSON [{query, location}] for Google Places discovery
  use_existing INTEGER NOT NULL DEFAULT 0, -- also enrol qualified CRM prospects (incl. Harvey's)
  service_fit TEXT,                  -- service being pitched (products.slug-ish free text)
  offer TEXT NOT NULL,               -- what we do for them, one paragraph
  entry_offer TEXT,                  -- low-commitment ask, e.g. "a free 10-minute website audit"
  booking_url TEXT,
  signature TEXT,
  min_score INTEGER NOT NULL DEFAULT 35,
  daily_new_leads INTEGER NOT NULL DEFAULT 15,
  follow_up_days TEXT NOT NULL DEFAULT '[3,5]', -- delays before follow-up 1, 2
  require_approval INTEGER NOT NULL DEFAULT 1,
  send_window TEXT NOT NULL DEFAULT '{"start":"10:00","end":"18:00","days":[1,2,3,4,5,6],"tz":"Asia/Kolkata"}',
  mailbox_id TEXT REFERENCES mailboxes(id),
  owner_id TEXT REFERENCES users(id),
  campaign_id TEXT REFERENCES campaigns(id),
  search_cursor INTEGER NOT NULL DEFAULT 0,
  paused_reason TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- One prospect's journey through a playbook.
CREATE TABLE autopilot_leads (
  id TEXT PRIMARY KEY,
  playbook_id TEXT NOT NULL REFERENCES autopilot_playbooks(id),
  prospect_id TEXT NOT NULL REFERENCES prospects(id),
  stage TEXT NOT NULL DEFAULT 'found' CHECK (stage IN ('found','researched','no_email','drafted','approved','in_sequence','replied','interested','meeting','won','lost','opted_out','bounced','skipped','finished')),
  email TEXT,
  first_name TEXT,
  research TEXT,                     -- JSON: facts used for personalisation (with sources)
  last_step_sent INTEGER NOT NULL DEFAULT 0,
  thread_id TEXT,                    -- Gmail thread of the conversation
  skip_reason TEXT,
  next_action_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (playbook_id, prospect_id)
);
CREATE INDEX idx_ap_leads_stage ON autopilot_leads(playbook_id, stage, next_action_at);
CREATE INDEX idx_ap_leads_thread ON autopilot_leads(thread_id);

CREATE TABLE autopilot_messages (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES autopilot_leads(id),
  direction TEXT NOT NULL CHECK (direction IN ('out','in')),
  kind TEXT NOT NULL CHECK (kind IN ('cold','follow_up','reply')),
  step INTEGER,                      -- 1..3 for the sequence; NULL for replies
  to_email TEXT,
  from_email TEXT,
  subject TEXT,
  body TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending_approval','approved','sent','failed','rejected','cancelled','received')),
  classification TEXT,               -- inbound: interested, question, objection, not_now, not_interested, opt_out, out_of_office, bounce, other
  generator TEXT,                    -- claude | template | human
  scheduled_for TEXT,
  sent_at TEXT,
  received_at TEXT,
  gmail_message_id TEXT UNIQUE,
  gmail_thread_id TEXT,
  rfc_message_id TEXT,
  approved_by TEXT REFERENCES users(id),
  approved_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_ap_msgs_lead ON autopilot_messages(lead_id, step);
CREATE INDEX idx_ap_msgs_queue ON autopilot_messages(status, scheduled_for);

-- Never contact these (any channel, any tool). Opt-outs are permanent.
CREATE TABLE do_not_contact (
  value TEXT PRIMARY KEY,            -- lowercase email address or domain
  kind TEXT NOT NULL CHECK (kind IN ('email','domain')),
  reason TEXT NOT NULL CHECK (reason IN ('opt_out','bounce','complaint','manual','customer','competitor')),
  source TEXT,                       -- autopilot, harvey, manual, …
  note TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE revenue_goals (
  period TEXT PRIMARY KEY,           -- YYYY-MM
  target_minor INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  avg_deal_minor INTEGER,            -- planning assumption for "deals needed"
  updated_by TEXT REFERENCES users(id),
  updated_at TEXT NOT NULL
);

-- Tokens are shared by the phone app and the Harvey bridge; kind says which.
ALTER TABLE devices ADD COLUMN kind TEXT NOT NULL DEFAULT 'phone';
ALTER TABLE prospects ADD COLUMN external_ref TEXT; -- e.g. harvey:<id>, for idempotent syncs
CREATE INDEX idx_prospects_external_ref ON prospects(external_ref);
CREATE INDEX idx_prospects_email ON prospects(email);

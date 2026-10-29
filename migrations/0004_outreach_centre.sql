-- Phase 3: Outreach Centre.
-- Outreach messages gain archiving, authorship, a selected service and sequence links.
-- Sequence enrollments tie a contact to a sequence; enrolling only creates tasks and
-- draft messages — nothing is ever sent automatically.

ALTER TABLE outreach_messages ADD COLUMN product_id TEXT REFERENCES products(id);
ALTER TABLE outreach_messages ADD COLUMN created_by TEXT REFERENCES users(id);
ALTER TABLE outreach_messages ADD COLUMN archived_at TEXT;
CREATE INDEX idx_outreach_status ON outreach_messages(status, owner_id);
CREATE INDEX idx_outreach_prospect ON outreach_messages(prospect_id);

ALTER TABLE email_templates ADD COLUMN created_by TEXT REFERENCES users(id);
ALTER TABLE outreach_sequences ADD COLUMN created_by TEXT REFERENCES users(id);

CREATE TABLE sequence_enrollments (
  id TEXT PRIMARY KEY,
  sequence_id TEXT NOT NULL REFERENCES outreach_sequences(id),
  contact_id TEXT NOT NULL REFERENCES contacts(id),
  account_id TEXT REFERENCES accounts(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','stopped','completed')),
  started_at TEXT NOT NULL,
  stopped_at TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);
-- A contact can be in a given sequence only once at a time.
CREATE UNIQUE INDEX uq_enrollment_active ON sequence_enrollments(sequence_id, contact_id) WHERE status = 'active';
CREATE INDEX idx_enrollment_contact ON sequence_enrollments(contact_id);

ALTER TABLE tasks ADD COLUMN sequence_enrollment_id TEXT REFERENCES sequence_enrollments(id);
ALTER TABLE outreach_messages ADD COLUMN sequence_enrollment_id TEXT REFERENCES sequence_enrollments(id);

-- Starting templates and the example follow-up sequence. Ordinary rows: edit or archive them.
INSERT INTO email_templates (id, name, category, subject, body, tone, status, created_at, updated_at) VALUES
('tpl_intro', 'Initial introduction', 'introduction',
 'Quick question about {{company_name}}',
 'Hi {{contact_first_name}},

I''m {{sender_name}} from Gexart. We help businesses like {{company_name}} with {{service_name}}.

Would you be open to a 20-minute call next week to see whether it is relevant for you?

Best regards,
{{sender_name}}
Gexart',
 'professional', 'active', '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z'),
('tpl_follow_up', 'Follow-up', 'follow_up',
 'Re: Quick question about {{company_name}}',
 'Hi {{contact_first_name}},

Following up on my earlier note about {{service_name}} for {{company_name}}. Happy to share a few specific observations if that would be useful.

Would a short call this week work?

Best,
{{sender_name}}',
 'professional', 'active', '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z'),
('tpl_final', 'Final follow-up', 'follow_up',
 'Closing the loop, {{contact_first_name}}',
 'Hi {{contact_first_name}},

I haven''t heard back, so I''ll assume the timing isn''t right for {{company_name}}. If {{service_name}} becomes a priority later, just reply to this email.

Thanks,
{{sender_name}}',
 'professional', 'active', '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z');

INSERT INTO outreach_sequences (id, name, description, status, created_at, updated_at) VALUES
('seq_standard', 'Standard 4-touch follow-up', 'Day 1 introduction, day 4 follow-up, day 8 case study, day 14 final follow-up.', 'active', '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z');

INSERT INTO sequence_steps (id, sequence_id, position, day_offset, channel, template_id, task_type, note) VALUES
('seq_standard_1', 'seq_standard', 1, 0, 'manual_email', 'tpl_intro', 'send_email', NULL),
('seq_standard_2', 'seq_standard', 2, 3, 'manual_email', 'tpl_follow_up', 'send_email', NULL),
('seq_standard_3', 'seq_standard', 3, 7, 'manual_email', NULL, 'send_email', 'Share a relevant, verified case study from Sales Assets.'),
('seq_standard_4', 'seq_standard', 4, 13, 'manual_email', 'tpl_final', 'send_email', NULL);

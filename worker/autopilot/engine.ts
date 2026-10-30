// The autopilot loop. Runs from the queue every 15 minutes (cron) or on "Run now":
//   1. read replies (always first: an opt-out must stop the next send)
//   2. send approved emails that are due, inside the send window and the mailbox's daily cap
//   3. research new leads (their website, their published email)
//   4. draft sequences for researched leads (held for approval unless the playbook says otherwise)
//   5. discover or enrol new leads up to the playbook's daily number
// Every step is bounded so one run never does unbounded work.
import type { Env } from "../env";
import { activityStmt } from "../lib/audit-log";
import { notifyStmt } from "../audits/run";
import { computeQualification } from "../lib/qualification";
import { claudeJson, placesTextSearch, untrusted } from "../lib/providers";
import { gmailInbox, gmailSend, newReplyText, type InboundMail, type Mailbox } from "../lib/gmail";
import { b, domainOf, newId, normalizeName, now } from "../lib/util";
import { bouncedAddress, classifyByRules, dncMatch, effectiveDailyCap, footer, inSendWindow, type ResearchFacts, type SendWindow } from "./rules";
import { draftSequence, researchProspect } from "./research";

type Row = Record<string, unknown>;
export interface Playbook {
  id: string;
  name: string;
  status: string;
  searches: string;
  use_existing: number;
  service_fit: string | null;
  offer: string;
  entry_offer: string | null;
  booking_url: string | null;
  signature: string | null;
  min_score: number;
  daily_new_leads: number;
  follow_up_days: string;
  require_approval: number;
  send_window: string;
  mailbox_id: string | null;
  owner_id: string | null;
  campaign_id: string | null;
  search_cursor: number;
}

const PER_RUN = { research: 5, draft: 5, send: 6 };
const DAY = 86_400_000;
const addDays = (iso: string, d: number) => new Date(Date.parse(iso) + d * DAY).toISOString();

async function dncList(env: Env): Promise<string[]> {
  return (await env.DB.prepare("SELECT value FROM do_not_contact").all<{ value: string }>()).results.map((r) => r.value);
}

export function addDncStmt(env: Env, value: string, reason: string, source: string, note: string | null, userId: string | null) {
  const v = value.trim().toLowerCase();
  return env.DB.prepare("INSERT OR IGNORE INTO do_not_contact (value, kind, reason, source, note, created_by, created_at) VALUES (?,?,?,?,?,?,?)").bind(
    v, v.includes("@") ? "email" : "domain", reason, source, b(note), userId, now(),
  );
}

const cancelPendingStmt = (env: Env, leadId: string) =>
  env.DB.prepare("UPDATE autopilot_messages SET status = 'cancelled', updated_at = ? WHERE lead_id = ? AND direction = 'out' AND kind != 'reply' AND status IN ('pending_approval','approved')").bind(now(), leadId);

async function loadMailbox(env: Env, id: string | null): Promise<Mailbox | null> {
  if (!id) return null;
  return env.DB.prepare("SELECT * FROM mailboxes WHERE id = ?").bind(id).first<Mailbox>();
}

// ─── 1. Replies ───
const REPLY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["classification", "summary", "reply"],
  properties: {
    classification: { type: "string", enum: ["interested", "question", "objection", "not_now", "other"] },
    summary: { type: "string" },
    reply: { type: "string" },
  },
};

async function draftReply(env: Env, lead: Row, pb: Playbook | null, incoming: string): Promise<{ classification: string; summary: string; reply: string } | null> {
  if (!env.ANTHROPIC_API_KEY) return null;
  try {
    const history = await env.DB.prepare("SELECT direction, subject, body FROM autopilot_messages WHERE lead_id = ? AND status IN ('sent','received') ORDER BY COALESCE(sent_at, received_at)").bind(lead.id).all<Row>();
    const { data } = await claudeJson<{ classification: string; summary: string; reply: string }>(env, {
      effort: "low",
      schema: REPLY_SCHEMA,
      system: `You help a salesperson at Gexart (digital growth agency in India) answer replies to their cold emails. Classify the latest reply and draft a short, warm, plain-text answer (under 90 words) that moves toward a 15-minute call. Answer questions honestly using only the facts given; never invent prices, results or guarantees — if pricing is asked, say you'll share options on a quick call. Sign with the sender's first name. The draft is reviewed by a human before sending.`,
      prompt: [
        `Our offer: ${pb?.offer ?? "digital growth services"}`,
        pb?.booking_url ? `Booking link: ${pb.booking_url}` : "",
        `Sender first name: ${(pb?.signature ?? "").split(/\s|\n/)[0] || "Team"}`,
        "Conversation so far:",
        untrusted("email_thread", history.results.map((m) => `${m.direction === "out" ? "US" : "THEM"}: ${m.subject}\n${String(m.body ?? "").slice(0, 1500)}`).join("\n---\n")),
        "Latest reply:",
        untrusted("latest_reply", incoming),
      ].filter(Boolean).join("\n"),
    });
    return data;
  } catch (e) {
    console.warn("reply draft failed", e instanceof Error ? e.message : e);
    return null;
  }
}

async function handleInbound(env: Env, mb: Mailbox, m: InboundMail) {
  const seen = await env.DB.prepare("SELECT 1 FROM autopilot_messages WHERE gmail_message_id = ?").bind(m.id).first();
  if (seen) return;
  let lead = await env.DB.prepare("SELECT l.*, p.company_name, p.owner_id AS prospect_owner FROM autopilot_leads l JOIN prospects p ON p.id = l.prospect_id WHERE l.thread_id = ?").bind(m.threadId).first<Row>();
  const text = newReplyText(m.text);
  const rule = classifyByRules({ from: m.from, subject: m.subject, text, autoSubmitted: m.autoSubmitted });
  if (!lead && rule === "bounce") {
    const addr = bouncedAddress(m.text);
    if (addr) lead = await env.DB.prepare("SELECT l.*, p.company_name, p.owner_id AS prospect_owner FROM autopilot_leads l JOIN prospects p ON p.id = l.prospect_id WHERE l.email = ? ORDER BY l.updated_at DESC").bind(addr).first<Row>();
  }
  if (!lead) return; // not one of our conversations
  const pb = await env.DB.prepare("SELECT * FROM autopilot_playbooks WHERE id = ?").bind(lead.playbook_id).first<Playbook>();
  const owner = String(pb?.owner_id ?? lead.prospect_owner ?? "");
  const t = now();
  const msgId = newId();
  const stmts: D1PreparedStatement[] = [];
  const insertInbound = (classification: string) =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO autopilot_messages (id, lead_id, direction, kind, from_email, to_email, subject, body, status, classification, received_at, gmail_message_id, gmail_thread_id, created_at, updated_at)
       VALUES (?,?,'in','reply',?,?,?,?,'received',?,?,?,?,?,?)`,
    ).bind(msgId, lead.id, m.from, mb.email, m.subject.slice(0, 300), text, classification, m.date, m.id, m.threadId, t, t);
  const company = String(lead.company_name);

  if (rule === "bounce" || rule === "opt_out") {
    const email = String(lead.email ?? m.from);
    stmts.push(
      insertInbound(rule),
      cancelPendingStmt(env, String(lead.id)),
      env.DB.prepare("UPDATE autopilot_leads SET stage = ?, updated_at = ? WHERE id = ?").bind(rule === "bounce" ? "bounced" : "opted_out", t, lead.id),
      addDncStmt(env, email, rule === "bounce" ? "bounce" : "opt_out", "autopilot", rule === "opt_out" ? text.slice(0, 300) : null, null),
      activityStmt(env.DB, { type: "email", subject: rule === "bounce" ? `Email to ${email} bounced` : `${company} opted out of email`, body: rule === "opt_out" ? text.slice(0, 2000) : null, actorId: null, prospectId: String(lead.prospect_id), occurredAt: m.date }),
    );
    await env.DB.batch(stmts);
    return;
  }
  if (rule === "out_of_office") {
    // Keep the sequence, just push the next email back a few days.
    stmts.push(
      insertInbound(rule),
      env.DB.prepare("UPDATE autopilot_messages SET scheduled_for = ?, updated_at = ? WHERE lead_id = ? AND status = 'approved' AND direction = 'out'").bind(addDays(t, 4), t, lead.id),
    );
    await env.DB.batch(stmts);
    return;
  }
  if (rule === "not_interested") {
    stmts.push(
      insertInbound(rule),
      cancelPendingStmt(env, String(lead.id)),
      env.DB.prepare("UPDATE autopilot_leads SET stage = 'lost', updated_at = ? WHERE id = ?").bind(t, lead.id),
      activityStmt(env.DB, { type: "email", subject: `${company} replied: not interested`, body: text.slice(0, 2000), actorId: null, prospectId: String(lead.prospect_id), occurredAt: m.date }),
    );
    await env.DB.batch(stmts);
    return;
  }

  // A human reply: stop the sequence, hand it to a person with a drafted answer.
  const ai = await draftReply(env, lead, pb, text);
  const classification = ai?.classification ?? "other";
  const hot = classification === "interested" || classification === "question";
  stmts.push(
    insertInbound(classification),
    cancelPendingStmt(env, String(lead.id)),
    env.DB.prepare("UPDATE autopilot_leads SET stage = ?, next_action_at = ?, updated_at = ? WHERE id = ?").bind(hot ? "interested" : "replied", t, t, lead.id),
    activityStmt(env.DB, { type: "email", subject: `${company} replied${ai ? ` (${classification})` : ""}`, body: text.slice(0, 4000), actorId: null, prospectId: String(lead.prospect_id), occurredAt: m.date }),
  );
  if (ai?.reply) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO autopilot_messages (id, lead_id, direction, kind, to_email, from_email, subject, body, status, generator, gmail_thread_id, created_at, updated_at)
         VALUES (?,?,'out','reply',?,?,?,?,'pending_approval','claude',?,?,?)`,
      ).bind(newId(), lead.id, m.from, mb.email, m.subject.toLowerCase().startsWith("re:") ? m.subject : `Re: ${m.subject}`, ai.reply.trim(), m.threadId, t, t),
    );
  }
  if (owner) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO tasks (id, title, description, type, prospect_id, due_at, priority, owner_id, status, created_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,'open',NULL,?,?)`,
      ).bind(newId(), `${hot ? "🔥 Reply to" : "Reply to"} ${company}${hot ? " — book the call" : ""}`.slice(0, 200), (ai?.summary ?? text).slice(0, 2000), hot ? "follow_up_call" : "send_email", lead.prospect_id, t, hot ? "urgent" : "high", owner, t, t),
      notifyStmt(env.DB, owner, `ap-reply:${m.id}`, `${hot ? "🔥 " : ""}${company} replied${ai ? `: ${classification}` : ""}`, (ai?.summary ?? text).slice(0, 300), "prospect", String(lead.prospect_id)),
    );
  }
  await env.DB.batch(stmts);
}

export async function checkInboxes(env: Env) {
  const boxes = await env.DB.prepare("SELECT * FROM mailboxes WHERE status = 'active'").all<Mailbox & { last_inbox_check_at: string | null }>();
  for (const mb of boxes.results) {
    const since = mb.last_inbox_check_at ? Date.parse(mb.last_inbox_check_at) - 15 * 60_000 : Date.now() - 2 * DAY;
    const startedAt = now();
    try {
      const mails = await gmailInbox(env, mb, Math.floor(since / 1000));
      for (const m of mails) await handleInbound(env, mb, m);
      await env.DB.prepare("UPDATE mailboxes SET last_inbox_check_at = ?, last_error = NULL WHERE id = ?").bind(startedAt, mb.id).run();
    } catch (e) {
      await env.DB.prepare("UPDATE mailboxes SET last_error = ?, updated_at = ? WHERE id = ?").bind(e instanceof Error ? e.message : "Inbox check failed", now(), mb.id).run();
    }
  }
}

// ─── 2. Send ───
async function sentToday(env: Env, mailboxEmail: string) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM autopilot_messages WHERE direction = 'out' AND status = 'sent' AND from_email = ? AND sent_at >= ?").bind(mailboxEmail, new Date(Date.now() - DAY).toISOString()).first<{ n: number }>();
  return Number(r?.n ?? 0);
}

/** Pauses a playbook when more than 5% of the last week's sends bounced (min 20 sends). */
async function bounceGuard(env: Env, pb: Playbook): Promise<boolean> {
  const since = new Date(Date.now() - 7 * DAY).toISOString();
  const [sent, bounced] = await env.DB.batch<{ n: number }>([
    env.DB.prepare("SELECT COUNT(*) AS n FROM autopilot_messages m JOIN autopilot_leads l ON l.id = m.lead_id WHERE l.playbook_id = ? AND m.direction = 'out' AND m.status = 'sent' AND m.sent_at >= ?").bind(pb.id, since),
    env.DB.prepare("SELECT COUNT(*) AS n FROM autopilot_messages m JOIN autopilot_leads l ON l.id = m.lead_id WHERE l.playbook_id = ? AND m.direction = 'in' AND m.classification = 'bounce' AND m.received_at >= ?").bind(pb.id, since),
  ]);
  const s = Number(sent.results[0]?.n ?? 0);
  const bn = Number(bounced.results[0]?.n ?? 0);
  if (s >= 20 && bn / s > 0.05) {
    const reason = `Paused automatically: ${bn} of ${s} emails bounced this week (over 5%). Check the lead source before resuming.`;
    await env.DB.batch([
      env.DB.prepare("UPDATE autopilot_playbooks SET status = 'paused', paused_reason = ?, updated_at = ? WHERE id = ?").bind(reason, now(), pb.id),
      ...(pb.owner_id ? [notifyStmt(env.DB, pb.owner_id, `ap-bounce:${pb.id}:${now().slice(0, 10)}`, `Autopilot "${pb.name}" paused`, reason, "autopilot", pb.id)] : []),
    ]);
    return false;
  }
  return true;
}

export async function sendMessage(env: Env, mb: Mailbox, msg: Row, lead: Row, postalAddress: string | null) {
  const isReply = msg.kind === "reply";
  const first = isReply ? null : await env.DB.prepare("SELECT rfc_message_id FROM autopilot_messages WHERE lead_id = ? AND step = 1 AND status = 'sent'").bind(lead.id).first<{ rfc_message_id: string | null }>();
  const pb = await env.DB.prepare("SELECT signature FROM autopilot_playbooks WHERE id = ?").bind(lead.playbook_id).first<{ signature: string | null }>();
  // Cold and follow-up emails carry the opt-out line and postal address; human-approved replies don't.
  const text = isReply ? String(msg.body) : `${String(msg.body).trim()}\n\n--\n${footer(pb?.signature ?? null, postalAddress)}`;
  const t = now();
  try {
    const sent = await gmailSend(env, mb, {
      to: String(msg.to_email ?? lead.email),
      subject: String(msg.subject),
      text,
      threadId: (msg.gmail_thread_id as string) ?? (Number(msg.step) > 1 ? (lead.thread_id as string) : null),
      inReplyTo: first?.rfc_message_id ?? null,
    });
    const stmts: D1PreparedStatement[] = [
      env.DB.prepare("UPDATE autopilot_messages SET status = 'sent', sent_at = ?, from_email = ?, to_email = COALESCE(to_email, ?), gmail_message_id = ?, gmail_thread_id = ?, rfc_message_id = ?, error = NULL, updated_at = ? WHERE id = ?").bind(
        t, mb.email, lead.email, sent.id, sent.threadId, sent.rfcMessageId, t, msg.id,
      ),
      activityStmt(env.DB, { type: "email", subject: `${isReply ? "Reply" : `Autopilot email ${msg.step}`} sent: ${msg.subject}`, body: String(msg.body).slice(0, 4000), actorId: (msg.approved_by as string) ?? null, prospectId: String(lead.prospect_id), occurredAt: t }),
    ];
    if (!isReply) {
      const step = Number(msg.step);
      const delays = JSON.parse(String((await env.DB.prepare("SELECT follow_up_days FROM autopilot_playbooks WHERE id = ?").bind(lead.playbook_id).first<{ follow_up_days: string }>())?.follow_up_days ?? "[3,5]")) as number[];
      const more = await env.DB.prepare("SELECT COUNT(*) AS n FROM autopilot_messages WHERE lead_id = ? AND step > ? AND status IN ('approved','pending_approval')").bind(lead.id, step).first<{ n: number }>();
      stmts.push(
        env.DB.prepare("UPDATE autopilot_messages SET scheduled_for = ?, updated_at = ? WHERE lead_id = ? AND step = ? AND status = 'approved'").bind(addDays(t, delays[step - 1] ?? 4), t, lead.id, step + 1),
        env.DB.prepare("UPDATE autopilot_leads SET stage = ?, last_step_sent = ?, thread_id = COALESCE(thread_id, ?), updated_at = ? WHERE id = ?").bind(Number(more?.n ?? 0) > 0 ? "in_sequence" : "finished", step, sent.threadId, t, lead.id),
        env.DB.prepare("UPDATE prospects SET status = CASE WHEN status IN ('discovered','to_qualify') THEN 'researching' ELSE status END, updated_at = ? WHERE id = ?").bind(t, lead.prospect_id),
      );
    } else {
      stmts.push(env.DB.prepare("UPDATE autopilot_leads SET stage = CASE WHEN stage = 'replied' THEN 'replied' ELSE stage END, updated_at = ? WHERE id = ?").bind(t, lead.id));
    }
    await env.DB.batch(stmts);
    return { ok: true as const };
  } catch (e) {
    const err = e instanceof Error ? e.message : "Send failed";
    await env.DB.prepare("UPDATE autopilot_messages SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").bind(err, t, msg.id).run();
    return { ok: false as const, error: err };
  }
}

async function sendDue(env: Env, pb: Playbook) {
  const mb = await loadMailbox(env, pb.mailbox_id);
  if (!mb || mb.status !== "active" || !env.COMPANY_POSTAL_ADDRESS) return;
  if (!inSendWindow(JSON.parse(pb.send_window) as SendWindow)) return;
  if (!(await bounceGuard(env, pb))) return;
  const room = effectiveDailyCap(mb.daily_cap, mb.warmup_started_on) - (await sentToday(env, mb.email));
  if (room <= 0) return;
  const due = await env.DB.prepare(
    `SELECT m.*, l.email, l.thread_id, l.prospect_id, l.playbook_id, l.stage AS lead_stage FROM autopilot_messages m JOIN autopilot_leads l ON l.id = m.lead_id
     WHERE l.playbook_id = ? AND m.direction = 'out' AND m.kind != 'reply' AND m.status = 'approved' AND (m.scheduled_for IS NULL OR m.scheduled_for <= ?)
       AND l.stage IN ('approved','in_sequence')
       AND NOT EXISTS (SELECT 1 FROM autopilot_messages p WHERE p.lead_id = m.lead_id AND p.step < m.step AND p.status != 'sent')
     ORDER BY m.step DESC, m.scheduled_for LIMIT ?`,
  )
    .bind(pb.id, now(), Math.min(room, PER_RUN.send))
    .all<Row>();
  if (!due.results.length) return;
  const dnc = await dncList(env);
  const address = env.COMPANY_POSTAL_ADDRESS ?? null;
  for (const msg of due.results) {
    const blocked = dncMatch(String(msg.email), dnc);
    if (blocked) {
      await env.DB.batch([cancelPendingStmt(env, String(msg.lead_id)), env.DB.prepare("UPDATE autopilot_leads SET stage = 'opted_out', skip_reason = ?, updated_at = ? WHERE id = ?").bind(`On do-not-contact list (${blocked})`, now(), msg.lead_id)]);
      continue;
    }
    await sendMessage(env, mb, msg, { ...msg, id: msg.lead_id }, address);
  }
}

// ─── 3. Draft ───
async function draftReady(env: Env, pb: Playbook, senderName: string) {
  const leads = await env.DB.prepare("SELECT * FROM autopilot_leads WHERE playbook_id = ? AND stage = 'researched' ORDER BY created_at LIMIT ?").bind(pb.id, PER_RUN.draft).all<Row>();
  for (const lead of leads.results) {
    const facts = JSON.parse(String(lead.research ?? "{}")) as ResearchFacts;
    const { steps, generator } = await draftSequence(env, facts, { offer: pb.offer, entry_offer: pb.entry_offer, booking_url: pb.booking_url, sender_name: senderName });
    const t = now();
    const status = pb.require_approval ? "pending_approval" : "approved";
    await env.DB.batch([
      ...steps.map((s, i) =>
        env.DB.prepare(
          `INSERT INTO autopilot_messages (id, lead_id, direction, kind, step, to_email, subject, body, status, generator, created_at, updated_at)
           VALUES (?,?,'out',?,?,?,?,?,?,?,?,?)`,
        ).bind(newId(), lead.id, i === 0 ? "cold" : "follow_up", i + 1, lead.email, s.subject, s.body, status, generator, t, t),
      ),
      env.DB.prepare("UPDATE autopilot_leads SET stage = ?, updated_at = ? WHERE id = ?").bind(pb.require_approval ? "drafted" : "approved", t, lead.id),
    ]);
  }
}

// ─── 4. Research ───
async function researchFound(env: Env, pb: Playbook) {
  const leads = await env.DB.prepare("SELECT l.id AS lead_id, p.* FROM autopilot_leads l JOIN prospects p ON p.id = l.prospect_id WHERE l.playbook_id = ? AND l.stage = 'found' ORDER BY l.created_at LIMIT ?").bind(pb.id, PER_RUN.research).all<Row>();
  if (!leads.results.length) return;
  const dnc = await dncList(env);
  for (const p of leads.results) {
    const { facts, email, error } = await researchProspect(p);
    const t = now();
    const blocked = email ? dncMatch(email, dnc) : p.domain ? dncMatch(`x@${p.domain}`, dnc) : null;
    const stage = blocked ? "skipped" : email ? "researched" : "no_email";
    await env.DB.batch([
      env.DB.prepare("UPDATE autopilot_leads SET stage = ?, email = ?, first_name = ?, research = ?, skip_reason = ?, last_error = ?, updated_at = ? WHERE id = ?").bind(
        stage, b(email), b(facts.firstName), JSON.stringify(facts), blocked ? `On do-not-contact list (${blocked})` : email ? null : "No published email address found", b(error), t, p.lead_id,
      ),
      env.DB.prepare("UPDATE prospects SET email = COALESCE(email, ?), last_researched_at = ?, updated_at = ? WHERE id = ?").bind(b(email), t, t, p.id),
    ]);
  }
}

// ─── 5. Discover / enrol ───
async function discover(env: Env, pb: Playbook) {
  const today = new Date(Date.now() - DAY).toISOString();
  const [added, backlog] = await env.DB.batch<{ n: number }>([
    env.DB.prepare("SELECT COUNT(*) AS n FROM autopilot_leads WHERE playbook_id = ? AND created_at >= ?").bind(pb.id, today),
    env.DB.prepare("SELECT COUNT(*) AS n FROM autopilot_leads WHERE playbook_id = ? AND stage IN ('found','researched','drafted')").bind(pb.id),
  ]);
  let room = pb.daily_new_leads - Number(added.results[0]?.n ?? 0);
  if (room <= 0 || Number(backlog.results[0]?.n ?? 0) >= pb.daily_new_leads * 2) return;
  const t = now();
  const enrol = (prospectId: string) =>
    env.DB.prepare("INSERT OR IGNORE INTO autopilot_leads (id, playbook_id, prospect_id, stage, created_at, updated_at) VALUES (?,?,?,'found',?,?)").bind(newId(), pb.id, prospectId, t, t);

  if (pb.use_existing) {
    const r = await env.DB.prepare(
      `SELECT id FROM prospects WHERE archived_at IS NULL AND status IN ('discovered','researching','to_qualify','qualified') AND COALESCE(qualification_score, 0) >= ?
         AND id NOT IN (SELECT prospect_id FROM autopilot_leads) ORDER BY qualification_score DESC, created_at DESC LIMIT ?`,
    ).bind(pb.min_score, room).all<{ id: string }>();
    if (r.results.length) await env.DB.batch(r.results.map((x) => enrol(x.id)));
    room -= r.results.length;
  }
  const searches = JSON.parse(pb.searches || "[]") as { query: string; location?: string }[];
  if (room <= 0 || !searches.length || !env.GOOGLE_PLACES_API_KEY) return;
  const s = searches[pb.search_cursor % searches.length];
  await env.DB.prepare("UPDATE autopilot_playbooks SET search_cursor = search_cursor + 1 WHERE id = ?").bind(pb.id).run();
  const places = await placesTextSearch(env, [s.query, s.location && `in ${s.location}`].filter(Boolean).join(" "), 20);
  const stmts: D1PreparedStatement[] = [];
  for (const pl of places) {
    if (room <= 0) break;
    const dom = domainOf(pl.website);
    const nn = normalizeName(pl.name);
    const dup = await env.DB.prepare(
      `SELECT 1 FROM prospects WHERE archived_at IS NULL AND (name_normalized = ? OR (? IS NOT NULL AND domain = ?)) UNION ALL SELECT 1 FROM accounts WHERE archived_at IS NULL AND (name_normalized = ? OR (? IS NOT NULL AND domain = ?)) LIMIT 1`,
    ).bind(nn, dom, dom, nn, dom, dom).first();
    if (dup) continue;
    const q = computeQualification({ industry: pl.category, geography: pl.city ?? s.location ?? null, website: pl.website, phone: pl.phone, service_fit: pb.service_fit });
    if (q.score < pb.min_score) continue;
    const pid = newId();
    stmts.push(
      env.DB.prepare(
        `INSERT INTO prospects (id, company_name, name_normalized, website, domain, industry, geography, phone, discovery_source, campaign_id, service_fit, status, owner_id,
           research_notes, qualification_score, qualification_level, qualification_factors, qualification_scored_at, created_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?, 'autopilot', ?,?, 'discovered', ?,?,?,?,?,?,NULL,?,?)`,
      ).bind(
        pid, pl.name, nn, b(pl.website), b(dom), b(pl.category), b(pl.city ?? s.location ?? null), b(pl.phone), b(pb.campaign_id), b(pb.service_fit), b(pb.owner_id),
        `Found by autopilot "${pb.name}" via Google Places ("${s.query}${s.location ? ` in ${s.location}` : ""}"). ${pl.address ?? ""}${pl.rating ? ` · ${pl.rating}★ (${pl.reviewCount} reviews)` : ""}`.trim(),
        q.score, q.level, JSON.stringify(q.factors), t, t, t,
      ),
      enrol(pid),
    );
    room--;
  }
  if (stmts.length) await env.DB.batch(stmts);
}

/** One full pass for every active playbook (or one playbook, for "Run now"). */
export async function autopilotTick(env: Env, playbookId?: string) {
  await checkInboxes(env);
  const pbs = await env.DB.prepare(`SELECT * FROM autopilot_playbooks WHERE ${playbookId ? "id = ?" : "status = 'active'"}`).bind(...(playbookId ? [playbookId] : [])).all<Playbook>();
  for (const pb of pbs.results) {
    try {
      const owner = pb.owner_id ? await env.DB.prepare("SELECT name FROM users WHERE id = ?").bind(pb.owner_id).first<{ name: string }>() : null;
      const sender = (pb.signature ?? "").trim().split(/\s|\n/)[0] || owner?.name.split(" ")[0] || "Team";
      await sendDue(env, pb);
      await researchFound(env, pb);
      await draftReady(env, pb, sender);
      await discover(env, pb);
    } catch (e) {
      console.error("autopilot playbook failed", pb.id, e);
      await env.DB.prepare("UPDATE autopilot_playbooks SET paused_reason = ?, updated_at = ? WHERE id = ?").bind(`Last run error: ${e instanceof Error ? e.message : "unknown"}`.slice(0, 500), now(), pb.id).run();
    }
  }
}

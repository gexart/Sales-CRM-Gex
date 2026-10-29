// Zod schemas shared by the Worker (authoritative validation) and the UI (inline form errors).
import { z } from "zod";
import * as E from "./enums";

const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

export const optText = (max = 500) => z.preprocess(blankToNull, z.string().trim().max(max).nullable().optional());
export const reqText = (max = 200) => z.string().trim().min(1, "Required").max(max);
const optEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(blankToNull, z.enum(values).nullable().optional());
const optInt = z.preprocess(
  (v) => (v === "" || v === undefined ? null : typeof v === "string" ? Number(v) : v),
  z.number().int("Must be a whole number").nonnegative("Must be zero or more").nullable().optional(),
);
const optUrl = z.preprocess((v) => {
  const s = blankToNull(v);
  if (typeof s !== "string") return s;
  return /^https?:\/\//i.test(s.trim()) ? s.trim() : `https://${s.trim()}`;
}, z.url("Enter a valid URL").max(500).nullable().optional());
const optEmail = z.preprocess(blankToNull, z.email("Enter a valid email").max(200).nullable().optional());
const optDate = z.preprocess(blankToNull, z.iso.date("Use YYYY-MM-DD").nullable().optional());
const optDateTime = z.preprocess(blankToNull, z.iso.datetime({ offset: true, message: "Invalid date/time" }).nullable().optional());
const optId = z.preprocess(blankToNull, z.string().max(64).nullable().optional());
const currency = z.preprocess(blankToNull, z.string().length(3).toUpperCase().nullable().optional());
const forceFlag = z.boolean().optional(); // acknowledge a duplicate warning

export const accountSchema = z.object({
  name: reqText(200),
  legal_name: optText(200),
  website: optUrl,
  industry: optText(100),
  company_size: optEnum(E.COMPANY_SIZES.values),
  business_type: optText(100),
  country: optText(100),
  state: optText(100),
  city: optText(100),
  address: optText(500),
  postal_code: optText(20),
  email: optEmail,
  phone: optText(40),
  linkedin_url: optUrl,
  instagram_url: optUrl,
  facebook_url: optUrl,
  youtube_url: optUrl,
  google_business_url: optUrl,
  owner_id: optId,
  type: z.enum(E.ACCOUNT_TYPES.values).default("prospect"),
  status: z.enum(E.ACCOUNT_STATUSES.values).default("new"),
  qualification: optEnum(E.QUALIFICATION_LEVELS.values),
  qualification_note: optText(2000),
  lead_source: optEnum(E.LEAD_SOURCES.values),
  source_campaign_id: optId,
  notes: optText(10000),
  force: forceFlag,
});

export const contactSchema = z.object({
  first_name: reqText(100),
  last_name: optText(100),
  job_title: optText(150),
  department: optText(100),
  account_id: optId,
  email: optEmail,
  phone: optText(40),
  linkedin_url: optUrl,
  owner_id: optId,
  decision_role: optEnum(E.DECISION_ROLES.values),
  preferred_channel: optEnum(E.CHANNELS.values),
  status: z.enum(E.CONTACT_STATUSES.values).default("new"),
  last_contacted_at: optDateTime,
  next_follow_up_at: optDateTime,
  notes: optText(10000),
  source: optEnum(E.LEAD_SOURCES.values),
  force: forceFlag,
});

export const productSchema = z.object({
  name: reqText(150),
  sku: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9_-]+$/, "Letters, numbers, - and _ only").toUpperCase(),
  category: z.enum(E.PRODUCT_CATEGORIES.values),
  short_description: optText(300),
  description: optText(10000),
  pricing_model: z.enum(E.PRICING_MODELS.values).default("custom"),
  default_price_minor: optInt,
  currency: currency.default("INR"),
  billing_frequency: optEnum(E.BILLING_FREQUENCIES.values),
  internal_cost_minor: optInt,
  features: optText(5000),
  target_industries: optText(500),
  status: z.enum(E.ACTIVE_STATUSES.values).default("active"),
});

export const campaignSchema = z.object({
  name: reqText(150),
  code: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9_-]+$/, "Letters, numbers, - and _ only").toUpperCase(),
  description: optText(5000),
  type: z.enum(E.CAMPAIGN_TYPES.values),
  objective: optText(1000),
  target_industry: optText(200),
  target_geography: optText(200),
  target_audience: optText(500),
  owner_id: optId,
  start_date: optDate,
  end_date: optDate,
  budget_minor: optInt,
  actual_spend_minor: optInt,
  currency: currency.default("INR"),
  target_leads: optInt,
  status: z.enum(E.CAMPAIGN_STATUSES.values).default("draft"),
  lead_source: optEnum(E.LEAD_SOURCES.values),
  notes: optText(10000),
  product_ids: z.array(z.string().max(64)).max(100).optional(),
});

export const prospectSchema = z.object({
  company_name: reqText(200),
  website: optUrl,
  industry: optText(100),
  geography: optText(150),
  company_size: optEnum(E.COMPANY_SIZES.values),
  contact_name: optText(150),
  contact_title: optText(150),
  email: optEmail,
  phone: optText(40),
  linkedin_url: optUrl,
  discovery_source: optEnum(E.LEAD_SOURCES.values),
  campaign_id: optId,
  service_fit: optText(500),
  estimated_value_minor: optInt,
  currency: currency.default("INR"),
  status: z.enum(E.PROSPECT_STATUSES.values).default("discovered"),
  owner_id: optId,
  last_researched_at: optDateTime,
  research_notes: optText(10000),
  qualification_evidence: optText(10000),
  next_action: optText(500),
  force: forceFlag,
});

export const opportunitySchema = z.object({
  name: reqText(200),
  account_id: z.string().min(1, "Choose an account").max(64),
  primary_contact_id: optId,
  campaign_id: optId,
  owner_id: optId,
  amount_minor: optInt,
  currency: currency.default("INR"),
  expected_close_date: optDate,
  stage: z.enum(E.OPPORTUNITY_STAGES.values).default("new"),
  probability: z.preprocess(
    (v) => (v === "" || v === undefined ? undefined : typeof v === "string" ? Number(v) : v),
    z.number().int().min(0).max(100).optional(),
  ),
  next_action: optText(500),
  competitors: optText(1000),
  proposal_url: optUrl,
  win_loss_reason: optText(2000),
  notes: optText(10000),
});

export const taskSchema = z.object({
  title: reqText(200),
  description: optText(5000),
  type: z.enum(E.TASK_TYPES.values).default("general"),
  account_id: optId,
  contact_id: optId,
  prospect_id: optId,
  opportunity_id: optId,
  due_at: optDateTime,
  priority: z.enum(E.PRIORITIES.values).default("medium"),
  owner_id: optId,
  status: z.enum(E.TASK_STATUSES.values).default("open"),
  reminder_minutes: optInt,
  outcome: optText(5000),
  reopen: z.boolean().optional(), // must be true to move a completed/cancelled task back to open
});

export const activitySchema = z.object({
  type: z.enum(E.LOGGABLE_ACTIVITY_TYPES as [string, ...string[]]),
  subject: reqText(200),
  body: optText(10000),
  account_id: optId,
  contact_id: optId,
  prospect_id: optId,
  opportunity_id: optId,
  occurred_at: optDateTime,
});

export const assessmentSchema = z.object({
  status: z.enum(E.ASSESSMENT_STATUSES.values),
  note: optText(2000),
});

export const convertProspectSchema = z.object({
  account_mode: z.enum(["create", "link"]),
  account_id: optId, // required when account_mode = link
  create_contact: z.boolean().default(true),
  contact_first_name: optText(100),
  contact_last_name: optText(100),
});

export const userCreateSchema = z.object({
  email: z.email().max(200),
  name: reqText(120),
  role: z.enum(E.ROLES.values),
  password: z.string().min(10, "At least 10 characters").max(200),
});
export const userUpdateSchema = z.object({
  name: reqText(120).optional(),
  role: z.enum(E.ROLES.values).optional(),
  status: z.enum(["active", "disabled"]).optional(),
  timezone: z.string().max(60).optional(),
  password: z.string().min(10, "At least 10 characters").max(200).optional(),
});
export const loginSchema = z.object({ email: z.email().max(200), password: z.string().min(1).max(200) });
export const setupSchema = userCreateSchema.omit({ role: true });

export const auditRunSchema = z.object({
  audit_type: z.string().max(40),
  target: optUrl,
});

export type AccountInput = z.input<typeof accountSchema>;

// ─── Outreach (Phase 3) ───
export const templateSchema = z.object({
  name: reqText(150),
  category: z.preprocess(blankToNull, z.enum(E.TEMPLATE_CATEGORIES.values).nullable().optional()),
  subject: reqText(300),
  body: z.string().trim().min(1, "Required").max(20000),
  intended_industry: optText(150),
  product_id: optId,
  tone: z.preprocess(blankToNull, z.enum(E.TONES.values).nullable().optional()),
  status: z.enum(E.ACTIVE_STATUSES.values).default("active"),
});

export const outreachSchema = z.object({
  title: reqText(200),
  channel: z.enum(E.OUTREACH_CHANNELS.values).default("manual_email"),
  contact_id: optId,
  account_id: optId,
  prospect_id: optId,
  campaign_id: optId,
  product_id: optId,
  template_id: optId,
  subject: optText(300),
  body: z.preprocess(blankToNull, z.string().max(20000).nullable().optional()),
  owner_id: optId,
  status: z.enum(E.EDITABLE_OUTREACH_STATUSES as [string, ...string[]]).default("draft"),
  planned_send_at: optDateTime,
  next_follow_up_at: optDateTime,
  outcome: optText(2000),
  notes: optText(5000),
});

export const renderSchema = z.object({
  subject: z.string().max(300).default(""),
  body: z.string().max(20000).default(""),
  template_id: optId,
  contact_id: optId,
  account_id: optId,
  prospect_id: optId,
  product_id: optId,
});

export const markSentSchema = z.object({
  confirm: z.literal(true, { message: "Confirm that the message was actually sent" }),
  sent_at: optDateTime,
  next_follow_up_at: optDateTime,
});

export const recordReplySchema = z.object({
  outcome: z.enum(["replied", "bounced"]),
  at: optDateTime,
  note: optText(2000),
});

export const sequenceStepSchema = z.object({
  day_offset: z.number().int().min(0).max(365),
  channel: z.enum(E.OUTREACH_CHANNELS.values),
  template_id: optId,
  task_type: z.enum(E.TASK_TYPES.values).default("send_email"),
  note: optText(500),
});

export const sequenceSchema = z.object({
  name: reqText(150),
  description: optText(1000),
  status: z.enum(E.ACTIVE_STATUSES.values).default("active"),
  steps: z.array(sequenceStepSchema).min(1, "Add at least one step").max(20).optional(),
});

export const enrollSchema = z.object({
  contact_id: z.string().min(1, "Choose a contact").max(64),
  start_date: z.iso.date("Use YYYY-MM-DD"),
  product_id: optId,
});


// ─── Operations & intelligence ───
export const packageSchema = z.object({
  product_id: z.string().min(1, "Choose a service").max(64),
  name: reqText(150),
  description: optText(1000),
  price_minor: optInt,
  currency: currency.default("INR"),
  billing_frequency: z.enum(E.PACKAGE_BILLING.values).default("one_time"),
  deliverables: optText(5000),
  timeline: optText(200),
  position: optInt,
  status: z.enum(E.ACTIVE_STATUSES.values).default("active"),
});

export const assetUpdateSchema = z.object({
  name: reqText(200),
  description: optText(2000),
  type: z.enum(E.ASSET_TYPES.values),
  external_url: optUrl,
  intended_industry: optText(150),
  visibility: z.enum(E.ASSET_VISIBILITY.values).default("internal"),
  owner_id: optId,
});

export const assetLinkSchema = z.object({
  entity_type: z.enum(["account", "contact", "campaign", "opportunity", "product", "audit_run", "outreach", "prospect"]),
  entity_id: z.string().min(1).max(64),
});

export const lineItemSchema = z.object({
  product_id: z.string().min(1).max(64),
  package_id: optId,
  quantity: z.number().int().min(1).max(10000).default(1),
  unit_price_minor: z.number().int().min(0),
  discount_pct: z.number().min(0).max(100).default(0),
  billing_frequency: z.preprocess(blankToNull, z.enum(E.PACKAGE_BILLING.values).nullable().optional()),
  notes: optText(500),
});

export const importPreviewSchema = z.object({
  file_name: optText(200),
  csv: z.string().min(1, "The file is empty").max(5_000_000, "File too large (5 MB max)"),
  mapping: z.record(z.string(), z.string()).optional(),
});
export const importCommitSchema = z.object({
  rows: z.array(z.number().int().min(0)).max(5000),
  include_duplicates: z.boolean().default(false),
  campaign_id: optId,
  owner_id: optId,
});

export const discoverySearchSchema = z.object({
  query: reqText(200),
  location: optText(200),
  campaign_id: optId,
  max_results: z.number().int().min(1).max(60).default(20),
});
export const discoveryImportSchema = z.object({
  result_ids: z.array(z.string().max(64)).min(1).max(60),
  campaign_id: optId,
  owner_id: optId,
  service_fit: optText(500),
});

export const enrichSchema = z.object({
  providers: z.array(z.enum(E.ENRICHMENT_PROVIDERS.values)).min(1).max(5),
});
export const saveEnrichmentSchema = z.object({
  first_name: reqText(100),
  last_name: optText(100),
  decision_role: z.preprocess(blankToNull, z.enum(E.DECISION_ROLES.values).nullable().optional()),
});

export const qualificationOverrideSchema = z.object({
  level: z.preprocess(blankToNull, z.enum(E.QUALIFICATION_LEVELS.values).nullable()),
  reason: optText(1000),
});

export const pitchSchema = z.object({
  formats: z.array(z.enum(E.PITCH_FORMATS.values)).min(1).max(9),
  contact_id: optId,
  product_ids: z.array(z.string().max(64)).max(20).default([]),
  audit_run_ids: z.array(z.string().max(64)).max(10).default([]),
  objective: optText(300),
  tone: z.enum(E.TONES.values).default("professional"),
  language: z.string().max(40).default("English"),
  use_ai: z.boolean().default(true),
});

export const proposalSchema = z.object({
  title: optText(150),
  contact_id: optId,
  opportunity_id: optId,
  audit_run_ids: z.array(z.string().max(64)).max(10).default([]),
  items: z
    .array(z.object({ product_id: z.string().max(64), package_id: optId, quantity: z.number().int().min(1).max(1000).default(1) }))
    .min(1, "Choose at least one service")
    .max(20),
  validity_days: z.number().int().min(1).max(180).default(30),
  intro_note: optText(2000),
});

export const deckOutlineSchema = z.object({
  template: z.enum(E.DECK_TEMPLATES.values),
  audience: optText(200),
  objective: optText(300),
  contact_id: optId,
  opportunity_id: optId,
  audit_run_ids: z.array(z.string().max(64)).max(10).default([]),
  product_ids: z.array(z.string().max(64)).max(20).default([]),
  use_ai: z.boolean().default(true),
});

export const deviceSchema = z.object({ name: reqText(80) });

export const competitorSchema = z.object({ name: reqText(150), website: optUrl, notes: optText(1000) });

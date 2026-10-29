// Allowed values for every status/type column. The SQL CHECK constraints in
// migrations/ mirror these lists; change both together via a new migration.

export type Option = { value: string; label: string };

function opts<const T extends readonly string[]>(values: T, labels: Record<T[number], string>) {
  return { values, options: values.map((v) => ({ value: v, label: labels[v as T[number]] })) as Option[] };
}

export const ROLES = opts(["admin", "manager", "rep"] as const, {
  admin: "Administrator",
  manager: "Founder / Sales Manager",
  rep: "Sales Representative",
});
export type Role = (typeof ROLES.values)[number];

export const ACCOUNT_TYPES = opts(["prospect", "customer", "partner", "former_customer", "other"] as const, {
  prospect: "Prospect",
  customer: "Customer",
  partner: "Partner",
  former_customer: "Former customer",
  other: "Other",
});

export const ACCOUNT_STATUSES = opts(
  ["new", "researching", "contacted", "engaged", "qualified", "active_customer", "inactive", "disqualified"] as const,
  {
    new: "New",
    researching: "Researching",
    contacted: "Contacted",
    engaged: "Engaged",
    qualified: "Qualified",
    active_customer: "Active customer",
    inactive: "Inactive",
    disqualified: "Disqualified",
  },
);

export const QUALIFICATION_LEVELS = opts(["high", "medium", "low", "needs_research"] as const, {
  high: "High priority",
  medium: "Medium priority",
  low: "Low priority",
  needs_research: "Needs more research",
});

export const CONTACT_STATUSES = opts(
  ["new", "not_contacted", "contacted", "responded", "engaged", "qualified", "unresponsive", "do_not_contact"] as const,
  {
    new: "New",
    not_contacted: "Not contacted",
    contacted: "Contacted",
    responded: "Responded",
    engaged: "Engaged",
    qualified: "Qualified",
    unresponsive: "Unresponsive",
    do_not_contact: "Do not contact",
  },
);

export const DECISION_ROLES = opts(["decision_maker", "influencer", "champion", "user", "gatekeeper", "unknown"] as const, {
  decision_maker: "Decision maker",
  influencer: "Influencer",
  champion: "Champion",
  user: "End user",
  gatekeeper: "Gatekeeper",
  unknown: "Unknown",
});

export const CHANNELS = opts(["email", "phone", "linkedin", "whatsapp", "other"] as const, {
  email: "Email",
  phone: "Phone",
  linkedin: "LinkedIn",
  whatsapp: "WhatsApp",
  other: "Other",
});

export const PROSPECT_STATUSES = opts(
  ["discovered", "researching", "to_qualify", "qualified", "converted", "disqualified"] as const,
  {
    discovered: "Discovered",
    researching: "Researching",
    to_qualify: "To qualify",
    qualified: "Qualified",
    converted: "Converted",
    disqualified: "Disqualified",
  },
);

export const CAMPAIGN_TYPES = opts(
  ["outbound_email", "prospecting", "paid_ads", "linkedin", "referral", "event", "partnership", "other"] as const,
  {
    outbound_email: "Outbound email",
    prospecting: "Prospecting",
    paid_ads: "Paid advertising",
    linkedin: "LinkedIn outreach",
    referral: "Referral",
    event: "Event / networking",
    partnership: "Partnership",
    other: "Other",
  },
);

export const CAMPAIGN_STATUSES = opts(["draft", "planned", "active", "paused", "completed", "archived"] as const, {
  draft: "Draft",
  planned: "Planned",
  active: "Active",
  paused: "Paused",
  completed: "Completed",
  archived: "Archived",
});

export const PRODUCT_CATEGORIES = opts(["marketing", "technology", "other"] as const, {
  marketing: "Marketing",
  technology: "Technology",
  other: "Other",
});

export const PRICING_MODELS = opts(["one_time", "recurring", "custom"] as const, {
  one_time: "One-time",
  recurring: "Recurring",
  custom: "Custom",
});

export const BILLING_FREQUENCIES = opts(["monthly", "quarterly", "yearly"] as const, {
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
});

export const ACTIVE_STATUSES = opts(["active", "inactive"] as const, { active: "Active", inactive: "Inactive" });

export const ASSESSMENT_STATUSES = opts(
  ["not_assessed", "needs_assessment", "relevant", "discussed", "proposed", "won", "lost", "not_applicable"] as const,
  {
    not_assessed: "Not assessed",
    needs_assessment: "Needs assessment",
    relevant: "Relevant",
    discussed: "Discussed",
    proposed: "Proposed",
    won: "Won",
    lost: "Lost",
    not_applicable: "Not applicable",
  },
);
/** Assessment statuses that mean the service has been put in front of the client. */
export const PITCHED_ASSESSMENTS = ["discussed", "proposed", "won", "lost"];

export const OPPORTUNITY_STAGES = opts(
  [
    "new",
    "discovery",
    "qualified",
    "meeting_scheduled",
    "meeting_completed",
    "proposal_prep",
    "proposal_sent",
    "negotiation",
    "closed_won",
    "closed_lost",
  ] as const,
  {
    new: "New opportunity",
    discovery: "Discovery",
    qualified: "Qualified",
    meeting_scheduled: "Meeting scheduled",
    meeting_completed: "Meeting completed",
    proposal_prep: "Proposal in preparation",
    proposal_sent: "Proposal sent",
    negotiation: "Negotiation",
    closed_won: "Closed won",
    closed_lost: "Closed lost",
  },
);
/** Default win probability (%) suggested when a deal enters a stage. */
export const STAGE_PROBABILITY: Record<string, number> = {
  new: 5,
  discovery: 10,
  qualified: 20,
  meeting_scheduled: 30,
  meeting_completed: 40,
  proposal_prep: 50,
  proposal_sent: 60,
  negotiation: 75,
  closed_won: 100,
  closed_lost: 0,
};
export const CLOSED_STAGES = ["closed_won", "closed_lost"];

export const TASK_TYPES = opts(
  ["follow_up_call", "send_email", "prepare_proposal", "meeting", "research", "internal_review", "general"] as const,
  {
    follow_up_call: "Follow-up call",
    send_email: "Send email",
    prepare_proposal: "Prepare proposal",
    meeting: "Meeting",
    research: "Research",
    internal_review: "Internal review",
    general: "General task",
  },
);

export const TASK_STATUSES = opts(["open", "in_progress", "completed", "cancelled"] as const, {
  open: "Open",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
});

export const PRIORITIES = opts(["low", "medium", "high", "urgent"] as const, {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
});

export const ACTIVITY_TYPES = opts(
  [
    "note",
    "call",
    "email",
    "meeting",
    "linkedin",
    "whatsapp",
    "stage_change",
    "status_change",
    "conversion",
    "audit",
    "task_completed",
    "system",
  ] as const,
  {
    note: "Note",
    call: "Call",
    email: "Email",
    meeting: "Meeting",
    linkedin: "LinkedIn",
    whatsapp: "WhatsApp",
    stage_change: "Stage change",
    status_change: "Status change",
    conversion: "Conversion",
    audit: "Audit",
    task_completed: "Task completed",
    system: "System",
  },
);
/** Activity types a user may log by hand. The rest are written by the system. */
export const LOGGABLE_ACTIVITY_TYPES = ["note", "call", "email", "meeting", "linkedin", "whatsapp"];
/** Activities that count as outreach in timelines and reports. */
export const OUTREACH_ACTIVITY_TYPES = ["call", "email", "linkedin", "whatsapp"];

export const LEAD_SOURCES = opts(
  ["manual", "csv_import", "referral", "website", "linkedin", "event", "paid_ads", "google_places", "partner", "data_provider", "other"] as const,
  {
    manual: "Manual research",
    csv_import: "CSV import",
    referral: "Referral",
    website: "Website enquiry",
    linkedin: "LinkedIn",
    event: "Event",
    paid_ads: "Paid ads",
    google_places: "Google Places",
    partner: "Partner",
    data_provider: "Data provider",
    other: "Other",
  },
);

export const COMPANY_SIZES = opts(["1-10", "11-50", "51-200", "201-500", "501-1000", "1000+"] as const, {
  "1-10": "1–10",
  "11-50": "11–50",
  "51-200": "51–200",
  "201-500": "201–500",
  "501-1000": "501–1,000",
  "1000+": "1,000+",
});

export const AUDIT_STATUSES = opts(["queued", "running", "completed", "completed_warnings", "failed", "cancelled"] as const, {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  completed_warnings: "Completed with warnings",
  failed: "Failed",
  cancelled: "Cancelled",
});

export const FINDING_SEVERITIES = opts(["critical", "high", "medium", "low", "positive"] as const, {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  positive: "Positive",
});

export function labelOf(list: { options: Option[] }, value: string | null | undefined): string {
  if (!value) return "—";
  return list.options.find((o) => o.value === value)?.label ?? value;
}

// ─── Outreach (Phase 3) ───
export const OUTREACH_CHANNELS = opts(["manual_email", "brevo", "phone", "linkedin", "whatsapp", "other"] as const, {
  manual_email: "Email (manual)",
  brevo: "Email via Brevo",
  phone: "Phone call",
  linkedin: "LinkedIn",
  whatsapp: "WhatsApp (manual)",
  other: "Other",
});
/** Activity type recorded when an outreach on this channel is confirmed as done. */
export const CHANNEL_ACTIVITY: Record<string, string> = {
  manual_email: "email",
  brevo: "email",
  phone: "call",
  linkedin: "linkedin",
  whatsapp: "whatsapp",
  other: "note",
};

export const OUTREACH_STATUSES = opts(
  ["draft", "ready_for_review", "approved", "sent", "delivered", "replied", "bounced", "failed", "cancelled"] as const,
  {
    draft: "Draft",
    ready_for_review: "Ready for review",
    approved: "Approved",
    sent: "Sent",
    delivered: "Delivered",
    replied: "Replied",
    bounced: "Bounced",
    failed: "Failed",
    cancelled: "Cancelled",
  },
);
/** Statuses a user may set by editing; the rest come from explicit actions or a provider. */
export const EDITABLE_OUTREACH_STATUSES = ["draft", "ready_for_review", "approved", "cancelled"];
export const UNSENT_OUTREACH_STATUSES = ["draft", "ready_for_review", "approved"];

export const TEMPLATE_CATEGORIES = opts(["introduction", "follow_up", "case_study", "proposal", "meeting", "other"] as const, {
  introduction: "Introduction",
  follow_up: "Follow-up",
  case_study: "Case study",
  proposal: "Proposal",
  meeting: "Meeting",
  other: "Other",
});

export const TONES = opts(["professional", "friendly", "formal", "concise"] as const, {
  professional: "Professional",
  friendly: "Friendly",
  formal: "Formal",
  concise: "Concise",
});

export const ENROLLMENT_STATUSES = opts(["active", "stopped", "completed"] as const, {
  active: "Active",
  stopped: "Stopped",
  completed: "Completed",
});


// ─── Operations & intelligence (Phase 4 / C / D / E / 5) ───
export const PACKAGE_BILLING = opts(["one_time", "monthly", "quarterly", "yearly"] as const, {
  one_time: "One-time",
  monthly: "Per month",
  quarterly: "Per quarter",
  yearly: "Per year",
});

export const ASSET_TYPES = opts(
  ["company_profile", "brochure", "proposal", "case_study", "presentation", "pricing_sheet", "contract", "demo_link", "audit_report", "pitch_deck", "template", "other"] as const,
  {
    company_profile: "Company profile",
    brochure: "Service brochure",
    proposal: "Proposal",
    case_study: "Case study",
    presentation: "Presentation",
    pricing_sheet: "Pricing sheet",
    contract: "Contract",
    demo_link: "Demo link",
    audit_report: "Audit report",
    pitch_deck: "Pitch deck",
    template: "Template",
    other: "Other",
  },
);
export const ASSET_VISIBILITY = opts(["internal", "confidential"] as const, {
  internal: "Internal (all users)",
  confidential: "Confidential (owner & managers)",
});
/** Upload limits enforced by the Worker. */
export const ASSET_MAX_BYTES = 25 * 1024 * 1024;
export const ASSET_MIME_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/csv": "csv",
  "text/plain": "txt",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/mp4": "mp4",
};
export const CALL_AUDIO_MIME_TYPES = ["audio/mpeg", "audio/mp4", "audio/m4a", "audio/x-m4a", "audio/aac", "audio/amr", "audio/3gpp", "audio/ogg", "audio/opus", "audio/wav", "audio/x-wav", "audio/webm", "application/octet-stream"];
export const CALL_MAX_BYTES = 50 * 1024 * 1024;

export const CALL_DIRECTIONS = opts(["incoming", "outgoing", "missed", "unknown"] as const, {
  incoming: "Incoming",
  outgoing: "Outgoing",
  missed: "Missed",
  unknown: "Unknown",
});
export const CALL_STATUSES = opts(["uploaded", "transcribing", "transcribed", "summarized", "failed", "no_audio"] as const, {
  uploaded: "Uploaded",
  transcribing: "Transcribing",
  transcribed: "Transcribed",
  summarized: "Summarised",
  failed: "Failed",
  no_audio: "No recording",
});

export const ENRICHMENT_PROVIDERS = opts(["website", "hunter", "apollo", "rocketreach", "lusha"] as const, {
  website: "Company website (public)",
  hunter: "Hunter.io",
  apollo: "Apollo.io",
  rocketreach: "RocketReach",
  lusha: "Lusha",
});

export const DECK_TEMPLATES = opts(
  ["company_intro", "website_seo_audit", "aeo_audit", "social_audit", "digital_marketing_proposal", "technology_proposal", "crm_erp_proposal", "ai_automation_proposal", "competitor_analysis", "custom"] as const,
  {
    company_intro: "Company introduction",
    website_seo_audit: "Website & SEO audit",
    aeo_audit: "AEO audit",
    social_audit: "Social media audit",
    digital_marketing_proposal: "Digital marketing proposal",
    technology_proposal: "Technology & software proposal",
    crm_erp_proposal: "CRM / ERP solution proposal",
    ai_automation_proposal: "AI & automation proposal",
    competitor_analysis: "Competitor analysis",
    custom: "Custom sales presentation",
  },
);

export const PITCH_FORMATS = opts(
  ["intro_30s", "cold_call_script", "discovery_agenda", "sales_email", "whatsapp", "linkedin", "meeting_pitch", "executive_summary", "objection_handling"] as const,
  {
    intro_30s: "30-second introduction",
    cold_call_script: "Cold-call script",
    discovery_agenda: "Discovery-call agenda",
    sales_email: "Personalised sales email",
    whatsapp: "WhatsApp message",
    linkedin: "LinkedIn message",
    meeting_pitch: "Meeting pitch",
    executive_summary: "Executive summary",
    objection_handling: "Objection-handling guide",
  },
);

// Settings an admin can manage from Settings → Configuration. A value saved in the CRM overrides the
// Worker var/secret of the same name, so `wrangler secret put` still works but is never required.

export type ConfigKind = "secret" | "text" | "email" | "number" | "repo";

export interface ConfigField {
  key: string;
  label: string;
  kind: ConfigKind;
  help: string;
  link?: string;
  placeholder?: string;
  /** Integration checked by "Test connections" once this key is set. */
  provider?: string;
}

export interface ConfigSection {
  id: string;
  title: string;
  description: string;
  fields: ConfigField[];
}

export const CONFIG_SECTIONS: ConfigSection[] = [
  {
    id: "gst_lookup",
    title: "GST lookup",
    description: "Type a customer's GSTIN and their registered name and address fill in. The state and PAN always fill in without this.",
    fields: [
      { key: "GSTIN_API_URL", label: "GST data provider address", kind: "text", placeholder: "https://appyflow.in/api/verifyGST?gstNo={gstin}&key_secret={key}", help: "From a GST data provider you sign up with (for example AppyFlow). Keep {gstin} and {key} exactly as written." },
      { key: "GSTIN_API_KEY", label: "GST data provider key", kind: "secret", placeholder: "key", help: "The key the provider gives you." },
    ],
  },
  {
    id: "billing_mail",
    title: "Billing emails and CRM link",
    description: "Emails to clients when an invoice is generated or paid, and the push of invoices to crm.gexart.com.",
    fields: [
      { key: "BILLING_EMAIL_PROVIDER", label: "Email provider", kind: "text", placeholder: "gmail", help: "gmail (a connected mailbox such as tech.gexart@gmail.com), brevo, resend, or off. Leave empty to try gmail, then brevo, then resend." },
      { key: "BILLING_EMAIL_AUTO", label: "Email clients automatically", kind: "text", placeholder: "on", help: "on = email the client when an invoice is generated and when a payment is recorded. off = only when you press Email client." },
      { key: "RESEND_API_KEY", label: "Resend API key", kind: "secret", placeholder: "re_…", help: "Only if you use Resend. resend.com → API keys.", link: "https://resend.com/api-keys" },
      { key: "RESEND_SENDER_EMAIL", label: "Resend sender email", kind: "email", placeholder: "billing@yourdomain.com", help: "An address on a domain you verified in Resend." },
      { key: "RESEND_SENDER_NAME", label: "Resend sender name", kind: "text", placeholder: "Gexart", help: "Shown as the From name." },
      { key: "AGENCY_CRM_HOOK_URL", label: "CRM invoice webhook address", kind: "secret", placeholder: "https://crm.gexart.com/api/hook/invoice/…", help: "From crm.gexart.com → Settings → Invoice sync. The client must already exist there (matched by email, name or phone)." },
      { key: "AGENCY_CRM_PUSH", label: "Push invoices to the CRM automatically", kind: "text", placeholder: "on", help: "on = send every new invoice, payment and cancellation. off = only when you press Send to CRM." },
    ],
  },
  {
    id: "ai",
    title: "Claude AI",
    description: "Pitches, deck outlines and call summaries. Without a key the CRM uses fixed templates.",
    fields: [{ key: "ANTHROPIC_API_KEY", provider: "anthropic", label: "Anthropic API key", kind: "secret", placeholder: "sk-ant-…", help: "Console → API keys → Create key.", link: "https://console.anthropic.com/settings/keys" }],
  },
  {
    id: "email",
    title: "Brevo email",
    description: "Send approved outreach and receive delivery, bounce and unsubscribe events.",
    fields: [
      { key: "BREVO_API_KEY", provider: "brevo", label: "Brevo API key", kind: "secret", placeholder: "xkeysib-…", help: "Brevo → SMTP & API → API keys.", link: "https://app.brevo.com/settings/keys/api" },
      { key: "BREVO_SENDER_EMAIL", label: "Sender email", kind: "email", placeholder: "sales@yourdomain.com", help: "Must be a verified sender in Brevo." },
      { key: "BREVO_SENDER_NAME", label: "Sender name", kind: "text", placeholder: "Gexart", help: "Shown as the From name." },
      { key: "BREVO_WEBHOOK_SECRET", label: "Webhook secret", kind: "secret", help: "Any long random string. Generate one, save, then paste the webhook URL into Brevo → Transactional → Webhooks." },
    ],
  },
  {
    id: "emailjs",
    title: "EmailJS (welcome and password-reset emails)",
    description:
      "Sends the welcome email when a user is created and the forgot-password link. Used first when all four values are set; otherwise Brevo is used. In EmailJS: add an email service, create a template whose To address is {{to_email}}, Subject is {{subject}} and body is {{{message_html}}}, and turn on Account → Security → \"Allow EmailJS API for non-browser applications\".",
    fields: [
      { key: "EMAILJS_SERVICE_ID", label: "Service ID", kind: "text", placeholder: "service_xxxxxxx", help: "EmailJS → Email Services.", link: "https://dashboard.emailjs.com/admin" },
      { key: "EMAILJS_TEMPLATE_ID", label: "Template ID", kind: "text", placeholder: "template_xxxxxxx", help: "EmailJS → Email Templates. Variables sent: to_email, to_name, subject, message_html, message.", link: "https://dashboard.emailjs.com/admin/templates" },
      { key: "EMAILJS_PUBLIC_KEY", label: "Public key", kind: "text", help: "EmailJS → Account → General → Public Key.", link: "https://dashboard.emailjs.com/admin/account" },
      { key: "EMAILJS_PRIVATE_KEY", label: "Private key (secret)", kind: "secret", help: "EmailJS → Account → General → Private Key. Stored encrypted and never shown in full.", link: "https://dashboard.emailjs.com/admin/account" },
    ],
  },
  {
    id: "coldemail",
    title: "Cold email mailbox (Google Workspace)",
    description: "Lets the autopilot send from, and read replies in, a Google Workspace mailbox. Use a separate domain for cold email so your main domain's reputation stays safe.",
    fields: [
      { key: "GOOGLE_OAUTH_CLIENT_ID", label: "Google OAuth client ID", kind: "text", placeholder: "…apps.googleusercontent.com", help: "Google Cloud → APIs & Services → Credentials → OAuth client (Web application). Enable the Gmail API. Set the consent screen to Internal.", link: "https://console.cloud.google.com/apis/credentials" },
      { key: "GOOGLE_OAUTH_CLIENT_SECRET", label: "Google OAuth client secret", kind: "secret", placeholder: "GOCSPX-…", help: "From the same OAuth client." },
      { key: "COMPANY_POSTAL_ADDRESS", label: "Business postal address", kind: "text", placeholder: "Gexart, 12 Park Street, Kolkata 700016, India", help: "Added under every cold email with the opt-out line. Required before the autopilot sends." },
    ],
  },
  {
    id: "leads",
    title: "Lead discovery & contact finder",
    description: "Find businesses and decision-makers. The company-website finder is free and always on.",
    fields: [
      { key: "GOOGLE_PLACES_API_KEY", provider: "google_places", label: "Google Places API key", kind: "secret", placeholder: "AIza…", help: "Google Cloud → enable Places API (New) → Credentials → API key. Billing must be on.", link: "https://console.cloud.google.com/apis/library/places.googleapis.com" },
      { key: "HUNTER_API_KEY", provider: "hunter", label: "Hunter.io API key", kind: "secret", help: "Hunter → API.", link: "https://hunter.io/api-keys" },
      { key: "APOLLO_API_KEY", provider: "apollo", label: "Apollo.io API key", kind: "secret", help: "Apollo → Settings → Integrations → API.", link: "https://app.apollo.io/#/settings/integrations/api" },
      { key: "ROCKETREACH_API_KEY", provider: "rocketreach", label: "RocketReach API key", kind: "secret", help: "RocketReach → Account → API.", link: "https://rocketreach.co/account?section=nav_gen_api" },
      { key: "LUSHA_API_KEY", provider: "lusha", label: "Lusha API key", kind: "secret", help: "Lusha → API.", link: "https://dashboard.lusha.com/enrich/api" },
    ],
  },
  {
    id: "audits",
    title: "Audits",
    description: "Public YouTube channel statistics for the social audit.",
    fields: [{ key: "YOUTUBE_API_KEY", provider: "youtube", label: "YouTube Data API key", kind: "secret", placeholder: "AIza…", help: "Google Cloud → enable YouTube Data API v3 → API key.", link: "https://console.cloud.google.com/apis/library/youtube.googleapis.com" }],
  },
  {
    id: "limits",
    title: "Daily limits",
    description: "Maximum calls per day to each paid provider, to protect your credits. 0 turns a provider off.",
    fields: [
      { key: "QUOTA_GOOGLE_PLACES", label: "Google Places", kind: "number", help: "Searches per day." },
      { key: "QUOTA_ENRICHMENT", label: "Contact finders", kind: "number", help: "Per provider, per day." },
      { key: "QUOTA_CLAUDE", label: "Claude", kind: "number", help: "Generations per day." },
      { key: "QUOTA_YOUTUBE", label: "YouTube", kind: "number", help: "Lookups per day." },
    ],
  },
  {
    id: "phone",
    title: "Phone app builds",
    description: "Where the CRM picks up new Android app builds. New GitHub releases are imported automatically within minutes.",
    fields: [
      { key: "GITHUB_REPO", label: "GitHub repository", kind: "repo", placeholder: "owner/name", help: "The repository whose Actions publish android-v* releases." },
      { key: "GITHUB_TOKEN", label: "GitHub token", kind: "secret", placeholder: "github_pat_…", help: "Only needed if the repository is private (fine-grained token, Contents: read)." },
    ],
  },
  {
    id: "workspace",
    title: "Workspace",
    description: "General settings.",
    fields: [
      { key: "APP_NAME", label: "Workspace name", kind: "text", placeholder: "Sales Gexart", help: "Shown to the phone app after pairing and in system emails." },
      { key: "APP_URL", label: "CRM web address", kind: "text", placeholder: "https://crm.yourdomain.com", help: "Used in welcome and password-reset emails. Leave blank to use the address you are signed in on." },
    ],
  },
];

export const CONFIG_FIELDS: ConfigField[] = CONFIG_SECTIONS.flatMap((s) => s.fields);
export const CONFIG_KEYS = new Set(CONFIG_FIELDS.map((f) => f.key));

/** Returns an error message, or null when the value is acceptable for the field. */
export function checkConfigValue(f: ConfigField, v: string): string | null {
  if (v.length > 2000) return "Too long";
  if (/[\r\n]/.test(v)) return "Must be a single line";
  if (f.kind === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return "Enter a valid email address";
  if (f.kind === "number" && !/^\d{1,7}$/.test(v)) return "Enter a whole number";
  if (f.kind === "repo" && !/^[\w.-]+\/[\w.-]+$/.test(v)) return "Use the form owner/name";
  return null;
}

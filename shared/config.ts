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
    fields: [{ key: "APP_NAME", label: "Workspace name", kind: "text", placeholder: "Gexart CRM", help: "Shown to the phone app after pairing." }],
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

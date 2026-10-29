// Audit type registry. Add a new audit by registering it here and handling it in run.ts.
import { aeoRubric, seoRubric, websiteRubric, type Rubric } from "./rubrics";
import { techRubric } from "./extra";
import type { Env } from "../env";

export interface AuditType {
  key: string;
  label: string;
  description: string;
  /** What the run needs: the account website, competitors, or just the account name/city. */
  needs: "website" | "website_or_profiles" | "name" | "competitors";
  implemented: boolean;
  version: string;
  rubric?: Rubric;
  requiresKey?: keyof Env;
  requiresLabel?: string;
}

export const AUDIT_TYPES: AuditType[] = [
  { key: "website", label: "Website audit", description: "Availability, HTTPS, mobile basics, lead capture, accessibility and performance indicators from public pages.", needs: "website", implemented: true, version: websiteRubric.version, rubric: websiteRubric },
  { key: "seo", label: "SEO audit", description: "Titles, descriptions, indexability, canonical, sitemap/robots, headings, internal links and structured data.", needs: "website", implemented: true, version: seoRubric.version, rubric: seoRubric },
  { key: "aeo", label: "AEO audit", description: "How clearly the site answers questions and signals credibility for answer engines. Does not measure actual AI visibility.", needs: "website", implemented: true, version: aeoRubric.version, rubric: aeoRubric },
  { key: "tech", label: "Technology & AI automation audit", description: "Detects analytics, ad tags, chat/WhatsApp, booking, CRM capture and payments, and maps gaps to automation opportunities.", needs: "website", implemented: true, version: techRubric.version, rubric: techRubric },
  { key: "social", label: "Social media audit", description: "Profile presence, website linking and brand consistency; YouTube activity via the official API. Other platforms' metrics need the business's own connection.", needs: "website_or_profiles", implemented: true, version: "social-1.0" },
  { key: "gbp", label: "Google Business Profile audit", description: "Profile completeness, status, rating, review volume and photos from the Google Places API.", needs: "name", implemented: true, version: "gbp-1.0", requiresKey: "GOOGLE_PLACES_API_KEY", requiresLabel: "Google Places API key" },
  { key: "competitor", label: "Competitor analysis", description: "Side-by-side website, SEO, AEO and technology comparison against up to three competitors added to the account.", needs: "competitors", implemented: true, version: "competitor-1.0" },
];

export const auditType = (key: string) => AUDIT_TYPES.find((t) => t.key === key);

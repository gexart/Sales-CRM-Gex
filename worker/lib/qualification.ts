// Transparent prospect qualification. Every point comes from a stored fact; nothing is
// inferred about budget or intent. The score ranks research priority, not conversion odds.
import { DECISION_TITLES } from "./providers";

export interface QualificationFactor {
  key: string;
  label: string;
  points: number;
  max: number;
  observed: boolean;
  detail: string;
}

export interface QualificationResult {
  score: number;
  level: "high" | "medium" | "low" | "needs_research";
  factors: QualificationFactor[];
}

export interface QualificationInput {
  industry?: string | null;
  geography?: string | null;
  website?: string | null;
  service_fit?: string | null;
  email?: string | null;
  phone?: string | null;
  contact_name?: string | null;
  contact_title?: string | null;
  qualification_evidence?: string | null;
  campaign?: { target_industry?: string | null; target_geography?: string | null } | null;
  touches?: number;
  replied?: boolean;
}

const contains = (a?: string | null, b?: string | null) => {
  if (!a || !b) return false;
  const x = a.toLowerCase();
  return b
    .toLowerCase()
    .split(/[,/;|]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .some((t) => x.includes(t) || t.includes(x));
};

export function computeQualification(p: QualificationInput): QualificationResult {
  const f: QualificationFactor[] = [];
  const add = (key: string, label: string, max: number, observed: boolean, detail: string) => f.push({ key, label, max, observed, points: observed ? max : 0, detail });

  const ind = p.campaign?.target_industry;
  add("industry_match", "Industry matches campaign target", 15, contains(p.industry, ind), ind ? `Target: ${ind}; prospect: ${p.industry ?? "unknown"}` : "No campaign industry target");
  const geo = p.campaign?.target_geography;
  add("geography_match", "Location matches campaign target", 10, contains(p.geography, geo), geo ? `Target: ${geo}; prospect: ${p.geography ?? "unknown"}` : "No campaign location target");
  add("website", "Has a website to audit", 10, !!p.website, p.website ? "Website on record" : "No website");
  add("service_fit", "Service fit recorded", 10, !!p.service_fit?.trim(), p.service_fit ? p.service_fit : "Not recorded");
  add("reachable", "Verified email or phone", 15, !!(p.email || p.phone), [p.email && "email", p.phone && "phone"].filter(Boolean).join(" + ") || "No contact channel");
  add("named_contact", "Named contact with title", 10, !!(p.contact_name && p.contact_title), p.contact_name ? `${p.contact_name}${p.contact_title ? `, ${p.contact_title}` : ""}` : "No named contact");
  const dm = !!p.contact_title && DECISION_TITLES.some((t) => new RegExp(`\\b${t}\\b`, "i").test(p.contact_title!));
  add("decision_maker", "Decision-maker identified", 10, dm, dm ? `Title "${p.contact_title}"` : "No decision-maker title");
  add("engagement", "Logged engagement", 10, (p.touches ?? 0) > 0, `${p.touches ?? 0} logged call/email/meeting touch(es)`);
  add("replied", "Has replied", 5, !!p.replied, p.replied ? "A reply was recorded" : "No reply recorded");
  add("evidence", "Qualification evidence written", 5, !!p.qualification_evidence?.trim(), p.qualification_evidence ? "Evidence recorded" : "No evidence notes");

  const score = f.reduce((s, x) => s + x.points, 0);
  const thin = !p.website && !p.email && !p.phone;
  const level = thin || score < 25 ? "needs_research" : score >= 70 ? "high" : score >= 45 ? "medium" : "low";
  return { score, level, factors: f };
}

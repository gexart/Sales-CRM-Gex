// One data model for the audit report, rendered to PDF (audit-pdf.ts) and Word (audit-docx.ts).
// The PPTX version is built in the browser from the same API response (src/lib/audit-deck.ts).
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];
export const SEV_LABEL: Record<Severity, string> = { critical: "Critical", high: "High priority", medium: "Medium priority", low: "Low priority" };
export const EFFORT_LABEL: Record<string, string> = { low: "Low effort", medium: "Medium effort", high: "High effort" };
const SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const EFFORT_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };

export interface ReportFinding {
  title: string;
  detail: string;
  recommendation: string | null;
  effort: string | null;
  severity: string;
  result: "pass" | "fail" | "warn" | "unavailable";
  category: string;
  evidence: { path: string; observation: string }[];
  services: string[];
}

export interface AuditReportData {
  typeLabel: string;
  accountName: string;
  target: string;
  host: string;
  auditVersion: string;
  auditedOn: string; // display date
  startedBy: string;
  preparedBy: string;
  score: number | null;
  categories: { label: string; weight: number; score: number | null; passed: number; failed: number; unavailable: number }[];
  findings: ReportFinding[];
  scope: { pages: string[]; linksChecked: number; linksDiscovered: number; note: string | null };
  warnings: string[];
  compare: { previousOn: string; scoreChange: number | null; sameRubric: boolean; resolved: string[]; newIssues: string[] } | null;
}

export const gradeOf = (s: number | null) => (s === null ? "Not scored" : s >= 85 ? "Excellent" : s >= 70 ? "Good" : s >= 50 ? "Needs improvement" : "Needs urgent attention");

export const isIssue = (f: ReportFinding) => f.result === "fail" || f.result === "warn";
export const issuesOf = (d: AuditReportData) => d.findings.filter(isIssue);
export const passedOf = (d: AuditReportData) => d.findings.filter((f) => f.result === "pass");
export const unavailableOf = (d: AuditReportData) => d.findings.filter((f) => f.result === "unavailable");

/** Most severe first; within a severity, cheapest to fix first. */
export const prioritised = (d: AuditReportData) =>
  [...issuesOf(d)].sort((a, b) => (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9) || (EFFORT_RANK[a.effort ?? "medium"] ?? 1) - (EFFORT_RANK[b.effort ?? "medium"] ?? 1));
export const quickWins = (d: AuditReportData) => prioritised(d).filter((f) => f.effort === "low" && f.severity !== "low").slice(0, 6);

export function countBySeverity(d: AuditReportData): Record<Severity, number> {
  const out: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of issuesOf(d)) if (f.severity in out) out[f.severity as Severity]++;
  return out;
}

/** Gexart services that the failing findings map to, with the findings each one addresses. */
export function serviceRollup(d: AuditReportData): { name: string; findings: string[] }[] {
  const m = new Map<string, string[]>();
  for (const f of prioritised(d)) for (const s of f.services) m.set(s, [...(m.get(s) ?? []), f.title]);
  return [...m.entries()].map(([name, findings]) => ({ name, findings })).sort((a, b) => b.findings.length - a.findings.length);
}

export function summaryParagraph(d: AuditReportData): string {
  const issues = issuesOf(d);
  const sev = countBySeverity(d);
  const scored = d.categories.filter((c) => c.score !== null);
  const best = [...scored].sort((a, b) => b.score! - a.score!)[0];
  const worst = [...scored].sort((a, b) => a.score! - b.score!)[0];
  const parts = [
    d.score === null
      ? `${d.typeLabel} for ${d.accountName} (${d.host}) could not be scored because too few checks were available.`
      : `${d.typeLabel} for ${d.accountName} (${d.host}) scored ${d.score}/100, rated "${gradeOf(d.score)}".`,
    `${d.findings.length - unavailableOf(d).length} checks were run: ${passedOf(d).length} passed and ${issues.length} need attention${sev.critical + sev.high ? `, including ${sev.critical} critical and ${sev.high} high-priority` : ""}.`,
  ];
  if (quickWins(d).length) parts.push(`${quickWins(d).length} of the issues are quick wins: meaningful impact for low effort.`);
  if (best && worst && best !== worst) parts.push(`${best.label} is the strongest area (${best.score}/100); ${worst.label} has the most room to improve (${worst.score}/100).`);
  return parts.join(" ");
}

const pathOf = (u: string | null | undefined) => {
  if (!u) return "";
  try {
    const x = new URL(u);
    return (x.pathname || "/") + x.search;
  } catch {
    return String(u);
  }
};

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

const displayDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }) : "";

/** Builds the report model from `loadRunDetail()` output and (optionally) the compare result. */
export function buildAuditReportData(run: Row, compare: Row | null, preparedBy: string): AuditReportData {
  const catLabel = new Map<string, string>((run.categories ?? []).map((c: Row) => [String(c.category), String(c.label)]));
  const scope = run.scope ?? null;
  return {
    typeLabel: String(run.type_label ?? "Audit"),
    accountName: String(run.account_name ?? ""),
    target: String(run.target ?? ""),
    host: hostOf(String(run.target ?? "")),
    auditVersion: String(run.audit_version ?? ""),
    auditedOn: displayDate(run.completed_at ?? run.created_at),
    startedBy: String(run.initiated_by_name ?? ""),
    preparedBy,
    score: run.overall_score === null || run.overall_score === undefined ? null : Number(run.overall_score),
    categories: (run.categories ?? []).map((c: Row) => ({
      label: String(c.label),
      weight: Number(c.weight),
      score: c.score === null ? null : Number(c.score),
      passed: Number(c.checks_passed),
      failed: Number(c.checks_failed),
      unavailable: Number(c.checks_unavailable),
    })),
    findings: (run.findings ?? []).map((f: Row) => ({
      title: String(f.title),
      detail: String(f.detail ?? ""),
      recommendation: f.recommendation ? String(f.recommendation) : null,
      effort: f.effort ?? null,
      severity: String(f.severity),
      result: f.result,
      category: catLabel.get(String(f.category)) ?? String(f.category),
      evidence: (f.evidence ?? []).slice(0, 4).map((e: Row) => ({ path: pathOf(e.url), observation: String(e.observation ?? "") })),
      services: (f.related_products ?? []).map((p: Row) => String(p.name)),
    })),
    scope: {
      pages: (scope?.pages ?? []).map((p: Row) => pathOf(p.url)),
      linksChecked: Number(scope?.links_checked ?? 0),
      linksDiscovered: Number(scope?.links_discovered ?? 0),
      note: scope?.note ? String(scope.note) : null,
    },
    warnings: (run.warnings ?? []).map(String),
    compare: compare
      ? {
          previousOn: displayDate(compare.previous?.created_at),
          scoreChange: compare.score_change ?? null,
          sameRubric: Boolean(compare.same_rubric),
          resolved: compare.resolved ?? [],
          newIssues: compare.new_issues ?? [],
        }
      : null,
  };
}

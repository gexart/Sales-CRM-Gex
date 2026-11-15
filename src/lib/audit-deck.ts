// Turns an audit report into slides for the fixed Gexart deck format (see deck.ts).
import {
  SEV_LABEL,
  countBySeverity,
  gradeOf,
  issuesOf,
  passedOf,
  prioritised,
  quickWins,
  serviceRollup,
  summaryParagraph,
  unavailableOf,
  type AuditReportData,
} from "../../shared/audit-report";
import type { Slide } from "./deck";

const blank = (s: Partial<Slide>): Slide => ({ layout: "bullets", title: "", subtitle: "", bullets: [], left_heading: "", left_bullets: [], right_heading: "", right_bullets: [], table_headers: [], table_rows: [], metrics: [], notes: "", ...s });
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function auditDeckSlides(d: AuditReportData): Slide[] {
  const eyebrow = d.typeLabel;
  const issues = issuesOf(d);
  const sev = countBySeverity(d);
  const order = prioritised(d);
  const wins = quickWins(d);
  const slides: Slide[] = [];

  slides.push(
    blank({
      layout: "title",
      eyebrow,
      title: d.accountName,
      subtitle: `${d.typeLabel} report  ·  ${d.host}  ·  ${d.auditedOn}`,
      bullets: [d.score === null ? "Not scored" : `Score ${d.score}/100`, gradeOf(d.score), `${issues.length} issues found`],
      notes: `Prepared by ${d.preparedBy}. Evidence was observed on ${d.auditedOn}.`,
    }),
  );

  slides.push(blank({ eyebrow, title: "Executive summary", bullets: summaryParagraph(d).split(/(?<=[.!?])\s+(?=[A-Z0-9])/).filter(Boolean).slice(0, 6) }));

  slides.push(
    blank({
      layout: "metrics",
      eyebrow,
      title: "Digital health scorecard",
      subtitle: "Weighted share of passed checks in each category",
      metrics: [{ label: "Overall score", value: d.score === null ? "N/A" : `${d.score}/100` }, ...d.categories.slice(0, 7).map((c) => ({ label: `${c.label} (${c.weight}%)`, value: c.score === null ? "N/A" : `${c.score}/100` }))],
      bullets: [`${sev.critical} critical`, `${sev.high} high`, `${sev.medium} medium`, `${sev.low} low priority`],
      notes: "Scores reflect the documented rubric for the pages inspected. They do not measure rankings, traffic or revenue.",
    }),
  );

  if (order.length) {
    slides.push(
      blank({
        layout: "table",
        eyebrow,
        title: "Priority actions",
        subtitle: "Most severe first, then cheapest to fix",
        table_headers: ["Priority", "Finding", "Recommended action"],
        table_rows: order.slice(0, 8).map((f) => [f.severity, clip(f.title, 70), clip(f.recommendation ?? f.detail, 120)]),
      }),
    );
    const withFix = order.filter((f) => f.recommendation).slice(0, 5);
    if (withFix.length)
      slides.push(
        blank({
          layout: "two_column",
          eyebrow,
          title: "What we found → how to fix it",
          left_heading: "What we found",
          left_bullets: withFix.map((f) => clip(f.title, 80)),
          right_heading: "Recommended fix",
          right_bullets: withFix.map((f) => clip(f.recommendation!, 110)),
        }),
      );
  }

  if (wins.length) slides.push(blank({ eyebrow, title: "Quick wins", subtitle: "High impact for low effort", bullets: wins.map((f) => clip(f.title, 110)) }));

  if (d.compare) {
    const c = d.compare;
    slides.push(
      blank({
        layout: "metrics",
        eyebrow,
        title: "Progress since the previous audit",
        subtitle: `Compared with ${c.previousOn}`,
        metrics: [
          { label: "Score change", value: c.scoreChange === null ? "N/A" : `${c.scoreChange > 0 ? "+" : ""}${c.scoreChange} pts` },
          { label: "Issues resolved", value: String(c.resolved.length) },
          { label: "New issues", value: String(c.newIssues.length) },
        ],
        bullets: [...c.resolved.slice(0, 2).map((x) => `Resolved: ${x}`), ...c.newIssues.slice(0, 2).map((x) => `New: ${x}`)],
      }),
    );
  }

  const services = serviceRollup(d);
  if (services.length)
    slides.push(
      blank({
        layout: "table",
        eyebrow,
        title: "How Gexart can help",
        table_headers: ["Gexart service", "Findings addressed", "Examples"],
        table_rows: services.slice(0, 8).map((s) => [s.name, String(s.findings.length), clip(s.findings.slice(0, 2).join("; "), 110)]),
      }),
    );

  const good = passedOf(d);
  if (good.length) slides.push(blank({ eyebrow, title: "What is working well", subtitle: `${good.length} checks passed`, bullets: good.slice(0, 8).map((f) => clip(f.title, 110)) }));

  const unavailable = unavailableOf(d);
  slides.push(
    blank({
      eyebrow,
      title: "Scope and method",
      bullets: [
        `${d.scope.pages.length} page(s) inspected${d.scope.linksDiscovered ? `; ${d.scope.linksChecked} of ${d.scope.linksDiscovered} internal links checked` : ""}.`,
        "Score = weighted share of passed checks (partial results count half; unavailable checks are excluded).",
        "Based on publicly observable evidence; not a full-site crawl and not a guarantee of rankings, traffic or revenue.",
        ...(unavailable.length ? [`${unavailable.length} check(s) could not be run and are excluded from the score.`] : []),
        ...d.warnings.slice(0, 2).map((w) => `Note: ${clip(w, 100)}`),
      ],
    }),
  );

  slides.push(
    blank({
      layout: "closing",
      eyebrow: "Next steps",
      title: "Let's turn these findings into results",
      subtitle: `${d.preparedBy}, ${"Gexart"}`,
      bullets: ["Review findings together", "Agree priority actions", "Fixed-scope plan and quote", "Kick-off and delivery", "Ongoing support"],
    }),
  );
  void SEV_LABEL;
  return slides;
}

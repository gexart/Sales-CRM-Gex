// Sales material: problem→solution pitches, the fixed-format PDF proposal, PPT deck
// outlines (Claude or template), the price book and opportunity line items.
// Every generator works only from stored facts; AI output is labelled as a draft.
import { Hono, type Context } from "hono";
import type { AppEnv } from "../env";
import { deckOutlineSchema, lineItemSchema, pitchSchema, proposalSchema } from "../../shared/schemas";
import { DECK_TEMPLATES, PACKAGE_BILLING, PITCH_FORMATS, labelOf } from "../../shared/enums";
import { ApiError, notFound, parseJson } from "../lib/http";
import { auditStmt } from "../lib/audit-log";
import { clientIp } from "../lib/auth";
import { fetchOne, updateRow } from "../lib/entity";
import { claudeJson, untrusted, CLAUDE_MODEL } from "../lib/providers";
import { renderProposalPdf } from "../lib/pdf";
import { auditType } from "../audits/registry";
import { b, newId, now } from "../lib/util";
import { ENTITIES } from "../entities";
import { storeAsset } from "./assets";

type Row = Record<string, unknown>;
type Ctx = Context<AppEnv>;
export const salesRoutes = new Hono<AppEnv>();

const SEV_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const fmtMoney = (minor: number | null | undefined, currency = "INR") =>
  minor === null || minor === undefined ? "Custom quote" : `${currency} ${(minor / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

// ─── Facts ───
export interface Facts {
  account: Row;
  contact: Row | null;
  sender: { name: string; email: string };
  audits: { id: string; type: string; label: string; score: number | null; date: string; target: string; scope: Row | null; findings: Row[] }[];
  problems: { severity: string; title: string; detail: string; evidence: string | null; source: string; product: Row | null; recommendation: string | null }[];
  services: { product: Row; packages: Row[]; reason: string }[];
  caseStudies: string[];
  recentActivity: string[];
}

export async function gatherFacts(c: Ctx, accountId: string, o: { auditRunIds?: string[]; productIds?: string[]; contactId?: string | null }): Promise<Facts> {
  const account = await fetchOne(c, ENTITIES.accounts, accountId);
  const db = c.env.DB;
  const contact = o.contactId
    ? await fetchOne(c, ENTITIES.contacts, o.contactId)
    : await db.prepare("SELECT *, (first_name || COALESCE(' ' || last_name,'')) AS full_name FROM contacts WHERE account_id = ? AND archived_at IS NULL ORDER BY CASE decision_role WHEN 'decision_maker' THEN 0 ELSE 1 END, updated_at DESC LIMIT 1").bind(accountId).first<Row>();
  const runIds = o.auditRunIds?.length
    ? o.auditRunIds
    : (
        await db.prepare(
          `SELECT r.id FROM audit_runs r WHERE r.account_id = ? AND r.status IN ('completed','completed_warnings')
           AND r.created_at = (SELECT MAX(created_at) FROM audit_runs r2 WHERE r2.account_id = r.account_id AND r2.audit_type = r.audit_type AND r2.status IN ('completed','completed_warnings'))`,
        )
          .bind(accountId)
          .all<{ id: string }>()
      ).results.map((r) => r.id);
  const products = (await db.prepare("SELECT * FROM products WHERE archived_at IS NULL AND status = 'active'").all<Row>()).results;
  const bySku = new Map(products.map((p) => [String(p.sku), p]));
  const audits: Facts["audits"] = [];
  const problems: Facts["problems"] = [];
  for (const id of runIds.slice(0, 10)) {
    const run = await db.prepare("SELECT * FROM audit_runs WHERE id = ? AND account_id = ?").bind(id, accountId).first<Row>();
    if (!run) throw notFound("Audit");
    const findings = (
      await db.prepare(
        `SELECT f.*, (SELECT e.url FROM audit_evidence e WHERE e.finding_id = f.id AND e.url IS NOT NULL LIMIT 1) AS evidence_url
         FROM audit_findings f WHERE f.run_id = ? AND f.result IN ('fail','warn') ORDER BY f.position`,
      )
        .bind(id)
        .all<Row>()
    ).results;
    const label = auditType(String(run.audit_type))?.label ?? String(run.audit_type);
    audits.push({ id, type: String(run.audit_type), label, score: run.overall_score as number | null, date: String(run.completed_at ?? run.created_at).slice(0, 10), target: String(run.target), scope: run.scope ? JSON.parse(String(run.scope)) : null, findings });
    for (const f of findings) {
      const sku = (JSON.parse(String(f.related_skus ?? "[]")) as string[]).find((s) => bySku.has(s));
      problems.push({ severity: String(f.severity), title: String(f.title), detail: String(f.detail ?? ""), evidence: (f.evidence_url as string) ?? null, source: `${label}, ${String(run.completed_at ?? run.created_at).slice(0, 10)}`, product: sku ? bySku.get(sku)! : null, recommendation: (f.recommendation as string) ?? null });
    }
  }
  problems.sort((a, b2) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b2.severity] ?? 9));

  const assessed = (await db.prepare("SELECT product_id, status, note FROM account_service_assessments WHERE account_id = ? AND status IN ('needs_assessment','relevant','discussed','proposed')").bind(accountId).all<Row>()).results;
  const chosen = new Map<string, string>();
  for (const pid of o.productIds ?? []) chosen.set(pid, "Selected for this pitch");
  if (!o.productIds?.length) {
    for (const a of assessed) chosen.set(String(a.product_id), `Service fit: ${a.status}${a.note ? ` (${a.note})` : ""}`);
    for (const p of problems) if (p.product && !chosen.has(String(p.product.id))) chosen.set(String(p.product.id), `Addresses audit finding: ${p.title}`);
  }
  const services: Facts["services"] = [];
  for (const [pid, reason] of chosen) {
    const product = products.find((p) => p.id === pid);
    if (!product) continue;
    const packages = (await db.prepare("SELECT * FROM product_packages WHERE product_id = ? AND status = 'active' AND archived_at IS NULL ORDER BY position, price_minor").bind(pid).all<Row>()).results;
    services.push({ product, packages, reason });
  }
  const ids = services.map((s) => s.product.id);
  const caseStudies = (
    await db.prepare(
      `SELECT DISTINCT sa.name FROM sales_assets sa JOIN asset_associations aa ON aa.asset_id = sa.id WHERE sa.type = 'case_study' AND sa.archived_at IS NULL
       AND ((aa.entity_type = 'account' AND aa.entity_id = ?) OR (aa.entity_type = 'product' AND aa.entity_id IN (${ids.length ? ids.map(() => "?").join(",") : "NULL"}))) LIMIT 5`,
    )
      .bind(accountId, ...ids)
      .all<{ name: string }>()
  ).results.map((r) => r.name);
  const recentActivity = (
    await db.prepare("SELECT type, subject, occurred_at FROM activities WHERE account_id = ? AND type IN ('call','email','meeting','note','linkedin','whatsapp') ORDER BY occurred_at DESC LIMIT 6").bind(accountId).all<Row>()
  ).results.map((a) => `${String(a.occurred_at).slice(0, 10)} ${a.type}: ${a.subject}`);
  const user = c.get("user");
  return { account, contact, sender: { name: user.name, email: user.email }, audits, problems, services, caseStudies, recentActivity };
}

function factsForAi(f: Facts) {
  return {
    company: { name: f.account.name, industry: f.account.industry, city: f.account.city, website: f.account.website, business_type: f.account.business_type, size: f.account.company_size },
    contact: f.contact ? { name: f.contact.full_name ?? f.contact.first_name, title: f.contact.job_title } : null,
    sender: f.sender.name,
    audit_findings: f.problems.slice(0, 15).map((p) => ({ severity: p.severity, finding: p.title, detail: p.detail, source: p.source, related_service: p.product?.name ?? null })),
    services: f.services.map((s) => ({
      service: s.product.name, why: s.reason, description: s.product.short_description,
      packages: s.packages.map((p) => ({ name: p.name, price: fmtMoney(p.price_minor as number, String(p.currency)), billing: labelOf(PACKAGE_BILLING, String(p.billing_frequency)), deliverables: p.deliverables, timeline: p.timeline })),
      catalogue_price: s.packages.length ? null : fmtMoney(s.product.default_price_minor as number, String(s.product.currency)),
    })),
    verified_case_studies: f.caseStudies,
    previous_interactions: f.recentActivity,
  };
}

// ─── Pitch ───
function templatePitch(f: Facts, format: string): { title: string; content: string } {
  const first = String(f.contact?.first_name ?? "there");
  const company = String(f.account.name);
  const top = f.problems.slice(0, 3);
  const svc = f.services.map((s) => s.product.name);
  const svcText = svc.length ? svc.slice(0, 3).join(", ") : "digital growth and automation";
  const obs = top.map((p) => `- ${p.title}: ${p.detail}`).join("\n") || "- [Add 2-3 specific observations about their business before sending]";
  const price = (s: Facts["services"][number]) => (s.packages[0] ? `${s.packages[0].name} from ${fmtMoney(s.packages[0].price_minor as number, String(s.packages[0].currency))}` : fmtMoney(s.product.default_price_minor as number, String(s.product.currency)));
  const solutions = f.services.map((s) => `- ${s.product.name}: ${s.product.short_description ?? ""} (${price(s)})`).join("\n");
  const label = labelOf(PITCH_FORMATS, format);
  switch (format) {
    case "intro_30s":
      return { title: label, content: `Hi ${first}, I'm ${f.sender.name} from Gexart. ${top[0] ? `While looking at ${company} we noticed ${top[0].title.toLowerCase()}${top[1] ? ` and ${top[1].title.toLowerCase()}` : ""}.` : `We work with ${f.account.industry ?? "businesses"} like ${company}.`} We help with ${svcText}. Would a 20-minute call to walk through what we found be useful?` };
    case "sales_email":
      return { title: label, content: `Subject: A few observations about ${company}'s online presence\n\nHi ${first},\n\nI'm ${f.sender.name} from Gexart. We reviewed ${company}'s public website and noticed:\n${obs}\n\nWhat we'd suggest:\n${solutions || "- [Choose the relevant Gexart service]"}\n\nHappy to share the full audit on a short call. Would Tuesday or Thursday suit you?\n\nBest regards,\n${f.sender.name}\nGexart` };
    case "cold_call_script":
      return { title: label, content: `OPENER\n"Hi ${first}, this is ${f.sender.name} from Gexart. Is now a bad time for a 2-minute call?"\n\nREASON FOR CALLING\n"We ran a quick review of ${company}'s website and found a few things that are likely costing you enquiries."\n\nOBSERVATIONS\n${obs}\n\nQUESTIONS\n- How do most new customers find you today?\n- What happens to an enquiry after someone fills your form or calls?\n- Who looks after your website and marketing?\n\nCLOSE\n"Could I take 20 minutes to walk you through the audit? I can do [day] at [time]."\n\nVOICEMAIL\n"Hi ${first}, ${f.sender.name} from Gexart. I have a short audit of ${company}'s website with a few quick wins. I'll send it by email; reply or call back when convenient."` };
    case "whatsapp":
      return { title: label, content: `Hi ${first}, ${f.sender.name} here from Gexart. We did a quick review of ${company}'s website${top[0] ? ` and noticed ${top[0].title.toLowerCase()}` : ""}. I have a short summary with fixes. Can I share it here, or would a quick call be better?` };
    case "linkedin":
      return { title: label, content: `Hi ${first}, I came across ${company} and had a look at your website. ${top[0] ? `A couple of things stood out (e.g. ${top[0].title.toLowerCase()}). ` : ""}We help ${f.account.industry ?? "businesses"} with ${svcText}. Open to connecting? Happy to share what we found.` };
    case "discovery_agenda":
      return { title: label, content: `Discovery call: ${company} (30 min)\n1. Introductions and goals for the next 6-12 months (5 min)\n2. How customers find and contact ${company} today (5 min)\n3. Walk-through of our audit findings (10 min)\n${obs}\n4. Priorities, decision process and timelines (5 min)\n5. Agree next step: proposal or pilot (5 min)` };
    case "meeting_pitch":
    case "executive_summary":
      return { title: label, content: `${company}${f.account.industry ? ` (${f.account.industry}${f.account.city ? `, ${f.account.city}` : ""})` : ""}\n\nThe problem\n${obs}\n\nThe solution\n${solutions || "- [Choose services from the catalogue]"}\n\nWhy now\nEach of these issues is visible to every prospective customer who visits today. Fixing them is low risk and measurable.\n\nNext step\nA 30-minute discovery call to confirm priorities, followed by a written proposal with fixed pricing.` };
    default:
      return {
        title: label,
        content: `"We already have someone for this."\n-> "Great. Our audit is independent; happy to share it with them. If it confirms everything is covered, you've lost nothing."\n\n"We don't have budget right now."\n-> "Understood. The quick wins (${top[0]?.title ?? "the top finding"}) are low effort. Shall we size just those?"\n\n"Send me some details."\n-> "Will do. To make it relevant, what's the one thing you'd most like more of: enquiries, bookings or repeat customers?"\n\nNote: general guidance; adapt it to what you learn on the call.`,
      };
  }
}

salesRoutes.post("/accounts/:id/pitch", async (c) => {
  const input = await parseJson(c, pitchSchema);
  const f = await gatherFacts(c, c.req.param("id"), { auditRunIds: input.audit_run_ids, productIds: input.product_ids, contactId: input.contact_id });
  const user = c.get("user");
  let sections: { format: string; title: string; content: string }[];
  let assumptions: string[] = [];
  let missing: string[] = [];
  let generator = "template";
  let model: string | null = null;
  if (input.use_ai && c.env.ANTHROPIC_API_KEY) {
    const res = await claudeJson<{ sections: { format: string; title: string; content: string }[]; assumptions: string[]; missing_information: string[] }>(c.env, {
      system: `You write B2B sales material for Gexart, a digital marketing, software and AI-automation agency in India.
Rules: use ONLY the facts provided. Never invent results, statistics, client names, case studies, prices, discounts, deadlines or prior relationships. Quote prices exactly as given; if a price is "Custom quote", say pricing will be confirmed. Only mention case studies listed in verified_case_studies. Frame each pitch as problem -> evidence -> solution -> next step. List anything you assumed under assumptions and anything a salesperson should find out under missing_information. Write in ${input.language}, ${input.tone} tone.`,
      prompt: `Objective: ${input.objective ?? "book a discovery call"}\nWrite these formats: ${input.formats.map((x) => `${x} (${labelOf(PITCH_FORMATS, x)})`).join(", ")}.\n${untrusted("crm_facts", factsForAi(f))}`,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["sections", "assumptions", "missing_information"],
        properties: {
          sections: { type: "array", items: { type: "object", additionalProperties: false, required: ["format", "title", "content"], properties: { format: { type: "string", enum: [...PITCH_FORMATS.values] }, title: { type: "string" }, content: { type: "string" } } } },
          assumptions: { type: "array", items: { type: "string" } },
          missing_information: { type: "array", items: { type: "string" } },
        },
      },
      effort: "medium",
    });
    sections = res.data.sections;
    assumptions = res.data.assumptions;
    missing = res.data.missing_information;
    generator = "claude";
    model = res.model;
  } else {
    sections = input.formats.map((fmt) => ({ format: fmt, ...templatePitch(f, fmt) }));
    if (!f.contact) missing.push("No contact on file: add the decision-maker's name.");
    if (!f.audits.length) missing.push("No completed audit: run a website audit for specific observations.");
    if (!f.services.length) missing.push("No services selected or assessed as relevant.");
    if (f.services.some((s) => !s.packages.length && s.product.default_price_minor === null)) missing.push("Some services have no price in the price book.");
  }
  const problems = f.problems.slice(0, 10).map((p) => ({ severity: p.severity, problem: p.title, evidence: p.detail, source: p.source, solution: p.product ? p.product.name : null, recommendation: p.recommendation }));
  const content = { sections, assumptions, missing_information: missing, problems, pricing: f.services.map((s) => ({ service: s.product.name, packages: s.packages.map((p) => ({ name: p.name, price: fmtMoney(p.price_minor as number, String(p.currency)), billing: p.billing_frequency })) })) };
  const id = newId();
  await c.env.DB.prepare("INSERT INTO sales_pitch_drafts (id, account_id, title, content, generator, model, sources, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .bind(id, f.account.id, `Pitch for ${f.account.name}`, JSON.stringify(content), generator, b(model), JSON.stringify({ audit_run_ids: f.audits.map((a) => a.id), product_ids: f.services.map((s) => s.product.id) }), user.id, now())
    .run();
  return c.json({ data: { id, generator, model, ...content } }, 201);
});

salesRoutes.get("/accounts/:id/pitches", async (c) => {
  const a = await fetchOne(c, ENTITIES.accounts, c.req.param("id"));
  const r = await c.env.DB.prepare("SELECT p.*, u.name AS created_by_name FROM sales_pitch_drafts p LEFT JOIN users u ON u.id = p.created_by WHERE p.account_id = ? ORDER BY p.created_at DESC LIMIT 20").bind(a.id).all<Row>();
  return c.json({ data: r.results.map((x) => ({ ...x, content: JSON.parse(String(x.content)) })) });
});

// ─── PDF proposal (fixed format) ───
salesRoutes.post("/accounts/:id/proposal", async (c) => {
  const input = await parseJson(c, proposalSchema);
  const accountId = c.req.param("id");
  const f = await gatherFacts(c, accountId, { auditRunIds: input.audit_run_ids, productIds: input.items.map((i) => i.product_id), contactId: input.contact_id });
  if (input.opportunity_id) await fetchOne(c, ENTITIES.opportunities, input.opportunity_id);
  const user = c.get("user");
  const db = c.env.DB;
  const lines: { product: Row; pkg: Row | null; qty: number }[] = [];
  for (const it of input.items) {
    const product = await db.prepare("SELECT * FROM products WHERE id = ? AND archived_at IS NULL").bind(it.product_id).first<Row>();
    if (!product) throw notFound("Product");
    const pkg = it.package_id ? await db.prepare("SELECT * FROM product_packages WHERE id = ? AND product_id = ?").bind(it.package_id, it.product_id).first<Row>() : null;
    if (it.package_id && !pkg) throw notFound("Package");
    lines.push({ product, pkg, qty: it.quantity });
  }
  const totals = new Map<string, { minor: number; currency: string }>();
  let customCount = 0;
  const prices = lines.map((l) => {
    const unit = (l.pkg ? l.pkg.price_minor : l.product.default_price_minor) as number | null;
    const currency = String(l.pkg?.currency ?? l.product.currency ?? "INR");
    const billing = String(l.pkg?.billing_frequency ?? (l.product.pricing_model === "recurring" ? (l.product.billing_frequency ?? "monthly") : "one_time"));
    if (unit === null || unit === undefined) customCount++;
    else {
      const key = `${billing}|${currency}`;
      totals.set(key, { minor: (totals.get(key)?.minor ?? 0) + unit * l.qty, currency });
    }
    return { service: String(l.product.name), packageName: (l.pkg?.name as string) ?? null, billing: labelOf(PACKAGE_BILLING, billing), qty: l.qty, unit: fmtMoney(unit, currency), total: unit === null || unit === undefined ? "Custom quote" : fmtMoney(unit * l.qty, currency), custom: unit === null || unit === undefined };
  });
  const date = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: user.timezone }).format(new Date());
  const company = String(f.account.name);
  const issueCount = f.problems.length;
  const summary = [
    `${company}${f.account.industry ? ` operates in ${f.account.industry}${f.account.city ? ` in ${f.account.city}` : ""}` : ""}.`,
    f.audits.length
      ? `Gexart reviewed ${company}'s public online presence (${f.audits.map((a) => `${a.label} on ${a.date}${a.score !== null ? `, score ${a.score}/100` : ""}`).join("; ")}) and recorded ${issueCount} issue(s) that affect how customers find, trust and contact the business.`
      : `This proposal is based on our conversations and the services selected below; no audit findings are included.`,
    `We recommend ${lines.map((l) => l.product.name).join(", ")} to address ${issueCount ? "these findings" : "your priorities"}. The investment section lists prices from the Gexart price book${customCount ? `; ${customCount} item(s) will be quoted after the discovery call` : ""}.`,
  ].join(" ");
  const pdf = await renderProposalPdf({
    title: input.title ?? "Digital Growth Proposal",
    clientName: company,
    clientMeta: [f.account.industry, f.account.city, f.account.website].filter(Boolean).join("  ·  ").replace(/·/g, "|"),
    contactLine: f.contact ? `${f.contact.full_name ?? f.contact.first_name}${f.contact.job_title ? `, ${f.contact.job_title}` : ""}` : null,
    preparedBy: user.name,
    date,
    validityDays: input.validity_days,
    introNote: input.intro_note ?? null,
    summary,
    findings: f.problems.filter((p) => p.severity !== "positive").slice(0, 14).map((p) => ({ severity: p.severity, title: p.title, detail: p.detail, evidence: p.evidence, source: p.source })),
    solutions: lines.map((l) => ({
      service: String(l.product.name),
      packageName: (l.pkg?.name as string) ?? null,
      description: ((l.pkg?.description ?? l.product.short_description) as string) ?? null,
      deliverables: String(l.pkg?.deliverables ?? l.product.features ?? "").split("\n").map((s) => s.trim()).filter(Boolean),
      timeline: (l.pkg?.timeline as string) ?? null,
    })),
    prices,
    totals: [...totals.entries()].map(([k, v]) => ({ label: `${labelOf(PACKAGE_BILLING, k.split("|")[0])} total`, value: fmtMoney(v.minor, v.currency) })),
    priceNote: `Prices from the Gexart price book as of ${date}.${customCount ? " Items marked Custom quote will be priced in writing after scope is confirmed." : ""}`,
    scopeNote: f.audits.length ? "Audit findings reflect publicly observable evidence on the pages inspected at the stated dates; they are not a full-site crawl or a guarantee of rankings or revenue." : null,
  });
  const title = `${input.title ?? "Digital Growth Proposal"} - ${company} - ${now().slice(0, 10)}`;
  const links = [{ type: "account", id: accountId }, ...(input.opportunity_id ? [{ type: "opportunity", id: input.opportunity_id }] : []), ...f.audits.map((a) => ({ type: "audit_run", id: a.id }))];
  const asset = await storeAsset(c.env, { userId: user.id, name: title, type: "proposal", visibility: "internal", fileName: `${title.replace(/[^\w -]+/g, "")}.pdf`, mime: "application/pdf", body: pdf, size: pdf.byteLength, source: "generated", links });
  const docId = newId();
  await db.batch([
    db.prepare("INSERT INTO generated_documents (id, kind, title, account_id, opportunity_id, asset_id, sources, content, generator, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(
      docId, "proposal_pdf", title, accountId, b(input.opportunity_id), asset.id, JSON.stringify({ audit_run_ids: f.audits.map((a) => a.id), items: input.items }), JSON.stringify({ prices }), "template", user.id, now(),
    ),
    auditStmt(db, { actorId: user.id, action: "generate", entityType: "account", entityId: accountId, summary: `Generated PDF proposal "${title}"`, ip: clientIp(c) }),
  ]);
  return c.json({ data: { document_id: docId, asset_id: asset.id, title } }, 201);
});

// ─── Pitch deck outline (Claude or template) ───
interface Slide {
  layout: "title" | "section" | "bullets" | "two_column" | "table" | "metrics" | "closing";
  title: string;
  subtitle: string;
  bullets: string[];
  left_heading: string;
  left_bullets: string[];
  right_heading: string;
  right_bullets: string[];
  table_headers: string[];
  table_rows: string[][];
  metrics: { label: string; value: string }[];
  notes: string;
}
const blank = (s: Partial<Slide>): Slide => ({ layout: "bullets", title: "", subtitle: "", bullets: [], left_heading: "", left_bullets: [], right_heading: "", right_bullets: [], table_headers: [], table_rows: [], metrics: [], notes: "", ...s });

function templateDeck(f: Facts, template: string): Slide[] {
  const company = String(f.account.name);
  const slides: Slide[] = [blank({ layout: "title", title: company, subtitle: labelOf(DECK_TEMPLATES, template), notes: `Prepared by ${f.sender.name}, Gexart` })];
  slides.push(blank({ title: "Executive summary", bullets: [f.audits.length ? `We audited ${company}'s public presence: ${f.audits.map((a) => `${a.label}${a.score !== null ? ` (${a.score}/100)` : ""}`).join(", ")}.` : `Overview of how Gexart can help ${company}.`, `${f.problems.length} improvement opportunities identified.`, f.services.length ? `Recommended: ${f.services.map((s) => s.product.name).join(", ")}.` : "Services to be confirmed in discovery."] }));
  if (template !== "company_intro") {
    slides.push(blank({ title: "About " + company, bullets: [f.account.industry && `Industry: ${f.account.industry}`, f.account.city && `Location: ${f.account.city}`, f.account.website && `Website: ${f.account.website}`, f.account.business_type && `Business: ${f.account.business_type}`].filter(Boolean) as string[] }));
  }
  if (f.audits.length) {
    slides.push(blank({ layout: "metrics", title: "Digital health snapshot", metrics: f.audits.map((a) => ({ label: a.label, value: a.score === null ? "N/A" : `${a.score}/100` })), notes: "Scores reflect the documented check rubric for the pages inspected, not rankings or revenue." }));
    const crit = f.problems.slice(0, 6);
    if (crit.length) slides.push(blank({ layout: "table", title: "Key findings", table_headers: ["Priority", "Finding", "Evidence"], table_rows: crit.map((p) => [p.severity, p.title, p.detail.slice(0, 120)]) }));
    const withSol = f.problems.filter((p) => p.product).slice(0, 5);
    if (withSol.length) slides.push(blank({ layout: "two_column", title: "Problem → solution", left_heading: "What we found", left_bullets: withSol.map((p) => p.title), right_heading: "How Gexart fixes it", right_bullets: withSol.map((p) => `${p.product!.name}: ${p.recommendation ?? ""}`.slice(0, 140)) }));
  }
  if (f.services.length) {
    slides.push(blank({ title: "Recommended services", bullets: f.services.map((s) => `${s.product.name} - ${s.product.short_description ?? s.reason}`) }));
    const rows = f.services.flatMap((s) => (s.packages.length ? s.packages.map((p) => [String(s.product.name), String(p.name), labelOf(PACKAGE_BILLING, String(p.billing_frequency)), fmtMoney(p.price_minor as number, String(p.currency))]) : [[String(s.product.name), "-", "-", fmtMoney(s.product.default_price_minor as number, String(s.product.currency))]]));
    slides.push(blank({ layout: "table", title: "Investment", table_headers: ["Service", "Package", "Billing", "Price"], table_rows: rows, notes: "Prices from the Gexart price book." }));
  }
  slides.push(blank({ title: "Implementation roadmap", bullets: ["Week 1: discovery and access", "Weeks 2-4: quick wins from the audit", "Month 2 onwards: growth programme and monthly reporting"], notes: "Indicative; confirm timelines in the proposal." }));
  if (f.caseStudies.length) slides.push(blank({ title: "Relevant work", bullets: f.caseStudies }));
  slides.push(blank({ layout: "closing", title: "Next steps", bullets: ["30-minute discovery call", "Written proposal with fixed pricing", "Kick-off"], subtitle: `${f.sender.name} · ${f.sender.email}` }));
  return slides;
}

const SLIDE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["layout", "title", "subtitle", "bullets", "left_heading", "left_bullets", "right_heading", "right_bullets", "table_headers", "table_rows", "metrics", "notes"],
  properties: {
    layout: { type: "string", enum: ["title", "section", "bullets", "two_column", "table", "metrics", "closing"] },
    title: { type: "string" },
    subtitle: { type: "string" },
    bullets: { type: "array", items: { type: "string" } },
    left_heading: { type: "string" },
    left_bullets: { type: "array", items: { type: "string" } },
    right_heading: { type: "string" },
    right_bullets: { type: "array", items: { type: "string" } },
    table_headers: { type: "array", items: { type: "string" } },
    table_rows: { type: "array", items: { type: "array", items: { type: "string" } } },
    metrics: { type: "array", items: { type: "object", additionalProperties: false, required: ["label", "value"], properties: { label: { type: "string" }, value: { type: "string" } } } },
    notes: { type: "string" },
  },
};

salesRoutes.post("/accounts/:id/deck-outline", async (c) => {
  const input = await parseJson(c, deckOutlineSchema);
  const f = await gatherFacts(c, c.req.param("id"), { auditRunIds: input.audit_run_ids, productIds: input.product_ids, contactId: input.contact_id });
  if (input.use_ai && c.env.ANTHROPIC_API_KEY) {
    const res = await claudeJson<{ slides: Slide[]; assumptions: string[]; missing_information: string[] }>(c.env, {
      system: `You design concise B2B sales decks for Gexart (digital marketing, software, CRM/ERP and AI automation, India).
Use ONLY the provided facts. Never invent statistics, results, client names, case studies, prices or timelines beyond what is given. Prices must match the facts exactly. Problem -> evidence -> solution -> investment -> next step. 8-14 slides. Max 6 bullets per slide, each under 18 words. Choose layouts: title (first), section, bullets, two_column (problem vs solution), table (findings or pricing), metrics (audit scores), closing (last). Leave unused fields empty. Put talking points in notes.`,
      prompt: `Deck type: ${labelOf(DECK_TEMPLATES, input.template)}\nAudience: ${input.audience ?? "business owner / decision-maker"}\nObjective: ${input.objective ?? "agree a discovery call or proposal"}\n${untrusted("crm_facts", factsForAi(f))}`,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["slides", "assumptions", "missing_information"],
        properties: { slides: { type: "array", items: SLIDE_SCHEMA }, assumptions: { type: "array", items: { type: "string" } }, missing_information: { type: "array", items: { type: "string" } } },
      },
      effort: "medium",
    });
    return c.json({ data: { generator: "claude", model: res.model, ...res.data } });
  }
  return c.json({ data: { generator: "template", model: null, slides: templateDeck(f, input.template), assumptions: [], missing_information: c.env.ANTHROPIC_API_KEY ? [] : ["Claude is not configured, so this outline was built from a fixed template."] } });
});

/** The browser renders the .pptx (pptxgenjs) from the reviewed outline and uploads it here. */
salesRoutes.post("/accounts/:id/decks", async (c) => {
  const accountId = c.req.param("id");
  const account = await fetchOne(c, ENTITIES.accounts, accountId);
  const form = await c.req.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") throw new ApiError(400, "validation_error", "Missing deck file");
  const f = file as File;
  if (f.type !== "application/vnd.openxmlformats-officedocument.presentationml.presentation") throw new ApiError(400, "unsupported_type", "Expected a .pptx file");
  if (f.size > 25 * 1024 * 1024) throw new ApiError(400, "too_large", "Deck exceeds 25 MB");
  const s = (k: string) => (typeof form.get(k) === "string" ? String(form.get(k)) : null);
  const user = c.get("user");
  const title = (s("title") ?? `Pitch deck - ${account.name}`).slice(0, 200);
  const opp = s("opportunity_id");
  if (opp) await fetchOne(c, ENTITIES.opportunities, opp);
  const asset = await storeAsset(c.env, { userId: user.id, name: title, type: "pitch_deck", fileName: `${title.replace(/[^\w -]+/g, "")}.pptx`, mime: f.type, body: f.stream(), size: f.size, source: "generated", links: [{ type: "account", id: accountId }, ...(opp ? [{ type: "opportunity", id: opp }] : [])] });
  const generator = s("generator") === "claude" ? "claude" : "template";
  await c.env.DB.prepare("INSERT INTO generated_documents (id, kind, title, account_id, opportunity_id, asset_id, sources, content, generator, model, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(newId(), "pitch_deck", title, accountId, b(opp), asset.id, JSON.stringify({ template: s("template") }), (s("outline") ?? "").slice(0, 200000), generator, generator === "claude" ? (s("model") ?? CLAUDE_MODEL) : null, user.id, now())
    .run();
  return c.json({ data: { asset_id: asset.id } }, 201);
});

salesRoutes.get("/accounts/:id/documents", async (c) => {
  const a = await fetchOne(c, ENTITIES.accounts, c.req.param("id"));
  const r = await c.env.DB.prepare("SELECT d.id, d.kind, d.title, d.asset_id, d.generator, d.model, d.created_at, u.name AS created_by_name FROM generated_documents d LEFT JOIN users u ON u.id = d.created_by WHERE d.account_id = ? ORDER BY d.created_at DESC LIMIT 50").bind(a.id).all();
  return c.json({ data: r.results });
});

// ─── Price book ───
salesRoutes.get("/price-book", async (c) => {
  const db = c.env.DB;
  const [products, packages] = await db.batch<Row>([
    db.prepare("SELECT id, name, sku, category, short_description, pricing_model, default_price_minor, currency, billing_frequency, status FROM products WHERE archived_at IS NULL ORDER BY category, name"),
    db.prepare("SELECT * FROM product_packages WHERE archived_at IS NULL ORDER BY position, price_minor"),
  ]);
  return c.json({ data: products.results.map((p) => ({ ...p, packages: packages.results.filter((k) => k.product_id === p.id) })) });
});

// ─── Opportunity line items ───
salesRoutes.get("/opportunities/:id/items", async (c) => {
  const o = await fetchOne(c, ENTITIES.opportunities, c.req.param("id"));
  const r = await c.env.DB.prepare("SELECT i.*, p.name AS product_name, k.name AS package_name FROM opportunity_products i JOIN products p ON p.id = i.product_id LEFT JOIN product_packages k ON k.id = i.package_id WHERE i.opportunity_id = ? ORDER BY i.created_at").bind(o.id).all();
  return c.json({ data: r.results });
});

salesRoutes.post("/opportunities/:id/items", async (c) => {
  const o = await fetchOne(c, ENTITIES.opportunities, c.req.param("id"));
  const input = await parseJson(c, lineItemSchema);
  const product = await c.env.DB.prepare("SELECT id FROM products WHERE id = ?").bind(input.product_id).first();
  if (!product) throw notFound("Product");
  if (input.package_id && !(await c.env.DB.prepare("SELECT 1 FROM product_packages WHERE id = ? AND product_id = ?").bind(input.package_id, input.product_id).first())) throw notFound("Package");
  await c.env.DB.prepare("INSERT INTO opportunity_products (id, opportunity_id, product_id, package_id, quantity, unit_price_minor, discount_pct, currency, billing_frequency, notes, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .bind(newId(), o.id, input.product_id, b(input.package_id), input.quantity, input.unit_price_minor, input.discount_pct, o.currency, b(input.billing_frequency), b(input.notes), now())
    .run();
  return c.json({ data: { ok: true } }, 201);
});

salesRoutes.delete("/opportunities/:id/items/:itemId", async (c) => {
  const o = await fetchOne(c, ENTITIES.opportunities, c.req.param("id"));
  await c.env.DB.prepare("DELETE FROM opportunity_products WHERE id = ? AND opportunity_id = ?").bind(c.req.param("itemId"), o.id).run();
  return c.json({ data: { ok: true } });
});

/** Sets the deal value to the first-year value of the line items (recurring items annualised). */
salesRoutes.post("/opportunities/:id/items/apply-total", async (c) => {
  const o = await fetchOne(c, ENTITIES.opportunities, c.req.param("id"));
  const items = (await c.env.DB.prepare("SELECT * FROM opportunity_products WHERE opportunity_id = ?").bind(o.id).all<Row>()).results;
  if (!items.length) throw new ApiError(400, "validation_error", "Add line items first");
  const factor: Record<string, number> = { monthly: 12, quarterly: 4, yearly: 1, one_time: 1 };
  const total = items.reduce((s, i) => s + Math.round(Number(i.unit_price_minor) * Number(i.quantity) * (1 - Number(i.discount_pct) / 100)) * (factor[String(i.billing_frequency ?? "one_time")] ?? 1), 0);
  return c.json({ data: await updateRow(c, ENTITIES.opportunities, String(o.id), { amount_minor: total }) });
});

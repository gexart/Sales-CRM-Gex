// Lead discovery (Google Places), contact finding (public website + authorised data
// providers) and transparent prospect qualification. Nothing found here is saved to the
// CRM until a user reviews and confirms it; every saved record keeps its source.
import { Hono, type Context } from "hono";
import type { AppEnv } from "../env";
import { discoveryImportSchema, discoverySearchSchema, enrichSchema, qualificationOverrideSchema, saveEnrichmentSchema } from "../../shared/schemas";
import { ApiError, notFound, parseJson } from "../lib/http";
import { activityStmt, auditStmt } from "../lib/audit-log";
import { clientIp, isManager } from "../lib/auth";
import { fetchOne } from "../lib/entity";
import { computeQualification } from "../lib/qualification";
import {
  apolloPeopleSearch, apolloReveal, hunterDomainSearch, lushaPerson, placesTextSearch, rocketreachReveal, rocketreachSearch, type FoundPerson,
} from "../lib/providers";
import { b, domainOf, newId, normalizeEmail, normalizeName, normalizePhone, now } from "../lib/util";
import { crawl } from "../audits/crawler";
import { ENTITIES } from "../entities";

type Row = Record<string, unknown>;
export const discoveryRoutes = new Hono<AppEnv>();

// ─── Google Places lead discovery ───
discoveryRoutes.post("/discovery/search", async (c) => {
  const input = await parseJson(c, discoverySearchSchema);
  const user = c.get("user");
  if (input.campaign_id) await fetchOne(c, ENTITIES.campaigns, input.campaign_id);
  const query = [input.query, input.location && `in ${input.location}`].filter(Boolean).join(" ");
  const jobId = newId();
  const t = now();
  let places;
  try {
    places = await placesTextSearch(c.env, query, input.max_results);
  } catch (e) {
    await c.env.DB.prepare("INSERT INTO lead_search_jobs (id, provider, query, location, campaign_id, status, error, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(jobId, "google_places", input.query, b(input.location), b(input.campaign_id), "failed", e instanceof Error ? e.message : "error", user.id, t)
      .run();
    throw e;
  }
  // Duplicate check against existing prospects and accounts by domain or normalised name.
  const names = places.map((p) => normalizeName(p.name));
  const domains = places.map((p) => domainOf(p.website)).filter((d): d is string => !!d);
  const dupes = names.length
    ? (
        await c.env.DB.prepare(
          `SELECT 'prospect' AS kind, id, company_name AS name, name_normalized, domain FROM prospects WHERE archived_at IS NULL AND (name_normalized IN (${names.map(() => "?").join(",")}) OR domain IN (${domains.length ? domains.map(() => "?").join(",") : "NULL"}))
           UNION ALL SELECT 'account', id, name, name_normalized, domain FROM accounts WHERE archived_at IS NULL AND (name_normalized IN (${names.map(() => "?").join(",")}) OR domain IN (${domains.length ? domains.map(() => "?").join(",") : "NULL"}))`,
        )
          .bind(...names, ...domains, ...names, ...domains)
          .all<Row>()
      ).results
    : [];
  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare("INSERT INTO lead_search_jobs (id, provider, query, location, campaign_id, status, result_count, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(
      jobId, "google_places", input.query, b(input.location), b(input.campaign_id), "completed", places.length, user.id, t,
    ),
  ];
  for (const p of places) {
    const d = dupes.find((x) => x.name_normalized === normalizeName(p.name) || (domainOf(p.website) && x.domain === domainOf(p.website)));
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO lead_search_results (id, job_id, provider_place_id, name, category, address, city, phone, website, rating, review_count, maps_url, duplicate_kind, duplicate_id, duplicate_name, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(newId(), jobId, p.id, p.name, b(p.category), b(p.address), b(p.city), b(p.phone), b(p.website), b(p.rating), b(p.reviewCount), b(p.mapsUrl), b(d?.kind), b(d?.id), b(d?.name), t),
    );
  }
  await c.env.DB.batch(stmts);
  return c.json({ data: await jobDetail(c, jobId) }, 201);
});

async function jobDetail(c: Context<AppEnv>, id: string) {
  const job = await c.env.DB.prepare("SELECT j.*, cp.name AS campaign_name FROM lead_search_jobs j LEFT JOIN campaigns cp ON cp.id = j.campaign_id WHERE j.id = ?").bind(id).first<Row>();
  const user = c.get("user");
  if (!job || (job.created_by !== user.id && !isManager(user))) throw notFound("Search");
  const results = await c.env.DB.prepare("SELECT * FROM lead_search_results WHERE job_id = ? ORDER BY rowid").bind(id).all();
  return { ...job, results: results.results } as Row & { results: Row[] };
}

discoveryRoutes.get("/discovery/jobs", async (c) => {
  const user = c.get("user");
  const r = await c.env.DB.prepare(
    `SELECT j.*, u.name AS created_by_name, (SELECT COUNT(*) FROM lead_search_results r WHERE r.job_id = j.id AND r.imported_prospect_id IS NOT NULL) AS imported
     FROM lead_search_jobs j LEFT JOIN users u ON u.id = j.created_by ${isManager(user) ? "" : "WHERE j.created_by = ?"} ORDER BY j.created_at DESC LIMIT 30`,
  )
    .bind(...(isManager(user) ? [] : [user.id]))
    .all();
  return c.json({ data: r.results });
});

discoveryRoutes.get("/discovery/jobs/:id", async (c) => c.json({ data: await jobDetail(c, c.req.param("id")) }));

discoveryRoutes.post("/discovery/jobs/:id/import", async (c) => {
  const job = await jobDetail(c, c.req.param("id"));
  const input = await parseJson(c, discoveryImportSchema);
  const user = c.get("user");
  const campaignId = input.campaign_id ?? (job.campaign_id as string) ?? null;
  const campaign = campaignId ? await c.env.DB.prepare("SELECT id, target_industry, target_geography FROM campaigns WHERE id = ?").bind(campaignId).first<Row>() : null;
  const owner = input.owner_id && isManager(user) ? input.owner_id : user.id;
  const chosen = (job.results as Row[]).filter((r) => input.result_ids.includes(String(r.id)) && !r.imported_prospect_id);
  const t = now();
  const stmts: D1PreparedStatement[] = [];
  for (const r of chosen) {
    const pid = newId();
    const q = computeQualification({ industry: r.category as string, geography: r.city as string, website: r.website as string, phone: r.phone as string, service_fit: input.service_fit, campaign: campaign as never });
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO prospects (id, company_name, name_normalized, website, domain, industry, geography, phone, discovery_source, campaign_id, service_fit, status, owner_id,
           research_notes, qualification_score, qualification_level, qualification_factors, qualification_scored_at, created_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?, 'google_places', ?,?, 'discovered', ?,?,?,?,?,?,?,?,?)`,
      ).bind(
        pid, r.name, normalizeName(String(r.name)), b(r.website), domainOf(r.website as string), b(r.category), b(r.city ?? r.address), b(r.phone), b(campaign?.id), b(input.service_fit), owner,
        `Found via Google Places search "${job.query}". ${r.address ?? ""}${r.rating ? ` · ${r.rating}★ (${r.review_count} reviews)` : ""}`.trim(),
        q.score, q.level, JSON.stringify(q.factors), t, user.id, t, t,
      ),
      c.env.DB.prepare("UPDATE lead_search_results SET imported_prospect_id = ? WHERE id = ? AND imported_prospect_id IS NULL").bind(pid, r.id),
    );
    if (campaign) stmts.push(c.env.DB.prepare("INSERT OR IGNORE INTO campaign_prospects (campaign_id, prospect_id, created_at) VALUES (?,?,?)").bind(campaign.id, pid, t));
  }
  if (stmts.length) {
    stmts.push(auditStmt(c.env.DB, { actorId: user.id, action: "import", entityType: "prospect", entityId: String(job.id), summary: `Imported ${chosen.length} prospect(s) from Google Places`, ip: clientIp(c) }));
    await c.env.DB.batch(stmts);
  }
  return c.json({ data: { created: chosen.length, skipped: input.result_ids.length - chosen.length } });
});

// ─── Contact finder ───
async function enrichmentTarget(c: Context<AppEnv>, kind: "account" | "prospect", id: string) {
  const row = kind === "account" ? await fetchOne(c, ENTITIES.accounts, id) : await fetchOne(c, ENTITIES.prospects, id);
  const name = String(kind === "account" ? row.name : row.company_name);
  return { row, name, website: (row.website as string) ?? null, domain: domainOf(row.website as string) };
}

async function websiteContacts(website: string): Promise<FoundPerson[]> {
  const r = await crawl(website, undefined, { maxPages: 4, maxLinkChecks: 0, checkHttpRedirect: false });
  if (!r.homepage) throw new ApiError(502, "website_unreachable", `The website could not be read: ${r.homepageError ?? "no response"}`);
  const out: FoundPerson[] = [];
  for (const p of r.pages) {
    for (const e of p.emails) out.push({ provider: "website", provider_ref: e, full_name: null, title: null, email: e, email_status: "published", phone: null, linkedin_url: null, confidence: null, source_url: p.finalUrl, revealed: true });
    for (const ph of p.phones) out.push({ provider: "website", provider_ref: ph, full_name: null, title: null, email: null, email_status: null, phone: ph, linkedin_url: null, confidence: null, source_url: p.finalUrl, revealed: true });
    for (const l of p.links.filter((x) => /linkedin\.com\/in\//i.test(x.href))) out.push({ provider: "website", provider_ref: l.href, full_name: l.text || null, title: null, email: null, email_status: null, phone: null, linkedin_url: l.href, confidence: null, source_url: p.finalUrl, revealed: true });
  }
  const seen = new Set<string>();
  return out.filter((x) => (seen.has(x.provider_ref ?? "") ? false : (seen.add(x.provider_ref ?? ""), true)));
}

discoveryRoutes.post("/:kind{accounts|prospects}/:id/enrich", async (c) => {
  const kind = c.req.param("kind") === "accounts" ? "account" : "prospect";
  const target = await enrichmentTarget(c, kind, c.req.param("id"));
  const { providers } = await parseJson(c, enrichSchema);
  const user = c.get("user");
  const results: FoundPerson[] = [];
  const errors: { provider: string; error: string }[] = [];
  for (const p of providers) {
    try {
      if (p === "website") {
        if (!target.website) throw new ApiError(400, "missing_website", "No website on record");
        results.push(...(await websiteContacts(target.website)));
      } else if (p === "hunter") {
        if (!target.domain) throw new ApiError(400, "missing_website", "No website/domain on record");
        results.push(...(await hunterDomainSearch(c.env, target.domain)));
      } else if (p === "apollo") {
        if (!target.domain) throw new ApiError(400, "missing_website", "No website/domain on record");
        results.push(...(await apolloPeopleSearch(c.env, target.domain)));
      } else if (p === "rocketreach") {
        results.push(...(await rocketreachSearch(c.env, target.name, target.domain)));
      } else if (p === "lusha") {
        throw new ApiError(400, "needs_name", "Lusha looks up a named person: use Reveal with Lusha on a result that has a name");
      }
    } catch (e) {
      errors.push({ provider: p, error: e instanceof Error ? e.message : "error" });
    }
  }
  const t = now();
  const ids: string[] = [];
  const stmts = results.slice(0, 60).map((r) => {
    const id = newId();
    ids.push(id);
    return c.env.DB.prepare(
      `INSERT INTO enrichment_results (id, account_id, prospect_id, provider, provider_ref, full_name, title, email, email_status, phone, linkedin_url, confidence, source_url, revealed, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      id, kind === "account" ? target.row.id : null, kind === "prospect" ? target.row.id : null, r.provider, b(r.provider_ref), b(r.full_name), b(r.title), b(r.email), b(r.email_status),
      b(r.phone), b(r.linkedin_url), b(r.confidence), b(r.source_url), r.revealed ? 1 : 0, user.id, t,
    );
  });
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json({ data: { found: ids.length, errors } });
});

discoveryRoutes.get("/:kind{accounts|prospects}/:id/enrichment", async (c) => {
  const kind = c.req.param("kind") === "accounts" ? "account" : "prospect";
  const target = await enrichmentTarget(c, kind, c.req.param("id"));
  const r = await c.env.DB.prepare(`SELECT * FROM enrichment_results WHERE ${kind}_id = ? ORDER BY created_at DESC, provider LIMIT 200`).bind(target.row.id).all();
  return c.json({ data: r.results });
});

async function loadResult(c: Context<AppEnv>, id: string) {
  const r = await c.env.DB.prepare("SELECT * FROM enrichment_results WHERE id = ?").bind(id).first<Row>();
  if (!r) throw notFound("Result");
  await (r.account_id ? fetchOne(c, ENTITIES.accounts, String(r.account_id)) : fetchOne(c, ENTITIES.prospects, String(r.prospect_id)));
  return r;
}

discoveryRoutes.post("/enrichment-results/:id/reveal", async (c) => {
  const r = await loadResult(c, c.req.param("id"));
  const via = c.req.query("via") ?? String(r.provider);
  let patch: Partial<FoundPerson>;
  if (via === "apollo" && r.provider === "apollo") patch = await apolloReveal(c.env, String(r.provider_ref));
  else if (via === "rocketreach" && r.provider === "rocketreach") patch = await rocketreachReveal(c.env, String(r.provider_ref));
  else if (via === "lusha") {
    const parent = r.account_id
      ? await c.env.DB.prepare("SELECT website FROM accounts WHERE id = ?").bind(r.account_id).first<Row>()
      : await c.env.DB.prepare("SELECT website FROM prospects WHERE id = ?").bind(r.prospect_id).first<Row>();
    const domain = domainOf(parent?.website as string);
    if (!r.full_name || !domain) throw new ApiError(400, "validation_error", "Lusha needs the person's full name and the company website");
    patch = await lushaPerson(c.env, String(r.full_name), domain);
  } else throw new ApiError(400, "validation_error", "This result cannot be revealed with that provider");
  await c.env.DB.prepare(
    "UPDATE enrichment_results SET full_name = COALESCE(?, full_name), title = COALESCE(?, title), email = COALESCE(?, email), email_status = COALESCE(?, email_status), phone = COALESCE(?, phone), linkedin_url = COALESCE(?, linkedin_url), revealed = 1 WHERE id = ?",
  )
    .bind(b(patch.full_name), b(patch.title), b(patch.email), b(patch.email_status != null ? String(patch.email_status) : null), b(patch.phone), b(patch.linkedin_url), r.id)
    .run();
  return c.json({ data: await c.env.DB.prepare("SELECT * FROM enrichment_results WHERE id = ?").bind(r.id).first() });
});

discoveryRoutes.post("/enrichment-results/:id/save", async (c) => {
  const r = await loadResult(c, c.req.param("id"));
  if (r.saved_contact_id) throw new ApiError(409, "already_saved", "Already saved as a contact");
  const input = await parseJson(c, saveEnrichmentSchema);
  const user = c.get("user");
  const email = normalizeEmail(r.email as string);
  const phone = normalizePhone(r.phone as string);
  if (email || phone) {
    const dup = await c.env.DB.prepare("SELECT id FROM contacts WHERE archived_at IS NULL AND ((? IS NOT NULL AND email_normalized = ?) OR (? IS NOT NULL AND phone_normalized = ?))")
      .bind(email, email, phone, phone)
      .first<{ id: string }>();
    if (dup) {
      await c.env.DB.prepare("UPDATE enrichment_results SET saved_contact_id = ? WHERE id = ?").bind(dup.id, r.id).run();
      return c.json({ data: { contact_id: dup.id, existing: true } });
    }
  }
  let accountId = (r.account_id as string) ?? null;
  if (!accountId && r.prospect_id) accountId = ((await c.env.DB.prepare("SELECT converted_account_id FROM prospects WHERE id = ?").bind(r.prospect_id).first<Row>())?.converted_account_id as string) ?? null;
  const id = newId();
  const t = now();
  const label = { website: "company website", hunter: "Hunter.io", apollo: "Apollo.io", rocketreach: "RocketReach", lusha: "Lusha" }[String(r.provider)] ?? String(r.provider);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO contacts (id, account_id, first_name, last_name, job_title, email, email_normalized, phone, phone_normalized, linkedin_url, owner_id, decision_role, status, source, notes, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'not_contacted', 'data_provider', ?, ?,?,?)`,
    ).bind(
      id, accountId, input.first_name, b(input.last_name), b(r.title), b(r.email), email, b(r.phone), phone, b(r.linkedin_url), user.id, b(input.decision_role),
      `Found via ${label}${r.email_status ? ` (email status: ${r.email_status})` : ""}${r.source_url ? ` — ${r.source_url}` : ""}. Verify before outreach.`, user.id, t, t,
    ),
    c.env.DB.prepare("UPDATE enrichment_results SET saved_contact_id = ? WHERE id = ?").bind(id, r.id),
    ...(r.prospect_id && !accountId
      ? [c.env.DB.prepare("UPDATE prospects SET contact_name = COALESCE(contact_name, ?), contact_title = COALESCE(contact_title, ?), email = COALESCE(email, ?), phone = COALESCE(phone, ?), updated_at = ? WHERE id = ?").bind(`${input.first_name}${input.last_name ? ` ${input.last_name}` : ""}`, b(r.title), b(r.email), b(r.phone), t, r.prospect_id)]
      : []),
    activityStmt(c.env.DB, { type: "system", subject: `Contact found via ${label}: ${input.first_name} ${input.last_name ?? ""}`.trim(), actorId: user.id, accountId, contactId: id, prospectId: (r.prospect_id as string) ?? null }),
  ]);
  return c.json({ data: { contact_id: id, existing: false } }, 201);
});

// ─── Qualification ───
async function scoreProspect(c: Context<AppEnv>, id: string) {
  const p = await c.env.DB.prepare("SELECT * FROM prospects WHERE id = ?").bind(id).first<Row>();
  if (!p) throw notFound("Prospect");
  const [campaign, touches, replied] = await c.env.DB.batch<Row>([
    c.env.DB.prepare("SELECT target_industry, target_geography FROM campaigns WHERE id = ?").bind(p.campaign_id ?? ""),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM activities WHERE prospect_id = ? AND type IN ('call','email','meeting','linkedin','whatsapp')").bind(id),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM outreach_messages WHERE prospect_id = ? AND status = 'replied'").bind(id),
  ]);
  const q = computeQualification({ ...(p as Record<string, string>), campaign: (campaign.results[0] as never) ?? null, touches: Number(touches.results[0]?.n ?? 0), replied: Number(replied.results[0]?.n ?? 0) > 0 });
  await c.env.DB.prepare("UPDATE prospects SET qualification_score = ?, qualification_level = ?, qualification_factors = ?, qualification_scored_at = ? WHERE id = ?")
    .bind(q.score, q.level, JSON.stringify(q.factors), now(), id)
    .run();
  return q;
}

discoveryRoutes.post("/prospects/:id/score", async (c) => {
  await fetchOne(c, ENTITIES.prospects, c.req.param("id"));
  return c.json({ data: await scoreProspect(c, c.req.param("id")) });
});

discoveryRoutes.post("/prospects/rescore", async (c) => {
  const user = c.get("user");
  const r = await c.env.DB.prepare(`SELECT id FROM prospects WHERE archived_at IS NULL AND status NOT IN ('converted','disqualified') ${isManager(user) ? "" : "AND owner_id = ?"} LIMIT 500`)
    .bind(...(isManager(user) ? [] : [user.id]))
    .all<{ id: string }>();
  for (const p of r.results) await scoreProspect(c, p.id);
  return c.json({ data: { scored: r.results.length } });
});

discoveryRoutes.post("/prospects/:id/qualification-override", async (c) => {
  const p = await fetchOne(c, ENTITIES.prospects, c.req.param("id"));
  const input = await parseJson(c, qualificationOverrideSchema);
  if (input.level && !input.reason) throw new ApiError(400, "validation_error", "Give a reason for overriding the calculated level");
  const user = c.get("user");
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE prospects SET qualification_override = ?, qualification_override_reason = ?, updated_at = ? WHERE id = ?").bind(input.level, input.level ? input.reason : null, now(), p.id),
    auditStmt(c.env.DB, { actorId: user.id, action: "qualification_override", entityType: "prospect", entityId: String(p.id), summary: input.level ? `Override → ${input.level}: ${input.reason}` : "Override removed", ip: clientIp(c) }),
  ]);
  return c.json({ data: { ok: true } });
});

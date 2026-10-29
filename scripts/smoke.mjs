// End-to-end API smoke test against a running dev server (npm run dev).
// Usage: node scripts/smoke.mjs [baseUrl]
// Uses the local test administrator documented in DEVELOPMENT.md; override with
// SMOKE_ADMIN_EMAIL / SMOKE_ADMIN_PASSWORD. Creates uniquely-named records each run.
const BASE = process.argv[2] ?? "http://localhost:5173";
const ADMIN = { email: process.env.SMOKE_ADMIN_EMAIL ?? "admin@gexart.test", password: process.env.SMOKE_ADMIN_PASSWORD ?? "LocalDevOnly-2026" };
const run = Date.now().toString(36);
let failures = 0;

function client() {
  let cookie = "";
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(`${BASE}/api/v1${path}`, {
      method,
      headers: { "content-type": "application/json", "x-requested-with": "gexart-crm", cookie, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { call, get: (p) => call("GET", p), post: (p, b = {}, h) => call("POST", p, b, h), patch: (p, b) => call("PATCH", p, b) };
}

function check(name, cond, extra) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}`, extra === undefined ? "" : JSON.stringify(extra).slice(0, 300));
  }
}

const admin = client();
const login = await admin.post("/auth/login", ADMIN);
check("admin can sign in", login.status === 200, login.body);
if (login.status !== 200) process.exit(1);

console.log("Security");
const anon = client();
check("unauthenticated list is rejected (401)", (await anon.get("/accounts")).status === 401);
check("mutation without CSRF header is rejected (403)", (await admin.call("POST", "/accounts", { name: "x" }, { "x-requested-with": "" })).status === 403);
check("cross-origin mutation is rejected (403)", (await admin.call("POST", "/accounts", { name: "x" }, { origin: "https://evil.example" })).status === 403);
check("validation errors are reported per field", (await admin.post("/accounts", { name: "" })).body?.error?.code === "validation_error");

console.log("Users & roles");
const repEmail = `rep-${run}@gexart.test`;
const rep = await admin.post("/users", { email: repEmail, name: `Rep ${run}`, role: "rep", password: "RepPassword-123" });
check("admin creates a sales rep", rep.status === 201, rep.body);
const repClient = client();
check("rep can sign in", (await repClient.post("/auth/login", { email: repEmail, password: "RepPassword-123" })).status === 200);
check("rep cannot create users (403)", (await repClient.post("/users", { email: `x-${run}@gexart.test`, name: "x", role: "admin", password: "abcdefghijk" })).status === 403);
check("rep cannot edit the product catalogue (403)", (await repClient.post("/products", { name: "X", sku: `X-${run}`, category: "other" })).status === 403);
const prodList = await repClient.get("/products?pageSize=1");
check("rep does not receive internal product cost", prodList.body.data[0] && !("internal_cost_minor" in prodList.body.data[0]), prodList.body.data[0]);

console.log("Accounts, duplicates & scoping");
const acc = await admin.post("/accounts", { name: `Smoke Hospital ${run}`, website: `smoke-${run}.example`, city: "Kolkata" });
check("admin creates account", acc.status === 201, acc.body);
const dup = await admin.post("/accounts", { name: `Smoke Hospital ${run} Pvt Ltd`, website: `https://www.smoke-${run}.example/` });
check("duplicate account is flagged (409 possible_duplicate)", dup.status === 409 && dup.body.error.code === "possible_duplicate", dup.body);
check("rep cannot see an account owned by someone else (404)", (await repClient.get(`/accounts/${acc.body.data.id}`)).status === 404);
const repAcc = await repClient.post("/accounts", { name: `Rep Account ${run}` });
check("rep's own account is assigned to the rep", repAcc.body.data?.owner_id === rep.body.data.id, repAcc.body);
const repList = await repClient.get("/accounts?pageSize=100");
check("rep list only contains own accounts", repList.body.data.every((a) => a.owner_id === rep.body.data.id));

console.log("Contacts");
const phoneA = `+91 9${String(Date.now()).slice(-9)}`;
const c1 = await admin.post("/contacts", { first_name: "Asha", last_name: "Roy", email: `asha.${run}@smoke.example`, phone: phoneA, account_id: acc.body.data.id, decision_role: "decision_maker" });
check("contact created", c1.status === 201, c1.body);
const c2 = await admin.post("/contacts", { first_name: "A.", email: `ASHA.${run}@SMOKE.EXAMPLE` });
check("duplicate email (case-insensitive) is flagged", c2.status === 409, c2.body);

console.log("Prospect conversion");
const camp = await admin.post("/campaigns", { name: `Smoke campaign ${run}`, code: `SM-${run}`, type: "prospecting", status: "active" });
check("campaign created", camp.status === 201, camp.body);
const pr = await admin.post("/prospects", { company_name: `Prospect Co ${run}`, website: `prospect-${run}.example`, contact_name: "Ravi Sen", email: `ravi.${run}@prospect.example`, campaign_id: camp.body.data.id, discovery_source: "manual" });
check("prospect created", pr.status === 201, pr.body);
check("prospect cannot be set to converted by edit", (await admin.patch(`/prospects/${pr.body.data.id}`, { status: "converted" })).status === 400);
check("unqualified prospect cannot be converted", (await admin.post(`/prospects/${pr.body.data.id}/convert`, { account_mode: "create" })).status === 400);
await admin.post("/activities", { type: "note", subject: "Research note", prospect_id: pr.body.data.id });
await admin.patch(`/prospects/${pr.body.data.id}`, { status: "qualified" });
const [conv1, conv2] = await Promise.all([
  admin.post(`/prospects/${pr.body.data.id}/convert`, { account_mode: "create", create_contact: true }),
  admin.post(`/prospects/${pr.body.data.id}/convert`, { account_mode: "create", create_contact: true }),
]);
const ok = [conv1, conv2].filter((r) => r.status === 200);
check("concurrent double conversion yields exactly one success", ok.length === 1, [conv1.status, conv2.status, conv1.body, conv2.body]);
const conv = ok[0]?.body.data;
if (conv) {
  const newAcc = await admin.get(`/accounts/${conv.account_id}`);
  check("converted account keeps campaign attribution", newAcc.body.data.source_campaign_id === camp.body.data.id, newAcc.body.data);
  const tl = await admin.get(`/activities?account_id=${conv.account_id}`);
  check("prospect history appears on the account timeline", tl.body.data.some((a) => a.subject === "Research note") && tl.body.data.some((a) => a.type === "conversion"));
  check("contact created from prospect", !!conv.contact_id);
  const accs = await admin.get(`/accounts?q=${encodeURIComponent(`Prospect Co ${run}`)}`);
  check("no duplicate account was created", accs.body.meta.total === 1, accs.body.meta);
}

console.log("Opportunities & tasks");
const opp = await admin.post("/opportunities", { name: `Smoke deal ${run}`, account_id: acc.body.data.id, amount_minor: 50000000, primary_contact_id: c1.body.data.id });
check("opportunity created with default probability", opp.status === 201 && opp.body.data.probability === 5, opp.body);
check("primary contact from another account is rejected", (await admin.post("/opportunities", { name: "Bad", account_id: repAcc.body.data.id, primary_contact_id: c1.body.data.id })).status === 400);
const moved = await admin.patch(`/opportunities/${opp.body.data.id}`, { stage: "proposal_sent" });
check("stage change updates probability", moved.body.data?.probability === 60, moved.body);
const oppTl = await admin.get(`/activities?opportunity_id=${opp.body.data.id}`);
check("stage change is recorded on the timeline", oppTl.body.data.some((a) => a.type === "stage_change"));
const won = await admin.patch(`/opportunities/${opp.body.data.id}`, { stage: "closed_won", win_loss_reason: "Strong audit evidence" });
check("closing a deal sets closed_at", !!won.body.data?.closed_at, won.body);
const task = await admin.post("/tasks", { title: `Call ${run}`, type: "follow_up_call", account_id: acc.body.data.id, due_at: new Date(Date.now() - 3600_000).toISOString() });
check("task created", task.status === 201, task.body);
const done = await admin.patch(`/tasks/${task.body.data.id}`, { status: "completed", outcome: "Agreed to a meeting" });
check("completing a task sets completed_at", !!done.body.data?.completed_at, done.body);
check("completed task is not silently reopened (409)", (await admin.patch(`/tasks/${task.body.data.id}`, { status: "open" })).status === 409);
check("explicit reopen is allowed", (await admin.patch(`/tasks/${task.body.data.id}`, { status: "open", reopen: true })).status === 200);

console.log("Service fit, insights, dashboard, search");
const prods = await admin.get("/products?q=SEO");
const seo = prods.body.data.find((p) => p.sku === "GX-MKT-SEO");
check("seeded catalogue contains SEO", !!seo);
check("assessment saved", (await admin.call("PUT", `/accounts/${acc.body.data.id}/assessments/${seo.id}`, { status: "proposed", note: "Sent SEO proposal" })).status === 200);
const ins = await admin.get(`/accounts/${acc.body.data.id}/insights`);
check("insights list SEO as pitched", ins.body.data.services_pitched.some((s) => s.sku === "GX-MKT-SEO"), ins.body.data.services_pitched);
check("insights know the decision-maker", ins.body.data.has_decision_maker === true);
const dash = await admin.get(`/dashboard?from=${new Date(Date.now() - 86400_000).toISOString()}&to=${new Date(Date.now() + 60_000).toISOString()}`);
check("dashboard counts the won deal in period", dash.body.data.kpis.won_count >= 1, dash.body.data.kpis);
const s = await admin.get(`/search?q=${run}`);
check("global search finds records across entities", new Set(s.body.data.map((r) => r.kind)).size >= 3, s.body.data.map((r) => r.kind));
const audit = await admin.post(`/accounts/${acc.body.data.id}/audits`, { audit_type: "competitor" });
check("competitor audit needs competitors first", audit.status === 400 && audit.body.error.code === "no_competitors", audit.body);
const ssrf = await admin.post(`/accounts/${acc.body.data.id}/audits`, { audit_type: "website", target: "http://127.0.0.1:8080" });
check("private-network audit targets are refused", ssrf.status === 400, ssrf.body);
const logs = await admin.get(`/audit-logs?entity_type=prospect&entity_id=${pr.body.data.id}`);
check("conversion is in the audit log", logs.body.data.some((l) => l.action === "convert"));

console.log("Outreach Centre (Phase 3)");
const tpls = await admin.get("/templates?pageSize=100");
check("starter templates are seeded", tpls.body.data.some((t) => t.id === "tpl_intro"));
const badTpl = await admin.post("/templates", { name: `Bad ${run}`, subject: "Hi {{first_name}}", body: "x" });
check("template with an unsupported placeholder is rejected", badTpl.status === 400 && badTpl.body.error.code === "unknown_placeholder", badTpl.body);
const r1 = await admin.post("/outreach/render", { template_id: "tpl_intro", contact_id: c1.body.data.id, product_id: seo.id });
check("template renders for the recipient", r1.body.data?.body.text.includes("Hi Asha") && r1.body.data.subject.text.includes(`Smoke Hospital ${run}`) && r1.body.data.body.missing.length === 0, r1.body);
check("render returns the recipient's email", r1.body.data?.recipient.email === `asha.${run}@smoke.example`);
const r2 = await admin.post("/outreach/render", { template_id: "tpl_intro", contact_id: c1.body.data.id });
check("missing service is reported, not invented", r2.body.data?.body.missing.includes("service_name") && r2.body.data.body.text.includes("{{service_name}}"), r2.body.data?.body);
const draftBad = await admin.post("/outreach", { title: "Unresolved", contact_id: c1.body.data.id, subject: "Hi", body: r2.body.data.body.text });
check("draft with unresolved placeholders can be saved", draftBad.status === 201, draftBad.body);
check("draft takes the contact's account", draftBad.body.data?.account_id === acc.body.data.id);
check("approving with unresolved placeholders is refused", (await admin.patch(`/outreach/${draftBad.body.data.id}`, { status: "approved" })).status === 400);
check("marking sent with unresolved placeholders is refused", (await admin.post(`/outreach/${draftBad.body.data.id}/mark-sent`, { confirm: true })).status === 400);
check("Brevo channel is refused until implemented", (await admin.post("/outreach", { title: "B", channel: "brevo", contact_id: c1.body.data.id, body: "x" })).status === 400);
const draft = await admin.post("/outreach", { title: `Intro ${run}`, contact_id: c1.body.data.id, product_id: seo.id, template_id: "tpl_intro", subject: r1.body.data.subject.text, body: r1.body.data.body.text });
check("clean draft created", draft.status === 201 && draft.body.data.status === "draft", draft.body);
check("mark-sent requires explicit confirmation", (await admin.post(`/outreach/${draft.body.data.id}/mark-sent`, {})).status === 400);
const followAt = new Date(Date.now() + 3 * 86400_000).toISOString();
const [s1, s2] = await Promise.all([
  admin.post(`/outreach/${draft.body.data.id}/mark-sent`, { confirm: true, next_follow_up_at: followAt }),
  admin.post(`/outreach/${draft.body.data.id}/mark-sent`, { confirm: true, next_follow_up_at: followAt }),
]);
const okSends = [s1, s2].filter((r) => r.status === 200);
check("concurrent confirmations record exactly one send", okSends.length === 1, [s1.status, s2.status]);
check("send is recorded as manual (not via integration)", okSends[0]?.body.data.sent_via_integration === 0 && okSends[0]?.body.data.status === "sent");
const ctAfter = await admin.get(`/contacts/${c1.body.data.id}`);
check("contact marked contacted with last-contacted date", ctAfter.body.data.status === "contacted" && !!ctAfter.body.data.last_contacted_at, ctAfter.body.data);
const ctTl = await admin.get(`/activities?contact_id=${c1.body.data.id}`);
check("exactly one email activity on the contact timeline", ctTl.body.data.filter((a) => a.type === "email" && a.subject.includes("sent")).length === 1);
const fu = await admin.get(`/tasks?contact_id=${c1.body.data.id}&open=1`);
check("follow-up task created once", fu.body.data.filter((t) => t.title.startsWith("Follow up: Intro")).length === 1, fu.body.data.map((t) => t.title));
check("sent message content is locked", (await admin.patch(`/outreach/${draft.body.data.id}`, { body: "changed" })).status === 409);
check("rep cannot see another user's outreach", (await repClient.get(`/outreach/${draft.body.data.id}`)).status === 404);
const reply = await admin.post(`/outreach/${draft.body.data.id}/record-response`, { outcome: "replied", note: "Interested, call next week" });
check("reply recorded", reply.body.data?.status === "replied" && !!reply.body.data.replied_at, reply.body);
check("contact moves to responded", (await admin.get(`/contacts/${c1.body.data.id}`)).body.data.status === "responded");
const dash2 = await admin.get(`/dashboard?from=${new Date(Date.now() - 86400_000).toISOString()}&to=${new Date(Date.now() + 60_000).toISOString()}`);
check("dashboard counts confirmed sends and reply rate, not drafts", dash2.body.data.kpis.messages_sent >= 1 && dash2.body.data.kpis.reply_rate !== null && dash2.body.data.kpis.messages_unsent >= 1, dash2.body.data.kpis);

console.log("Sequences");
check("rep cannot create sequences", (await repClient.post("/sequences", { name: "x", steps: [{ day_offset: 0, channel: "phone" }] })).status === 403);
check("sequence without steps is refused", (await admin.post("/sequences", { name: `Empty ${run}` })).status === 400);
const c3 = await admin.post("/contacts", { first_name: "Neel", email: `neel.${run}@smoke.example`, account_id: acc.body.data.id });
const enr = await admin.post("/sequences/seq_standard/enroll", { contact_id: c3.body.data.id, start_date: "2026-11-02", product_id: seo.id });
check("enrollment schedules 4 tasks and 3 drafts", enr.status === 201 && enr.body.data.tasks === 4 && enr.body.data.drafts === 3, enr.body);
check("double enrollment is refused", (await admin.post("/sequences/seq_standard/enroll", { contact_id: c3.body.data.id, start_date: "2026-11-02" })).status === 409);
const seqTasks = await admin.get(`/tasks?contact_id=${c3.body.data.id}&sort=due_at&dir=asc`);
check("first step due 09:00 IST on the start date", seqTasks.body.data[0]?.due_at === "2026-11-02T03:30:00.000Z", seqTasks.body.data[0]);
check("day-14 step lands on 15 Nov", seqTasks.body.data.at(-1)?.due_at === "2026-11-15T03:30:00.000Z", seqTasks.body.data.at(-1));
const seqDrafts = await admin.get(`/outreach?contact_id=${c3.body.data.id}`);
check("sequence drafts are personalised and unsent", seqDrafts.body.data.length === 3 && seqDrafts.body.data.every((m) => m.status === "draft" && !m.body.includes("{{")), seqDrafts.body.data.map((m) => m.status));
const det = await admin.get("/sequences/seq_standard/detail");
const myEnr = det.body.data.enrollments.find((e) => e.contact_id === c3.body.data.id);
check("stop enrollment", (await admin.post(`/sequence-enrollments/${myEnr.id}/stop`)).status === 200);
const afterStop = await admin.get(`/tasks?contact_id=${c3.body.data.id}&open=1`);
const draftsAfter = await admin.get(`/outreach?contact_id=${c3.body.data.id}&unsent=1`);
check("stopping cancels remaining tasks and drafts", afterStop.body.meta.total === 0 && draftsAfter.body.meta.total === 0, [afterStop.body.meta, draftsAfter.body.meta]);


// ─────────────────────────────── Phase 4 / C / D / E / 5 ───────────────────────────────
const { PDFDocument } = await import("pdf-lib");
async function upload(c, path, fields, file) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  if (file) fd.set(file.field ?? "file", new Blob([file.bytes], { type: file.type }), file.name);
  const res = await fetch(`${BASE}/api/v1${path}`, { method: "POST", headers: { "x-requested-with": "gexart-crm", ...(c.headers ?? {}) }, body: fd });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const cookieOf = async (email, password) => {
  const r = await fetch(`${BASE}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "gexart-crm" }, body: JSON.stringify({ email, password }) });
  return { headers: { cookie: r.headers.get("set-cookie").split(";")[0] } };
};
const adminC = await cookieOf(ADMIN.email, ADMIN.password);
const repC = await cookieOf(repEmail, "RepPassword-123");

console.log("Price book & line items");
const pkg = await admin.post("/packages", { product_id: seo.id, name: `Growth ${run}`, price_minor: 2500000, billing_frequency: "monthly", deliverables: "Technical fixes\nMonthly report", timeline: "3 months" });
check("manager creates a priced package", pkg.status === 201, pkg.body);
check("rep cannot edit the price book", (await repClient.post("/packages", { product_id: seo.id, name: "x" })).status === 403);
const book = await admin.get("/price-book");
check("price book lists the package under its service", book.body.data.find((p) => p.id === seo.id)?.packages.some((k) => k.id === pkg.body.data.id));
const opp2 = await admin.post("/opportunities", { name: `Line items ${run}`, account_id: acc.body.data.id });
await admin.post(`/opportunities/${opp2.body.data.id}/items`, { product_id: seo.id, package_id: pkg.body.data.id, quantity: 1, unit_price_minor: 2500000, discount_pct: 10, billing_frequency: "monthly" });
const applied = await admin.post(`/opportunities/${opp2.body.data.id}/items/apply-total`);
check("deal value = first-year value of line items (monthly × 12, after discount)", applied.body.data?.amount_minor === 2250000 * 12, applied.body.data?.amount_minor);

console.log("Sales assets");
const pdfDoc = await PDFDocument.create();
pdfDoc.addPage();
const pdfBytes = await pdfDoc.save();
const up = await upload(adminC, "/assets/upload", { name: `Brochure ${run}`, type: "brochure", visibility: "confidential", link_type: "account", link_id: acc.body.data.id }, { bytes: pdfBytes, type: "application/pdf", name: "brochure.pdf" });
check("PDF upload stored privately", up.status === 201 && up.body.data.version === 1, up.body);
check("disallowed file types are rejected", (await upload(adminC, "/assets/upload", { type: "other" }, { bytes: new TextEncoder().encode("<script>"), type: "text/html", name: "x.html" })).status === 400);
const dl = await fetch(`${BASE}/api/v1/assets/${up.body.data.id}/download`, adminC);
check("download streams the file with its type", dl.status === 200 && dl.headers.get("content-type") === "application/pdf" && (await dl.arrayBuffer()).byteLength === pdfBytes.byteLength);
check("rep cannot see another user's confidential asset", (await repClient.get(`/assets/${up.body.data.id}`)).status === 404);
const v2 = await upload(adminC, "/assets/upload", { previous_version_id: up.body.data.id, type: "brochure" }, { bytes: pdfBytes, type: "application/pdf", name: "brochure-v2.pdf" });
check("new version increments and keeps links", v2.body.data?.version === 2 && v2.body.data?.link_count === 1, v2.body);
check("new version keeps name and confidential visibility", v2.body.data?.name === `Brochure ${run}` && v2.body.data?.visibility === "confidential", v2.body.data);
check("version history lists both versions", (await admin.get(`/assets/${v2.body.data.id}/versions`)).body.data.length === 2);
check("library shows only the latest version", !(await admin.get(`/assets?latest=1&q=${encodeURIComponent(`Brochure ${run}`)}`)).body.data.some((a) => a.id === up.body.data.id));

console.log("CSV import & export");
const csv = `Business Name,Website,City,Email,Mobile\nImport One ${run},one-${run}.example,Kolkata,info@one-${run}.example,+91 90000 11111\nImport Two ${run},two-${run}.example,Howrah,not-an-email,\nProspect Co ${run},,Kolkata,,\nImport One ${run} Pvt Ltd,,Kolkata,,\n`;
const prev = await admin.post("/imports/prospects/preview", { csv, file_name: "smoke.csv" });
check("preview validates, maps and flags duplicates", prev.status === 200 && prev.body.data.counts.valid === 1 && prev.body.data.counts.error === 1 && prev.body.data.counts.duplicate === 2, prev.body?.data?.counts ?? prev.body);
const commit = await admin.post(`/imports/${prev.body.data.id}/commit`, { rows: prev.body.data.rows.map((r) => r.index), campaign_id: camp.body.data.id });
check("only valid rows are imported", commit.body.data?.created === 1, commit.body);
check("an import cannot be committed twice", (await admin.post(`/imports/${prev.body.data.id}/commit`, { rows: [0] })).status === 409);
const imported = await admin.get(`/prospects?q=${encodeURIComponent(`Import One ${run}`)}`);
check("imported prospect is scored and attributed", imported.body.data[0]?.qualification_score !== null && imported.body.data[0]?.campaign_id === camp.body.data.id, imported.body.data[0]);
const exp = await fetch(`${BASE}/api/v1/imports/export/prospects.csv`, adminC);
const expText = await exp.text();
check("export returns CSV with a header row", exp.status === 200 && expText.includes("company_name") && expText.includes(`Import One ${run}`));
const repExp = await (await fetch(`${BASE}/api/v1/imports/export/products.csv`, repC)).text();
check("rep export omits internal cost", !repExp.split("\n")[0].includes("internal_cost"));

console.log("Discovery, contact finder & qualification");
const disc = await admin.post("/discovery/search", { query: "hospitals", location: "Kolkata" });
check("Places search without a key fails clearly", disc.status === 400 && disc.body.error.code === "not_configured", disc.body);
const enrich = await admin.post(`/accounts/${acc.body.data.id}/enrich`, { providers: ["website", "hunter"] });
check("contact finder reports per-provider errors instead of failing", enrich.status === 200 && enrich.body.data.errors.length === 2, enrich.body);
const sc = await admin.post(`/prospects/${pr.body.data.id}/score`);
check("qualification score explains its factors", sc.body.data?.factors?.length === 10, sc.body);
check("override requires a reason", (await admin.post(`/prospects/${pr.body.data.id}/qualification-override`, { level: "high" })).status === 400);
check("override with reason is saved", (await admin.post(`/prospects/${pr.body.data.id}/qualification-override`, { level: "high", reason: "Met the owner at an event" })).status === 200);

console.log("Audits (new types)");
check("GBP audit without a Places key is refused", (await admin.post(`/accounts/${acc.body.data.id}/audits`, { audit_type: "gbp" })).body?.error?.code === "not_configured");
const comp = await admin.post(`/accounts/${acc.body.data.id}/competitors`, { name: `Rival ${run}`, website: `rival-${run}.example` });
check("competitor added", comp.status === 201, comp.body);
check("private-network competitor sites are refused", (await admin.post(`/accounts/${acc.body.data.id}/competitors`, { name: "LAN", website: "http://192.168.1.10" })).status === 400);
const types = await admin.get("/audits/types");
check("seven audit types are registered and runnable", types.body.data.length === 7 && types.body.data.every((t) => t.implemented));

console.log("Sales material");
const pitch = await admin.post(`/accounts/${acc.body.data.id}/pitch`, { formats: ["sales_email", "cold_call_script", "whatsapp"], product_ids: [seo.id], use_ai: false });
check("template pitch generated for each format", pitch.status === 201 && pitch.body.data.sections.length === 3 && pitch.body.data.generator === "template", pitch.body);
check("pitch pricing comes from the price book", JSON.stringify(pitch.body.data.pricing).includes("25,000"));
const prop = await admin.post(`/accounts/${acc.body.data.id}/proposal`, { items: [{ product_id: seo.id, package_id: pkg.body.data.id, quantity: 1 }], validity_days: 15 });
check("PDF proposal generated", prop.status === 201, prop.body);
const pdfRes = await fetch(`${BASE}/api/v1/assets/${prop.body.data.asset_id}/download`, adminC);
const pdfBuf = new Uint8Array(await pdfRes.arrayBuffer());
check("proposal is a real PDF", new TextDecoder().decode(pdfBuf.slice(0, 5)) === "%PDF-" && (await PDFDocument.load(pdfBuf)).getPageCount() >= 2);
const outline = await admin.post(`/accounts/${acc.body.data.id}/deck-outline`, { template: "digital_marketing_proposal", product_ids: [seo.id], use_ai: false });
check("deck outline (template) has title, pricing and closing slides", outline.body.data?.slides?.[0]?.layout === "title" && outline.body.data.slides.at(-1).layout === "closing" && outline.body.data.slides.some((s) => s.title === "Investment"), outline.body);
check("deck upload rejects non-pptx files", (await upload(adminC, `/accounts/${acc.body.data.id}/decks`, { title: "x" }, { bytes: pdfBytes, type: "application/pdf", name: "x.pdf" })).status === 400);
const PptxGenJS = (await import("pptxgenjs")).default;
const deck = new PptxGenJS();
deck.addSlide().addText("Smoke", { x: 1, y: 1, w: 4, h: 1 });
const pptxBytes = await deck.write({ outputType: "uint8array" });
const deckUp = await upload(adminC, `/accounts/${acc.body.data.id}/decks`, { title: `Deck ${run}`, template: "custom", generator: "template", outline: "[]" }, { bytes: pptxBytes, type: "application/vnd.openxmlformats-officedocument.presentationml.presentation", name: "deck.pptx" });
check("generated .pptx saved as a pitch-deck asset", deckUp.status === 201, deckUp.body);
check("generated documents are listed on the account", (await admin.get(`/accounts/${acc.body.data.id}/documents`)).body.data.length >= 2);

console.log("Integrations & Brevo");
const integ = await admin.get("/integrations");
check("integration hub lists all providers with honest status", integ.body.data.length >= 11 && integ.body.data.find((i) => i.provider === "brevo").status === "not_configured");
check("reps cannot open the integration hub", (await repClient.get("/integrations")).status === 403);
check("every user can see which features are available", (await repClient.get("/integrations/available")).body.data?.enrichment?.website === true);
check("reps cannot validate integrations", (await repClient.post("/integrations/hunter/validate")).status === 403);
const approved = await admin.post("/outreach", { title: `Brevo ${run}`, contact_id: c1.body.data.id, subject: "Hello", body: "Hi Asha", status: "approved" });
check("Brevo send is refused until connected", (await admin.post(`/outreach/${approved.body.data.id}/send-brevo`, { confirm: true })).body?.error?.code === "not_configured");
check("webhook rejects a missing secret", (await fetch(`${BASE}/api/v1/webhooks/brevo?token=x`, { method: "POST", body: "{}" })).status === 401);

console.log("Phone app (calls)");
const dev = await admin.post("/devices", { name: `Phone ${run}` });
check("device token created once", dev.status === 201 && dev.body.data.token.startsWith("gxd_"), dev.body);
const devH = { authorization: `Bearer ${dev.body.data.token}` };
const ping = await fetch(`${BASE}/api/v1/device/ping`, { headers: devH });
check("device token authenticates the app", ping.status === 200);
check("device API rejects missing tokens", (await fetch(`${BASE}/api/v1/device/ping`)).status === 401);
const look = await (await fetch(`${BASE}/api/v1/device/lookup?phone=${encodeURIComponent(phoneA.replace(/\s/g, ""))}`, { headers: devH })).json();
check("lookup recognises a CRM contact's number", look.data.known === true && look.data.name === "Asha Roy", look);
const audio = new Uint8Array(2048).fill(7);
const callFields = { phone_number: phoneA, direction: "outgoing", started_at: new Date(Date.now() - 600_000).toISOString(), duration_seconds: "185", client_ref: `smoke-${run}` };
const call1 = await upload({ headers: devH }, "/device/calls", callFields, { field: "audio", bytes: audio, type: "audio/mpeg", name: "call.mp3" });
check("phone upload is matched to the contact (no CSRF header needed for devices)", call1.status === 201 && call1.body.data.matched?.name === "Asha Roy", call1.body);
const call2 = await upload({ headers: devH }, "/device/calls", callFields, { field: "audio", bytes: audio, type: "audio/mpeg", name: "call.mp3" });
check("re-uploading the same call is idempotent", call2.body.data?.duplicate === true && call2.body.data.id === call1.body.data.id, call2.body);
const callList = await admin.get(`/calls?contact_id=${c1.body.data.id}`);
check("call appears for the contact", callList.body.data.some((x) => x.id === call1.body.data.id));
const audioRes = await fetch(`${BASE}/api/v1/calls/${call1.body.data.id}/audio`, { headers: { ...adminC.headers, range: "bytes=0-99" } });
check("recording streams with range support", audioRes.status === 206 && (await audioRes.arrayBuffer()).byteLength === 100);
check("rep cannot open another user's call", (await repClient.get(`/calls/${call1.body.data.id}`)).status === 404);
const ctTl2 = await admin.get(`/activities?contact_id=${c1.body.data.id}`);
check("call is logged on the contact timeline", ctTl2.body.data.some((a) => a.type === "call" && a.subject.includes("185") === false && a.subject.includes("Asha Roy")));
let callOne;
for (let i = 0; i < 30; i++) {
  callOne = await admin.get(`/calls/${call1.body.data.id}`);
  if (!["uploaded", "transcribing"].includes(callOne.body.data.status)) break;
  await new Promise((r) => setTimeout(r, 1000));
}
check("without Workers AI the call is marked failed with a clear reason", callOne.body.data.status === "failed" && /Workers AI/.test(callOne.body.data.error ?? ""), callOne.body.data);
await admin.post(`/devices/${dev.body.data.id}/revoke`);
check("revoked device can no longer connect", (await fetch(`${BASE}/api/v1/device/ping`, { headers: devH })).status === 401);

console.log("Configuration (CRM-managed keys)");
check("reps cannot read configuration", (await repClient.get("/settings/config")).status === 403);
const cfg0 = await admin.get("/settings/config");
check("admin sees every configuration section", cfg0.status === 200 && cfg0.body.data.sections.some((s) => s.id === "leads") && cfg0.body.data.values.length >= 15, cfg0.body);
const badCfg = await admin.call("PUT", "/settings/config", { values: { BREVO_SENDER_EMAIL: "not-an-email", QUOTA_CLAUDE: "-5" } });
check("invalid settings are rejected per field", badCfg.status === 400 && badCfg.body.error.details?.BREVO_SENDER_EMAIL && badCfg.body.error.details?.QUOTA_CLAUDE, badCfg.body);
check("unknown settings are rejected", (await admin.call("PUT", "/settings/config", { values: { EVIL: "x" } })).status === 400);
const secretVal = `smoke-hunter-${run}-ZQ91`;
const saveCfg = await admin.call("PUT", "/settings/config", { values: { HUNTER_API_KEY: secretVal, QUOTA_ENRICHMENT: "7" } });
check("admin saves a key and a limit together", saveCfg.status === 200 && saveCfg.body.data.changed.length === 2, saveCfg.body);
const cfg1 = await admin.get("/settings/config");
const hunterV = cfg1.body.data.values.find((v) => v.key === "HUNTER_API_KEY");
check("saved secret is never returned, only its last 4 characters", hunterV.source === "crm" && hunterV.value === null && hunterV.preview === "••••ZQ91" && !JSON.stringify(cfg1.body).includes(secretVal), hunterV);
check("plain settings are returned for editing", cfg1.body.data.values.find((v) => v.key === "QUOTA_ENRICHMENT").value === "7");
check("saved key takes effect without a redeploy", (await admin.get("/integrations/available")).body.data.enrichment.hunter === true);
const cfgLogs = await admin.get("/audit-logs");
check("audit log records which settings changed, never the value", cfgLogs.body.data.some((l) => l.action === "settings_update" && l.summary.includes("HUNTER_API_KEY")) && !JSON.stringify(cfgLogs.body).includes(secretVal));
await admin.call("PUT", "/settings/config", { values: { HUNTER_API_KEY: null, QUOTA_ENRICHMENT: null } });
const cfg2 = await admin.get("/settings/config");
check("removing a key falls back to the Worker value", cfg2.body.data.values.find((v) => v.key === "HUNTER_API_KEY").source === "none" && cfg2.body.data.values.find((v) => v.key === "QUOTA_ENRICHMENT").source === "worker", cfg2.body.data.values);
check("removed key is no longer active", (await admin.get("/integrations/available")).body.data.enrichment.hunter === false);

console.log("Phone app downloads");
check("non-APK uploads are rejected", (await upload(adminC, "/app-releases", { version_name: "0.0.1" }, { bytes: pdfBytes, type: "application/pdf", name: "x.apk" })).status === 400);
check("reps cannot publish builds", (await upload(repC, "/app-releases", { version_name: "0.0.1" }, { bytes: pptxBytes, type: "application/vnd.android.package-archive", name: "x.apk" })).status === 403);
const apk = await upload(adminC, "/app-releases", { version_name: `9.9.${run}`.slice(0, 20), notes: "Smoke build" }, { bytes: pptxBytes, type: "application/vnd.android.package-archive", name: "app.apk" });
check("admin publishes an APK", apk.status === 201 && apk.body.data.size_bytes === pptxBytes.byteLength && /^[0-9a-f]{64}$/.test(apk.body.data.sha256) && !("file_key" in apk.body.data), apk.body);
const relList = await repClient.get("/app-releases");
check("every user sees published builds", relList.status === 200 && relList.body.data.some((r) => r.id === apk.body.data.id));
const apkDl = await fetch(`${BASE}/api/v1/app-releases/${apk.body.data.id}/download`, { headers: repC.headers });
check("signed-in download is served as an Android package", apkDl.status === 200 && apkDl.headers.get("content-type") === "application/vnd.android.package-archive" && (await apkDl.arrayBuffer()).byteLength === pptxBytes.byteLength);
check("download needs sign-in", (await fetch(`${BASE}/api/v1/app-releases/${apk.body.data.id}/download`)).status === 401);
const qrLink = await repClient.post(`/app-releases/${apk.body.data.id}/link`);
check("QR link is issued for 30 minutes", qrLink.status === 200 && qrLink.body.data.url.includes("/api/v1/dl/android/") && new Date(qrLink.body.data.expires_at) > new Date(Date.now() + 25 * 60_000), qrLink.body);
const qrPath = new URL(qrLink.body.data.url).pathname + new URL(qrLink.body.data.url).search;
const pub = await fetch(`${BASE}${qrPath}`);
check("QR link downloads without a session", pub.status === 200 && (await pub.arrayBuffer()).byteLength === pptxBytes.byteLength);
check("tampered QR link is refused", (await fetch(`${BASE}${qrPath.replace(/sig=./, (m) => m.slice(0, -1) + (m.endsWith("0") ? "1" : "0"))}`)).status === 403);
check("expired QR link is refused", (await fetch(`${BASE}${qrPath.replace(/exp=\d+/, "exp=1000")}`)).status === 403);
const sync = await admin.post("/app-releases/sync");
check("GitHub import answers clearly (reachable or not)", (sync.status === 200 && typeof sync.body.data.message === "string") || sync.status === 502, sync.body);
check("reps cannot remove builds", (await repClient.call("DELETE", `/app-releases/${apk.body.data.id}`)).status === 403);
check("admin removes a build", (await admin.call("DELETE", `/app-releases/${apk.body.data.id}`)).status === 200);
check("removed build's QR link stops working", (await fetch(`${BASE}${qrPath}`)).status === 404);

console.log("Notifications");
const notes = await admin.get("/notifications");
check("notifications endpoint returns unread count", typeof notes.body.meta?.unread === "number");

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);

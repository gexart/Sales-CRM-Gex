// CRM account -> billing customer -> invoice, GSTIN lookup, and the rounding fix.  Usage: node scripts/billing-smoke-link.mjs [baseUrl]
import http from "node:http";
const BASE = process.argv[2] ?? "http://localhost:5173";
const ADMIN = { email: process.env.SMOKE_ADMIN_EMAIL ?? "admin@gexart.test", password: process.env.SMOKE_ADMIN_PASSWORD ?? "LocalDevOnly-2026" };
const run = Date.now().toString(36);
let failures = 0, ck = "";
const h = () => ({ cookie: ck, "x-requested-with": "gexart-crm", "content-type": "application/json" });
const call = async (m, p, b) => { const r = await fetch(`${BASE}/api/v1${p}`, { method: m, headers: h(), body: b ? JSON.stringify(b) : undefined }); const s = r.headers.get("set-cookie"); if (s) ck = s.split(";")[0]; return { status: r.status, body: await r.json().catch(() => null) }; };
const check = (n, c, x) => (c ? console.log(`  ✓ ${n}`) : (failures++, console.log(`  ✗ ${n}`, x === undefined ? "" : JSON.stringify(x).slice(0, 300))));
for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/v1/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 2000)); }
await call("POST", "/auth/login", { email: ADMIN.email, password: ADMIN.password });

console.log("GSTIN lookup");
const ok = (await call("GET", "/billing/masters/gstin/19AAMCK2340L1Z7")).body.details;
check("a valid GSTIN gives state and PAN", ok.valid && ok.stateName && ok.pan === "AAMCK2340L", ok);
check("without a provider it never invents a name", ok.source === "checksum_only" && !ok.legalName);
check("a wrong checksum is refused", (await call("GET", "/billing/masters/gstin/19AAMCK2340L1Z8")).body.details.valid === false);
const mock = http.createServer((req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ flag: true, taxpayerInfo: { lgnm: "KLOVE PRIVATE LIMITED", tradeNam: "Korigo Snacks", sts: "Active", pradr: { addr: { bno: "BLT-4", st: "Madurdaha", loc: "Kolkata", stcd: "West Bengal", pncd: "700107" } } } })); });
await new Promise((r) => mock.listen(8898, "127.0.0.1", r));
await call("PUT", "/settings/config", { values: { GSTIN_API_URL: "http://127.0.0.1:8898/verify?gstNo={gstin}&key_secret={key}", GSTIN_API_KEY: "testkey" } });
await new Promise((r) => setTimeout(r, 400));
const net = (await call("GET", "/billing/masters/gstin/19AACCJ6158P1ZU")).body.details;
check("with a provider the name and address fill in", net.source === "gst_network" && net.legalName === "KLOVE PRIVATE LIMITED" && net.tradeName === "Korigo Snacks" && /Kolkata/.test(net.address) && net.pincode === "700107", net);
await call("PUT", "/settings/config", { values: { GSTIN_API_URL: "", GSTIN_API_KEY: "" } });
mock.close();

console.log("CRM account to invoice");
const acc = await call("POST", "/accounts", { name: `Link Client ${run}`, legal_name: `Link Client ${run} Pvt Ltd`, email: "client@link.test", phone: "9876543210", address: "1 Park Street", city: "Kolkata", state: "West Bengal", postal_code: "700016" });
check("a CRM account exists", acc.status === 201 || acc.status === 200, acc.body);
const id = acc.body?.data?.id;
check("before linking it says so", (await call("GET", `/billing-access/from-account/${id}`)).body.data.linked === false);
const link = await call("POST", `/billing-access/from-account/${id}`, {});
check("the account becomes a billing customer", link.status === 201 && link.body.data.created === true && !!link.body.data.partyId, link.body);
const party = (await call("GET", `/billing/masters/parties/${link.body.data.partyId}`)).body;
const p = party.party ?? party;
check("its details were copied across", p.name === `Link Client ${run}` && p.company === `Link Client ${run} Pvt Ltd` && p.email === "client@link.test" && /Park Street/.test(p.billingAddress) && p.stateCode === "19", p);
check("doing it again reuses the same customer", (await call("POST", `/billing-access/from-account/${id}`, {})).body.data.partyId === link.body.data.partyId);
const unit = (await call("GET", "/billing/masters/units")).body.units[0];
const tax = (await call("GET", "/billing/masters/taxes")).body.taxRates.find((t) => t.rate_basis_points === 1800);
const item = (await call("POST", "/billing/masters/items", { name: `Link Service ${run}`, type: "SERVICE", unitId: unit.id, salePricePaise: 123457, taxRateId: tax.id, hsnSac: "9983" })).body.item;
const inv = await call("POST", "/billing/sales/invoices", { partyId: link.body.data.partyId, partyName: p.name, partyStateCode: "19", date: "2026-11-24", dueDate: "2026-12-24", paymentMode: "CREDIT", items: [{ itemId: item.id, name: item.name, hsnSac: "9983", quantityThousandths: 3000, unitId: unit.id, unitPricePaise: 123457, discountPaise: 0, taxRatePercent: 18 }] });
check("an invoice with awkward paise amounts saves (rounding fix)", inv.status === 201, inv.body);
const after = (await call("GET", `/billing-access/from-account/${id}`)).body.data;
check("the account now shows that invoice", after.linked && after.invoices?.length === 1 && after.totals.totalPendingPaise > 0, after);
const tb = (await call("GET", "/billing/accounting/trial-balance")).body;
check("the books balance", tb.isBalanced === true, tb.trialBalance?.differencePaise);

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll link checks passed");
process.exit(failures ? 1 : 0);

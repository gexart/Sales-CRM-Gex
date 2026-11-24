// Invoice documents, settings, drafts, credit/debit notes and purchases, with the permission rules around them.
// Usage: node scripts/billing-smoke-docs.mjs [baseUrl]   (needs `npm run dev` and the local test administrator)
const BASE = process.argv[2] ?? "http://localhost:5173";
const ADMIN = { email: process.env.SMOKE_ADMIN_EMAIL ?? "admin@gexart.test", password: process.env.SMOKE_ADMIN_PASSWORD ?? "LocalDevOnly-2026" };
const run = Date.now().toString(36);
const PW = "Smoke-Pass-2026!x";
let failures = 0;

function client() {
  let cookie = "";
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(`${BASE}/api/v1${path}`, { method, headers: { "content-type": "application/json", "x-requested-with": "gexart-crm", cookie, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const type = res.headers.get("content-type") || "";
    if (/pdf|officedocument/.test(type)) return { status: res.status, type, bytes: Buffer.from(await res.arrayBuffer()) };
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { get: (p) => call("GET", p), post: (p, b = {}, h) => call("POST", p, b, h), put: (p, b) => call("PUT", p, b), del: (p) => call("DELETE", p), login: async (e, p) => (await call("POST", "/auth/login", { email: e, password: p })).status === 200 };
}
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else (failures++, console.log(`  ✗ ${name}`, extra === undefined ? "" : JSON.stringify(extra).slice(0, 300)));
};
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`${BASE}/api/v1/health`)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 2000));
}
const admin = client();
await admin.login(ADMIN.email, ADMIN.password);
const roles = (await admin.get("/billing-access/roles")).body.data;
const mk = async (key, role) => {
  const email = `${key}.${run}@gexart.test`;
  const u = await admin.post("/users", { email, name: `${key} ${run}`, role: "rep", password: PW, send_welcome: false });
  await admin.put(`/billing-access/users/${u.body.data.id}`, { roleId: roles.find((r) => r.name === role).id, extra: [], denied: [] });
  const c = client();
  await c.login(email, PW);
  return { id: u.body.data.id, c };
};
const exec = await mk("docexec", "Sales Executive");
const agent = await mk("docagent", "Billing Agent");
const fin = await mk("docfin", "Finance Manager");

const unit = (await admin.get("/billing/masters/units")).body.units[0];
const tax = (await admin.get("/billing/masters/taxes")).body.taxRates.find((t) => t.rate_basis_points === 1800);
const party = (await admin.post("/billing/masters/parties", { name: `Doc Customer ${run}`, phone: "9876543210", type: "CUSTOMER", stateCode: "19", billingAddress: "1 Test Road\nKolkata" })).body.party;
const vendor = (await admin.post("/billing/masters/parties", { name: `Doc Vendor ${run}`, phone: "9876500001", type: "VENDOR", stateCode: "19" })).body.party;
const item = (await admin.post("/billing/masters/items", { name: `Doc Service ${run}`, type: "SERVICE", unitId: unit.id, salePricePaise: 250000, taxRateId: tax.id, hsnSac: "9983" })).body.item;
const invBody = { partyId: party.id, partyName: party.name, partyStateCode: "19", date: "2026-11-24", dueDate: "2026-12-24", paymentMode: "CREDIT", items: [{ itemId: item.id, name: item.name, hsnSac: "9983", quantityThousandths: 2000, unitId: unit.id, unitPricePaise: 250000, discountPaise: 0, taxRatePercent: 18 }], notes: "Thank you" };

console.log("Settings round trip");
const put = await admin.put("/billing/settings/billing", { company: { legalName: `Doc Co ${run}`, email: "a@b.test", website: "b.test", mobile: "+91 90000 00000" }, template: { id: "classic-black" }, notesTerms: { INVOICE: { notes: "N1", terms: "T1" } } });
check("administrator saves billing settings", put.status === 200, put);
const got = (await admin.get("/billing/settings/billing")).body.billing;
check("company, template and terms are stored", got.company.legalName === `Doc Co ${run}` && got.template.id === "classic-black" && got.notesTerms.INVOICE.terms === "T1");
check("finance manager can read settings", (await fin.c.get("/billing/settings/billing")).status === 200);
check("billing agent cannot read settings", (await agent.c.get("/billing/settings/billing")).status === 403);

console.log("Invoice PDF and Word");
const inv = await admin.post("/billing/sales/invoices", invBody);
check("invoice created", inv.status === 201);
const id = inv.body.invoice.id;
const pdf = await admin.get(`/billing/sales/invoices/${id}/pdf`);
check("classic PDF is a real PDF", pdf.status === 200 && pdf.bytes?.subarray(0, 4).toString() === "%PDF" && pdf.bytes.length > 3000, pdf.status);
const lh = await admin.get(`/billing/sales/invoices/${id}/pdf?template=letterhead`);
check("letterhead PDF works too", lh.status === 200 && lh.bytes?.subarray(0, 4).toString() === "%PDF");
check("the two templates differ", lh.bytes && pdf.bytes && !lh.bytes.equals(pdf.bytes));
const docx = await admin.get(`/billing/sales/invoices/${id}/docx`);
check("Word file is a real docx", docx.status === 200 && docx.bytes?.subarray(0, 2).toString() === "PK");
check("finance manager can download", (await fin.c.get(`/billing/sales/invoices/${id}/pdf`)).status === 200);
check("sales executive cannot download invoices", (await exec.c.get(`/billing/sales/invoices/${id}/pdf`)).status === 403);
check("billing agent cannot download someone else's invoice", (await agent.c.get(`/billing/sales/invoices/${id}/pdf`)).status === 404);

console.log("Quotation PDF");
const q = await exec.c.post("/billing/documents", { docType: "QUOTATION", partyId: party.id, date: "2026-11-24", validUntil: "2026-12-10", status: "OPEN", lines: [{ itemId: item.id, name: item.name, hsnSac: "9983", unitId: unit.id, quantityThousandths: 1000, unitPricePaise: 250000, taxRateBasisPoints: 1800 }] });
check("executive creates a quotation", q.status === 201, q);
const qid = q.body?.document?.id ?? q.body?.id ?? q.body?.result?.id;
const qpdf = await exec.c.get(`/billing/documents/${qid}/pdf`);
check("executive downloads the quotation PDF", qpdf.status === 200 && qpdf.bytes?.subarray(0, 4).toString() === "%PDF", qpdf.status);

console.log("Drafts");
const d1 = await agent.c.post("/billing-access/drafts", { kind: "invoice", title: "My draft", payload: { x: 1 } });
check("draft saved", d1.status === 201);
check("draft can be read back", (await agent.c.get(`/billing-access/drafts/${d1.body.data.id}`)).body.data.payload.x === 1);
check("another user cannot read it", (await fin.c.get(`/billing-access/drafts/${d1.body.data.id}`)).status === 404);
check("draft list shows only own", (await agent.c.get("/billing-access/drafts?kind=invoice")).body.data.length === 1 && (await fin.c.get("/billing-access/drafts?kind=invoice")).body.data.length === 0);
check("draft deleted", (await agent.c.del(`/billing-access/drafts/${d1.body.data.id}`)).status === 200 && (await agent.c.get(`/billing-access/drafts/${d1.body.data.id}`)).status === 404);

console.log("Credit note and purchases");
const cn = await admin.post(`/billing/sales/invoices/${id}/credit-note`, { branchId: inv.body.invoice.branchId, date: "2026-11-25", reason: "Test credit", totalAmountPaise: 50000 });
check("credit note created", cn.status === 201, cn);
const cnl = (await admin.get("/billing/sales/credit-notes")).body.notes ?? [];
check("credit note is listed", cnl.some((n) => n.reason === "Test credit"));
const bill = await admin.post("/billing/purchases/bills", { partyId: vendor.id, vendorBillNo: `VB-${run}`, date: "2026-11-20", dueDate: "2026-12-20", lines: [{ itemId: item.id, quantityThousandths: 1000, unitPricePaise: 100000, taxRateBasisPoints: 1800 }] });
check("purchase bill created", bill.status === 201, bill);
const dn = await admin.post("/billing/purchases/debit-notes", { billId: bill.body.bill.id, reason: "Test debit", date: "2026-11-25", lines: [{ itemId: item.id, quantityThousandths: 500, unitPricePaise: 100000, taxRateBasisPoints: 1800 }] });
check("debit note created", dn.status === 201, dn);
check("debit note is listed", ((await admin.get("/billing/purchases/debit-notes")).body.notes ?? []).some((n) => n.reason === "Test debit"));
const po = await admin.post("/billing/documents", { docType: "PURCHASE_ORDER", partyId: vendor.id, date: "2026-11-24", status: "OPEN", lines: [{ itemId: item.id, name: item.name, unitId: unit.id, quantityThousandths: 1000, unitPricePaise: 100000, taxRateBasisPoints: 1800 }] });
check("purchase order created", po.status === 201, po);
check("sales executive cannot create a purchase order", (await exec.c.post("/billing/documents", { docType: "PURCHASE_ORDER", partyId: vendor.id, date: "2026-11-24", lines: [] })).status === 403);

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll document checks passed");
process.exit(failures ? 1 : 0);

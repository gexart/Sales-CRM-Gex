// Client emails, the push to the agency CRM, signature and stamp on the PDF, and quick-add of customers and products.
// Usage: node scripts/billing-smoke-notify.mjs [baseUrl]   (needs `npm run dev` and the local test administrator)
import http from "node:http";
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
    if (/pdf/.test(type)) return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()) };
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { get: (p) => call("GET", p), post: (p, b = {}, h) => call("POST", p, b, h), put: (p, b) => call("PUT", p, b), login: async (e, p) => (await call("POST", "/auth/login", { email: e, password: p })).status === 200 };
}
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else (failures++, console.log(`  ✗ ${name}`, extra === undefined ? "" : JSON.stringify(extra).slice(0, 300)));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`${BASE}/api/v1/health`)).ok) break; } catch {}
  await sleep(2000);
}

// A stand-in for crm.gexart.com's invoice webhook.
const received = [];
const server = http.createServer((req, res) => {
  let b = "";
  req.on("data", (d) => (b += d));
  req.on("end", () => {
    try { received.push({ url: req.url, body: JSON.parse(b) }); } catch {}
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, results: [{ invoice_no: "x", client: "Test Client", action: "created", status: "unpaid" }] }));
  });
});
await new Promise((r) => server.listen(8899, "127.0.0.1", r));

const admin = client();
await admin.login(ADMIN.email, ADMIN.password);
const roles = (await admin.get("/billing-access/roles")).body.data;
const u = await admin.post("/users", { email: `nt.${run}@gexart.test`, name: `nt ${run}`, role: "rep", password: PW, send_welcome: false });
await admin.put(`/billing-access/users/${u.body.data.id}`, { roleId: roles.find((r) => r.name === "Billing Agent").id, extra: [], denied: [] });
const agent = client();
await agent.login(`nt.${run}@gexart.test`, PW);

const unit = (await admin.get("/billing/masters/units")).body.units[0];
const tax = (await admin.get("/billing/masters/taxes")).body.taxRates.find((t) => t.rate_basis_points === 1800);

console.log("Quick-add (the calls the + Create buttons make)");
const party = (await admin.post("/billing/masters/parties", { name: `Quick Client ${run}`, phone: "9876543210", type: "CUSTOMER", gstin: "19AAACU7929H1ZX", stateCode: "19", email: "client@example.test" })).body.party;
check("a customer can be added in one step", !!party?.id && party.stateCode === "19", party);
const item = (await admin.post("/billing/masters/items", { name: `Quick Service ${run}`, type: "SERVICE", unitId: unit.id, salePricePaise: 500000, taxRateId: tax.id, hsnSac: "9983" })).body.item;
check("a service can be added in one step with a default price", item?.salePricePaise === 500000, item);
const mkInv = (price) => ({ partyId: party.id, partyName: party.name, partyEmail: undefined, partyGstin: party.gstin, partyStateCode: "19", date: "2026-11-24", dueDate: "2026-12-24", paymentMode: "CREDIT", signatoryName: "Test Signer", items: [{ itemId: item.id, name: item.name, hsnSac: "9983", quantityThousandths: 1000, unitId: unit.id, unitPricePaise: price, discountPaise: 0, taxRatePercent: 18 }] });
const inv1 = (await admin.post("/billing/sales/invoices", mkInv(750000))).body.invoice;
check("the price on the invoice can differ from the default", inv1.subtotalPaise === 750000 || inv1.subtotal_paise === 750000, inv1);

console.log("Saved notes and terms, signature and stamp");
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const put = await admin.put("/billing/settings/billing", { textTemplates: { notes: [{ id: "n1", name: "Standard note", text: "Thanks" }, { id: "n2", name: "Retainer", text: "Monthly" }], terms: [{ id: "t1", name: "Standard terms", text: "1. Pay on time" }] }, branding: { signatures: [{ id: "s1", name: "Test Signer", signature: png, stamp: png }] } });
check("several saved notes and terms are stored", put.status === 200, put.body);
const got = (await admin.get("/billing/settings/billing")).body.billing;
check("they come back as a list", got.textTemplates.notes.length === 2 && got.textTemplates.terms.length === 1 && got.branding.signatures[0].name === "Test Signer");
check("a role without settings access cannot change them", (await agent.put("/billing/settings/billing", { textTemplates: { notes: [] } })).status === 403);
const pdf = await admin.get(`/billing/sales/invoices/${inv1.id}/pdf?template=classic`);
check("the PDF prints with the chosen signature and stamp", pdf.status === 200 && pdf.bytes.length > 3000, pdf.status);

console.log("Client email");
await admin.put("/settings/config", { values: { BILLING_EMAIL_PROVIDER: "off", AGENCY_CRM_HOOK_URL: "", AGENCY_CRM_PUSH: "" } });
const em = await admin.post(`/billing/sales/invoices/${inv1.id}/email`, { to: "client@example.test" });
check("with no provider, emailing fails cleanly and says why", em.status === 502 && /provider|mailbox|Configuration/i.test(em.body?.error ?? ""), em.body);
check("the invoice is untouched by the failed email", (await admin.get(`/billing/sales/invoices/${inv1.id}`)).status === 200);

console.log("Push to the agency CRM");
const none = await admin.post(`/billing/sales/invoices/${inv1.id}/crm`, {});
check("without a webhook address it explains what to do", none.status === 502 && /webhook/i.test(none.body?.message ?? ""), none.body);
await admin.put("/settings/config", { values: { AGENCY_CRM_HOOK_URL: "http://127.0.0.1:8899/api/hook/invoice/testkey", AGENCY_CRM_PUSH: "on", BILLING_EMAIL_PROVIDER: "off" } });
await sleep(300);
const push = await admin.post(`/billing/sales/invoices/${inv1.id}/crm`, {});
check("a manual push reaches the CRM", push.status === 200 && push.body.ok, push.body);
const got1 = received.find((r) => r.body.invoice_no === (inv1.invoiceNo ?? inv1.invoice_no));
check("the CRM receives the invoice with the client's details", got1 && got1.body.amount === 8850 && got1.body.customer.name === party.name && got1.body.customer.email === "client@example.test" && got1.body.status === "unpaid", got1?.body);
check("it uses the webhook's own address and key", got1?.url === "/api/hook/invoice/testkey");
check("line items travel too", got1?.body.items?.[0]?.name === item.name && got1.body.items[0].hsn === "9983");
check("agent cannot push to the CRM", (await agent.post(`/billing/sales/invoices/${inv1.id}/crm`, {})).status === 403);
const before = received.length;
const inv2 = (await admin.post("/billing/sales/invoices", mkInv(100000))).body.invoice;
await sleep(1500);
check("a new invoice is pushed automatically", received.slice(before).some((r) => r.body.event === "invoice.created" && r.body.invoice_no === (inv2.invoiceNo ?? inv2.invoice_no)), received.slice(before).map((r) => r.body.event));
const before2 = received.length;
await admin.post(`/billing/sales/invoices/${inv2.id}/payments`, { amountPaise: 50000, paymentMode: "UPI", branchId: inv2.branchId, date: "2026-11-24" });
await sleep(1500);
const pay = received.slice(before2).find((r) => r.body.event === "payment.received");
check("a payment is pushed with the new paid amount", pay && pay.body.paid_amount === 500 && pay.body.status === "partial", pay?.body);

// leave the local settings as they were
await admin.put("/settings/config", { values: { BILLING_EMAIL_PROVIDER: "", AGENCY_CRM_HOOK_URL: "", AGENCY_CRM_PUSH: "" } });
server.close();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll notification checks passed");
process.exit(failures ? 1 : 0);

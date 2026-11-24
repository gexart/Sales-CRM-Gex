// Phone-app behaviours of billing: safe offline retries and the customer's public invoice link.
// Usage: node scripts/billing-smoke-mobile.mjs [baseUrl]   (needs `npm run dev` and the local test administrator)
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
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { get: (p) => call("GET", p), post: (p, b = {}, h) => call("POST", p, b, h), put: (p, b) => call("PUT", p, b), login: async (e, p) => (await call("POST", "/auth/login", { email: e, password: p })).status === 200 };
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
const email = `mob.${run}@gexart.test`;
const u = await admin.post("/users", { email, name: `mob ${run}`, role: "rep", password: PW, send_welcome: false });
await admin.put(`/billing-access/users/${u.body.data.id}`, { roleId: roles.find((r) => r.name === "Billing Agent").id, extra: [], denied: [] });
const agent = client();
await agent.login(email, PW);

const unit = (await admin.get("/billing/masters/units")).body.units[0];
const tax = (await admin.get("/billing/masters/taxes")).body.taxRates.find((t) => t.rate_basis_points === 1800);
const party = (await admin.post("/billing/masters/parties", { name: `Mobile Customer ${run}`, phone: "9876543210", type: "CUSTOMER", stateCode: "19" })).body.party;
const item = (await admin.post("/billing/masters/items", { name: `Mobile Service ${run}`, type: "SERVICE", unitId: unit.id, salePricePaise: 500000, taxRateId: tax.id, hsnSac: "998314" })).body.item;
const body = { partyId: party.id, partyName: party.name, partyStateCode: "19", date: "2026-11-24", dueDate: "2026-12-24", paymentMode: "CREDIT", items: [{ itemId: item.id, name: item.name, hsnSac: "998314", quantityThousandths: 1000, unitId: unit.id, unitPricePaise: 500000, discountPaise: 0, taxRatePercent: 18 }] };

console.log("Offline retry is safe");
const ref = `offline-${run}`;
const a = await agent.post("/billing/sales/invoices", body, { "x-client-ref": ref });
const b = await agent.post("/billing/sales/invoices", body, { "x-client-ref": ref });
check("first send creates the request", a.status === 202 && !!a.body.approvalId, a);
check("a retry with the same reference returns the same request", b.status === 202 && b.body.approvalId === a.body.approvalId && b.body.duplicate === true, b);
const mine = (await agent.get("/billing-access/approvals?status=pending")).body.data.filter((x) => x.party_name === party.name);
check("only one approval exists", mine.length === 1, mine.length);
const c = await agent.post("/billing/sales/invoices", body, { "x-client-ref": `${ref}-2` });
check("a different reference is a new request", c.status === 202 && c.body.approvalId !== a.body.approvalId);

console.log("Customer's public invoice link");
const inv = await admin.post("/billing/sales/invoices", body);
check("administrator creates an invoice", inv.status === 201);
const detail = (await admin.get(`/billing/sales/invoices/${inv.body.invoice.id}`)).body.invoice;
check("the invoice has a share token", /^[A-Za-z0-9]{20,64}$/.test(detail.shareToken ?? ""));
const anon = await fetch(`${BASE}/api/v1/public/invoice/${detail.shareToken}`);
const pj = await anon.json();
check("anyone with the link can read it, no login", anon.status === 200 && pj.data.invoiceNo === detail.invoice_no);
check("it shows the amount due", pj.data.balancePaise === detail.balance_amount_paise);
check("nothing internal is exposed", !/created_by|party_id|branch_id|share|user/i.test(JSON.stringify(pj)));
check("a wrong token is a 404", (await fetch(`${BASE}/api/v1/public/invoice/aaaaaaaaaaaaaaaaaaaaaaaa`)).status === 404);
check("billing itself still needs a login", (await fetch(`${BASE}/api/v1/billing/sales/invoices`)).status === 401);

console.log("Calls: mapped and unmapped");
const unm = await admin.get("/calls?unmatched=1&pageSize=5");
const mapped = await admin.get("/calls?matched=1&pageSize=5");
check("unmapped filter answers", unm.status === 200);
check("mapped filter answers", mapped.status === 200);
check("no call is in both lists", !(unm.body.data ?? []).some((x) => (mapped.body.data ?? []).some((y) => y.id === x.id)));

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll mobile billing checks passed");
process.exit(failures ? 1 : 0);

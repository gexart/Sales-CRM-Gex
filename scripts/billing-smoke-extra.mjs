// Attachments, split payments, expenses, stock and the phone's notification feed.
// Usage: node scripts/billing-smoke-extra.mjs [baseUrl]   (needs `npm run dev` and the local test administrator)
const BASE = process.argv[2] ?? "http://localhost:5173";
const ADMIN = { email: process.env.SMOKE_ADMIN_EMAIL ?? "admin@gexart.test", password: process.env.SMOKE_ADMIN_PASSWORD ?? "LocalDevOnly-2026" };
const run = Date.now().toString(36);
const PW = "Smoke-Pass-2026!x";
let failures = 0;

function client() {
  let cookie = "";
  const call = async (method, path, body, headers = {}) => {
    const isForm = body instanceof FormData;
    const res = await fetch(`${BASE}/api/v1${path}`, { method, headers: { ...(isForm ? {} : { "content-type": "application/json" }), "x-requested-with": "gexart-crm", cookie, ...headers }, body: body === undefined ? undefined : isForm ? body : JSON.stringify(body) });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return { status: res.status, body: await res.json().catch(() => null), res };
  };
  return { get: (p, h) => call("GET", p, undefined, h), post: (p, b = {}, h) => call("POST", p, b, h), put: (p, b) => call("PUT", p, b), del: (p) => call("DELETE", p), login: async (e, p) => (await call("POST", "/auth/login", { email: e, password: p })).status === 200 };
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
const u = await admin.post("/users", { email: `ex.${run}@gexart.test`, name: `ex ${run}`, role: "rep", password: PW, send_welcome: false });
await admin.put(`/billing-access/users/${u.body.data.id}`, { roleId: roles.find((r) => r.name === "Billing Agent").id, extra: [], denied: [] });
const agent = client();
await agent.login(`ex.${run}@gexart.test`, PW);
const outsider = client();

const unit = (await admin.get("/billing/masters/units")).body.units[0];
const tax = (await admin.get("/billing/masters/taxes")).body.taxRates.find((t) => t.rate_basis_points === 1800);
const party = (await admin.post("/billing/masters/parties", { name: `Extra Customer ${run}`, phone: "9876543210", type: "CUSTOMER", stateCode: "19" })).body.party;
const item = (await admin.post("/billing/masters/items", { name: `Extra Service ${run}`, type: "SERVICE", unitId: unit.id, salePricePaise: 100000, taxRateId: tax.id, hsnSac: "9983" })).body.item;
const mkInv = (extra = {}) => ({ partyId: party.id, partyName: party.name, partyStateCode: "19", date: "2026-11-24", dueDate: "2026-12-24", paymentMode: "CREDIT", items: [{ itemId: item.id, name: item.name, hsnSac: "9983", quantityThousandths: 1000, unitId: unit.id, unitPricePaise: 100000, discountPaise: 0, taxRatePercent: 18 }], ...extra });

console.log("Split payments");
const inv = (await admin.post("/billing/sales/invoices", mkInv({ paymentMode: "UPI", paidAmountPaise: 40000 }))).body.invoice;
check("invoice created with a first payment", [inv?.paidPaise, inv?.paidAmountPaise, inv?.paid_amount_paise].includes(40000), Object.keys(inv ?? {}));
const p2 = await admin.post(`/billing/sales/invoices/${inv.id}/payments`, { amountPaise: 30000, paymentMode: "CASH", branchId: inv.branchId, date: "2026-11-24" });
check("second payment recorded", p2.status === 200, p2.body);
const d = (await admin.get(`/billing/sales/invoices/${inv.id}`)).body.invoice;
check("invoice shows both payments (balance 118000 - 70000)", d.paid_amount_paise === 70000 && d.balance_amount_paise === 48000 && d.status === "PARTIALLY_PAID", [d.paid_amount_paise, d.balance_amount_paise, d.status]);

console.log("Attachments");
const up = (name, type, size = 100) => { const f = new FormData(); f.set("entity_type", "invoice"); f.set("entity_id", inv.id); f.set("file", new Blob([new Uint8Array(size).fill(65)], { type }), name); return f; };
const a1 = await admin.post("/billing-access/attachments", up("po.pdf", "application/pdf"));
check("a PDF attaches", a1.status === 201, a1.body);
const list = await admin.get(`/billing-access/attachments?entity_type=invoice&entity_id=${inv.id}`);
check("it is listed", list.body.data.length === 1 && list.body.data[0].file_name === "po.pdf");
const file = await fetch(`${BASE}/api/v1/billing-access/attachments/${a1.body.data.id}/file`, { headers: { cookie: "" } });
check("the file is private: no sign-in, no file", file.status === 401);
check("a script file is refused", (await admin.post("/billing-access/attachments", up("x.exe", "application/x-msdownload"))).status === 400);
check("a file over 5 MB is refused", (await admin.post("/billing-access/attachments", up("big.pdf", "application/pdf", 5 * 1024 * 1024 + 10))).status === 400);
for (let i = 0; i < 4; i++) await admin.post("/billing-access/attachments", up(`f${i}.pdf`, "application/pdf"));
check("the sixth file is refused", (await admin.post("/billing-access/attachments", up("six.pdf", "application/pdf"))).status === 409);
check("someone else cannot remove it", (await agent.del(`/billing-access/attachments/${a1.body.data.id}`)).status === 403);
check("the uploader can remove it", (await admin.del(`/billing-access/attachments/${a1.body.data.id}`)).status === 200);
check("a signed-out visitor cannot list files", (await outsider.get(`/billing-access/attachments?entity_type=invoice&entity_id=${inv.id}`)).status === 401);

console.log("Expenses and stock");
const acc = (await admin.get("/billing/accounting/accounts")).body.accounts;
const ex = await admin.post("/billing/expenses", { categoryAccountId: acc.find((a) => a.type === "EXPENSE").id, paymentAccountId: acc.find((a) => a.subtype === "CASH").id, amountPaise: 55500, payee: `Payee ${run}`, paymentMode: "CASH" });
check("expense saved", ex.status === 201, ex.body);
check("expense listed", ((await admin.get("/billing/expenses")).body.expenses ?? []).some((e) => e.payee === `Payee ${run}`));
check("agent cannot see expenses", (await agent.get("/billing/expenses")).status === 403);
check("stock summary answers", Array.isArray((await admin.get("/billing/inventory/summary")).body.summary));

console.log("Phone notification feed");
const dev = await admin.post("/devices", { name: `Phone ${run}` });
const token = dev.body.data.token;
const feed = await fetch(`${BASE}/api/v1/device/notifications?since=1970-01-01T00:00:00.000Z`, { headers: { authorization: `Bearer ${token}` } });
const fj = await feed.json();
check("device token reads its own notifications", feed.status === 200 && Array.isArray(fj.data.items), fj);
const none = await fetch(`${BASE}/api/v1/device/notifications?since=2999-01-01T00:00:00.000Z`, { headers: { authorization: `Bearer ${token}` } });
check("nothing newer than the future", (await none.json()).data.items.length === 0);
check("no token, no feed", (await fetch(`${BASE}/api/v1/device/notifications`)).status === 401);
// an agent request notifies the administrator, and the phone sees it
const agentToken = null; void agentToken;
const before = new Date().toISOString();
await new Promise((r) => setTimeout(r, 50));
const req = await agent.post("/billing/sales/invoices", mkInv());
check("agent request is pending", req.status === 202, req.body);
const fresh = await (await fetch(`${BASE}/api/v1/device/notifications?since=${encodeURIComponent(before)}`, { headers: { authorization: `Bearer ${token}` } })).json();
check("the administrator's phone gets the approval notification", fresh.data.items.some((n) => n.entity_type === "billing_approval"), fresh.data.items);

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll extra checks passed");
process.exit(failures ? 1 : 0);

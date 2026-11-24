// Billing access-control smoke test against a running dev server (npm run dev).
// Usage: node scripts/billing-smoke.mjs [baseUrl]
// Creates uniquely-named users, parties and invoices each run (local dev database only).
const BASE = process.argv[2] ?? "http://localhost:5173";
const ADMIN = { email: process.env.SMOKE_ADMIN_EMAIL ?? "admin@gexart.test", password: process.env.SMOKE_ADMIN_PASSWORD ?? "LocalDevOnly-2026" };
const run = Date.now().toString(36);
const PW = "Smoke-Pass-2026!x";
let failures = 0;

function client() {
  let cookie = "";
  const call = async (method, path, body) => {
    const res = await fetch(`${BASE}/api/v1${path}`, {
      method,
      headers: { "content-type": "application/json", "x-requested-with": "gexart-crm", cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return {
    get: (p) => call("GET", p),
    post: (p, b = {}) => call("POST", p, b),
    put: (p, b = {}) => call("PUT", p, b),
    del: (p) => call("DELETE", p),
    login: async (email, password) => (await call("POST", "/auth/login", { email, password })).status === 200,
  };
}
function check(name, cond, extra) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}`, extra === undefined ? "" : JSON.stringify(extra).slice(0, 300));
  }
}

for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`${BASE}/api/v1/health`)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 2000));
}

const admin = client();
if (!(await admin.login(ADMIN.email, ADMIN.password))) { console.log("admin login failed"); process.exit(1); }

console.log("Setup: users, roles");
const roles = (await admin.get("/billing-access/roles")).body.data;
const roleId = (name) => roles.find((r) => r.name === name)?.id;
check("built-in roles exist", ["Sales Executive", "Billing Agent", "Finance Manager", "Accountant", "Auditor", "View only"].every((n) => roleId(n)));
const mk = async (key, billingRole) => {
  const email = `${key}.${run}@gexart.test`;
  const r = await admin.post("/users", { email, name: `${key} ${run}`, role: "rep", password: PW, send_welcome: false });
  if (r.status !== 201) throw new Error(`create user ${key}: ${r.status} ${JSON.stringify(r.body)}`);
  const id = r.body.data.id;
  const a = await admin.put(`/billing-access/users/${id}`, { roleId: roleId(billingRole), extra: [], denied: [] });
  if (a.status !== 200) throw new Error(`assign ${key}: ${a.status}`);
  const c = client();
  if (!(await c.login(email, PW))) throw new Error(`login ${key}`);
  return { id, c };
};
const exec = await mk("exec", "Sales Executive");
const agent = await mk("agent", "Billing Agent");
const fin = await mk("fin", "Finance Manager");
const nobody = await (async () => {
  const email = `none.${run}@gexart.test`;
  const r = await admin.post("/users", { email, name: `none ${run}`, role: "rep", password: PW, send_welcome: false });
  const c = client();
  await c.login(email, PW);
  return { id: r.body.data.id, c };
})();

console.log("Setup: party and item (as administrator)");
const unit = (await admin.get("/billing/masters/units")).body.units[0];
const tax = (await admin.get("/billing/masters/taxes")).body.taxRates.find((t) => t.rate_basis_points === 1800);
const party = (await admin.post("/billing/masters/parties", { name: `Smoke Customer ${run}`, phone: "9876543210", type: "CUSTOMER", stateCode: "19" })).body.party;
const item = (await admin.post("/billing/masters/items", { name: `Smoke Service ${run}`, type: "SERVICE", unitId: unit.id, salePricePaise: 1000000, purchasePricePaise: 400000, taxRateId: tax.id, hsnSac: "998314" })).body.item;
check("party and item created", !!party?.id && !!item?.id);
const invBody = (discountPaise = 0) => ({
  partyId: party.id, partyName: party.name, partyStateCode: "19", date: "2026-11-24", dueDate: "2026-12-24", paymentMode: "CREDIT",
  items: [{ itemId: item.id, name: item.name, hsnSac: "998314", quantityThousandths: 1000, unitId: unit.id, unitPricePaise: 1000000, discountPaise, taxRatePercent: 18 }],
});
const docBody = (docType) => ({ docType, partyId: party.id, date: "2026-11-24", lines: [{ itemId: item.id, name: item.name, hsnSac: "998314", unitId: unit.id, quantityThousandths: 1000, unitPricePaise: 1000000, taxRateBasisPoints: 1800 }] });

console.log("No billing role → no access");
check("user without a role is refused", (await nobody.c.get("/billing/masters/parties")).status === 403);
check("…and has no permissions", (await nobody.c.get("/billing-access/me")).body.data.permissions.length === 0);

console.log("Sales Executive: quotation and proforma yes, sales invoice no");
check("creates a quotation", (await exec.c.post("/billing/documents", docBody("QUOTATION"))).status === 201);
check("creates a proforma", (await exec.c.post("/billing/documents", docBody("PROFORMA"))).status === 201);
const direct = await exec.c.post("/billing/sales/invoices", invBody());
check("cannot create a sales invoice", direct.status === 403, direct);
check("cannot request one either", direct.body?.error?.code === "forbidden");
check("cannot see invoices", (await exec.c.get("/billing/sales/invoices")).status === 403);
check("cannot see reports", (await exec.c.get("/billing/reports/profit-loss")).status === 403);
check("cannot see collections", (await exec.c.get("/billing/payments?type=IN")).status === 403);
check("cannot convert a quotation into an invoice", (await exec.c.post("/billing/documents/none/convert", { target: "INVOICE" })).status === 403);
const items = await exec.c.get("/billing/masters/items");
check("sees items but not purchase cost", items.status === 200 && !JSON.stringify(items.body).includes("purchasePricePaise"), items.body);

console.log("Billing Agent: invoices only as a request");
const req1 = await agent.c.post("/billing/sales/invoices", invBody());
check("invoice request is accepted as pending (202)", req1.status === 202 && req1.body.pending === true, req1);
const approvalId = req1.body?.approvalId;
const agentList = await agent.c.get("/billing/sales/invoices");
check("no invoice exists yet", agentList.status === 200 && agentList.body.invoices.length === 0, agentList.body);
check("agent gets no totals or counts", agentList.body && !("totals" in agentList.body) && !("counts" in agentList.body));
check("agent cannot see reports", (await agent.c.get("/billing/reports/profit-loss")).status === 403);
check("agent cannot see collections", (await agent.c.get("/billing/payments?type=IN")).status === 403);
check("agent cannot see the trial balance", (await agent.c.get("/billing/accounting/trial-balance")).status === 403);
check("agent cannot create quotations", (await agent.c.post("/billing/documents", docBody("QUOTATION"))).status === 403);
check("agent cannot approve", (await agent.c.post(`/billing-access/approvals/${approvalId}/approve`, {})).status === 403);
check("agent cannot read the audit log", (await agent.c.get("/billing-access/audit")).status === 403);
check("agent cannot manage roles", (await agent.c.post("/billing-access/roles", { name: "x", permissions: [] })).status === 403);
const mine = await agent.c.get("/billing-access/approvals");
check("agent sees their own request, pending", mine.body.data.length === 1 && mine.body.data[0].status === "pending");
check("it names the reason", /only request/i.test(mine.body.data[0].reason ?? ""));

console.log("Approver sees it and decides");
const fl = await fin.c.get("/billing-access/approvals?status=pending");
check("approver sees the pending request", fl.body.data.some((a) => a.id === approvalId));
check("approver was notified", (await fin.c.get("/notifications")).status === 200);
const ok = await fin.c.post(`/billing-access/approvals/${approvalId}/approve`, { note: "ok" });
check("approval creates the real invoice", ok.status === 200 && !!ok.body.data.invoiceNo, ok);
check("approving twice is refused", (await fin.c.post(`/billing-access/approvals/${approvalId}/approve`, {})).status === 409);
const after = await agent.c.get("/billing/sales/invoices");
check("agent now sees exactly that invoice", after.body.invoices.length === 1 && after.body.invoices[0].id === ok.body.data.invoiceId, after.body);

console.log("Data scope: agent sees only their own invoices");
const adminInv = await admin.post("/billing/sales/invoices", invBody());
check("administrator creates one directly (201)", adminInv.status === 201);
const scoped = await agent.c.get("/billing/sales/invoices");
check("agent still sees only their own", scoped.body.invoices.length === 1);
check("agent cannot open someone else's invoice", (await agent.c.get(`/billing/sales/invoices/${adminInv.body.invoice.id}`)).status === 404);
const finList = await fin.c.get("/billing/sales/invoices");
check("finance manager sees all, with totals", finList.body.invoices.length >= 2 && "totals" in finList.body);

console.log("Rejection");
const req2 = await agent.c.post("/billing/sales/invoices", invBody());
check("reject needs a reason", (await fin.c.post(`/billing-access/approvals/${req2.body.approvalId}/reject`, {})).status === 400);
check("rejects with a reason", (await fin.c.post(`/billing-access/approvals/${req2.body.approvalId}/reject`, { reason: "Wrong GST rate" })).status === 200);
const rej = (await agent.c.get("/billing-access/approvals?status=rejected")).body.data[0];
check("agent sees the rejection and why", rej?.status === "rejected" && rej.decision_note === "Wrong GST rate");
check("no invoice was created for it", (await agent.c.get("/billing/sales/invoices")).body.invoices.length === 1);
const req3 = await agent.c.post("/billing/sales/invoices", invBody());
check("agent can withdraw a pending request", (await agent.c.post(`/billing-access/approvals/${req3.body.approvalId}/cancel`)).status === 200);

console.log("Limits: discount cap forces approval even with create rights");
await admin.put(`/billing-access/users/${agent.id}`, { roleId: roleId("Billing Agent"), extra: ["invoice.create"], denied: [] });
const small = await agent.c.post("/billing/sales/invoices", invBody(0));
check("within the cap: created directly (201)", small.status === 201, small);
const big = await agent.c.post("/billing/sales/invoices", invBody(300000));
check("30% discount over the 5% cap: waits for approval", big.status === 202 && /Discount/.test(big.body.reasons?.[0] ?? ""), big);
await admin.put(`/billing-access/users/${agent.id}`, { roleId: roleId("Billing Agent"), extra: [], denied: [] });

console.log("Finance Manager and roles");
check("finance manager reads reports", (await fin.c.get("/billing/reports/profit-loss")).status === 200);
check("finance manager reads collections", (await fin.c.get("/billing/payments?type=IN")).status === 200);
check("finance manager cannot manage roles", (await fin.c.post("/billing-access/roles", { name: "x", permissions: [] })).status === 403);
const custom = await admin.post("/billing-access/roles", { name: `Collections Clerk ${run}`, description: "Records payments", permissions: ["billing.access", "invoice.view", "invoice.view_all", "payment.receive"], limits: {} });
check("administrator creates a custom role", custom.status === 201, custom);
check("unknown permission is rejected", (await admin.post("/billing-access/roles", { name: `Bad ${run}`, permissions: ["made.up"] })).status === 400);
check("built-in roles cannot be edited", (await admin.put(`/billing-access/roles/${roleId("Billing Agent")}`, { name: "Billing Agent", permissions: [], limits: {} })).status === 409);
await admin.put(`/billing-access/users/${nobody.id}`, { roleId: custom.body.data.id, extra: [], denied: [] });
check("custom role is in use and cannot be deleted", (await admin.del(`/billing-access/roles/${custom.body.data.id}`)).status === 409);
check("custom role: can read invoices", (await nobody.c.get("/billing/sales/invoices")).status === 200);
check("custom role: cannot create parties", (await nobody.c.post("/billing/masters/parties", { name: "x", phone: "9876543210" })).status === 403);
await admin.put(`/billing-access/users/${nobody.id}`, { roleId: roleId("View only"), extra: [], denied: ["invoice.view"] });
check("per-user denial removes a permission from the role", (await nobody.c.get("/billing/sales/invoices")).status === 403);

console.log("Audit log");
const log = await fin.c.get("/billing-access/audit?limit=100");
check("audit log is readable by finance manager", log.status === 200);
const actions = new Set(log.body.data.map((r) => r.action));
check("records requests, approvals, rejections", ["approval.request", "approval.approve", "approval.reject"].every((a) => actions.has(a)), [...actions]);
check("records writes with actor and status", log.body.data.some((r) => r.action === "POST /sales/invoices" && r.actor_name && r.status === 201));

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll billing access checks passed");
process.exit(failures ? 1 : 0);

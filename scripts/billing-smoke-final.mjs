// Bulk import, stock adjustment, recurring invoices, TDS (sales and purchases) with balanced books, thermal receipt, barcode labels
// and the e-invoice safety block.  Usage: node scripts/billing-smoke-final.mjs [baseUrl]   (needs `npm run dev`)
const BASE = process.argv[2] ?? "http://localhost:5173";
const ADMIN = { email: process.env.SMOKE_ADMIN_EMAIL ?? "admin@gexart.test", password: process.env.SMOKE_ADMIN_PASSWORD ?? "LocalDevOnly-2026" };
const run = Date.now().toString(36);
const PW = "Smoke-Pass-2026!x";
const today = new Date().toISOString().slice(0, 10);
let failures = 0;

function client() {
  let cookie = "";
  const call = async (method, path, body) => {
    const res = await fetch(`${BASE}/api/v1${path}`, { method, headers: { "content-type": "application/json", "x-requested-with": "gexart-crm", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    if (/pdf/.test(res.headers.get("content-type") || "")) return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()) };
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { get: (p) => call("GET", p), post: (p, b = {}) => call("POST", p, b), put: (p, b) => call("PUT", p, b), del: (p) => call("DELETE", p), login: async (e, p) => (await call("POST", "/auth/login", { email: e, password: p })).status === 200 };
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
  return c;
};
const agent = await mk("fa", "Billing Agent");
const unit = (await admin.get("/billing/masters/units")).body.units[0];
const tax = (await admin.get("/billing/masters/taxes")).body.taxRates.find((t) => t.rate_basis_points === 1800);
const party = (await admin.post("/billing/masters/parties", { name: `Final Client ${run}`, phone: "9876543210", type: "CUSTOMER", stateCode: "19", email: "f@example.test" })).body.party;
const vendor = (await admin.post("/billing/masters/parties", { name: `Final Vendor ${run}`, phone: "9876500002", type: "VENDOR", stateCode: "19" })).body.party;
const item = (await admin.post("/billing/masters/items", { name: `Final Goods ${run}`, type: "GOODS", unitId: unit.id, salePricePaise: 100000, purchasePricePaise: 60000, taxRateId: tax.id, hsnSac: "8479", barcode: `BC${run}` })).body.item;
const invBody = (p = 100000, qty = 1000) => ({ partyId: party.id, partyName: party.name, partyStateCode: "19", date: today, dueDate: today, paymentMode: "CREDIT", items: [{ itemId: item.id, name: item.name, hsnSac: "8479", quantityThousandths: qty, unitId: unit.id, unitPricePaise: p, discountPaise: 0, taxRatePercent: 18 }] });
const tb = async () => (await admin.get("/billing/accounting/trial-balance")).body;
const bal = (t, code) => t.trialBalance.accounts.find((a) => a.code === code);

console.log("Bulk import of products");
const bulk = await admin.post("/billing/masters/items/bulk", { items: [1, 2, 3].map((n) => ({ name: `Imported ${run} ${n}`, salePricePaise: n * 10000, purchasePricePaise: 0, taxRateBasisPoints: 1800, hsnSac: "9983", sku: `IMP${run}${n}`, barcode: "", unit: "PCS", openingStockThousandths: 5000 })) });
check("three products import in one call", bulk.status === 200 && bulk.body.insertedCount === 3, bulk.body);
check("they are searchable", (await admin.get(`/billing/masters/items?search=Imported%20${run}`)).body.items.length === 3);

console.log("Stock adjustment");
const sumBefore = (await admin.get("/billing/inventory/summary")).body.summary.find((r) => r.itemId === item.id);
const wh = sumBefore?.warehouseId ?? (await admin.get("/billing/inventory/summary")).body.summary[0].warehouseId;
const adj = await admin.post("/billing/inventory/adjustments", { warehouseId: wh, reason: "PHYSICAL_COUNT", date: today, lines: [{ itemId: item.id, adjustmentType: "INCREASE", quantityThousandths: 10000, ratePaise: 60000 }] });
check("stock can be increased", adj.status === 201, adj.body);
const after = (await admin.get("/billing/inventory/summary")).body.summary.find((r) => r.itemId === item.id);
check("quantity goes up by 10", (after?.currentQtyThousandths ?? 0) - (sumBefore?.currentQtyThousandths ?? 0) === 10000, [sumBefore?.currentQtyThousandths, after?.currentQtyThousandths]);
check("a billing agent cannot adjust stock", (await agent.post("/billing/inventory/adjustments", { warehouseId: wh, reason: "DAMAGE", lines: [] })).status === 403);

console.log("Recurring invoices");
const inv = (await admin.post("/billing/sales/invoices", invBody())).body.invoice;
const rec = await admin.post("/billing-access/recurring", { invoiceId: inv.id, frequency: "monthly", firstRun: today });
check("a schedule is created from an invoice", rec.status === 201, rec.body);
check("an agent cannot create schedules", (await agent.post("/billing-access/recurring", { invoiceId: inv.id, frequency: "monthly", firstRun: today })).status === 403);
const made = await admin.post(`/billing-access/recurring/${rec.body.data.id}/run-now`);
check("running it creates the next invoice", made.status === 200 && !!made.body.data.last_invoice_no && !made.body.data.last_error, made.body);
const list = (await admin.get("/billing-access/recurring")).body.data;
const row = list.find((r) => r.id === rec.body.data.id);
check("it moved forward one month and counted the run", row.runs === 1 && row.next_run > today, row);
const newInv = (await admin.get(`/billing/sales/invoices/${made.body.data.last_invoice_id}`)).body.invoice;
check("the new invoice copies the amount", newInv.total_paise === inv.totalPaise || newInv.total_paise === 118000, newInv.total_paise);
check("pausing works", (await admin.put(`/billing-access/recurring/${row.id}`, { active: false })).status === 200 && (await admin.get("/billing-access/recurring")).body.data.find((r) => r.id === row.id).active === 0);
check("deleting works", (await admin.del(`/billing-access/recurring/${row.id}`)).status === 200);

console.log("TDS on a sale (customer deducts)");
const sale = (await admin.post("/billing/sales/invoices", invBody())).body.invoice; // 1000 + 18% = 1180
const tb0 = await tb();
const t1 = await admin.post(`/billing/sales/invoices/${sale.id}/tds`, { section: "194J" });
check("10% TDS on the taxable value is recorded (Rs 100)", t1.status === 200 && t1.body.tdsPaise === 10000, t1.body);
const s2 = (await admin.get(`/billing/sales/invoices/${sale.id}`)).body.invoice;
check("the invoice balance drops by the TDS", s2.balance_amount_paise === 118000 - 10000 && s2.status === "PARTIALLY_PAID", [s2.balance_amount_paise, s2.status]);
const tb1 = await tb();
check("TDS Receivable rises by Rs 100", (bal(tb1, "1350")?.netDebitPaise ?? 0) - (bal(tb0, "1350")?.netDebitPaise ?? 0) === 10000, bal(tb1, "1350"));
check("the books still balance", tb1.isBalanced === true, tb1.trialBalance.differencePaise);
check("TDS above the balance is refused", (await admin.post(`/billing/sales/invoices/${sale.id}/tds`, { section: "194J", amountPaise: 999999 })).status === 400);
check("a billing agent cannot record TDS", (await agent.post(`/billing/sales/invoices/${sale.id}/tds`, { section: "194J" })).status === 403);

console.log("TDS on a purchase (you deduct)");
const pb = (await admin.post("/billing/purchases/bills", { partyId: vendor.id, vendorBillNo: `FV-${run}`, date: today, dueDate: today, lines: [{ itemId: item.id, quantityThousandths: 1000, unitPricePaise: 100000, taxRateBasisPoints: 1800 }] })).body.bill;
const tp0 = await tb();
const t2 = await admin.post(`/billing/purchases/bills/${pb.id}/tds`, { section: "194C" });
check("2% TDS on the vendor bill is recorded (Rs 20)", t2.status === 200 && t2.body.tdsPaise === 2000, t2.body);
const tp1 = await tb();
check("TDS Payable rises by Rs 20", (bal(tp1, "2240")?.netCreditPaise ?? 0) - (bal(tp0, "2240")?.netCreditPaise ?? 0) === 2000, bal(tp1, "2240"));
check("the books still balance", tp1.isBalanced === true, tp1.trialBalance.differencePaise);
const rep = (await admin.get("/billing/accounting/tds/report")).body.report;
check("the TDS report lists section 194C", rep.sections.some((s) => s.section === "194C"), rep);

console.log("Thermal receipt and barcode labels");
const th = await admin.get(`/billing/sales/invoices/${sale.id}/thermal`);
check("a thermal receipt PDF is produced", th.status === 200 && th.bytes.subarray(0, 4).toString() === "%PDF", th.status);
const lb = await admin.get(`/billing/masters/items/labels?ids=${item.id}&copies=3`);
check("barcode labels PDF is produced", lb.status === 200 && lb.bytes.subarray(0, 4).toString() === "%PDF", lb.status);
check("labels need at least one item", (await admin.get("/billing/masters/items/labels")).status === 400);
check("a role without invoice access cannot open receipts", (await (await mk("fb", "Sales Executive")).get(`/billing/sales/invoices/${sale.id}/thermal`)).status === 403);

console.log("E-invoice safety block");
const ei = await admin.post(`/billing/einvoice/irn/${sale.id}`);
check("no fake IRN can be generated, even by the administrator", ei.status === 400 && ei.body?.error?.code === "not_connected", ei.body);
check("e-way bill is blocked the same way", (await admin.post(`/billing/einvoice/ewb/${sale.id}`)).status === 400);

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll final checks passed");
process.exit(failures ? 1 : 0);

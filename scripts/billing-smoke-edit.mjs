// Invoice edit, delete, remove-payment and bill-number reuse, with the books staying balanced.
// Usage: node scripts/billing-smoke-edit.mjs [baseUrl]   (needs `npm run dev` and the local test administrator)
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
  return { get: (p) => call("GET", p), post: (p, b = {}, h) => call("POST", p, b, h), put: (p, b) => call("PUT", p, b), del: (p, b) => call("DELETE", p, b), delete: (p, b) => call("DELETE", p, b), login: async (e, p) => (await call("POST", "/auth/login", { email: e, password: p })).status === 200 };
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
const unit = (await admin.get("/billing/masters/units")).body.units[0];
const tax = (await admin.get("/billing/masters/taxes")).body.taxRates.find((t) => t.rate_basis_points === 1800);
const mkParty = async (n) => (await admin.post("/billing/masters/parties", { name: `${n} ${run}`, phone: "9876543210", type: "CUSTOMER", stateCode: "19", billingAddress: "1 Test Road, Kolkata" })).body.party;
const A = await mkParty("Edit Client A");
const B = await mkParty("Edit Client B");
const item = (await admin.post("/billing/masters/items", { name: `Edit Service ${run}`, type: "SERVICE", unitId: unit.id, salePricePaise: 100000, taxRateId: tax.id, hsnSac: "9983" })).body.item;
const body = (p, qty = 1000, price = 100000, extra = {}) => ({ partyId: p.id, partyName: p.name, partyStateCode: "19", date: "2026-11-24", dueDate: "2026-12-24", paymentMode: "CREDIT", items: [{ itemId: item.id, name: item.name, hsnSac: "9983", quantityThousandths: qty, unitId: unit.id, unitPricePaise: price, discountPaise: 0, taxRatePercent: 18 }], ...extra });
const balanced = async () => {
  const r = (await admin.get("/billing/accounting/trial-balance")).body;
  return { ok: r.isBalanced === true, diff: r.trialBalance?.differencePaise };
};
const get = async (id) => (await admin.get(`/billing/sales/invoices/${id}`)).body.invoice;

console.log("Edit an unpaid invoice");
const i1 = (await admin.post("/billing/sales/invoices", body(A))).body.invoice;
const no1 = i1.invoiceNo;
const e1 = await admin.put(`/billing/sales/invoices/${i1.id}`, body(A, 2000, 150000));
check("edit works", e1.status === 200, e1.body);
const g1 = await get(i1.id);
check("same number and id after edit", g1.invoice_no === no1 && g1.id === i1.id, g1.invoice_no);
check("new total is stored (2 x 1500 + 18%)", g1.total_paise === 354000, g1.total_paise);
check("books balanced after edit", (await balanced()).ok, await balanced());

console.log("Payments block edit and delete until removed");
await admin.post(`/billing/sales/invoices/${i1.id}/payments`, { amountPaise: 100000, paymentMode: "CASH", branchId: g1.branch_id, date: "2026-11-24" });
check("partly paid", (await get(i1.id)).status === "PARTIALLY_PAID");
check("cannot edit while paid", (await admin.put(`/billing/sales/invoices/${i1.id}`, body(A))).status === 400);
check("cannot delete while paid", (await admin.delete(`/billing/sales/invoices/${i1.id}`)).status === 400);
const pays = (await get(i1.id)).payments ?? [];
let payId = pays[0]?.id;
if (!payId) { const l = await admin.get("/billing/payments?type=IN"); payId = (l.body.payments ?? []).find((p) => p.invoice_id === i1.id)?.id; }
check("payment id found", !!payId);
const rp = await admin.delete(`/billing/sales/payments/${payId}`, { reason: "entered twice" });
check("payment removed", rp.status === 200, rp.body);
const g2 = await get(i1.id);
check("invoice unpaid again", g2.status === "UNPAID" && g2.balance_amount_paise === 354000, [g2.status, g2.balance_amount_paise]);
check("books balanced after removing payment", (await balanced()).ok, await balanced());

console.log("Cancel keeps the number; edit gives it to another client");
check("cancelled", (await admin.post(`/billing/sales/invoices/${i1.id}/cancel`, { reason: "wrong client" })).status === 200);
check("books balanced after cancel", (await balanced()).ok);
const e2 = await admin.put(`/billing/sales/invoices/${i1.id}`, body(B, 1000, 200000));
check("cancelled invoice edited for another client", e2.status === 200, e2.body);
const g3 = await get(i1.id);
check("same number, new client, live again", g3.invoice_no === no1 && g3.party_id === B.id && g3.status === "UNPAID", [g3.invoice_no, g3.status]);
check("books balanced after reviving", (await balanced()).ok, await balanced());

console.log("Delete frees the number");
const del = await admin.delete(`/billing/sales/invoices/${i1.id}`, { reason: "created by mistake" });
check("delete works", del.status === 200, del.body);
check("deleted invoice is gone", (await admin.get(`/billing/sales/invoices/${i1.id}`)).status === 404);
const free = (await admin.get("/billing/sales/invoices/free-numbers")).body.numbers ?? [];
check("number is offered again", free.includes(no1), free);
const re = await admin.post("/billing/sales/invoices", body(A, 1000, 100000, { invoiceNo: no1 }));
check("new invoice on the same number", re.status === 201 && re.body.invoice.invoiceNo === no1, re.body);
check("number cannot be used twice", (await admin.post("/billing/sales/invoices", body(A, 1000, 100000, { invoiceNo: no1 }))).status === 400);
check("books balanced at the end", (await balanced()).ok, await balanced());
const del2 = await admin.delete(`/billing/sales/invoices/${re.body.invoice.id}`, { reason: "again" });
check("delete again works (number reused twice)", del2.status === 200);
check("books balanced after second delete", (await balanced()).ok);

console.log("Quotation to tax invoice");
const qt = await admin.post("/billing/documents", { docType: "QUOTATION", partyId: A.id, date: "2026-11-24", validUntil: "2026-12-10", status: "OPEN", lines: [{ itemId: item.id, name: item.name, hsnSac: "9983", unitId: unit.id, quantityThousandths: 1000, unitPricePaise: 100000, taxRateBasisPoints: 1800 }] });
check("quotation created", qt.status === 201, qt.body);
const qid = qt.body.document?.id ?? qt.body.id ?? qt.body.result?.id;
const cv = await admin.post(`/billing/documents/${qid}/convert`, { target: "INVOICE" });
check("quotation becomes a tax invoice", cv.status === 201 && !!cv.body.result?.id, cv.body);
check("invoice exists with the total", (await get(cv.body.result.id))?.total_paise === 118000);
check("books balanced after conversion", (await balanced()).ok);

console.log("GST summary");
const g = (await admin.get("/billing/reports/gst-summary?month=2026-10")).body;
check("GST summary answers", g.ok === true && g.invoiceCount > 0, g);
check("taxes add up (CGST = SGST for local sales)", g.totals.cgst === g.totals.sgst && g.totals.cgst > 0, g.totals);
const b2bTotal = g.b2b.reduce((a, r) => a + r.taxable, 0) + g.b2c.reduce((a, r) => a + r.taxable, 0);
check("B2B + B2C taxable equals the total taxable", b2bTotal === g.totals.taxable, [b2bTotal, g.totals.taxable]);
check("HSN rows add up to the same taxable value", g.hsn.reduce((a, r) => a + r.taxable, 0) === g.totals.taxable);
console.log("  October 2026:", g.invoiceCount, "invoices, taxable", g.totals.taxable / 100, "GST", (g.totals.cgst + g.totals.sgst + g.totals.igst) / 100);

const tally = await admin.get("/billing/accounting/tally-xml?startDate=2026-10-01&endDate=2026-10-31&companyName=Gexart");
check("Tally export answers", tally.status === 200, tally.status);

console.log("Payment receipt and log");
const ri = (await admin.post("/billing/sales/invoices", body(A, 3000, 100000))).body.invoice;
const rg = await get(ri.id);
await admin.post(`/billing/sales/invoices/${ri.id}/payments`, { amountPaise: 150000, paymentMode: "UPI", branchId: rg.branch_id, date: "2026-11-25", notes: "First instalment" });
const rpay = (await get(ri.id)).payments[0];
const rec = await admin.get(`/billing/payments/${rpay.id}/receipt`);
check("receipt is a real PDF", rec.status === 200 && rec.bytes?.subarray(0, 4).toString() === "%PDF" && rec.bytes.length > 1500, rec.status);
(await import("node:fs")).writeFileSync(process.env.RECEIPT_OUT || "receipt.pdf", rec.bytes);
const log = (await admin.get("/billing/payments?type=IN&limit=5")).body;
check("payment log lists it", (log.payments ?? []).some((p) => p.id === rpay.id) && log.totalPaise > 0, log.totalCount);
check("unknown payment gives 404", (await admin.get("/billing/payments/nope/receipt")).status === 404);

console.log("Payment date and UTR");
const di = (await admin.post("/billing/sales/invoices", body(A, 2000, 100000))).body.invoice;
const dg = await get(di.id);
const dp = await admin.post(`/billing/sales/invoices/${di.id}/payments`, { amountPaise: 100000, paymentMode: "UPI", branchId: dg.branch_id, date: "2026-11-18", referenceNo: "UTR" + run });
check("payment with date and UTR saved", dp.status === 200 || dp.status === 201, dp.body);
const dlog = (await admin.get(`/billing/payments?type=IN&limit=50&search=UTR${run}`)).body.payments ?? [];
check("log shows the UTR and the chosen date", dlog.length === 1 && dlog[0].reference_no === "UTR" + run && dlog[0].date === "2026-11-18", dlog[0]);
const nu = await admin.post(`/billing/sales/invoices/${di.id}/payments`, { amountPaise: 50000, paymentMode: "CASH", branchId: dg.branch_id, date: "2026-11-19" });
check("UTR is optional", nu.status === 200 || nu.status === 201, nu.body);
check("books balanced after dated payments", (await balanced()).ok);
const vend = (await admin.post("/billing/masters/parties", { name: `Pay Vendor ${run}`, phone: "9876500002", type: "VENDOR", stateCode: "19" })).body.party;
const pb = await admin.post("/billing/purchases/bills", { partyId: vend.id, vendorBillNo: `PV-${run}`, date: "2026-11-20", dueDate: "2026-12-20", lines: [{ itemId: item.id, quantityThousandths: 1000, unitPricePaise: 100000, taxRateBasisPoints: 1800 }] });
const pbId = pb.body.bill?.id ?? pb.body.id ?? pb.body.result?.id;
const pp = await admin.post(`/billing/purchases/bills/${pbId}/payments`, { amountPaise: 50000, paymentMode: "BANK", date: "2026-11-21", referenceNo: "UTRP" + run });
check("vendor payment with UTR saved", pp.status === 200 || pp.status === 201, pp.body);
const plog = (await admin.get(`/billing/payments?type=OUT&limit=50&search=UTRP${run}`)).body.payments ?? [];
check("vendor payment log shows UTR and date", plog.length === 1 && plog[0].date === "2026-11-21", plog[0]);

const ci = await admin.post("/billing/sales/invoices", { ...body(A, 1000, 100000, {}), paymentMode: "UPI", paidAmountPaise: 50000, paymentDate: "2026-11-17", paymentReference: "UTRC" + run });
check("invoice created with a dated, referenced payment", ci.status === 201, ci.body);
const clog = (await admin.get(`/billing/payments?type=IN&limit=50&search=UTRC${run}`)).body.payments ?? [];
check("that payment shows its UTR and its own date", clog.length === 1 && clog[0].date === "2026-11-17", clog[0]);
check("books balanced after that", (await balanced()).ok);

console.log("Edit a customer's details");
const ep = (await admin.post("/billing/masters/parties", { name: `Edit Me ${run}`, phone: "9876543210", type: "CUSTOMER", stateCode: "19", creditLimitPaise: 500000, creditDays: 15, tags: ["vip"], billingAddress: "Old Road" })).body.party;
const up = await admin.put(`/billing/masters/parties/${ep.id}`, { name: `Edited ${run}`, phone: "9123456780", billingAddress: "New Road, Kolkata" });
check("details updated", up.status === 200, up.body);
const eg = (await admin.get(`/billing/masters/parties/${ep.id}`)).body;
const gp = eg.party ?? eg;
check("name, phone and address changed", gp.name === `Edited ${run}` && gp.phone === "9123456780" && gp.billingAddress === "New Road, Kolkata", gp);
check("credit limit, credit days and tags untouched", gp.creditLimitPaise === 500000 && gp.creditDays === 15 && (gp.tags ?? []).includes("vip"), gp);

console.log("Delete a service");
const sv = (await admin.post("/billing/masters/items", { name: `Temp Service ${run}`, type: "SERVICE", unitId: unit.id, salePricePaise: 100000, taxRateId: tax.id, hsnSac: "9983" })).body.item;
const svi = (await admin.post("/billing/sales/invoices", { ...body(A), items: [{ itemId: sv.id, name: sv.name, hsnSac: "9983", quantityThousandths: 1000, unitId: unit.id, unitPricePaise: 100000, discountPaise: 0, taxRatePercent: 18 }] })).body.invoice;
check("service deleted", (await admin.delete(`/billing/masters/items/${sv.id}`)).status === 200);
const left = (await admin.get(`/billing/masters/items?search=${encodeURIComponent(`Temp Service ${run}`)}`)).body.items ?? [];
check("gone from the list", left.length === 0, left.length);
check("the invoice already made keeps it", (await get(svi.id)).lines[0].name === `Temp Service ${run}`);

console.log("Automatic numbers skip numbers already taken");
const n1 = (await admin.post("/billing/sales/invoices", body(A))).body.invoice.invoiceNo;
const num = (x) => Number(x.split("/")[1]);
const taken = [1, 2, 3].map((k) => n1.replace(`/${num(n1)}/`, `/${num(n1) + k}/`));
for (const t of taken) check(`number ${t} taken by hand`, (await admin.post("/billing/sales/invoices", body(A, 1000, 100000, { invoiceNo: t }))).status === 201);
const n2 = await admin.post("/billing/sales/invoices", body(A));
check("next automatic invoice is created", n2.status === 201, n2.body);
check("and it gets the first free number", n2.body.invoice?.invoiceNo && num(n2.body.invoice.invoiceNo) === num(n1) + 4, [n1, n2.body.invoice?.invoiceNo]);

console.log(failures === 0 ? "All edit and delete checks passed" : failures + " check(s) failed");
process.exit(failures ? 1 : 0);

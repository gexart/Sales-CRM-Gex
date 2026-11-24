# Billing, finance & accounting — import status

One-time copy of the GexPro billing/finance/accounting engine into this repo. After the copy there is no shared code,
database, API or login with GexPro/GexGrow; this CRM is the only live system.

## Layout
- `worker/billing/` — API + engine. `billing-do.ts` is `BillingDO`, one SQLite Durable Object per company (atomic postings,
  isolated books). `services/` (posting, invoice, purchase, accounting, inventory, GST, e-invoice…), `routes/`, `db/`.
- `shared/billing/` — GST engine, money, numbering, templates (alias `@billing/shared`).
- `worker/billing/index.ts` — mounts everything at `/api/v1/billing/*`; header `X-Company-Id` picks the company (default `default`).

## Imported
Masters (parties, items, units, taxes, banks), sales invoices/credit notes, quotations/proforma/orders/challans, purchases,
payments, expenses, inventory, double-entry accounting (journals, cheques, cost centres, fixed assets, bank statements, TDS/TCS),
reports, e-invoice/e-way bill hooks (off until credentials), numbering, notifications, offline sync.

## Left out on purpose
POS, restaurant, projects, HR/payroll, manufacturing, online orders, SaaS subscriptions/admin, webhooks, workflows, GexGrow auth.

## Access control (built)
- Roles are named permission bundles (`shared/access.ts`): Finance Manager, Accountant, Sales Executive, Billing Agent, Auditor, View only,
  plus any custom role. Per-user extras/denials on top. CRM `admin` always has everything. No billing role = no access.
- `worker/billing/index.ts` guard: every request is checked; routes with no rule are admin-only (deny by default).
  Sales invoice requests from people who may only "request" (or who exceed their discount cap / value threshold) are parked in
  `billing_approvals`; the real invoice exists only after someone with `invoice.approve` approves (atomic claim, no double create).
- Data scope: without `invoice.view_all` a user sees only invoices they created. Without `sales_analysis.view` the list has no totals/counts.
  Without `items.view_cost` purchase prices are removed from item responses.
- Append-only audit (`billing_audit`, DB triggers block update/delete): every write, approval, role and access change.
- API: `/api/v1/billing-access/{me,catalogue,roles,users,approvals,audit}`.
- Tests: `test/billing-access.test.ts` (unit), `node scripts/billing-smoke.mjs` (end-to-end, ~60 checks against `npm run dev`).

## Screens (built)
Billing home, approvals inbox (approve / reject with reason / withdraw), invoices (list, create or request, detail, record payment, cancel),
quotes & proforma & orders & challans (create, convert), parties, items, money & reports (collections, who owes, P&L, trial balance),
roles & access (roles, team assignment, audit log). Menu items appear only for permissions the user holds.

## Phone app (built)
- One Android app (`com.gexart.calls`): the full CRM and billing in a WebView plus the call recorder (`RecorderActivity`). WhatsApp, dialer, UPI and
  other sites open in their own apps. The web app can set up the recorder in one tap through the `GexartApp` bridge.
- PWA: `public/sw.js` (app shell offline, never caches /api), manifest shortcuts (Approvals, New invoice, Calls).
- Offline invoice requests are kept on the phone and sent when online; `x-client-ref` makes retries safe (migration 0010).
- Tap to call and WhatsApp on parties, invoices and the "who owes" list; reminders; optional automatic WhatsApp after saving / approving an invoice.
- Customers open `/i/:token` (no login) to view and pay by UPI. Token lookups are rate limited and expose no internal ids.
- Calls: Mapped / Unmapped tabs. Unmapped recordings can be mapped to a contact from the call drawer.

## Swipe-style depth (added)
- Menu groups: Sales (Invoices, Credit notes, Approvals), Quotations+ (Quotations, Sales orders, Pro forma, Delivery challans, Packing lists),
  Purchases (Purchases, Purchase orders, Debit notes), Billing (home, parties, items, reports, settings, roles).
- New invoice screen: customer and item search (HSN, tax, price), notes and terms from settings, extra discount in Rs or %, round off, totals panel,
  bank, payment received (mark fully paid), signature, Save as draft / Save and print / Save.
- Invoice PDF templates: "Classic black" (logo and company block, bill-to with place of supply, tax and HSN summary, UPI QR, bank, signature, notes,
  terms) and "Gexart letterhead"; also Word. Picked in Billing settings -> Invoice format, or `?template=classic|letterhead`.
- Billing settings: company details, logo and signature, banks and UPI (account numbers encrypted), notes and terms per document, invoice format,
  numbering, reminders.
- Drafts (per user), credit notes (list, create from an invoice), debit notes, purchases with payments.
- Fixed in the imported engine: partial credit notes with an odd tax amount posted a journal that was one paisa out of balance.

## Finishing pass
- Android app 2: opens the CRM full screen, pairs itself on first sign-in (no token to type), shows approval / approved / rejected / reminder
  notifications (polls `/api/v1/device/notifications` every 15 min with the device token; no Google push needed), opens the right screen when tapped,
  shows a retry page with no signal, keeps the call recorder.
- Attachments (up to 5 files, 5 MB each, private in R2), split payments, expenses and stock screens.

## Not done yet
- TDS/TCS toggles, reverse charge and e-invoice / e-way bill switches on the invoice form (the engine has the APIs; needs GSP credentials).
- Barcode and thermal print screens; subscriptions (recurring invoices) screen; stock adjustments and transfers screens.
- Push notifications to the phone (needs FCM/VAPID keys); today the app polls every 30 s while open.
- Voice-note / meeting recording types (calls only), mapping recordings to billing parties and invoices.
- JETSA data import; GSTR exports UI; purchases, expenses and inventory screens (APIs exist).
- Android app not compiled locally (no SDK here): built by GitHub Actions on push (`android.yml`).

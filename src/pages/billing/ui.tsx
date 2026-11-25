import { Link, NavLink } from "react-router";
import { MoreHorizontal, Plus } from "lucide-react";
import { Menu, MenuItem, cn } from "../../components/ui";
import { useBillingAccess } from "../../lib/billing";

/** The round + button, bottom right, above the tab bar on phones. */
export function Fab({ to, onClick, label = "Create" }: { to?: string; onClick?: () => void; label?: string }) {
  const cls = "fixed right-4 bottom-[4.75rem] z-30 flex size-14 items-center justify-center rounded-2xl bg-brand-500 text-snow shadow-lg shadow-black/30 transition-transform active:scale-95 lg:bottom-6 lg:right-6";
  return to ? (
    <Link to={to} aria-label={label} className={cls}><Plus className="size-7" /></Link>
  ) : (
    <button type="button" aria-label={label} onClick={onClick} className={cls}><Plus className="size-7" /></button>
  );
}

const MORE: { to: string; label: string; perm: string[] }[] = [
  { to: "/billing/payments", label: "Payments & receipts", perm: ["collections.view"] },
  { to: "/billing/credit-notes", label: "Credit notes", perm: ["invoice.view"] },
  { to: "/billing/debit-notes", label: "Debit notes", perm: ["purchases.view"] },
  { to: "/billing/sales-orders", label: "Sales orders", perm: ["documents.view", "sales_order.create"] },
  { to: "/billing/proforma", label: "Pro forma invoices", perm: ["documents.view", "proforma.create"] },
  { to: "/billing/challans", label: "Delivery challans", perm: ["documents.view", "challan.create"] },
  { to: "/billing/packing-lists", label: "Packing lists", perm: ["documents.view", "challan.create"] },
  { to: "/billing/purchase-orders", label: "Purchase orders", perm: ["purchases.view", "purchase_order.create"] },
  { to: "/billing/expenses", label: "Expenses", perm: ["expenses.view"] },
  { to: "/billing/approvals", label: "Approvals", perm: ["invoice.approve", "invoice.request"] },
];

/** Sales / Purchases / Quotations / More, shared by every list in the Bills area. */
export function BillsTabs() {
  const { any } = useBillingAccess();
  const tabs = [
    { to: "/billing/invoices", label: "Sales", perm: ["invoice.view"] },
    { to: "/billing/purchases", label: "Purchases", perm: ["purchases.view"] },
    { to: "/billing/quotations", label: "Quotations", perm: ["documents.view", "quotation.create"] },
  ].filter((t) => any(...t.perm));
  const more = MORE.filter((m) => any(...m.perm));
  return (
    <div className="-mx-4 mb-3 flex items-center border-b border-line px-4 sm:-mx-6 sm:px-6">
      <nav aria-label="Bills" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} className={({ isActive }) => cn("relative shrink-0 px-3 py-2.5 text-sm font-semibold", isActive ? "text-brand-600 after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-brand-500" : "text-slate-500")}>{t.label}</NavLink>
        ))}
      </nav>
      {more.length > 0 && (
        <Menu trigger={(p) => <button {...p} className="flex shrink-0 items-center gap-1 px-3 py-2.5 text-sm font-semibold text-slate-500">More<MoreHorizontal className="size-4" /></button>}>
          {(close: () => void) => more.map((m) => <Link key={m.to} to={m.to} onClick={close}><MenuItem>{m.label}</MenuItem></Link>)}
        </Menu>
      )}
    </div>
  );
}

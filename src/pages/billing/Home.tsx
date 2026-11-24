import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3, Boxes, ClipboardCheck, ClipboardList, FileMinus2, FilePlus2, FileSignature, FileText, FileX2, Lock, MoreHorizontal, Package, PackageCheck, Receipt, Settings, ShieldCheck, ShoppingCart,
  Truck, UserPlus, Users, WalletCards, type LucideIcon,
} from "lucide-react";
import { Dialog, EmptyState, Select, Skeleton } from "../../components/ui";
import { access, bill, inr, useBillingAccess } from "../../lib/billing";

type Tile = { to: string; label: string; icon: LucideIcon; show: boolean; hint?: string; onClick?: () => void };

function Grid({ tiles }: { tiles: Tile[] }) {
  return (
    <div className="grid grid-cols-4 gap-y-4 rounded-2xl border border-line bg-white p-3 dark:bg-white/5">
      {tiles.filter((t) => t.show).map((t) => (
        <Link key={t.label} to={t.to} onClick={(e) => { if (t.onClick) { e.preventDefault(); t.onClick(); } }} className="group relative flex flex-col items-center gap-1.5 rounded-lg px-1 py-1 text-center active:bg-slate-100 dark:active:bg-white/10">
          <span className="flex size-12 items-center justify-center rounded-xl bg-brand-50 text-brand-700 transition-colors group-hover:bg-brand-100 dark:bg-white/10 dark:text-brand-300"><t.icon className="size-6" /></span>
          <span className="text-[11.5px] leading-tight font-medium">{t.label}</span>
          {t.hint && <span className="absolute top-0 right-2 rounded-full bg-brand-500 px-1.5 text-[10px] font-semibold text-snow">{t.hint}</span>}
        </Link>
      ))}
    </div>
  );
}

function monthRange(offset: number) {
  const d = new Date();
  const a = new Date(d.getFullYear(), d.getMonth() + offset, 1);
  const b = new Date(d.getFullYear(), d.getMonth() + offset + 1, 0);
  const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  return { from: iso(a), to: iso(b) };
}
function fyRange() {
  const d = new Date();
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return { from: `${y}-04-01`, to: `${y + 1}-03-31` };
}

/** Landing page of billing, laid out for a thumb: totals, a Create grid, and quick access. */
export function BillingHome() {
  const { can, any, access: me, hasBilling, loading } = useBillingAccess();
  const [period, setPeriod] = useState("0");
  const [sheet, setSheet] = useState(false);
  const range = period === "fy" ? fyRange() : monthRange(Number(period));
  const pend = useQuery({ queryKey: ["billing-pending"], queryFn: () => access.get("/approvals?status=pending"), enabled: hasBilling, refetchInterval: 30_000 });
  const sales = useQuery({ queryKey: ["billing-home-sales", range.from, range.to], queryFn: () => bill.get(`/sales/invoices?limit=1&startDate=${range.from}&endDate=${range.to}`), enabled: can("invoice.view") && can("sales_analysis.view") });
  const buys = useQuery({ queryKey: ["billing-home-bills"], queryFn: () => bill.get("/purchases/bills?limit=500"), enabled: can("purchases.view") });
  const settings = useQuery({ queryKey: ["billing-settings"], queryFn: () => bill.get("/settings/billing"), enabled: can("settings.view"), staleTime: 60_000 });
  if (!loading && !hasBilling) return <div className="p-6"><EmptyState icon={Lock} title="You do not have billing access yet" body="Ask an administrator to give you a billing role." /></div>;
  const purchaseTotal = (buys.data?.bills ?? []).filter((b: any) => b.date >= range.from && b.date <= range.to && b.status !== "CANCELLED").reduce((a: number, b: any) => a + (b.total_paise ?? 0), 0); // eslint-disable-line @typescript-eslint/no-explicit-any
  const showTotals = can("sales_analysis.view") || can("purchases.view");

  const create: Tile[] = [
    { to: "/billing/invoices/new", label: can("invoice.create") ? "Invoice" : "Request invoice", icon: FilePlus2, show: can("invoice.create") || can("invoice.request") },
    { to: "/billing/purchases?new=1", label: "Purchase", icon: ShoppingCart, show: can("purchases.create") },
    { to: "/billing/quotations?new=1", label: "Quotation", icon: FileSignature, show: can("quotation.create") },
    { to: "/billing/expenses?new=1", label: "Expenses", icon: Receipt, show: can("expenses.create") },
    { to: "/billing/proforma?new=1", label: "Pro Forma Invoice", icon: FileText, show: can("proforma.create") },
    { to: "/billing/challans?new=1", label: "Delivery Challan", icon: Truck, show: can("challan.create") },
    { to: "/billing/credit-notes", label: "Credit Note", icon: FileMinus2, show: can("invoice.credit_note") },
  ];
  const moreCreate: Tile[] = [
    { to: "/billing/sales-orders?new=1", label: "Sales Order", icon: ClipboardList, show: can("sales_order.create") },
    { to: "/billing/packing-lists?new=1", label: "Packing List", icon: PackageCheck, show: can("challan.create") },
    { to: "/billing/purchase-orders?new=1", label: "Purchase Order", icon: ShoppingCart, show: can("purchase_order.create") },
    { to: "/billing/debit-notes", label: "Debit Note", icon: FileX2, show: can("purchases.create") },
    { to: "/billing/parties?new=1", label: "Customer", icon: UserPlus, show: can("parties.manage") },
    { to: "/billing/items?new=1", label: "Product / Service", icon: Package, show: can("items.manage") },
  ];
  const quick: Tile[] = [
    { to: "/billing/approvals", label: can("invoice.approve") ? "Approvals" : "My requests", icon: ClipboardCheck, show: can("invoice.approve") || can("invoice.request"), hint: pend.data?.pending ? String(pend.data.pending) : undefined },
    { to: "/billing/reports", label: "Reports", icon: BarChart3, show: any("reports.view", "accounting.view") },
    { to: "/billing/reports", label: "Payments", icon: WalletCards, show: can("collections.view") },
    { to: "/billing/stock", label: "Stock", icon: Boxes, show: can("inventory.view") },
    { to: "/billing/invoices?tab=drafts", label: "Drafts", icon: FileText, show: any("invoice.create", "invoice.request") },
    { to: "/billing/settings?tab=format", label: "Invoice Templates", icon: FileSignature, show: any("settings.view", "settings.manage") },
    { to: "/billing/settings", label: "Document Settings", icon: Settings, show: any("settings.view", "settings.manage") },
    { to: "/billing/parties", label: "Parties", icon: Users, show: can("parties.view") },
    { to: "/billing/access", label: "Roles & Access", icon: ShieldCheck, show: any("roles.manage", "audit.view") },
  ];
  const visibleCreate = create.filter((t) => t.show);
  const hasMore = moreCreate.some((t) => t.show);
  const company = settings.data?.billing?.company?.legalName;
  const Section = ({ title, children }: { title: string; children: ReactNode }) => <section className="space-y-2.5"><h2 className="px-1 text-lg font-semibold tracking-tight">{title}</h2>{children}</section>;

  return (
    <div className="space-y-5 px-4 pt-4 pb-8 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0"><div className="truncate text-[17px] font-semibold">{company || "Billing"}</div><div className="text-xs text-muted">{me?.roleName ? `Signed in as ${me.roleName}` : ""}</div></div>
      </div>
      {showTotals && (
        <div className="rounded-2xl border border-line bg-white p-4 dark:bg-white/5">
          <div className="flex items-center justify-between">
            <Select className="w-40 border-0 bg-transparent px-0 text-base font-semibold" value={period} onChange={(e) => setPeriod(e.target.value)} options={[{ value: "0", label: "This month" }, { value: "-1", label: "Last month" }, { value: "fy", label: "This year" }]} />
            {can("invoice.view") && <Link to="/billing/invoices" className="text-sm font-medium text-brand-600">View bills</Link>}
          </div>
          <div className="mt-2 grid grid-cols-2 divide-x divide-line">
            <div className="pr-3"><div className="text-xs text-muted">Sales</div><div className="text-xl font-semibold tabular-nums sm:text-2xl">{sales.isLoading ? <Skeleton className="mt-1 h-7 w-24" /> : inr(sales.data?.totals?.totalSalesPaise)}</div></div>
            <div className="pl-3"><div className="text-xs text-muted">Purchases</div><div className="text-xl font-semibold tabular-nums sm:text-2xl">{buys.isLoading ? <Skeleton className="mt-1 h-7 w-24" /> : inr(purchaseTotal)}</div></div>
          </div>
          {sales.data?.totals && <div className="mt-3 flex gap-4 border-t border-line pt-2.5 text-xs"><span className="text-muted">Received <b className="text-ink tabular-nums">{inr(sales.data.totals.totalPaidPaise)}</b></span><span className="text-muted">Pending <b className="text-ink tabular-nums">{inr(sales.data.totals.totalPendingPaise)}</b></span></div>}
        </div>
      )}
      {visibleCreate.length > 0 && (
        <Section title="Create">
          <Grid tiles={[...visibleCreate.slice(0, hasMore ? 7 : 8), ...(hasMore ? [{ to: "/billing", label: "More", icon: MoreHorizontal, show: true, onClick: () => setSheet(true) }] : [])]} />
        </Section>
      )}
      <Section title="Quick Access"><Grid tiles={quick} /></Section>
      <Dialog open={sheet} onClose={() => setSheet(false)} title="Create">
        <div onClick={() => setSheet(false)}><Grid tiles={moreCreate} /></div>
      </Dialog>
    </div>
  );
}

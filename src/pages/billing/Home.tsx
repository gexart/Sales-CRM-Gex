import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, ClipboardCheck, FilePlus2, FileSignature, Lock, Receipt, ShieldCheck, Users } from "lucide-react";
import { PageHeader } from "../../components/layout";
import { Card, EmptyState } from "../../components/ui";
import { access, bill, inr, useBillingAccess } from "../../lib/billing";

/** Landing page of the billing area: what needs attention and the things this person can do. */
export function BillingHome() {
  const { can, access: me, hasBilling, loading } = useBillingAccess();
  const pend = useQuery({ queryKey: ["billing-pending"], queryFn: () => access.get("/approvals?status=pending"), enabled: hasBilling, refetchInterval: 30_000 });
  const inv = useQuery({ queryKey: ["billing-invoices", "home"], queryFn: () => bill.get("/sales/invoices?limit=1"), enabled: can("invoice.view") });
  if (!loading && !hasBilling) return <div className="p-6"><EmptyState icon={Lock} title="You do not have billing access yet" body="Ask an administrator to give you a billing role." /></div>;
  const tiles: { to: string; label: string; hint?: string; icon: typeof Receipt; show: boolean }[] = [
    { to: "/billing/approvals", label: can("invoice.approve") ? "Approvals" : "My requests", hint: pend.data?.pending ? `${pend.data.pending} pending` : undefined, icon: ClipboardCheck, show: can("invoice.approve") || can("invoice.request") },
    { to: "/billing/invoices/new", label: can("invoice.create") ? "New invoice" : "Request invoice", icon: FilePlus2, show: can("invoice.create") || can("invoice.request") },
    { to: "/billing/invoices", label: "Sales invoices", icon: Receipt, show: can("invoice.view") },
    { to: "/billing/documents", label: "Quotes & proforma", icon: FileSignature, show: can("documents.view") || can("quotation.create") || can("proforma.create") },
    { to: "/billing/parties", label: "Parties", icon: Users, show: can("parties.view") },
    { to: "/billing/reports", label: "Money & reports", icon: BarChart3, show: can("collections.view") || can("reports.view") || can("accounting.view") },
    { to: "/billing/access", label: "Roles & access", icon: ShieldCheck, show: can("roles.manage") || can("audit.view") },
  ];
  const t = inv.data?.totals;
  return (
    <div className="pb-8">
      <PageHeader title="Billing" subtitle={me?.roleName ? `Signed in as ${me.roleName}` : undefined} />
      <div className="space-y-4 px-4 sm:px-6">
        {t && (
          <div className="grid grid-cols-3 gap-2">
            {[["Billed", t.totalSalesPaise], ["Received", t.totalPaidPaise], ["Pending", t.totalPendingPaise]].map(([l, v]) => (
              <Card key={l as string} className="p-3"><div className="text-[11px] text-muted">{l}</div><div className="text-[15px] font-semibold tabular-nums sm:text-xl">{inr(v as number)}</div></Card>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {tiles.filter((x) => x.show).map((x) => (
            <Link key={x.to} to={x.to}>
              <Card className="flex h-28 flex-col justify-between p-3.5 transition-colors hover:bg-slate-50 dark:hover:bg-white/5">
                <x.icon className="size-6 text-brand-600" />
                <div><div className="font-semibold">{x.label}</div>{x.hint && <div className="text-xs font-medium text-amber-600">{x.hint}</div>}</div>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Lock } from "lucide-react";
import { PageHeader } from "../../components/layout";
import { Badge, Card, EmptyState, ErrorState, Skeleton, Tabs } from "../../components/ui";
import { date as fmtDate } from "../../lib/format";
import { bill, inr, useBillingAccess } from "../../lib/billing";
import { PhoneActions } from "../../components/contact-actions";
import { reminderMessage } from "../../lib/invoice-share";

type Tab = "collections" | "aging" | "pl" | "tb" | "tds";

/** Money in, who owes what, profit and loss, and the trial balance. Each tab appears only if the role allows it. */
export function ReportsBillingPage() {
  const { can } = useBillingAccess();
  const tabs = ([
    can("collections.view") && { value: "collections", label: "Collections" },
    can("reports.view") && { value: "aging", label: "Who owes" },
    can("reports.view") && { value: "pl", label: "Profit & loss" },
    can("accounting.view") && { value: "tb", label: "Trial balance" },
    can("accounting.view") && { value: "tds", label: "TDS" },
  ].filter(Boolean)) as { value: Tab; label: string }[];
  const [tab, setTab] = useState<Tab>("collections");
  if (!tabs.length) return <div className="p-6"><EmptyState icon={Lock} title="No reports for your role" body="Ask an administrator if you need these." /></div>;
  const cur = tabs.some((t) => t.value === tab) ? tab : tabs[0]!.value;
  return (
    <div className="pb-8">
      <PageHeader title="Money & reports" icon={BarChart3} />
      <div className="px-4 sm:px-6">
        <Tabs<Tab> tabs={tabs} value={cur} onChange={setTab} />
        <div className="mt-3">{cur === "collections" ? <Collections /> : cur === "aging" ? <Aging /> : cur === "pl" ? <PL /> : cur === "tds" ? <Tds /> : <TB />}</div>
      </div>
    </div>
  );
}

function useQ(key: string, path: string) {
  return useQuery({ queryKey: ["billing-report", key], queryFn: () => bill.get(path) });
}

function Collections() {
  const q = useQ("in", "/payments?type=IN&limit=100");
  if (q.isError) return <ErrorState error={q.error} />;
  if (q.isLoading) return <Skeleton className="h-24" />;
  const rows: any[] = q.data.payments ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
  return (
    <div className="space-y-3">
      <Card className="p-3.5"><div className="text-xs text-muted">Total received</div><div className="text-2xl font-semibold tabular-nums">{inr(q.data.totalPaise)}</div>
        <div className="mt-1 flex flex-wrap gap-1.5">{Object.entries(q.data.byMode ?? {}).map(([m, v]) => <Badge key={m}>{m} {inr(v as number)}</Badge>)}</div></Card>
      {rows.length === 0 ? <Card><EmptyState icon={BarChart3} title="No payments yet" /></Card> : (
        <Card className="divide-y divide-line">{rows.map((p) => (
          <div key={p.id} className="flex items-center gap-3 px-3.5 py-2.5"><div className="min-w-0 flex-1"><div className="truncate font-medium">{p.partyName ?? p.party_name ?? "Customer"}</div><div className="text-xs text-muted">{p.paymentNo ?? p.payment_no} · {fmtDate(p.date)} · {p.mode}</div></div><div className="font-semibold tabular-nums">{inr(p.amountPaise ?? p.amount_paise)}</div></div>
        ))}</Card>
      )}
    </div>
  );
}

function Aging() {
  const q = useQ("aging", "/reports/aging");
  if (q.isError) return <ErrorState error={q.error} />;
  if (q.isLoading) return <Skeleton className="h-24" />;
  const rows: any[] = q.data.rows ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!rows.length) return <Card><EmptyState icon={BarChart3} title="Nobody owes you anything" /></Card>;
  return (
    <Card className="divide-y divide-line">{rows.map((r) => (
      <div key={r.partyId} className="px-3.5 py-2.5">
        <div className="flex justify-between gap-2"><span className="truncate font-medium">{r.partyName}</span><span className="font-semibold tabular-nums">{inr(r.totalOutstandingPaise)}</span></div>
        {r.phone && <div className="mt-1 text-xs"><PhoneActions phone={r.phone} greeting={reminderMessage({ party: r.partyName, outstandingPaise: r.totalOutstandingPaise })} /></div>}
        <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-muted"><span>0–30: {inr(r.bucket0to30Paise)}</span><span>31–60: {inr(r.bucket31to60Paise)}</span><span>61–90: {inr(r.bucket61to90Paise)}</span><span className={r.bucket90PlusPaise ? "text-red-600" : ""}>90+: {inr(r.bucket90PlusPaise)}</span></div>
      </div>
    ))}</Card>
  );
}

function PL() {
  const q = useQ("pl", "/reports/profit-loss");
  if (q.isError) return <ErrorState error={q.error} />;
  if (q.isLoading) return <Skeleton className="h-24" />;
  const d = q.data;
  const row = (l: string, v: number, strong = false) => <div className={`flex justify-between py-1 ${strong ? "border-t border-line pt-2 text-base font-semibold" : ""}`}><span className={strong ? "" : "text-muted"}>{l}</span><span className="tabular-nums">{inr(v)}</span></div>;
  return (
    <Card className="p-3.5 text-[13px]">
      <div className="mb-2 text-xs text-muted">{fmtDate(d.startDate)} to {fmtDate(d.endDate)}</div>
      {row("Sales & operating income", d.operatingRevenuePaise)}{row("Other income", d.otherIncomePaise)}{row("Cost of goods sold", -d.costOfGoodsSoldPaise)}{row("Gross profit", d.grossProfitPaise, true)}
      {row("Operating expenses", -d.operatingExpensesPaise)}{row("Net profit", d.netProfitPaise, true)}
    </Card>
  );
}

function TB() {
  const q = useQ("tb", "/accounting/trial-balance");
  if (q.isError) return <ErrorState error={q.error} />;
  if (q.isLoading) return <Skeleton className="h-24" />;
  const t = q.data.trialBalance;
  return (
    <Card className="text-[13px]">
      <div className="flex items-center justify-between px-3.5 py-2.5"><span className="font-medium">Trial balance</span><Badge tone={q.data.isBalanced ? "green" : "red"}>{q.data.isBalanced ? "Balanced" : "Out of balance"}</Badge></div>
      <div className="divide-y divide-line border-t border-line">
        {(t.accounts ?? []).map((a: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
          <div key={a.code} className="grid grid-cols-[3rem_1fr_6rem_6rem] items-center gap-2 px-3.5 py-1.5"><span className="text-muted">{a.code}</span><span className="truncate">{a.name}</span><span className="text-right tabular-nums">{a.netDebitPaise ? inr(a.netDebitPaise) : ""}</span><span className="text-right tabular-nums">{a.netCreditPaise ? inr(a.netCreditPaise) : ""}</span></div>
        ))}
        <div className="grid grid-cols-[3rem_1fr_6rem_6rem] gap-2 px-3.5 py-2 font-semibold"><span /><span>Total</span><span className="text-right tabular-nums">{inr(t.totalDebitPaise)}</span><span className="text-right tabular-nums">{inr(t.totalCreditPaise)}</span></div>
      </div>
    </Card>
  );
}

function Tds() {
  const acc = useQ("tds-acc", "/accounting/accounts");
  const rep = useQ("tds-rep", "/accounting/tds/report");
  if (acc.isError) return <ErrorState error={acc.error} />;
  if (acc.isLoading) return <Skeleton className="h-24" />;
  const bal = (code: string) => (acc.data.accounts ?? []).find((a: any) => a.code === code)?.balance_paise ?? 0; // eslint-disable-line @typescript-eslint/no-explicit-any
  const sections: any[] = rep.data?.report?.sections ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Card className="p-3"><div className="text-[11px] text-muted">TDS receivable (customers deducted)</div><div className="text-lg font-semibold tabular-nums">{inr(bal("1350"))}</div></Card>
        <Card className="p-3"><div className="text-[11px] text-muted">TDS payable (to deposit)</div><div className="text-lg font-semibold tabular-nums">{inr(bal("2240"))}</div></Card>
      </div>
      <Card className="divide-y divide-line">
        <div className="px-3.5 py-2 text-xs font-medium text-muted">TDS on purchases, by section</div>
        {sections.length === 0 ? <div className="px-3.5 py-3 text-xs text-muted">Nothing recorded yet. Use the TDS button on a purchase or an invoice.</div> : sections.map((s) => (
          <div key={s.section} className="flex items-center justify-between px-3.5 py-2.5 text-[13px]"><span className="font-medium">{s.section}</span><span className="text-muted">{s.count} · taxable {inr(s.totalTaxablePaise)}</span><span className="font-semibold tabular-nums">{inr(s.totalTdsPaise)}</span></div>
        ))}
      </Card>
    </div>
  );
}

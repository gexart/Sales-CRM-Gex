import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Download, Receipt, Search, WalletCards } from "lucide-react";
import { PageHeader } from "../../components/layout";
import { useDebounced } from "../../components/forms";
import { Button, Card, EmptyState, ErrorState, Select, Skeleton, Tabs } from "../../components/ui";
import { date as fmtDate } from "../../lib/format";
import { bill, inr } from "../../lib/billing";

type Dir = "IN" | "OUT";
type Range = "month" | "last" | "year" | "all";
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const iso = (d: Date) => d.toISOString().slice(0, 10);
function rangeDates(r: Range): { startDate?: string; endDate?: string } {
  const n = new Date();
  if (r === "month") return { startDate: iso(new Date(n.getFullYear(), n.getMonth(), 1)), endDate: iso(n) };
  if (r === "last") return { startDate: iso(new Date(n.getFullYear(), n.getMonth() - 1, 1)), endDate: iso(new Date(n.getFullYear(), n.getMonth(), 0)) };
  if (r === "year") {
    const fy = n.getMonth() >= 3 ? n.getFullYear() : n.getFullYear() - 1; // Indian financial year starts 1 April
    return { startDate: `${fy}-04-01`, endDate: iso(n) };
  }
  return {};
}
const MODE: Record<string, string> = { CASH: "Cash", UPI: "UPI", BANK: "Bank", CARD: "Card", NET_BANKING: "Net banking", CHEQUE: "Cheque" };

/** Every payment received from customers (and made to vendors): filter, total by mode, open a receipt, export to Excel. */
export function PaymentsPage() {
  const [dir, setDir] = useState<Dir>("IN");
  const [range, setRange] = useState<Range>("month");
  const [mode, setMode] = useState("");
  const [search, setSearch] = useState("");
  const dq = useDebounced(search, 300);
  const { startDate, endDate } = rangeDates(range);
  const qs = new URLSearchParams({ type: dir, limit: "500", ...(startDate ? { startDate } : {}), ...(endDate ? { endDate } : {}), ...(mode ? { mode } : {}), ...(dq ? { search: dq } : {}) }).toString();
  const q = useQuery({ queryKey: ["billing-payments", qs], queryFn: () => bill.get(`/payments?${qs}`) });
  const rows: Row[] = q.data?.payments ?? [];
  const byMode: Record<string, number> = q.data?.byMode ?? {};

  const exportCsv = () => {
    const esc = (v: string | number) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["Receipt no", "Date", dir === "IN" ? "Received from" : "Paid to", "Invoice", "Mode", "Reference", "Amount", "Notes"];
    const text = [head, ...rows.map((r) => [r.payment_no, r.date, r.party_name ?? "", r.invoice_no ?? "", MODE[r.mode] ?? r.mode, r.reference_no ?? "", r.amount_paise / 100, r.notes ?? ""])].map((r) => r.map(esc).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv" }));
    a.download = `payments-${dir === "IN" ? "received" : "made"}-${iso(new Date())}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="pb-8">
      <PageHeader title="Payments" icon={WalletCards} actions={rows.length > 0 && <Button icon={Download} onClick={exportCsv}>Excel</Button>} />
      <div className="space-y-3 px-4 sm:px-6">
        <Tabs<Dir> value={dir} onChange={setDir} tabs={[{ value: "IN", label: "Received" }, { value: "OUT", label: "Made" }]} />
        <div className="grid grid-cols-2 gap-2">
          <Select value={range} onChange={(e) => setRange(e.target.value as Range)} options={[{ value: "month", label: "This month" }, { value: "last", label: "Last month" }, { value: "year", label: "This financial year" }, { value: "all", label: "All time" }]} />
          <Select value={mode} onChange={(e) => setMode(e.target.value)} placeholder="All modes" options={Object.entries(MODE).map(([value, label]) => ({ value, label }))} />
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-slate-400" />
          <input className="input pl-8" placeholder="Search receipt, customer or reference" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {q.data && (
          <Card className="p-3.5">
            <div className="text-[11px] font-medium tracking-wide text-muted uppercase">{dir === "IN" ? "Total received" : "Total paid"} · {q.data.totalCount} payments</div>
            <div className="mt-0.5 text-2xl font-semibold tabular-nums">{inr(q.data.totalPaise)}</div>
            {Object.keys(byMode).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {Object.entries(byMode).map(([m, v]) => (
                  <span key={m} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs tabular-nums dark:bg-white/10">{MODE[m] ?? m} <b>{inr(v)}</b></span>
                ))}
              </div>
            )}
          </Card>
        )}
        {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.isLoading ? <Skeleton className="h-32" /> : rows.length === 0 ? (
          <Card><EmptyState icon={WalletCards} title="No payments found" body="Try another period or mode." /></Card>
        ) : (
          <Card className="divide-y divide-line">
            {rows.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-3.5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 font-medium leading-snug">{r.party_name ?? "-"}</div>
                  <div className="text-xs text-muted">
                    {r.payment_no} · {fmtDate(r.date)} · {MODE[r.mode] ?? r.mode}
                    {r.invoice_no && r.invoice_id ? <> · <Link className="underline underline-offset-2" to={`/billing/invoices/${r.invoice_id}`}>{r.invoice_no}</Link></> : null}
                  </div>
                  {r.reference_no && <div className="truncate text-xs text-muted">Ref {r.reference_no}</div>}
                </div>
                <div className="text-right">
                  <div className="font-semibold tabular-nums">{inr(r.amount_paise)}</div>
                  {dir === "IN" && (
                    <button type="button" className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-brand-700 underline-offset-2 hover:underline" onClick={() => window.open(`/api/v1/billing/payments/${r.id}/receipt?inline=1&name=${encodeURIComponent(r.payment_no)}`, "_blank", "noopener")}>
                      <Receipt className="size-3.5" /> Receipt
                    </button>
                  )}
                </div>
              </div>
            ))}
          </Card>
        )}
      </div>
    </div>
  );
}

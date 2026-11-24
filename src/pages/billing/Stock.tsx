import { useState } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, Plus, Receipt, Search } from "lucide-react";
import { PageHeader } from "../../components/layout";
import { useDebounced } from "../../components/forms";
import { Badge, Button, Card, Dialog, EmptyState, ErrorState, Field, Select, Skeleton, useToast } from "../../components/ui";
import { date as fmtDate } from "../../lib/format";
import { bill, errMsg, inr, useBillingAccess } from "../../lib/billing";
import { rupeesToPaise } from "./parts";
import { Fab } from "./ui";

export function ExpensesPage() {
  const { can } = useBillingAccess();
  const qc = useQueryClient();
  const toast = useToast();
  const [sp] = useSearchParams();
  const [add, setAdd] = useState(sp.get("new") === "1" && can("expenses.create"));
  const [f, setF] = useState({ category: "", payFrom: "", amount: "", payee: "", mode: "CASH", notes: "", gst: "0" });
  const list = useQuery({ queryKey: ["billing-expenses"], queryFn: () => bill.get("/expenses") });
  const sum = useQuery({ queryKey: ["billing-expense-summary"], queryFn: () => bill.get("/expenses/summary") });
  const accounts = useQuery({ queryKey: ["billing-accounts"], queryFn: () => bill.get("/accounting/accounts"), enabled: add && can("accounting.view"), staleTime: 120_000 });
  const accs: any[] = accounts.data?.accounts ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const cats = accs.filter((a) => a.type === "EXPENSE");
  const pay = accs.filter((a) => a.subtype === "CASH" || a.subtype === "BANK");
  const rows: any[] = list.data?.expenses ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const total = (sum.data?.summary ?? []).reduce((a: number, s: any) => a + s.total_paise, 0); // eslint-disable-line @typescript-eslint/no-explicit-any
  const save = useMutation({
    mutationFn: () => bill.post("/expenses", { categoryAccountId: f.category, paymentAccountId: f.payFrom || pay.find((p) => p.subtype === (f.mode === "CASH" ? "CASH" : "BANK"))?.id, amountPaise: rupeesToPaise(f.amount), payee: f.payee || undefined, paymentMode: f.mode, notes: f.notes || undefined, taxRateBasisPoints: Math.round(Number(f.gst) * 100), claimsItc: Number(f.gst) > 0 }),
    onSuccess: () => (toast("success", "Expense saved"), setAdd(false), setF({ ...f, amount: "", payee: "", notes: "" }), qc.invalidateQueries({ queryKey: ["billing-expenses"] }), qc.invalidateQueries({ queryKey: ["billing-expense-summary"] })),
    onError: (e) => toast("error", errMsg(e)),
  });
  return (
    <div className="pb-8">
      <PageHeader title="Expenses" icon={Receipt} actions={can("expenses.create") && <Button variant="primary" icon={Plus} onClick={() => setAdd(true)}>Add expense</Button>} />
      <div className="space-y-3 px-4 sm:px-6">
        <Card className="p-3.5"><div className="text-xs text-muted">Total spent</div><div className="text-2xl font-semibold tabular-nums">{inr(total)}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">{(sum.data?.summary ?? []).map((s: any) => <Badge key={s.category_name}>{s.category_name} {inr(s.total_paise)}</Badge>)}</div></Card> {/* eslint-disable-line @typescript-eslint/no-explicit-any */}
        {list.isError ? <ErrorState error={list.error} /> : list.isLoading ? <Skeleton className="h-24" /> : rows.length === 0 ? <Card><EmptyState icon={Receipt} title="No expenses yet" /></Card> : (
          <Card className="divide-y divide-line">{rows.map((e) => (
            <div key={e.id} className="flex items-center gap-3 px-3.5 py-2.5"><div className="min-w-0 flex-1"><div className="truncate font-medium">{e.payee || e.notes || "Expense"}</div><div className="text-xs text-muted">{e.expense_no} · {fmtDate(e.date)} · {e.payment_mode}</div></div><div className="font-semibold tabular-nums">{inr(e.amount_paise)}</div></div>
          ))}</Card>
        )}
      </div>
      {can("expenses.create") && <Fab onClick={() => setAdd(true)} label="Add expense" />}
      <Dialog open={add} onClose={() => setAdd(false)} title="Add expense" footer={<><Button onClick={() => setAdd(false)}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.category || !f.amount} onClick={() => save.mutate()}>Save</Button></>}>
        <div className="space-y-3">
          <Field label="Category" required><Select value={f.category} placeholder="Choose" onChange={(e) => setF({ ...f, category: e.target.value })} options={cats.map((a) => ({ value: a.id, label: a.name }))} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (₹)" required><input className="input" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
            <Field label="GST in this amount %"><Select value={f.gst} onChange={(e) => setF({ ...f, gst: e.target.value })} options={["0", "5", "12", "18", "28"].map((v) => ({ value: v, label: `${v}%` }))} /></Field>
            <Field label="Paid by"><Select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })} options={["CASH", "UPI", "BANK"].map((v) => ({ value: v, label: v[0] + v.slice(1).toLowerCase() }))} /></Field>
            <Field label="Paid from"><Select value={f.payFrom} placeholder="Automatic" onChange={(e) => setF({ ...f, payFrom: e.target.value })} options={pay.map((a) => ({ value: a.id, label: a.name }))} /></Field>
          </div>
          <Field label="Paid to"><input className="input" value={f.payee} onChange={(e) => setF({ ...f, payee: e.target.value })} /></Field>
          <Field label="Notes"><input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
      </Dialog>
    </div>
  );
}

export function InventoryPage() {
  const [search, setSearch] = useState("");
  const dq = useDebounced(search, 300);
  const [low, setLow] = useState(false);
  const q = useQuery({ queryKey: ["billing-stock", dq], queryFn: () => bill.get(`/inventory/summary?search=${encodeURIComponent(dq)}`) });
  const rows: any[] = (q.data?.summary ?? []).filter((r: any) => !low || r.isLowStock); // eslint-disable-line @typescript-eslint/no-explicit-any
  const value = (q.data?.summary ?? []).reduce((a: number, r: any) => a + (r.valuationPaise ?? 0), 0); // eslint-disable-line @typescript-eslint/no-explicit-any
  return (
    <div className="pb-8">
      <PageHeader title="Stock" icon={Boxes} subtitle="What you hold, and what is running low" />
      <div className="space-y-3 px-4 sm:px-6">
        <div className="grid grid-cols-2 gap-2"><Card className="p-3"><div className="text-[11px] text-muted">Stock value</div><div className="text-lg font-semibold tabular-nums">{inr(value)}</div></Card><Card className="p-3"><div className="text-[11px] text-muted">Running low</div><div className="text-lg font-semibold tabular-nums">{(q.data?.summary ?? []).filter((r: any) => r.isLowStock).length}</div></Card></div> {/* eslint-disable-line @typescript-eslint/no-explicit-any */}
        <div className="flex gap-2"><div className="relative flex-1"><Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-slate-400" /><input className="input pl-8" placeholder="Search items" value={search} onChange={(e) => setSearch(e.target.value)} /></div><label className="flex items-center gap-1.5 text-xs"><input type="checkbox" className="size-4" checked={low} onChange={(e) => setLow(e.target.checked)} />Low only</label></div>
        {q.isError ? <ErrorState error={q.error} /> : q.isLoading ? <Skeleton className="h-24" /> : rows.length === 0 ? <Card><EmptyState icon={Boxes} title="No stock to show" /></Card> : (
          <Card className="divide-y divide-line">{rows.map((r) => (
            <div key={`${r.itemId}-${r.warehouseId}`} className="flex items-center gap-3 px-3.5 py-2.5">
              <div className="min-w-0 flex-1"><div className="truncate font-medium">{r.itemName}</div><div className="text-xs text-muted">{r.warehouseName}{r.category ? ` · ${r.category}` : ""}</div></div>
              <div className="text-right"><div className="font-semibold tabular-nums">{r.currentQtyThousandths / 1000} {r.unit}</div><div className="text-xs text-muted tabular-nums">{inr(r.valuationPaise)}</div></div>
              {r.isLowStock && <Badge tone="red">Low</Badge>}
            </div>
          ))}</Card>
        )}
      </div>
    </div>
  );
}

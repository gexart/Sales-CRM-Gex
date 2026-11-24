import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileMinus2, FileX2, Plus, ShoppingCart, Wallet } from "lucide-react";
import { PageHeader } from "../../components/layout";
import { Badge, Button, Card, Dialog, EmptyState, ErrorState, Field, Select, Skeleton, SlideOver, Tabs, useToast } from "../../components/ui";
import { date as fmtDate } from "../../lib/format";
import { addDays, bill, errMsg, inr, today, useBillingAccess } from "../../lib/billing";
import { LineEditor, PartyPicker, blankLine, rupeesToPaise, totalsOf, type Line, type Party } from "./parts";

const TONE: Record<string, "green" | "amber" | "red" | "gray"> = { PAID: "green", UNPAID: "amber", PARTIALLY_PAID: "amber", CANCELLED: "gray" };
const billLines = (lines: Line[]) => lines.map((l) => ({ itemId: l.itemId, quantityThousandths: Math.round(Number(l.qty) * 1000), unitPricePaise: rupeesToPaise(l.price), taxRateBasisPoints: Math.round(l.taxPct * 100), discountPaise: rupeesToPaise(l.disc) }));

export function PurchasesPage() {
  const { can } = useBillingAccess();
  const [make, setMake] = useState(false);
  const [pay, setPay] = useState<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const q = useQuery({ queryKey: ["billing-bills"], queryFn: () => bill.get("/purchases/bills?limit=100") });
  const rows: any[] = q.data?.bills ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const parties = useQuery({ queryKey: ["billing-vendors-all"], queryFn: () => bill.get("/masters/parties?type=VENDOR&limit=200"), staleTime: 60_000 });
  const nameOf = (id: string) => parties.data?.parties?.find((p: any) => p.id === id)?.name ?? "Vendor"; // eslint-disable-line @typescript-eslint/no-explicit-any
  return (
    <div className="pb-8">
      <PageHeader title="Purchases" icon={ShoppingCart} actions={can("purchases.create") && <Button variant="primary" icon={Plus} onClick={() => setMake(true)}>New purchase</Button>} />
      <div className="px-4 sm:px-6">
        {q.isError ? <ErrorState error={q.error} /> : q.isLoading ? <Skeleton className="h-24" /> : rows.length === 0 ? <Card><EmptyState icon={ShoppingCart} title="No purchases yet" /></Card> : (
          <Card className="divide-y divide-line">
            {rows.map((b) => (
              <div key={b.id} className="flex items-center gap-3 px-3.5 py-3">
                <div className="min-w-0 flex-1"><div className="truncate font-medium">{b.party_name ?? nameOf(b.party_id)}</div><div className="text-xs text-muted">{b.bill_no}{b.vendor_bill_no ? ` · vendor bill ${b.vendor_bill_no}` : ""} · {fmtDate(b.date)}</div></div>
                <div className="text-right"><div className="font-semibold tabular-nums">{inr(b.total_paise)}</div><Badge tone={TONE[b.status] ?? "gray"}>{b.status}</Badge></div>
                {can("payment.pay") && b.status !== "PAID" && b.status !== "CANCELLED" && <Button size="sm" icon={Wallet} onClick={() => setPay(b)}>Pay</Button>}
              </div>
            ))}
          </Card>
        )}
      </div>
      <NewBill open={make} onClose={() => setMake(false)} />
      <PayBill bill={pay} onClose={() => setPay(null)} />
    </div>
  );
}

function NewBill({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [party, setParty] = useState<Party | null>(null);
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [vb, setVb] = useState("");
  const [date, setDate] = useState(today());
  const [due, setDue] = useState(addDays(today(), 30));
  const [rcm, setRcm] = useState(false);
  const ready = !!party && lines.every((l) => l.itemId && Number(l.qty) > 0 && l.price !== "");
  const save = useMutation({
    mutationFn: () => bill.post("/purchases/bills", { partyId: party!.id, vendorBillNo: vb || undefined, date, dueDate: due, lines: billLines(lines), rcmApplicable: rcm }),
    onSuccess: () => (toast("success", "Purchase saved"), qc.invalidateQueries({ queryKey: ["billing-bills"] }), setParty(null), setLines([blankLine()]), setVb(""), onClose()),
    onError: (e) => toast("error", errMsg(e)),
  });
  return (
    <SlideOver open={open} onClose={onClose} title="New purchase" width="max-w-2xl" footer={<><div className="mr-auto text-sm font-semibold tabular-nums">≈ {inr(totalsOf(lines).total)}</div><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!ready} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="space-y-4">
        <PartyPicker value={party} onPick={setParty} type="VENDOR" label="Vendor" />
        <div className="grid grid-cols-3 gap-3">
          <Field label="Vendor bill no."><input className="input" value={vb} onChange={(e) => setVb(e.target.value)} /></Field>
          <Field label="Date"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Due"><input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        </div>
        <LineEditor lines={lines} onChange={setLines} />
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" className="size-4" checked={rcm} onChange={(e) => setRcm(e.target.checked)} />Reverse charge applies</label>
      </div>
    </SlideOver>
  );
}

function PayBill({ bill: b, onClose }: { bill: any; onClose: () => void }) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const qc = useQueryClient();
  const toast = useToast();
  const [amt, setAmt] = useState("");
  const [mode, setMode] = useState("UPI");
  const due = b ? (b.total_paise ?? 0) - (b.paid_amount_paise ?? 0) : 0;
  const save = useMutation({
    mutationFn: () => bill.post(`/purchases/bills/${b.id}/payments`, { amountPaise: rupeesToPaise(amt || String(due / 100)), paymentMode: mode, date: today() }),
    onSuccess: () => (toast("success", "Payment recorded"), qc.invalidateQueries({ queryKey: ["billing-bills"] }), setAmt(""), onClose()),
    onError: (e) => toast("error", errMsg(e)),
  });
  return (
    <Dialog open={!!b} onClose={onClose} title={`Pay ${b?.bill_no ?? ""}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Record payment</Button></>}>
      <div className="space-y-3">
        <Field label="Amount (₹)" help={`Balance ${inr(due)}`}><input className="input" inputMode="decimal" placeholder={String(due / 100)} value={amt} onChange={(e) => setAmt(e.target.value)} /></Field>
        <Field label="Mode"><Select value={mode} onChange={(e) => setMode(e.target.value)} options={["UPI", "CASH", "BANK"].map((v) => ({ value: v, label: v[0] + v.slice(1).toLowerCase() }))} /></Field>
      </div>
    </Dialog>
  );
}

export function CreditNotesPage() {
  const q = useQuery({ queryKey: ["billing-credit-notes"], queryFn: () => bill.get("/sales/credit-notes") });
  const rows: any[] = q.data?.notes ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
  return (
    <div className="pb-8">
      <PageHeader title="Credit notes" icon={FileMinus2} subtitle="Raise one from an invoice (open the invoice, then Credit note)" actions={<Link to="/billing/invoices"><Button>Go to invoices</Button></Link>} />
      <div className="px-4 sm:px-6">
        {q.isError ? <ErrorState error={q.error} /> : q.isLoading ? <Skeleton className="h-24" /> : rows.length === 0 ? <Card><EmptyState icon={FileMinus2} title="No credit notes yet" /></Card> : (
          <Card className="divide-y divide-line">{rows.map((n) => (
            <div key={n.id} className="flex items-center gap-3 px-3.5 py-3">
              <div className="min-w-0 flex-1"><div className="truncate font-medium">{n.party_name}</div><div className="text-xs text-muted">{n.note_no} · {fmtDate(n.date)}{n.invoice_no ? ` · against ${n.invoice_no}` : ""} · {n.reason}</div></div>
              <div className="font-semibold tabular-nums">{inr(n.total_paise)}</div>
            </div>
          ))}</Card>
        )}
      </div>
    </div>
  );
}

export function DebitNotesPage() {
  const { can } = useBillingAccess();
  const nav = useNavigate();
  const [make, setMake] = useState(false);
  const q = useQuery({ queryKey: ["billing-debit-notes"], queryFn: () => bill.get("/purchases/debit-notes") });
  const rows: any[] = q.data?.notes ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
  return (
    <div className="pb-8">
      <PageHeader title="Debit notes" icon={FileX2} actions={can("purchases.create") && <Button variant="primary" icon={Plus} onClick={() => setMake(true)}>New debit note</Button>} />
      <div className="px-4 sm:px-6">
        {q.isError ? <ErrorState error={q.error} /> : q.isLoading ? <Skeleton className="h-24" /> : rows.length === 0 ? <Card><EmptyState icon={FileX2} title="No debit notes yet" /></Card> : (
          <Card className="divide-y divide-line">{rows.map((n) => (
            <div key={n.id} className="flex items-center gap-3 px-3.5 py-3">
              <div className="min-w-0 flex-1"><div className="truncate font-medium">{n.party_name}</div><div className="text-xs text-muted">{n.note_no} · {fmtDate(n.date)}{n.bill_no ? ` · against ${n.bill_no}` : ""} · {n.reason}</div></div>
              <div className="font-semibold tabular-nums">{inr(n.total_paise)}</div>
            </div>
          ))}</Card>
        )}
      </div>
      <NewDebitNote open={make} onClose={() => setMake(false)} onDone={() => nav(0)} />
    </div>
  );
}

function NewDebitNote({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const bills = useQuery({ queryKey: ["billing-bills"], queryFn: () => bill.get("/purchases/bills?limit=100"), enabled: open });
  const [billId, setBillId] = useState("");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const ready = !!billId && reason.trim().length > 1 && lines.every((l) => l.itemId && Number(l.qty) > 0 && l.price !== "");
  const save = useMutation({
    mutationFn: () => bill.post("/purchases/debit-notes", { billId, reason, date: today(), lines: billLines(lines).map(({ discountPaise: _d, ...l }) => l) }),
    onSuccess: () => (toast("success", "Debit note created"), onClose(), onDone()),
    onError: (e) => toast("error", errMsg(e)),
  });
  return (
    <SlideOver open={open} onClose={onClose} title="New debit note" width="max-w-2xl" footer={<><div className="mr-auto text-sm font-semibold tabular-nums">≈ {inr(totalsOf(lines).total)}</div><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!ready} loading={save.isPending} onClick={() => save.mutate()}>Create</Button></>}>
      <div className="space-y-4">
        <Field label="Against purchase" required><Select value={billId} placeholder="Choose the purchase" onChange={(e) => setBillId(e.target.value)} options={(bills.data?.bills ?? []).map((b: any) => ({ value: b.id, label: `${b.bill_no} · ${inr(b.total_paise)}` }))} /></Field> {/* eslint-disable-line @typescript-eslint/no-explicit-any */}
        <Field label="Reason" required><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Goods returned" /></Field>
        <LineEditor lines={lines} onChange={setLines} />
      </div>
    </SlideOver>
  );
}

void Tabs;

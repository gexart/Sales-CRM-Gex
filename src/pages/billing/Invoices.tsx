import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Download, FileText, MessageCircle, Phone, Plus, Printer, Search, Wallet } from "lucide-react";
import { PageHeader } from "../../components/layout";
import { useDebounced } from "../../components/forms";
import { Badge, Button, Card, Dialog, EmptyState, ErrorState, Field, Select, Skeleton, Tabs, useToast } from "../../components/ui";
import { ApiError } from "../../lib/api";
import { date as fmtDate } from "../../lib/format";
import { newRef, queueInvoiceRequest } from "../../lib/offline-queue";
import { telHref, hasDigits } from "../../lib/contact-links";
import { getAutoWhatsApp, invoiceMessage, openWhatsApp, reminderMessage, setAutoWhatsApp } from "../../lib/invoice-share";
import { INVOICE_STATUS_TONE, addDays, bill, errMsg, inr, today, useBillingAccess } from "../../lib/billing";
import { LineEditor, PartyPicker, blankLine, rupeesToPaise, totalsOf, type Line, type Party } from "./parts";

type Tab = "ALL" | "PENDING" | "OVERDUE" | "PAID";

export function InvoicesPage() {
  const { can } = useBillingAccess();
  const [tab, setTab] = useState<Tab>("ALL");
  const [search, setSearch] = useState("");
  const dq = useDebounced(search, 300);
  const q = useQuery({ queryKey: ["billing-invoices", tab, dq], queryFn: () => bill.get(`/sales/invoices?status=${tab}&search=${encodeURIComponent(dq)}&limit=100`) });
  const rows: any[] = q.data?.invoices ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const counts = q.data?.counts;
  const totals = q.data?.totals;
  const direct = can("invoice.create");
  return (
    <div className="pb-8">
      <PageHeader title="Sales invoices" icon={FileText} actions={(direct || can("invoice.request")) && <Link to="/billing/invoices/new"><Button variant="primary" icon={Plus}>{direct ? "New invoice" : "Request invoice"}</Button></Link>} />
      <div className="px-4 sm:px-6">
        {totals && (
          <div className="mb-3 grid grid-cols-3 gap-2">
            {[["Billed", totals.totalSalesPaise], ["Received", totals.totalPaidPaise], ["Pending", totals.totalPendingPaise]].map(([l, v]) => (
              <Card key={l as string} className="p-2.5"><div className="text-[11px] text-muted">{l}</div><div className="text-[15px] font-semibold tabular-nums sm:text-lg">{inr(v as number)}</div></Card>
            ))}
          </div>
        )}
        <Tabs<Tab> value={tab} onChange={setTab} tabs={(["ALL", "PENDING", "OVERDUE", "PAID"] as Tab[]).map((v) => ({ value: v, label: v === "ALL" ? "All" : v[0] + v.slice(1).toLowerCase(), count: counts?.[v] }))} />
        <div className="relative my-3"><Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-slate-400" /><input className="input pl-8" placeholder="Search invoice number or customer" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.isLoading ? <Skeleton className="h-24" /> : rows.length === 0 ? (
          <Card><EmptyState icon={FileText} title="No invoices" body={direct ? "Create your first invoice." : can("invoice.request") ? "Request an invoice. It appears here once approved." : undefined} /></Card>
        ) : (
          <Card className="divide-y divide-line">
            {rows.map((r) => (
              <Link key={r.id} to={`/billing/invoices/${r.id}`} className="flex items-center gap-3 px-3.5 py-3 hover:bg-slate-50 dark:hover:bg-white/5">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{r.party_name}</div>
                  <div className="text-xs text-muted">{r.invoice_no} · {fmtDate(r.date)}{r.status !== "PAID" && r.balance_amount_paise > 0 && r.due_date ? ` · due ${fmtDate(r.due_date)}` : ""}</div>
                </div>
                <div className="text-right"><div className="font-semibold tabular-nums">{inr(r.total_paise)}</div><Badge tone={INVOICE_STATUS_TONE[r.status] ?? "gray"}>{r.status}</Badge></div>
              </Link>
            ))}
          </Card>
        )}
      </div>
    </div>
  );
}

export function NewInvoicePage() {
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { can, access } = useBillingAccess();
  const [party, setParty] = useState<Party | null>(null);
  const [inv, setInv] = useState(today());
  const [due, setDue] = useState(addDays(today(), 15));
  const [mode, setMode] = useState("CREDIT");
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [extra, setExtra] = useState("");
  const [notes, setNotes] = useState("");
  const [autoWa, setAutoWa] = useState(getAutoWhatsApp);
  const direct = can("invoice.create");
  const t = totalsOf(lines, Number(extra) || 0);
  const maxPct = access?.limits.maxDiscountPct ?? 0;
  const discPct = t.sub > 0 ? (t.disc / t.sub) * 100 : 0;
  const ready = !!party && lines.every((l) => l.itemId && Number(l.qty) > 0 && l.price !== "");
  const [ref] = useState(newRef);
  const buildBody = () => ({
      partyId: party!.id, partyName: party!.name, partyGstin: party!.gstin || undefined, partyStateCode: party!.stateCode || "19", date: inv, dueDate: due, paymentMode: mode,
      items: lines.map((l) => ({ itemId: l.itemId, name: l.name, hsnSac: l.hsnSac, quantityThousandths: Math.round(Number(l.qty) * 1000), unitId: l.unitId, unitPricePaise: rupeesToPaise(l.price), discountPaise: rupeesToPaise(l.disc), taxRatePercent: l.taxPct, isTaxInclusive: l.inclusive })),
      extraDiscountPaise: rupeesToPaise(extra), notes: notes || undefined,
    });
  const save = useMutation({
    mutationFn: () => bill.post("/sales/invoices", buildBody(), { "x-client-ref": ref }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["billing-invoices"] });
      qc.invalidateQueries({ queryKey: ["billing-pending"] });
      if (r.pending) (toast("success", "Sent for approval. You will be told when it is decided."), nav("/billing/approvals"));
      else {
        toast("success", `Invoice ${r.invoice?.invoiceNo ?? ""} created`);
        const inv = r.invoice;
        if (autoWa && party && hasDigits(party.phone ?? "")) openWhatsApp(party.phone!, invoiceMessage({ party: party.name, invoiceNo: inv?.invoiceNo, totalPaise: inv?.totalPaise ?? inv?.total_paise ?? 0, balancePaise: inv?.balanceAmountPaise ?? inv?.balance_amount_paise ?? inv?.totalPaise ?? 0, dueDate: due, token: inv?.shareToken ?? r.shareToken }));
        nav(`/billing/invoices/${inv?.id}`);
      }
    },
    onError: (e) => {
      // No signal: a request (not a direct invoice) is kept on this phone and sent later, safely.
      if (!(e instanceof ApiError) && !direct) {
        queueInvoiceRequest(buildBody(), party!.name, ref);
        toast("success", "No connection. Saved on this phone and will be sent automatically.");
        nav("/billing/approvals");
      } else toast("error", errMsg(e));
    },
  });
  return (
    <div className="pb-28">
      <PageHeader title={direct ? "New invoice" : "Request invoice"} crumbs={[{ label: "Invoices", to: "/billing/invoices" }, { label: "New" }]} subtitle={direct ? undefined : "It becomes a real invoice only after it is approved"} />
      <div className="mx-auto max-w-3xl space-y-4 px-4 sm:px-6">
        <Card className="space-y-3 p-3.5">
          <PartyPicker value={party} onPick={setParty} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Invoice date"><input className="input" type="date" value={inv} onChange={(e) => setInv(e.target.value)} /></Field>
            <Field label="Due date"><input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
            <Field label="Payment" className="col-span-2 sm:col-span-1"><Select value={mode} onChange={(e) => setMode(e.target.value)} options={["CREDIT", "CASH", "UPI", "BANK", "CARD"].map((v) => ({ value: v, label: v[0] + v.slice(1).toLowerCase() }))} /></Field>
          </div>
        </Card>
        <LineEditor lines={lines} onChange={setLines} />
        <Card className="space-y-3 p-3.5">
          <Field label="Extra discount on whole bill (₹)"><input className="input" inputMode="decimal" value={extra} onChange={(e) => setExtra(e.target.value)} /></Field>
          <Field label="Notes"><textarea className="input min-h-16" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          {direct && (
            <label className="flex min-h-9 cursor-pointer items-center gap-2.5 text-[13px]"><input type="checkbox" className="size-4" checked={autoWa} onChange={(e) => (setAutoWa(e.target.checked), setAutoWhatsApp(e.target.checked))} />Open WhatsApp with the invoice after saving</label>
          )}
          {!direct && <p className="text-xs text-muted">Your role can only request invoices.</p>}
          {maxPct > 0 && discPct > maxPct && <p className="text-xs text-amber-700 dark:text-amber-300">Discount {discPct.toFixed(1)}% is above your {maxPct}% limit, so this will need approval.</p>}
        </Card>
      </div>
      <div className="fixed inset-x-0 bottom-14 z-30 border-t border-line bg-white p-3 lg:bottom-0 lg:left-60 dark:bg-night">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="flex-1 text-xs text-muted"><div>Subtotal {inr(t.sub)} · GST {inr(t.tax)}{t.disc ? ` · Disc −${inr(t.disc)}` : ""}</div><div className="text-base font-semibold text-ink tabular-nums">≈ {inr(t.total)}</div></div>
          <Button variant="primary" className="h-11 px-5 text-sm" disabled={!ready} loading={save.isPending} onClick={() => save.mutate()}>{direct ? "Create invoice" : "Send for approval"}</Button>
        </div>
      </div>
    </div>
  );
}

export function InvoiceDetailPage() {
  const { id } = useParams();
  const { can } = useBillingAccess();
  const qc = useQueryClient();
  const toast = useToast();
  const [pay, setPay] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [amt, setAmt] = useState("");
  const [pmode, setPmode] = useState("UPI");
  const [reason, setReason] = useState("");
  const q = useQuery({ queryKey: ["billing-invoice", id], queryFn: () => bill.get(`/sales/invoices/${id}`) });
  const inv = q.data?.invoice;
  const refresh = () => (qc.invalidateQueries({ queryKey: ["billing-invoice", id] }), qc.invalidateQueries({ queryKey: ["billing-invoices"] }));
  const payM = useMutation({
    mutationFn: () => bill.post(`/sales/invoices/${id}/payments`, { amountPaise: rupeesToPaise(amt), paymentMode: pmode, branchId: inv.branch_id, date: today() }),
    onSuccess: () => (toast("success", "Payment recorded"), setPay(false), setAmt(""), refresh()),
    onError: (e) => toast("error", errMsg(e)),
  });
  const cancelM = useMutation({
    mutationFn: () => bill.post(`/sales/invoices/${id}/cancel`, { reason }),
    onSuccess: () => (toast("success", "Invoice cancelled"), setCancel(false), refresh()),
    onError: (e) => toast("error", errMsg(e)),
  });
  if (q.isError) return <div className="p-4"><ErrorState error={q.error} /></div>;
  if (q.isLoading || !inv) return <div className="p-4"><Skeleton className="h-48" /></div>;
  const open = inv.status !== "CANCELLED" && inv.balance_amount_paise > 0;
  return (
    <div className="pb-10">
      <PageHeader title={inv.invoice_no} crumbs={[{ label: "Invoices", to: "/billing/invoices" }, { label: inv.invoice_no }]} subtitle={<Badge tone={INVOICE_STATUS_TONE[inv.status] ?? "gray"}>{inv.status}</Badge>}
        actions={<>
          {hasDigits(inv.party_phone ?? "") && <a href={telHref(inv.party_phone)}><Button icon={Phone}>Call</Button></a>}
          {hasDigits(inv.party_phone ?? "") && inv.status !== "CANCELLED" && <Button icon={MessageCircle} onClick={() => openWhatsApp(inv.party_phone, inv.balance_amount_paise > 0 && inv.paid_amount_paise === 0 && new Date(inv.due_date) < new Date() ? reminderMessage({ party: inv.party_name, outstandingPaise: inv.balance_amount_paise }) : invoiceMessage({ party: inv.party_name, invoiceNo: inv.invoice_no, totalPaise: inv.total_paise, balancePaise: inv.balance_amount_paise, dueDate: inv.due_date, token: inv.shareToken }))}>WhatsApp</Button>}
          <Button icon={Printer} onClick={() => window.print()}>Print</Button>
          {can("payment.receive") && open && <Button variant="primary" icon={Wallet} onClick={() => (setAmt(String(inv.balance_amount_paise / 100)), setPay(true))}>Record payment</Button>}
          {can("invoice.cancel") && inv.status !== "CANCELLED" && <Button icon={Ban} onClick={() => setCancel(true)}>Cancel</Button>}
        </>} />
      <div className="mx-auto max-w-3xl space-y-3 px-4 sm:px-6">
        <Card className="p-3.5">
          <div className="flex justify-between gap-3">
            <div><div className="text-xs text-muted">Billed to</div><div className="font-semibold">{inv.party_name}</div><div className="text-xs text-muted">{inv.party_phone}{inv.party_gstin ? ` · GSTIN ${inv.party_gstin}` : ""}</div></div>
            <div className="text-right text-xs text-muted"><div>Date {fmtDate(inv.date)}</div><div>Due {fmtDate(inv.due_date)}</div></div>
          </div>
        </Card>
        <Card className="divide-y divide-line">
          {inv.lines.map((l: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
            <div key={l.id} className="flex items-start justify-between gap-3 px-3.5 py-2.5">
              <div className="min-w-0"><div className="font-medium">{l.name}</div><div className="text-xs text-muted">{l.quantity_thousandths / 1000} × {inr(l.unit_price_paise)}{l.discount_paise ? ` − ${inr(l.discount_paise)}` : ""} · GST {l.tax_rate_basis_points / 100}%{l.hsn_sac ? ` · HSN ${l.hsn_sac}` : ""}</div></div>
              <div className="font-medium tabular-nums">{inr(l.line_total_paise)}</div>
            </div>
          ))}
        </Card>
        <Card className="space-y-1 p-3.5 text-[13px]">
          {[["Subtotal", inv.subtotal_paise], ["Discount", -inv.discount_paise], ["GST", inv.tax_total_paise], ["Round off", inv.round_off_paise]].filter(([, v]) => v).map(([l, v]) => (
            <div key={l as string} className="flex justify-between"><span className="text-muted">{l}</span><span className="tabular-nums">{inr(v as number)}</span></div>
          ))}
          <div className="flex justify-between border-t border-line pt-2 text-base font-semibold"><span>Total</span><span className="tabular-nums">{inr(inv.total_paise)}</span></div>
          <div className="flex justify-between"><span className="text-muted">Received</span><span className="tabular-nums">{inr(inv.paid_amount_paise)}</span></div>
          <div className="flex justify-between font-medium"><span>Balance</span><span className="tabular-nums">{inr(inv.balance_amount_paise)}</span></div>
          {inv.amountInWords && <div className="pt-1 text-xs text-muted">{inv.amountInWords}</div>}
        </Card>
        {inv.notes && <Card className="p-3.5 text-[13px]"><div className="mb-0.5 text-xs text-muted">Notes</div>{inv.notes}</Card>}
      </div>
      <Dialog open={pay} onClose={() => setPay(false)} title="Record payment" footer={<><Button onClick={() => setPay(false)}>Cancel</Button><Button variant="primary" loading={payM.isPending} disabled={rupeesToPaise(amt) <= 0} onClick={() => payM.mutate()}>Save</Button></>}>
        <div className="space-y-3">
          <Field label="Amount (₹)"><input className="input" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} /></Field>
          <Field label="Mode"><Select value={pmode} onChange={(e) => setPmode(e.target.value)} options={["UPI", "CASH", "BANK", "CARD", "NET_BANKING", "CHEQUE"].map((v) => ({ value: v, label: v.replace("_", " ") }))} /></Field>
        </div>
      </Dialog>
      <Dialog open={cancel} onClose={() => setCancel(false)} title="Cancel this invoice?" footer={<><Button onClick={() => setCancel(false)}>Keep it</Button><Button variant="danger" loading={cancelM.isPending} disabled={reason.trim().length < 3} onClick={() => cancelM.mutate()}>Cancel invoice</Button></>}>
        <Field label="Reason" required><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Dialog>
    </div>
  );
}

void Download;

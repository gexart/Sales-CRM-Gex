import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Download, FileText, Mail, MessageCircle, Phone, Plus, Printer, Search, Send, Wallet } from "lucide-react";
import { PageHeader } from "../../components/layout";
import { useDebounced } from "../../components/forms";
import { Badge, Button, Card, Dialog, EmptyState, ErrorState, Field, Select, Skeleton, Tabs, useToast } from "../../components/ui";
import { date as fmtDate } from "../../lib/format";
import { telHref, hasDigits } from "../../lib/contact-links";
import { invoiceMessage, openWhatsApp, reminderMessage } from "../../lib/invoice-share";
import { INVOICE_STATUS_TONE, access, bill, errMsg, fileUrl, inr, today, useBillingAccess } from "../../lib/billing";
import { rupeesToPaise } from "./parts";
import { Attachments } from "./Attachments";
import { BillsTabs, Fab } from "./ui";

type Tab = "ALL" | "PENDING" | "OVERDUE" | "PAID" | "DRAFTS";

export function InvoicesPage() {
  const { can } = useBillingAccess();
  const [sp] = useSearchParams();
  const [tab, setTab] = useState<Tab>(sp.get("tab") === "drafts" ? "DRAFTS" : "ALL");
  const [search, setSearch] = useState("");
  const dq = useDebounced(search, 300);
  const q = useQuery({ queryKey: ["billing-invoices", tab, dq], queryFn: () => bill.get(`/sales/invoices?status=${tab === "DRAFTS" ? "ALL" : tab}&search=${encodeURIComponent(dq)}&limit=100`), enabled: tab !== "DRAFTS" });
  const drafts = useQuery({ queryKey: ["billing-drafts"], queryFn: () => access.get("/drafts?kind=invoice") });
  const rows: any[] = q.data?.invoices ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const counts = q.data?.counts;
  const totals = q.data?.totals;
  const direct = can("invoice.create");
  return (
    <div className="pb-8">
      <PageHeader title="Sales invoices" icon={FileText} actions={(direct || can("invoice.request")) && <Link to="/billing/invoices/new"><Button variant="primary" icon={Plus}>{direct ? "New invoice" : "Request invoice"}</Button></Link>} />
      <div className="px-4 sm:px-6">
        <BillsTabs />
        {totals && (
          <div className="mb-3 grid grid-cols-3 gap-2">
            {[["Billed", totals.totalSalesPaise], ["Received", totals.totalPaidPaise], ["Pending", totals.totalPendingPaise]].map(([l, v]) => (
              <Card key={l as string} className="p-2.5"><div className="text-[11px] text-muted">{l}</div><div className="text-[15px] font-semibold tabular-nums sm:text-lg">{inr(v as number)}</div></Card>
            ))}
          </div>
        )}
        <Tabs<Tab> value={tab} onChange={setTab} tabs={(["ALL", "PENDING", "OVERDUE", "PAID", "DRAFTS"] as Tab[]).map((v) => ({ value: v, label: v === "ALL" ? "All" : v[0] + v.slice(1).toLowerCase(), count: v === "DRAFTS" ? drafts.data?.data?.length || undefined : counts?.[v] }))} />
        <div className="relative my-3"><Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-slate-400" /><input className="input pl-8" placeholder="Search invoice number or customer" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        {tab === "DRAFTS" ? <DraftList drafts={drafts.data?.data ?? []} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.isLoading ? <Skeleton className="h-24" /> : rows.length === 0 ? (
          <Card><EmptyState icon={FileText} title="No invoices" body={direct ? "Create your first invoice." : can("invoice.request") ? "Request an invoice. It appears here once approved." : undefined} /></Card>
        ) : (
          <Card className="divide-y divide-line">
            {rows.map((r) => (
              <Link key={r.id} to={`/billing/invoices/${r.id}`} className="flex items-center gap-3 px-3.5 py-3.5 hover:bg-slate-50 active:bg-slate-100 dark:hover:bg-white/5">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{r.party_name}</div>
                  <div className="text-xs text-muted">{r.invoice_no} · {fmtDate(r.date)}{r.status !== "PAID" && r.status !== "CANCELLED" && r.balance_amount_paise > 0 && r.due_date ? ` · due ${fmtDate(r.due_date)}` : ""}</div>
                </div>
                <div className="text-right"><div className="font-semibold tabular-nums">{inr(r.total_paise)}</div><Badge tone={INVOICE_STATUS_TONE[r.status] ?? "gray"}>{r.status}</Badge></div>
              </Link>
            ))}
          </Card>
        )}
      </div>
      {(direct || can("invoice.request")) && <Fab to="/billing/invoices/new" label="New invoice" />}
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
  const [cn, setCn] = useState(false);
  const [mailOpen, setMailOpen] = useState(false);
  const [mailTo, setMailTo] = useState("");
  const [cnReason, setCnReason] = useState("");
  const [cnAmt, setCnAmt] = useState("");
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
  const cnM = useMutation({
    mutationFn: () => bill.post(`/sales/invoices/${id}/credit-note`, { branchId: inv.branch_id, date: today(), reason: cnReason, totalAmountPaise: cnAmt ? rupeesToPaise(cnAmt) : undefined }),
    onSuccess: () => (toast("success", "Credit note created"), setCn(false), setCnReason(""), setCnAmt(""), refresh(), qc.invalidateQueries({ queryKey: ["billing-credit-notes"] })),
    onError: (e) => toast("error", errMsg(e)),
  });
  const mailM = useMutation({
    mutationFn: () => bill.post(`/sales/invoices/${id}/email`, { to: mailTo || undefined }),
    onSuccess: (r) => (toast("success", `Email sent${r.provider ? ` via ${r.provider}` : ""}`), setMailOpen(false)),
    onError: (e) => toast("error", errMsg(e)),
  });
  const crmM = useMutation({
    mutationFn: () => bill.post(`/sales/invoices/${id}/crm`, {}),
    onSuccess: (r) => toast("success", r.message || "Sent to the CRM"),
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
          <Button icon={Printer} onClick={() => window.open(fileUrl(`/sales/invoices/${inv.id}`, "pdf", true), "_blank", "noopener")}>PDF</Button>
          <a href={fileUrl(`/sales/invoices/${inv.id}`, "docx")}><Button icon={Download}>Word</Button></a>
          {inv.status !== "CANCELLED" && <Button icon={Mail} onClick={() => (setMailTo(inv.party_email ?? ""), setMailOpen(true))}>Email</Button>}
          {can("invoice.approve") && inv.status !== "CANCELLED" && <Button icon={Send} loading={crmM.isPending} onClick={() => crmM.mutate()}>Send to CRM</Button>}
          {can("invoice.credit_note") && inv.status !== "CANCELLED" && <Button onClick={() => setCn(true)}>Credit note</Button>}
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
        <Attachments type="invoice" id={inv.id} />
      </div>
      <Dialog open={pay} onClose={() => setPay(false)} title="Record payment" footer={<><Button onClick={() => setPay(false)}>Cancel</Button><Button variant="primary" loading={payM.isPending} disabled={rupeesToPaise(amt) <= 0} onClick={() => payM.mutate()}>Save</Button></>}>
        <div className="space-y-3">
          <Field label="Amount (₹)"><input className="input" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} /></Field>
          <Field label="Mode"><Select value={pmode} onChange={(e) => setPmode(e.target.value)} options={["UPI", "CASH", "BANK", "CARD", "NET_BANKING", "CHEQUE"].map((v) => ({ value: v, label: v.replace("_", " ") }))} /></Field>
        </div>
      </Dialog>
      <Dialog open={mailOpen} onClose={() => setMailOpen(false)} title="Email this invoice" footer={<><Button onClick={() => setMailOpen(false)}>Cancel</Button><Button variant="primary" loading={mailM.isPending} disabled={!/^\S+@\S+\.\S+$/.test(mailTo)} onClick={() => mailM.mutate()}>Send email</Button></>}>
        <Field label="Send to" help="The client gets a link to view and pay the invoice"><input className="input" type="email" inputMode="email" autoFocus value={mailTo} onChange={(e) => setMailTo(e.target.value)} placeholder="client@company.com" /></Field>
      </Dialog>
      <Dialog open={cn} onClose={() => setCn(false)} title="Credit note" footer={<><Button onClick={() => setCn(false)}>Cancel</Button><Button variant="primary" loading={cnM.isPending} disabled={cnReason.trim().length < 3} onClick={() => cnM.mutate()}>Create</Button></>}>
        <div className="space-y-3">
          <Field label="Reason" required><input className="input" value={cnReason} onChange={(e) => setCnReason(e.target.value)} placeholder="e.g. Service not delivered" /></Field>
          <Field label="Amount (₹)" help="Leave empty to credit the whole invoice"><input className="input" inputMode="decimal" value={cnAmt} onChange={(e) => setCnAmt(e.target.value)} /></Field>
        </div>
      </Dialog>
      <Dialog open={cancel} onClose={() => setCancel(false)} title="Cancel this invoice?" footer={<><Button onClick={() => setCancel(false)}>Keep it</Button><Button variant="danger" loading={cancelM.isPending} disabled={reason.trim().length < 3} onClick={() => cancelM.mutate()}>Cancel invoice</Button></>}>
        <Field label="Reason" required><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Dialog>
    </div>
  );
}

void Download;

function DraftList({ drafts }: { drafts: any[] }) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const qc = useQueryClient();
  const del = useMutation({ mutationFn: (id: string) => access.del(`/drafts/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["billing-drafts"] }) });
  if (!drafts.length) return <Card><EmptyState icon={FileText} title="No drafts" body="Use Save as draft on the new invoice screen to keep one for later." /></Card>;
  return (
    <Card className="divide-y divide-line">
      {drafts.map((d) => (
        <div key={d.id} className="flex items-center gap-3 px-3.5 py-3">
          <Link to={`/billing/invoices/new?draft=${d.id}`} className="min-w-0 flex-1"><div className="truncate font-medium">{d.title || "Untitled invoice"}</div><div className="text-xs text-muted">Saved {fmtDate(d.updated_at)}</div></Link>
          <Button size="sm" variant="ghost" onClick={() => del.mutate(d.id)}>Delete</Button>
        </div>
      ))}
    </Card>
  );
}

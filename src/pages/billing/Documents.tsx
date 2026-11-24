import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSignature, Plus, Printer } from "lucide-react";
import { PageHeader } from "../../components/layout";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Skeleton, SlideOver, Tabs, useToast } from "../../components/ui";
import { date as fmtDate } from "../../lib/format";
import { addDays, bill, errMsg, inr, today, useBillingAccess } from "../../lib/billing";
import { LineEditor, PartyPicker, blankLine, rupeesToPaise, totalsOf, type Line, type Party } from "./parts";

const TYPES = [
  { value: "QUOTATION", label: "Quotations", one: "Quotation", perm: "quotation.create" },
  { value: "PROFORMA", label: "Proforma", one: "Proforma invoice", perm: "proforma.create" },
  { value: "SALES_ORDER", label: "Sales orders", one: "Sales order", perm: "sales_order.create" },
  { value: "DELIVERY_CHALLAN", label: "Challans", one: "Delivery challan", perm: "challan.create" },
] as const;
type DT = (typeof TYPES)[number]["value"];

/** Quotations, proforma invoices, sales orders and challans: everything that comes before (or beside) a sales invoice. */
export function DocumentsPage() {
  const { can } = useBillingAccess();
  const visible = TYPES.filter((t) => can(t.perm) || can("documents.view"));
  const [type, setType] = useState<DT>("QUOTATION");
  const [make, setMake] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const cur = TYPES.find((t) => t.value === type)!;
  const q = useQuery({ queryKey: ["billing-docs", type], queryFn: () => bill.get(`/documents?type=${type}&limit=100`) });
  const rows: any[] = q.data?.documents ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
  return (
    <div className="pb-8">
      <PageHeader title="Quotes & proforma" icon={FileSignature} actions={can(cur.perm) && <Button variant="primary" icon={Plus} onClick={() => setMake(true)}>New {cur.one.toLowerCase()}</Button>} />
      <div className="px-4 sm:px-6">
        <Tabs<DT> value={type} onChange={setType} tabs={visible.map((t) => ({ value: t.value, label: t.label }))} />
        <div className="mt-3">
          {q.isError ? <ErrorState error={q.error} /> : q.isLoading ? <Skeleton className="h-24" /> : rows.length === 0 ? <Card><EmptyState icon={FileSignature} title={`No ${cur.label.toLowerCase()} yet`} /></Card> : (
            <Card className="divide-y divide-line">
              {rows.map((d) => (
                <button key={d.id} className="flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-slate-50 dark:hover:bg-white/5" onClick={() => setOpen(d.id)}>
                  <div className="min-w-0 flex-1"><div className="truncate font-medium">{d.party_name}</div><div className="text-xs text-muted">{d.doc_no} · {fmtDate(d.date)}{d.valid_until ? ` · valid to ${fmtDate(d.valid_until)}` : ""}</div></div>
                  <div className="text-right"><div className="font-semibold tabular-nums">{inr(d.total_paise)}</div><Badge tone={d.status === "OPEN" ? "blue" : "gray"}>{d.status}</Badge></div>
                </button>
              ))}
            </Card>
          )}
        </div>
      </div>
      <NewDoc open={make} type={type} label={cur.one} onClose={() => setMake(false)} />
      <DocView id={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function NewDoc({ open, type, label, onClose }: { open: boolean; type: DT; label: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [party, setParty] = useState<Party | null>(null);
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [valid, setValid] = useState(addDays(today(), 15));
  const [notes, setNotes] = useState("");
  const ready = !!party && lines.every((l) => l.itemId && Number(l.qty) > 0 && l.price !== "");
  const save = useMutation({
    mutationFn: () => bill.post("/documents", {
      docType: type, partyId: party!.id, date: today(), validUntil: type === "QUOTATION" || type === "PROFORMA" ? valid : undefined, status: "OPEN", notes: notes || undefined,
      lines: lines.map((l) => ({ itemId: l.itemId, name: l.name, hsnSac: l.hsnSac || undefined, unitId: l.unitId || undefined, quantityThousandths: Math.round(Number(l.qty) * 1000), unitPricePaise: rupeesToPaise(l.price), discountPaise: rupeesToPaise(l.disc), taxRateBasisPoints: Math.round(l.taxPct * 100), isTaxInclusive: l.inclusive })),
    }),
    onSuccess: () => (toast("success", `${label} created`), qc.invalidateQueries({ queryKey: ["billing-docs"] }), setParty(null), setLines([blankLine()]), setNotes(""), onClose()),
    onError: (e) => toast("error", errMsg(e)),
  });
  return (
    <SlideOver open={open} onClose={onClose} title={`New ${label.toLowerCase()}`} width="max-w-2xl" footer={<><div className="mr-auto text-sm font-semibold tabular-nums">≈ {inr(totalsOf(lines).total)}</div><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!ready} loading={save.isPending} onClick={() => save.mutate()}>Create</Button></>}>
      <div className="space-y-4">
        <PartyPicker value={party} onPick={setParty} />
        {(type === "QUOTATION" || type === "PROFORMA") && <Field label="Valid until"><input className="input" type="date" value={valid} onChange={(e) => setValid(e.target.value)} /></Field>}
        <LineEditor lines={lines} onChange={setLines} />
        <Field label="Notes"><textarea className="input min-h-16" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </SlideOver>
  );
}

function DocView({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { can } = useBillingAccess();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["billing-doc", id], queryFn: () => bill.get(`/documents/${id}`), enabled: !!id });
  const d = q.data?.document ? { ...q.data.document, lines: q.data.lines ?? q.data.document.lines } : null;
  const convert = useMutation({
    mutationFn: (target: string) => bill.post(`/documents/${id}/convert`, { target }),
    onSuccess: () => (toast("success", "Converted"), qc.invalidateQueries({ queryKey: ["billing-docs"] }), qc.invalidateQueries({ queryKey: ["billing-doc", id] })),
    onError: (e) => toast("error", errMsg(e)),
  });
  const targets: { to: string; label: string }[] = !d ? [] : d.doc_type === "QUOTATION" ? [{ to: "PROFORMA", label: "Make proforma" }, { to: "SALES_ORDER", label: "Make sales order" }] : d.doc_type === "PROFORMA" ? [{ to: "SALES_ORDER", label: "Make sales order" }] : [];
  return (
    <SlideOver open={!!id} onClose={onClose} title={d ? `${d.doc_no} · ${d.party_name}` : "Document"} width="max-w-xl" footer={<><Button icon={Printer} onClick={() => window.print()}>Print</Button>{can("documents.convert") && targets.map((t) => <Button key={t.to} variant="primary" loading={convert.isPending} onClick={() => convert.mutate(t.to)}>{t.label}</Button>)}</>}>
      {!d ? <Skeleton className="h-32" /> : (
        <div className="space-y-3 text-[13px]">
          <div className="flex justify-between text-muted"><span>{fmtDate(d.date)}</span><Badge>{d.status}</Badge></div>
          {(d.lines ?? []).map((l: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
            <div key={l.id} className="flex justify-between gap-3 border-b border-line pb-2"><div><div className="font-medium">{l.name}</div><div className="text-xs text-muted">{l.quantity_thousandths / 1000} × {inr(l.unit_price_paise)} · GST {l.tax_rate_basis_points / 100}%</div></div><div className="tabular-nums">{inr(l.line_total_paise)}</div></div>
          ))}
          <div className="flex justify-between text-base font-semibold"><span>Total</span><span className="tabular-nums">{inr(d.total_paise)}</span></div>
          {d.source_doc_no && <p className="text-xs text-muted">From {d.source_doc_no}</p>}
        </div>
      )}
    </SlideOver>
  );
}

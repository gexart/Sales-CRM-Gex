import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Printer } from "lucide-react";
import { PageHeader } from "../../components/layout";
import { Button, Card, Field, Select, useToast } from "../../components/ui";
import { ApiError } from "../../lib/api";
import { access, addDays, bill, errMsg, inr, today, useBillingAccess } from "../../lib/billing";
import { hasDigits } from "../../lib/contact-links";
import { getAutoWhatsApp, invoiceMessage, openWhatsApp, setAutoWhatsApp } from "../../lib/invoice-share";
import { newRef, queueInvoiceRequest } from "../../lib/offline-queue";
import { LineEditor, PartyPicker, blankLine, rupeesToPaise, totalsOf, type Line, type Party } from "./parts";

/** New sales invoice, laid out like Swipe: customer, items, notes and terms on the left; totals, bank and payment on the right. */
export function NewInvoicePage() {
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [sp] = useSearchParams();
  const { can, access: me } = useBillingAccess();
  const direct = can("invoice.create");
  const settings = useQuery({ queryKey: ["billing-settings"], queryFn: () => bill.get("/settings/billing"), staleTime: 60_000 });
  const banks = useQuery({ queryKey: ["billing-banks"], queryFn: () => bill.get("/masters/banks"), staleTime: 60_000 });
  const S = settings.data?.billing;

  const [party, setParty] = useState<Party | null>(null);
  const [inv, setInv] = useState(today());
  const [due, setDue] = useState(addDays(today(), 15));
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [extra, setExtra] = useState("");
  const [extraPct, setExtraPct] = useState(false);
  const [roundOff, setRoundOff] = useState(true);
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [bank, setBank] = useState("");
  const [signatory, setSignatory] = useState("");
  const [paidFull, setPaidFull] = useState(false);
  const [paid, setPaid] = useState("");
  const [mode, setMode] = useState("UPI");
  const [splits, setSplits] = useState<{ amt: string; mode: string }[]>([]);
  const [autoWa, setAutoWa] = useState(getAutoWhatsApp);
  const [ref] = useState(newRef);
  const [draftId, setDraftId] = useState<string | null>(sp.get("draft"));
  const [loadedDefaults, setLoadedDefaults] = useState(false);

  // Defaults from billing settings (credit days, notes, terms, bank, signatory), applied once.
  useEffect(() => {
    if (!S || loadedDefaults || sp.get("draft")) return;
    setLoadedDefaults(true);
    setDue(addDays(today(), S.preferences.defaultCreditDays));
    setRoundOff(S.preferences.roundOff);
    setNotes(S.notesTerms?.INVOICE?.notes ?? "");
    setTerms(S.notesTerms?.INVOICE?.terms ?? "");
    setBank(S.preferences.defaultBankAccountId || "");
    setSignatory(S.branding.signatoryName || "");
  }, [S, loadedDefaults, sp]);

  const draft = useQuery({ queryKey: ["billing-draft", sp.get("draft")], queryFn: () => access.get(`/drafts/${sp.get("draft")}`), enabled: !!sp.get("draft") });
  useEffect(() => {
    const p = draft.data?.data?.payload;
    if (!p) return;
    setParty(p.party ?? null); setInv(p.inv ?? today()); setDue(p.due ?? addDays(today(), 15)); setLines(p.lines?.length ? p.lines : [blankLine()]);
    setExtra(p.extra ?? ""); setExtraPct(!!p.extraPct); setRoundOff(p.roundOff ?? true); setNotes(p.notes ?? ""); setTerms(p.terms ?? ""); setBank(p.bank ?? ""); setSignatory(p.signatory ?? "");
    setLoadedDefaults(true);
  }, [draft.data]);

  const grossForExtra = totalsOf(lines).sub - totalsOf(lines).disc;
  const extraRupees = extraPct ? (grossForExtra * (Number(extra) || 0)) / 100 / 100 : Number(extra) || 0;
  const t = totalsOf(lines, extraRupees);
  const total = roundOff ? Math.round(t.total / 100) * 100 : t.total;
  const taxable = t.sub - t.disc;
  const maxPct = me?.limits.maxDiscountPct ?? 0;
  const discPct = t.sub > 0 ? (t.disc / t.sub) * 100 : 0;
  const ready = !!party && lines.every((l) => l.itemId && Number(l.qty) > 0 && l.price !== "");
  const firstPaid = paidFull ? total : Math.min(rupeesToPaise(paid), total);
  const splitPaid = paidFull ? 0 : splits.reduce((a, s) => a + rupeesToPaise(s.amt), 0);
  const paidPaise = Math.min(firstPaid + splitPaid, total);

  const body = () => ({
    partyId: party!.id, partyName: party!.name, partyGstin: party!.gstin || undefined, partyStateCode: party!.stateCode || "19", date: inv, dueDate: due,
    paymentMode: firstPaid > 0 ? mode : "CREDIT", paidAmountPaise: firstPaid,
    items: lines.map((l) => ({ itemId: l.itemId, name: l.name, hsnSac: l.hsnSac, quantityThousandths: Math.round(Number(l.qty) * 1000), unitId: l.unitId, unitPricePaise: rupeesToPaise(l.price), discountPaise: rupeesToPaise(l.disc), taxRatePercent: l.taxPct, isTaxInclusive: l.inclusive })),
    extraDiscountPaise: rupeesToPaise(String(extraRupees)), enableRoundOff: roundOff, notes: notes || undefined, terms: terms || undefined, bankAccountId: bank || undefined, signatoryName: signatory || undefined,
  });
  const formState = () => ({ party, inv, due, lines, extra, extraPct, roundOff, notes, terms, bank, signatory });

  const finish = (r: any, print: boolean) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    qc.invalidateQueries({ queryKey: ["billing-invoices"] });
    qc.invalidateQueries({ queryKey: ["billing-pending"] });
    if (draftId) access.del(`/drafts/${draftId}`).catch(() => undefined);
    if (r.pending) { toast("success", "Sent for approval. You will be told when it is decided."); return nav("/billing/approvals"); }
    const i = r.invoice;
    toast("success", `Invoice ${i?.invoiceNo ?? ""} created`);
    // Further payments of a split payment are recorded against the new invoice.
    if (i?.id) for (const sp of splits) if (rupeesToPaise(sp.amt) > 0 && !paidFull) bill.post(`/sales/invoices/${i.id}/payments`, { amountPaise: rupeesToPaise(sp.amt), paymentMode: sp.mode, branchId: i.branchId, date: inv }).catch((e) => toast("error", errMsg(e)));
    if (print && i?.id) window.open(`/api/v1/billing/sales/invoices/${i.id}/pdf?inline=1`, "_blank", "noopener");
    else if (autoWa && party && hasDigits(party.phone ?? "")) openWhatsApp(party.phone!, invoiceMessage({ party: party.name, invoiceNo: i?.invoiceNo, totalPaise: i?.totalPaise ?? i?.total_paise ?? total, balancePaise: Math.max(0, total - paidPaise), dueDate: due, token: i?.shareToken ?? r.shareToken }));
    nav(`/billing/invoices/${i?.id}`);
  };
  const save = useMutation({
    mutationFn: (_print: boolean) => bill.post("/sales/invoices", body(), { "x-client-ref": ref }),
    onSuccess: (r, print) => finish(r, print),
    onError: (e) => {
      if (!(e instanceof ApiError) && !direct) {
        queueInvoiceRequest(body(), party!.name, ref);
        toast("success", "No connection. Saved on this phone and will be sent automatically.");
        nav("/billing/approvals");
      } else toast("error", errMsg(e));
    },
  });
  const saveDraft = useMutation({
    mutationFn: () => {
      const payload = { kind: "invoice", title: party?.name || "Untitled invoice", payload: formState() };
      return draftId ? access.put(`/drafts/${draftId}`, payload) : access.post("/drafts", payload);
    },
    onSuccess: (r) => { setDraftId(r.data.id); toast("success", "Draft saved. Find it under Sales invoices → Drafts."); qc.invalidateQueries({ queryKey: ["billing-drafts"] }); },
    onError: (e) => toast("error", errMsg(e)),
  });

  const row = (label: string, v: string, strong = false) => <div className={`flex justify-between ${strong ? "border-t border-line pt-2 text-lg font-semibold" : "text-[13px]"}`}><span className={strong ? "" : "text-muted"}>{label}</span><span className="tabular-nums">{v}</span></div>;
  return (
    <div className="pb-32">
      <PageHeader title={direct ? "New invoice" : "Request invoice"} crumbs={[{ label: "Invoices", to: "/billing/invoices" }, { label: draftId ? "Draft" : "New" }]} subtitle={direct ? undefined : "It becomes a real invoice only after it is approved"} />
      <div className="grid gap-4 px-4 sm:px-6 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-4">
          <Card className="space-y-3 p-3.5">
            <PartyPicker value={party} onPick={setParty} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Invoice date"><input className="input" type="date" value={inv} onChange={(e) => setInv(e.target.value)} /></Field>
              <Field label="Due date"><input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
            </div>
          </Card>
          <LineEditor lines={lines} onChange={setLines} />
          <Card className="p-3.5">
            <details open className="group"><summary className="flex cursor-pointer items-center gap-1 font-medium"><ChevronDown className="size-4 transition-transform group-open:rotate-0 -rotate-90" />Notes</summary><textarea className="input mt-2 min-h-20" value={notes} onChange={(e) => setNotes(e.target.value)} /></details>
            <details className="group mt-3 border-t border-line pt-3"><summary className="flex cursor-pointer items-center gap-1 font-medium"><ChevronDown className="size-4 transition-transform group-open:rotate-0 -rotate-90" />Terms &amp; conditions</summary><textarea className="input mt-2 min-h-40" value={terms} onChange={(e) => setTerms(e.target.value)} /></details>
          </Card>
        </div>
        <div className="space-y-4">
          <Card className="space-y-2 p-3.5">
            <Field label="Extra discount">
              <div className="flex gap-2"><Select className="w-20" value={extraPct ? "%" : "₹"} onChange={(e) => setExtraPct(e.target.value === "%")} options={[{ value: "₹", label: "₹" }, { value: "%", label: "%" }]} /><input className="input" inputMode="decimal" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="0" /></div>
            </Field>
            <div className="space-y-1.5 pt-1">
              {row("Taxable amount", inr(taxable))}
              {row("Total tax", inr(t.tax))}
              <label className="flex items-center justify-between text-[13px]"><span className="flex items-center gap-2 text-muted"><input type="checkbox" className="size-4" checked={roundOff} onChange={(e) => setRoundOff(e.target.checked)} />Round off</span><span className="tabular-nums">{inr(total - t.total)}</span></label>
              {row("Total amount", inr(total), true)}
              {row("Total discount", inr(t.disc))}
            </div>
            {maxPct > 0 && discPct > maxPct && <p className="text-xs text-amber-700 dark:text-amber-300">Discount {discPct.toFixed(1)}% is above your {maxPct}% limit, so this will need approval.</p>}
          </Card>
          <Card className="space-y-3 p-3.5">
            <Field label="Bank on this invoice"><Select value={bank} placeholder="Default bank" onChange={(e) => setBank(e.target.value)} options={(banks.data?.bankAccounts ?? []).filter((b: any) => b.accountType === "BANK").map((b: any) => ({ value: b.id, label: `${b.name} ${b.maskedAccountNumber ?? ""}` }))} /></Field> {/* eslint-disable-line @typescript-eslint/no-explicit-any */}
            {direct && (
              <div className="space-y-2 rounded-md border border-line p-2.5">
                <div className="flex items-center justify-between text-[13px] font-medium"><span>Payment received</span><label className="flex items-center gap-1.5 text-xs font-normal"><input type="checkbox" className="size-4" checked={paidFull} onChange={(e) => setPaidFull(e.target.checked)} />Mark as fully paid</label></div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Amount (₹)"><input className="input" inputMode="decimal" disabled={paidFull} value={paidFull ? String(total / 100) : paid} onChange={(e) => setPaid(e.target.value)} placeholder="0" /></Field>
                  <Field label="Mode"><Select value={mode} onChange={(e) => setMode(e.target.value)} options={["UPI", "CASH", "BANK", "CARD"].map((v) => ({ value: v, label: v[0] + v.slice(1).toLowerCase() }))} /></Field>
                </div>
                {!paidFull && splits.map((sp, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                    <Field label={`Payment ${i + 2} (₹)`}><input className="input" inputMode="decimal" value={sp.amt} onChange={(e) => setSplits(splits.map((x, j) => (j === i ? { ...x, amt: e.target.value } : x)))} /></Field>
                    <Field label="Mode"><Select value={sp.mode} onChange={(e) => setSplits(splits.map((x, j) => (j === i ? { ...x, mode: e.target.value } : x)))} options={["UPI", "CASH", "BANK", "CARD"].map((v) => ({ value: v, label: v[0] + v.slice(1).toLowerCase() }))} /></Field>
                    <Button variant="ghost" size="sm" aria-label="Remove payment" onClick={() => setSplits(splits.filter((_, j) => j !== i))}>✕</Button>
                  </div>
                ))}
                {!paidFull && <button type="button" className="text-xs font-medium text-brand-700 underline" onClick={() => setSplits([...splits, { amt: "", mode: "CASH" }])}>+ Split payment</button>}
                {paidPaise > 0 && <p className="text-xs text-muted">Balance due {inr(Math.max(0, total - paidPaise))}</p>}
              </div>
            )}
            <Field label="Signature"><input className="input" value={signatory} onChange={(e) => setSignatory(e.target.value)} placeholder="Authorised signatory name" /></Field>
            {direct && <label className="flex min-h-9 cursor-pointer items-center gap-2.5 text-[13px]"><input type="checkbox" className="size-4" checked={autoWa} onChange={(e) => (setAutoWa(e.target.checked), setAutoWhatsApp(e.target.checked))} />Open WhatsApp with the invoice after saving</label>}
            {!direct && <p className="text-xs text-muted">Your role can only request invoices.</p>}
          </Card>
        </div>
      </div>
      <div className="fixed inset-x-0 bottom-14 z-30 border-t border-line bg-white p-3 lg:bottom-0 lg:left-60 dark:bg-night">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1 basis-40"><div className="text-[11px] text-muted">Total</div><div className="text-lg font-semibold tabular-nums">{inr(total)}</div></div>
          <Button loading={saveDraft.isPending} disabled={!party && lines.every((l) => !l.itemId)} onClick={() => saveDraft.mutate()}>Save as draft</Button>
          {direct && <Button icon={Printer} disabled={!ready} loading={save.isPending && save.variables === true} onClick={() => save.mutate(true)}>Save &amp; print</Button>}
          <Button variant="primary" className="h-10 px-5 text-sm" disabled={!ready} loading={save.isPending && save.variables === false} onClick={() => save.mutate(false)}>{direct ? "Save" : "Send for approval"}</Button>
        </div>
      </div>
    </div>
  );
}

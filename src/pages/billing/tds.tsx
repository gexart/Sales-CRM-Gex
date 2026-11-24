import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Dialog, Field, Select, useToast } from "../../components/ui";
import { bill, errMsg, inr } from "../../lib/billing";
import { rupeesToPaise } from "./parts";

export const TDS_SECTIONS: [string, string, number][] = [
  ["194C", "194C Contractors", 2],
  ["194J", "194J Professional / technical fees", 10],
  ["194H", "194H Commission", 5],
  ["194I", "194I Rent", 10],
  ["194Q", "194Q Purchase of goods", 0.1],
  ["194A", "194A Interest", 10],
  ["194O", "194O E-commerce", 1],
  ["OTHER", "Other (enter the rate)", 0],
];

/**
 * Record tax deducted at source. For a sale, the customer pays you the invoice minus TDS; the TDS part is kept as
 * "TDS Receivable" (claimed back later). For a purchase, you pay the vendor minus TDS; the TDS part is kept as
 * "TDS Payable" (deposited with the tax department). Either way the balance due and the books both update.
 */
export function TdsDialog({ open, onClose, path, taxablePaise, duePaise, onDone, kind }: { open: boolean; onClose: () => void; path: string; taxablePaise: number; duePaise: number; onDone: () => void; kind: "sale" | "purchase" }) {
  const toast = useToast();
  const [section, setSection] = useState("194J");
  const [rate, setRate] = useState("10");
  const [amount, setAmount] = useState("");
  const pick = (s: string) => (setSection(s), setRate(String(TDS_SECTIONS.find((x) => x[0] === s)?.[2] ?? 0)));
  const computed = Math.round((taxablePaise * (Number(rate) || 0)) / 100);
  const finalPaise = amount ? rupeesToPaise(amount) : computed;
  const save = useMutation({
    mutationFn: () => bill.post(path, { section: section === "OTHER" ? "OTHER" : section, ...(amount ? { amountPaise: finalPaise } : { ratePercent: Number(rate) }) }),
    onSuccess: (r) => (toast("success", `TDS ${inr(r.tdsPaise)} recorded`), setAmount(""), onClose(), onDone()),
    onError: (e) => toast("error", errMsg(e)),
  });
  return (
    <Dialog open={open} onClose={onClose} title={kind === "sale" ? "TDS deducted by customer" : "TDS deducted from vendor"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={finalPaise <= 0 || finalPaise > duePaise} onClick={() => save.mutate()}>Record TDS</Button></>}>
      <div className="space-y-3">
        <Field label="Section"><Select value={section} onChange={(e) => pick(e.target.value)} options={TDS_SECTIONS.map(([value, label]) => ({ value, label }))} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Rate %"><input className="input" inputMode="decimal" value={rate} onChange={(e) => (setRate(e.target.value), setAmount(""))} /></Field>
          <Field label="Or exact amount (₹)"><input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(computed / 100)} /></Field>
        </div>
        <p className="text-xs text-muted">Taxable value {inr(taxablePaise)} · TDS {inr(finalPaise)} · balance due now {inr(duePaise)}{finalPaise > duePaise ? " (TDS cannot be more than the balance)" : ""}</p>
        <p className="text-xs text-muted">{kind === "sale" ? "Record the rest of the money you receive as a normal payment." : "Pay the rest to the vendor as a normal payment. Deposit the TDS with the tax department and keep the challan."}</p>
      </div>
    </Dialog>
  );
}

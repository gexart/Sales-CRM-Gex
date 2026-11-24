import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, Field, Select, useToast } from "../../components/ui";
import { bill, errMsg } from "../../lib/billing";
import { rupeesToPaise, useBillingMasters, type Party } from "./parts";

/** Add a customer (or vendor) without leaving the invoice. Only the essentials; the rest can be filled in later under Parties. */
export function QuickParty({ open, onClose, onCreated, type = "CUSTOMER", name = "" }: { open: boolean; onClose: () => void; onCreated: (p: Party) => void; type?: string; name?: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState({ name, phone: "", gstin: "", email: "", address: "", stateCode: "19" });
  const [seed, setSeed] = useState(name);
  if (name !== seed) (setSeed(name), setF((x) => ({ ...x, name })));
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v, ...(k === "gstin" && /^\d{2}/.test(v) ? { stateCode: v.slice(0, 2) } : {}) }));
  const save = useMutation({
    mutationFn: () => bill.post("/masters/parties", { name: f.name.trim(), type, phone: f.phone, gstin: f.gstin.trim().toUpperCase() || undefined, email: f.email || undefined, billingAddress: f.address || undefined, stateCode: f.stateCode }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["billing-parties"] });
      toast("success", `${type === "VENDOR" ? "Vendor" : "Customer"} added`);
      onCreated({ id: r.party.id, name: r.party.name, phone: r.party.phone, stateCode: r.party.stateCode, gstin: r.party.gstin ?? null, type });
      setF({ name: "", phone: "", gstin: "", email: "", address: "", stateCode: "19" });
      onClose();
    },
    onError: (e) => toast("error", errMsg(e)),
  });
  return (
    <Dialog open={open} onClose={onClose} title={type === "VENDOR" ? "New vendor" : "New customer"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.name.trim() || f.phone.replace(/\D/g, "").length < 10} onClick={() => save.mutate()}>Save and use</Button></>}>
      <div className="space-y-3">
        <Field label="Name" required><input className="input" autoFocus value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="Phone" required><input className="input" inputMode="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="10-digit mobile" /></Field>
        <Field label="GSTIN" help="State is filled in from it"><input className="input uppercase" maxLength={15} value={f.gstin} onChange={(e) => set("gstin", e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email"><input className="input" type="email" value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
          <Field label="State code"><input className="input" maxLength={2} value={f.stateCode} onChange={(e) => set("stateCode", e.target.value)} /></Field>
        </div>
        <Field label="Address"><textarea className="input min-h-16" value={f.address} onChange={(e) => set("address", e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

/** Add a product or service on the spot. The price you enter is its default; each invoice can still override it. */
export function QuickItem({ open, onClose, onCreated, name = "" }: { open: boolean; onClose: () => void; onCreated: (item: any) => void; name?: string }) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const toast = useToast();
  const qc = useQueryClient();
  const { taxes, units, defaultUnit } = useBillingMasters();
  const [f, setF] = useState({ name, type: "SERVICE", hsn: "", price: "", tax: "", unit: "", incl: false });
  const [seed, setSeed] = useState(name);
  if (name !== seed) (setSeed(name), setF((x) => ({ ...x, name })));
  const defTax = f.tax || taxes.find((t: any) => t.rate_basis_points === 1800)?.id || taxes[0]?.id || ""; // eslint-disable-line @typescript-eslint/no-explicit-any
  const save = useMutation({
    mutationFn: () => bill.post("/masters/items", { name: f.name.trim(), type: f.type, hsnSac: f.hsn || undefined, unitId: f.unit || defaultUnit, salePricePaise: rupeesToPaise(f.price), taxRateId: defTax, priceIncludesTax: f.incl }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["billing-items"] });
      toast("success", `${f.type === "SERVICE" ? "Service" : "Product"} added`);
      onCreated(r.item);
      setF({ name: "", type: "SERVICE", hsn: "", price: "", tax: "", unit: "", incl: false });
      onClose();
    },
    onError: (e) => toast("error", errMsg(e)),
  });
  return (
    <Dialog open={open} onClose={onClose} title="New product or service" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.name.trim() || f.price === ""} onClick={() => save.mutate()}>Save and add</Button></>}>
      <div className="space-y-3">
        <Field label="Name" required><input className="input" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} options={[{ value: "SERVICE", label: "Service" }, { value: "GOODS", label: "Product" }]} /></Field>
          <Field label="HSN / SAC"><input className="input" value={f.hsn} onChange={(e) => setF({ ...f, hsn: e.target.value })} /></Field>
          <Field label="Default price (₹)" required help="Editable on every invoice"><input className="input" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
          <Field label="GST"><Select value={defTax} onChange={(e) => setF({ ...f, tax: e.target.value })} options={taxes.map((t: any) => ({ value: t.id, label: t.name }))} /></Field> {/* eslint-disable-line @typescript-eslint/no-explicit-any */}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Unit"><Select value={f.unit || defaultUnit || ""} onChange={(e) => setF({ ...f, unit: e.target.value })} options={units.map((u: any) => ({ value: u.id, label: u.name }))} /></Field> {/* eslint-disable-line @typescript-eslint/no-explicit-any */}
          <label className="flex items-end gap-2 pb-2 text-[13px]"><input type="checkbox" className="size-4" checked={f.incl} onChange={(e) => setF({ ...f, incl: e.target.checked })} />Price includes GST</label>
        </div>
      </div>
    </Dialog>
  );
}

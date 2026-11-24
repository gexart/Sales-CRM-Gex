import { useState } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Package, Plus, Search, Users } from "lucide-react";
import { PageHeader } from "../../components/layout";
import { useDebounced } from "../../components/forms";
import { Badge, Button, Card, Dialog, EmptyState, ErrorState, Field, Select, Skeleton, Tabs, useToast } from "../../components/ui";
import { bill, errMsg, inr, useBillingAccess } from "../../lib/billing";
import { PhoneActions } from "../../components/contact-actions";
import { rupeesToPaise, useBillingMasters } from "./parts";
import { Fab } from "./ui";

type PT = "CUSTOMER" | "VENDOR";

export function PartiesPage() {
  const { can } = useBillingAccess();
  const qc = useQueryClient();
  const toast = useToast();
  const [type, setType] = useState<PT>("CUSTOMER");
  const [search, setSearch] = useState("");
  const dq = useDebounced(search, 300);
  const [sp] = useSearchParams();
  const [add, setAdd] = useState(sp.get("new") === "1" && can("parties.manage"));
  const [f, setF] = useState({ name: "", phone: "", gstin: "", email: "", billingAddress: "", stateCode: "19", creditDays: "0" });
  const q = useQuery({ queryKey: ["billing-parties", type, dq], queryFn: () => bill.get(`/masters/parties?type=${type}&search=${encodeURIComponent(dq)}&limit=100`) });
  const rows: any[] = q.data?.parties ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const save = useMutation({
    mutationFn: () => bill.post("/masters/parties", { name: f.name, type, phone: f.phone, gstin: f.gstin || undefined, email: f.email || undefined, billingAddress: f.billingAddress || undefined, stateCode: f.stateCode, creditDays: Number(f.creditDays) || 0 }),
    onSuccess: () => (toast("success", "Saved"), setAdd(false), setF({ ...f, name: "", phone: "", gstin: "", email: "", billingAddress: "" }), qc.invalidateQueries({ queryKey: ["billing-parties"] })),
    onError: (e) => toast("error", errMsg(e)),
  });
  return (
    <div className="pb-8">
      <PageHeader title="Parties" icon={Users} actions={can("parties.manage") && <Button variant="primary" icon={Plus} onClick={() => setAdd(true)}>{type === "CUSTOMER" ? "Add customer" : "Add vendor"}</Button>} />
      <div className="px-4 sm:px-6">
        <Tabs<PT> value={type} onChange={setType} tabs={[{ value: "CUSTOMER", label: "Customers" }, { value: "VENDOR", label: "Vendors" }]} />
        <div className="relative my-3"><Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-slate-400" /><input className="input pl-8" placeholder="Search name or phone" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        {q.isError ? <ErrorState error={q.error} /> : q.isLoading ? <Skeleton className="h-24" /> : rows.length === 0 ? <Card><EmptyState icon={Users} title="No parties yet" /></Card> : (
          <Card className="divide-y divide-line">
            {rows.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <div className="min-w-0 flex-1"><div className="truncate font-medium">{p.name}</div><div className="mt-0.5 text-xs text-muted"><PhoneActions phone={p.phone} greeting={`Hello ${p.name},`} />{p.gstin ? ` · ${p.gstin}` : ""}</div></div>
                {p.creditDays ? <Badge>{p.creditDays} days credit</Badge> : null}
              </div>
            ))}
          </Card>
        )}
      </div>
      {can("parties.manage") && <Fab onClick={() => setAdd(true)} label="Add party" />}
      <Dialog open={add} onClose={() => setAdd(false)} title={type === "CUSTOMER" ? "New customer" : "New vendor"} footer={<><Button onClick={() => setAdd(false)}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.name || f.phone.replace(/\D/g, "").length < 10} onClick={() => save.mutate()}>Save</Button></>}>
        <div className="space-y-3">
          <Field label="Name" required><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Phone" required><input className="input" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="GSTIN"><input className="input uppercase" maxLength={15} value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} /></Field>
          <Field label="Email"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Address"><textarea className="input min-h-16" value={f.billingAddress} onChange={(e) => setF({ ...f, billingAddress: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="State code" help="19 = West Bengal"><input className="input" maxLength={2} value={f.stateCode} onChange={(e) => setF({ ...f, stateCode: e.target.value })} /></Field>
            <Field label="Credit days"><input className="input" inputMode="numeric" value={f.creditDays} onChange={(e) => setF({ ...f, creditDays: e.target.value })} /></Field>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

export function ItemsPage() {
  const { can } = useBillingAccess();
  const qc = useQueryClient();
  const toast = useToast();
  const { taxes, units, defaultUnit } = useBillingMasters();
  const [search, setSearch] = useState("");
  const dq = useDebounced(search, 300);
  const [sp] = useSearchParams();
  const [add, setAdd] = useState(sp.get("new") === "1" && can("items.manage"));
  const stock = useQuery({ queryKey: ["billing-stock-qty"], queryFn: () => bill.get("/inventory/summary"), enabled: can("inventory.view"), staleTime: 60_000 });
  const qtyOf = (id: string) => (stock.data?.summary ?? []).filter((r: any) => r.itemId === id).reduce((a: number, r: any) => a + r.currentQtyThousandths, 0) / 1000; // eslint-disable-line @typescript-eslint/no-explicit-any
  const [f, setF] = useState({ name: "", type: "SERVICE", hsnSac: "", unitId: "", sale: "", purchase: "", taxRateId: "" });
  const q = useQuery({ queryKey: ["billing-items", dq], queryFn: () => bill.get(`/masters/items?search=${encodeURIComponent(dq)}&limit=100`) });
  const rows: any[] = q.data?.items ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const taxOf = (id: string) => (taxes.find((t: any) => t.id === id)?.rate_basis_points ?? 0) / 100; // eslint-disable-line @typescript-eslint/no-explicit-any
  const defTax = taxes.find((t: any) => t.rate_basis_points === 1800)?.id ?? taxes[0]?.id; // eslint-disable-line @typescript-eslint/no-explicit-any
  const save = useMutation({
    mutationFn: () => bill.post("/masters/items", { name: f.name, type: f.type, hsnSac: f.hsnSac || undefined, unitId: f.unitId || defaultUnit, salePricePaise: rupeesToPaise(f.sale), purchasePricePaise: rupeesToPaise(f.purchase), taxRateId: f.taxRateId || defTax }),
    onSuccess: () => (toast("success", "Saved"), setAdd(false), setF({ ...f, name: "", hsnSac: "", sale: "", purchase: "" }), qc.invalidateQueries({ queryKey: ["billing-items"] })),
    onError: (e) => toast("error", errMsg(e)),
  });
  return (
    <div className="pb-8">
      <PageHeader title="Items & services" icon={Package} actions={can("items.manage") && <Button variant="primary" icon={Plus} onClick={() => setAdd(true)}>Add item</Button>} />
      <div className="px-4 sm:px-6">
        <div className="relative mb-3"><Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-slate-400" /><input className="input pl-8" placeholder="Search items" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        {q.isError ? <ErrorState error={q.error} /> : q.isLoading ? <Skeleton className="h-24" /> : rows.length === 0 ? <Card><EmptyState icon={Package} title="No items yet" /></Card> : (
          <Card className="divide-y divide-line">
            {rows.map((it) => (
              <div key={it.id} className="relative flex items-center gap-3 px-3.5 py-3.5">
                {it.type !== "SERVICE" && stock.data && <span className={`absolute top-1.5 right-2 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold ${qtyOf(it.id) < 0 ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>Qty: {qtyOf(it.id)}</span>}
                <div className="min-w-0 flex-1"><div className="truncate font-medium">{it.name}</div><div className="text-xs text-muted">{it.type === "SERVICE" ? "Service" : "Goods"}{it.hsnSac ? ` · HSN/SAC ${it.hsnSac}` : ""} · GST {taxOf(it.taxRateId)}%</div></div>
                <div className="text-right"><div className="font-semibold tabular-nums">{inr(it.salePricePaise)}</div>{it.purchasePricePaise !== undefined && <div className="text-xs text-muted tabular-nums">cost {inr(it.purchasePricePaise)}</div>}</div>
              </div>
            ))}
          </Card>
        )}
      </div>
      {can("items.manage") && <Fab onClick={() => setAdd(true)} label="Add item" />}
      <Dialog open={add} onClose={() => setAdd(false)} title="New item or service" footer={<><Button onClick={() => setAdd(false)}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.name || !f.sale} onClick={() => save.mutate()}>Save</Button></>}>
        <div className="space-y-3">
          <Field label="Name" required><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} options={[{ value: "SERVICE", label: "Service" }, { value: "GOODS", label: "Goods" }]} /></Field>
            <Field label="HSN / SAC"><input className="input" value={f.hsnSac} onChange={(e) => setF({ ...f, hsnSac: e.target.value })} /></Field>
            <Field label="Selling price (₹)" required><input className="input" inputMode="decimal" value={f.sale} onChange={(e) => setF({ ...f, sale: e.target.value })} /></Field>
            {can("items.view_cost") && <Field label="Purchase cost (₹)"><input className="input" inputMode="decimal" value={f.purchase} onChange={(e) => setF({ ...f, purchase: e.target.value })} /></Field>}
            <Field label="GST"><Select value={f.taxRateId || defTax || ""} onChange={(e) => setF({ ...f, taxRateId: e.target.value })} options={taxes.map((t: any) => ({ value: t.id, label: t.name }))} /></Field> {/* eslint-disable-line @typescript-eslint/no-explicit-any */}
            <Field label="Unit"><Select value={f.unitId || defaultUnit || ""} onChange={(e) => setF({ ...f, unitId: e.target.value })} options={units.map((u: any) => ({ value: u.id, label: u.name }))} /></Field> {/* eslint-disable-line @typescript-eslint/no-explicit-any */}
          </div>
        </div>
      </Dialog>
    </div>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, Trash2 } from "lucide-react";
import { Button, Field, Select, Skeleton, cn } from "../../components/ui";
import { useDebounced } from "../../components/forms";
import { bill, inr } from "../../lib/billing";

export interface Party { id: string; name: string; phone?: string; stateCode?: string; gstin?: string | null; type?: string }

/** Type to search customers; pick one. Works with a thumb: big rows, no tiny dropdown. */
export function PartyPicker({ value, onPick, type = "CUSTOMER", label = "Customer" }: { value: Party | null; onPick: (p: Party | null) => void; type?: string; label?: string }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const dq = useDebounced(q, 250);
  const list = useQuery({ queryKey: ["billing-party-search", type, dq], queryFn: () => bill.get(`/masters/parties?type=${type === "ANY" ? "" : type}&search=${encodeURIComponent(dq)}&limit=15`), enabled: open });
  if (value)
    return (
      <Field label={label} required>
        <div className="flex items-center justify-between rounded-md border border-line px-3 py-2">
          <div className="min-w-0"><div className="truncate font-medium">{value.name}</div><div className="text-xs text-muted">{value.phone}{value.gstin ? ` · ${value.gstin}` : ""}</div></div>
          <Button size="sm" variant="ghost" onClick={() => onPick(null)}>Change</Button>
        </div>
      </Field>
    );
  const rows: Party[] = list.data?.parties ?? [];
  return (
    <Field label={label} required>
      <div className="relative">
        <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-slate-400" />
        <input className="input pl-8" placeholder="Search by name or phone" value={q} onFocus={() => setOpen(true)} onChange={(e) => (setQ(e.target.value), setOpen(true))} />
        {open && (
          <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-line bg-white shadow-lg dark:bg-night">
            {list.isLoading ? <Skeleton className="m-2 h-8" /> : rows.length ? rows.map((p) => (
              <button key={p.id} type="button" className="block min-h-11 w-full px-3 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-white/5" onClick={() => (onPick(p), setOpen(false))}>
                <div className="truncate text-[13px] font-medium">{p.name}</div><div className="text-xs text-muted">{p.phone}</div>
              </button>
            )) : <div className="p-3 text-xs text-muted">No match. Add the customer under Billing → Parties first.</div>}
          </div>
        )}
      </div>
    </Field>
  );
}

export interface Line { itemId: string; name: string; hsnSac: string; unitId: string; qty: string; price: string; disc: string; taxPct: number; inclusive: boolean }
export const blankLine = (): Line => ({ itemId: "", name: "", hsnSac: "", unitId: "", qty: "1", price: "", disc: "", taxPct: 18, inclusive: false });

export function useBillingMasters() {
  const taxes = useQuery({ queryKey: ["billing-taxes"], queryFn: () => bill.get("/masters/taxes"), staleTime: 300_000 });
  const units = useQuery({ queryKey: ["billing-units"], queryFn: () => bill.get("/masters/units"), staleTime: 300_000 });
  const pct = (id: string) => (taxes.data?.taxRates ?? []).find((t: any) => t.id === id)?.rate_basis_points / 100 || 0; // eslint-disable-line @typescript-eslint/no-explicit-any
  return { taxes: taxes.data?.taxRates ?? [], units: units.data?.units ?? [], pct, defaultUnit: units.data?.units?.[0]?.id as string | undefined };
}

export const rupeesToPaise = (v: string) => Math.round((Number(v) || 0) * 100);

export function totalsOf(lines: Line[], extraDiscountRupees = 0) {
  let sub = 0, disc = 0, tax = 0;
  for (const l of lines) {
    const gross = Math.round((Number(l.qty) || 0) * rupeesToPaise(l.price));
    const d = rupeesToPaise(l.disc);
    const net = gross - d;
    const base = l.inclusive ? Math.round(net / (1 + l.taxPct / 100)) : net;
    sub += l.inclusive ? base + d : gross;
    disc += d;
    tax += l.inclusive ? net - base : Math.round((net * l.taxPct) / 100);
  }
  const extra = rupeesToPaise(String(extraDiscountRupees));
  const total = Math.max(0, sub - disc - extra + tax);
  return { sub, disc: disc + extra, tax, total };
}

/** Line items: pick an item (price, GST and HSN fill in), then adjust quantity, price and discount. */
export function LineEditor({ lines, onChange }: { lines: Line[]; onChange: (l: Line[]) => void }) {
  const { pct, defaultUnit, taxes } = useBillingMasters();
  const set = (i: number, patch: Partial<Line>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-3">
      {lines.map((l, i) => (
        <div key={i} className="rounded-lg border border-line p-3">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1"><ItemSearch pct={pct} value={l.name} onPick={(it) => set(i, { itemId: it.id, name: it.name, hsnSac: it.hsnSac ?? "", unitId: it.unitId || defaultUnit || "", price: String((it.salePricePaise ?? 0) / 100), taxPct: pct(it.taxRateId), inclusive: !!it.priceIncludesTax })} /></div>
            {lines.length > 1 && <Button variant="ghost" size="sm" aria-label="Remove line" icon={Trash2} onClick={() => onChange(lines.filter((_, j) => j !== i))} />}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Field label="Qty"><input className="input" inputMode="decimal" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} /></Field>
            <Field label="Price (₹)"><input className="input" inputMode="decimal" value={l.price} onChange={(e) => set(i, { price: e.target.value })} /></Field>
            <Field label="Discount (₹)"><input className="input" inputMode="decimal" value={l.disc} onChange={(e) => set(i, { disc: e.target.value })} /></Field>
            <Field label="GST %">
              <Select value={String(l.taxPct)} options={[...new Set<number>([0, 5, 12, 18, 28, ...taxes.map((t: any) => t.rate_basis_points / 100)])].sort((a, b) => a - b).map((n) => ({ value: String(n), label: `${n}%` }))} onChange={(e) => set(i, { taxPct: Number(e.target.value) })} />
            </Field>
          </div>
          <div className={cn("mt-1.5 text-right text-xs text-muted", !l.price && "invisible")}>Line total ≈ {inr(totalsOf([l]).total)}{l.inclusive ? " (tax included)" : ""}</div>
        </div>
      ))}
      <Button icon={Plus} onClick={() => onChange([...lines, blankLine()])}>Add line</Button>
    </div>
  );
}

function ItemSearch({ value, onPick, pct }: { value: string; onPick: (it: any) => void; pct: (id: string) => number }) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const dq = useDebounced(q, 250);
  const list = useQuery({ queryKey: ["billing-item-search", dq], queryFn: () => bill.get(`/masters/items?search=${encodeURIComponent(dq)}&limit=15`), enabled: open });
  const rows = list.data?.items ?? [];
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-slate-400" />
      <input className="input pl-8" placeholder="Search item or service" value={open ? q : value || q} onFocus={() => (setOpen(true), setQ(""))} onChange={(e) => setQ(e.target.value)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && (
        <div className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-line bg-white shadow-lg dark:bg-night">
          {rows.length ? rows.map((it: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
            <button key={it.id} type="button" className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-white/5" onMouseDown={(e) => (e.preventDefault(), onPick(it), setOpen(false))}>
              <span className="min-w-0"><span className="block truncate text-[13px] font-medium">{it.name}</span><span className="text-[11px] text-muted">{it.hsnSac ? `HSN/SAC ${it.hsnSac}` : it.type === "SERVICE" ? "Service" : "Goods"}</span></span><span className="shrink-0 text-right"><span className="block text-[13px] font-medium tabular-nums">{inr(it.salePricePaise)}</span><span className="text-[11px] text-muted">{it.priceIncludesTax ? "incl." : "+"} tax {pct(it.taxRateId)}%</span></span>
            </button>
          )) : <div className="p-3 text-xs text-muted">{list.isLoading ? "Searching…" : "No items. Add them under Billing → Items."}</div>}
        </div>
      )}
    </div>
  );
}

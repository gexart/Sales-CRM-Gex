import { useQuery } from "@tanstack/react-query";
import { Printer, Smartphone } from "lucide-react";
import { api } from "../lib/api";
import { date as fmtDate } from "../lib/format";
import { inr } from "../lib/billing";
import { Button, Skeleton } from "../components/ui";

/** What a customer sees when they tap the invoice link in WhatsApp. Works without signing in. */
export function PublicInvoicePage({ token }: { token: string }) {
  const q = useQuery({ queryKey: ["public-invoice", token], queryFn: () => api.get<{ data: any }>(`/public/invoice/${token}`), retry: false }); // eslint-disable-line @typescript-eslint/no-explicit-any
  const d = q.data?.data;
  return (
    <div className="min-h-dvh bg-slate-50 px-3 py-6 dark:bg-night">
      <div className="mx-auto max-w-xl rounded-xl border border-line bg-white p-5 shadow-sm dark:bg-white/5">
        {q.isLoading ? <Skeleton className="h-64" /> : q.isError || !d ? (
          <div className="py-10 text-center"><div className="text-lg font-semibold">Invoice not found</div><p className="mt-1 text-sm text-muted">This link is not valid. Please ask the sender for a new one.</p></div>
        ) : (
          <div className="space-y-4 text-[13px]">
            <div className="flex items-start justify-between gap-3">
              <div><div className="text-lg font-semibold">{d.seller?.name ?? "Invoice"}</div><div className="text-xs text-muted">{d.seller?.gstin ? `GSTIN ${d.seller.gstin}` : ""} {d.seller?.phone ?? ""}</div></div>
              <div className="text-right"><div className="font-semibold">{d.invoiceNo}</div><div className="text-xs text-muted">{fmtDate(d.date)}</div></div>
            </div>
            <div><div className="text-xs text-muted">Billed to</div><div className="font-medium">{d.partyName}</div></div>
            <div className="divide-y divide-line rounded-md border border-line">
              {d.lines.map((l: any, i: number) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                <div key={i} className="flex justify-between gap-3 px-3 py-2"><div><div className="font-medium">{l.name}</div><div className="text-xs text-muted">{l.qty} × {inr(l.pricePaise)} · GST {l.gstPct}%</div></div><div className="tabular-nums">{inr(l.totalPaise)}</div></div>
              ))}
            </div>
            <div className="space-y-1">
              {[["Subtotal", d.subtotalPaise], ["Discount", -d.discountPaise], ["GST", d.taxPaise], ["Round off", d.roundOffPaise]].filter(([, v]) => v).map(([l, v]) => <div key={l as string} className="flex justify-between"><span className="text-muted">{l}</span><span className="tabular-nums">{inr(v as number)}</span></div>)}
              <div className="flex justify-between border-t border-line pt-2 text-base font-semibold"><span>Total</span><span className="tabular-nums">{inr(d.totalPaise)}</span></div>
              {d.paidPaise > 0 && <div className="flex justify-between"><span className="text-muted">Paid</span><span className="tabular-nums">{inr(d.paidPaise)}</span></div>}
              <div className="flex justify-between font-semibold"><span>{d.balancePaise > 0 ? "Amount due" : "Status"}</span><span className="tabular-nums">{d.balancePaise > 0 ? inr(d.balancePaise) : "Paid"}</span></div>
              {d.amountInWords && <div className="pt-1 text-xs text-muted">{d.amountInWords}</div>}
              {d.balancePaise > 0 && d.dueDate && <div className="text-xs text-muted">Due {fmtDate(d.dueDate)}</div>}
            </div>
            <div className="flex flex-wrap gap-2">
              {d.upiDeepLink && <a href={d.upiDeepLink}><Button variant="primary" icon={Smartphone} className="h-11 px-5 text-sm">Pay with UPI</Button></a>}
              <Button icon={Printer} className="h-11" onClick={() => window.print()}>Print / save PDF</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

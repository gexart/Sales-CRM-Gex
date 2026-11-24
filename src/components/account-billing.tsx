import { Link, useNavigate } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FilePlus2, FileSignature, Receipt } from "lucide-react";
import { Badge, Button, Card, CardHeader, useToast } from "./ui";
import { api } from "../lib/api";
import { access, errMsg, inr, INVOICE_STATUS_TONE, useBillingAccess } from "../lib/billing";

/**
 * On a CRM account: turn the client into a billing customer and raise an invoice or quotation in one tap, then see what was
 * billed and what is still due. Invoices raised here are emailed to the client and pushed to crm.gexart.com like any other.
 */
export function AccountBilling({ accountId }: { accountId: string }) {
  const { can, hasBilling } = useBillingAccess();
  const nav = useNavigate();
  const toast = useToast();
  const q = useQuery({ queryKey: ["account-billing", accountId], queryFn: () => access.get(`/from-account/${accountId}`), enabled: hasBilling });
  const go = useMutation({
    mutationFn: (to: "invoice" | "quote") => api.post<{ data: { partyId: string; created: boolean } }>(`/billing-access/from-account/${accountId}`, {}).then((r) => ({ ...r.data, to })),
    onSuccess: (r) => {
      if (r.created) toast("success", "Added to billing as a customer");
      nav(r.to === "invoice" ? `/billing/invoices/new?party=${r.partyId}` : `/billing/quotations?new=1&party=${r.partyId}`);
    },
    onError: (e) => toast("error", errMsg(e)),
  });
  if (!hasBilling) return null;
  const d = q.data?.data;
  const canInvoice = can("invoice.create") || can("invoice.request");
  const canQuote = can("quotation.create");
  return (
    <Card>
      <CardHeader title="Billing" icon={Receipt} subtitle={d?.linked ? "Billing customer linked" : "Not billed yet"} />
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap gap-2">
          {canInvoice && <Button variant="primary" icon={FilePlus2} loading={go.isPending && go.variables === "invoice"} onClick={() => go.mutate("invoice")}>{can("invoice.create") ? "Create invoice" : "Request invoice"}</Button>}
          {canQuote && <Button icon={FileSignature} loading={go.isPending && go.variables === "quote"} onClick={() => go.mutate("quote")}>Quotation</Button>}
        </div>
        {d?.totals && <div className="grid grid-cols-3 gap-2 text-center text-xs"><div><div className="text-muted">Billed</div><div className="font-semibold tabular-nums">{inr(d.totals.totalSalesPaise)}</div></div><div><div className="text-muted">Received</div><div className="font-semibold tabular-nums">{inr(d.totals.totalPaidPaise)}</div></div><div><div className="text-muted">Due</div><div className="font-semibold tabular-nums">{inr(d.totals.totalPendingPaise)}</div></div></div>}
        {d?.invoices?.length ? (
          <div className="divide-y divide-line rounded-md border border-line">
            {d.invoices.map((i: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
              <Link key={i.id} to={`/billing/invoices/${i.id}`} className="flex items-center gap-2 px-3 py-2 text-[13px] hover:bg-slate-50 dark:hover:bg-white/5">
                <span className="min-w-0 flex-1 truncate font-medium">{i.invoiceNo}</span>
                <span className="tabular-nums">{inr(i.totalPaise)}</span>
                <Badge tone={INVOICE_STATUS_TONE[i.status] ?? "gray"}>{i.status}</Badge>
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

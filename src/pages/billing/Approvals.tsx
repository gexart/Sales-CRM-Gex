import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ClipboardCheck, X } from "lucide-react";
import { PageHeader } from "../../components/layout";
import { Badge, Button, Card, Dialog, EmptyState, ErrorState, Field, Skeleton, Tabs, useToast } from "../../components/ui";
import { relative } from "../../lib/format";
import { access, bill, errMsg, inr, useBillingAccess } from "../../lib/billing";
import { getAutoWhatsApp, invoiceMessage, openWhatsApp } from "../../lib/invoice-share";
import { hasDigits } from "../../lib/contact-links";

type Status = "pending" | "approved" | "rejected" | "all";
const TONE = { pending: "amber", approved: "green", rejected: "red", cancelled: "gray" } as const;

/** Invoice requests waiting for a decision. Built for a phone: one card per request, big approve / reject buttons. */
export function ApprovalsPage() {
  const [tab, setTab] = useState<Status>("pending");
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useBillingAccess();
  const q = useQuery({ queryKey: ["billing-approvals", tab], queryFn: () => access.get(`/approvals${tab === "all" ? "" : `?status=${tab}`}`), refetchInterval: 20_000 });
  const rows: any[] = q.data?.data ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const canDecide = !!q.data?.canDecide;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["billing-approvals"] });
    qc.invalidateQueries({ queryKey: ["billing-pending"] });
    qc.invalidateQueries({ queryKey: ["billing-invoices"] });
  };
  const approve = useMutation({
    mutationFn: (id: string) => access.post(`/approvals/${id}/approve`, {}),
    onSuccess: async (r) => {
      toast("success", `Approved. Invoice ${r.data.invoiceNo ?? ""} created.`);
      refresh();
      if (getAutoWhatsApp() && r.data.invoiceId) {
        try {
          const inv = (await bill.get(`/sales/invoices/${r.data.invoiceId}`)).invoice;
          if (hasDigits(inv.party_phone ?? "")) openWhatsApp(inv.party_phone, invoiceMessage({ party: inv.party_name, invoiceNo: inv.invoice_no, totalPaise: inv.total_paise, balancePaise: inv.balance_amount_paise, dueDate: inv.due_date, token: inv.shareToken }));
        } catch { /* the invoice exists; sharing is optional */ }
      }
    },
    onError: (e) => (toast("error", errMsg(e)), refresh()),
  });
  const reject = useMutation({
    mutationFn: () => access.post(`/approvals/${rejecting}/reject`, { reason }),
    onSuccess: () => (toast("success", "Rejected"), setRejecting(null), setReason(""), refresh()),
    onError: (e) => toast("error", errMsg(e)),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => access.post(`/approvals/${id}/cancel`),
    onSuccess: () => (toast("success", "Request withdrawn"), refresh()),
    onError: (e) => toast("error", errMsg(e)),
  });

  return (
    <div className="pb-8">
      <PageHeader title="Approvals" icon={ClipboardCheck} subtitle={canDecide ? "Invoices wait here until you approve them" : "Your invoice requests and their status"} />
      <div className="px-4 sm:px-6">
        <Tabs<Status>
          value={tab}
          onChange={setTab}
          tabs={[{ value: "pending", label: "Pending", count: tab === "pending" ? undefined : q.data?.pending }, { value: "approved", label: "Approved" }, { value: "rejected", label: "Rejected" }, { value: "all", label: "All" }]}
        />
        <div className="mt-3 space-y-3">
          {q.isError ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          ) : q.isLoading ? (
            <Skeleton className="h-28" />
          ) : rows.length === 0 ? (
            <Card><EmptyState icon={ClipboardCheck} title={tab === "pending" ? "Nothing waiting" : "Nothing here"} body="Invoice requests from your team show up here the moment they are submitted." /></Card>
          ) : (
            rows.map((a) => (
              <Card key={a.id} className="p-3.5">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[15px] font-semibold">{a.party_name}</span>
                      <Badge tone={TONE[a.status as keyof typeof TONE] ?? "gray"}>{a.status}</Badge>
                    </div>
                    <div className="mt-0.5 text-xs text-muted">
                      {a.requested_by_name} · {relative(a.created_at)}
                    </div>
                    {a.reason && <div className="mt-1.5 text-xs text-amber-700 dark:text-amber-300">{a.reason}</div>}
                    {a.decision_note && <div className="mt-1 text-xs text-muted">Note: {a.decision_note}</div>}
                    {a.status === "approved" && a.result_no && (
                      <Link className="mt-1 inline-block text-xs font-medium text-brand-700 underline" to={`/billing/invoices/${a.result_id}`}>Invoice {a.result_no}</Link>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-semibold tabular-nums">{inr(a.amount_paise)}</div>
                    <button className="text-xs text-muted underline" onClick={() => setOpen(open === a.id ? null : a.id)}>{open === a.id ? "Hide" : "Details"}</button>
                  </div>
                </div>
                {open === a.id && <Details id={a.id} />}
                {a.status === "pending" && (
                  <div className="mt-3 flex gap-2">
                    {canDecide && (
                      <>
                        <Button variant="primary" className="h-10 flex-1 sm:h-8 sm:flex-none" icon={Check} loading={approve.isPending && approve.variables === a.id} onClick={() => approve.mutate(a.id)}>Approve</Button>
                        <Button variant="secondary" className="h-10 flex-1 sm:h-8 sm:flex-none" icon={X} onClick={() => setRejecting(a.id)}>Reject</Button>
                      </>
                    )}
                    {!canDecide && can("billing.access") && <Button onClick={() => cancel.mutate(a.id)} loading={cancel.isPending}>Withdraw</Button>}
                  </div>
                )}
              </Card>
            ))
          )}
        </div>
      </div>
      <Dialog
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title="Reject this invoice request"
        footer={<><Button onClick={() => setRejecting(null)}>Cancel</Button><Button variant="danger" disabled={reason.trim().length < 3} loading={reject.isPending} onClick={() => reject.mutate()}>Reject</Button></>}
      >
        <Field label="Reason (the requester will see this)" required>
          <textarea className="input min-h-20" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong GST rate" />
        </Field>
      </Dialog>
    </div>
  );
}

function Details({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["billing-approval", id], queryFn: () => access.get(`/approvals/${id}`) });
  const d = q.data?.data?.payload;
  if (!d) return <Skeleton className="mt-3 h-12" />;
  return (
    <div className="mt-3 rounded-md bg-slate-50 p-2.5 text-xs dark:bg-white/5">
      <div className="mb-1 text-muted">Due {d.dueDate} · {d.paymentMode}</div>
      {d.items.map((l: any, i: number) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
        <div key={i} className="flex justify-between gap-2 py-0.5">
          <span className="truncate">{l.name} × {l.quantityThousandths / 1000}</span>
          <span className="tabular-nums">{inr(Math.round((l.quantityThousandths * l.unitPricePaise) / 1000))}{l.discountPaise ? ` (−${inr(l.discountPaise)})` : ""} · GST {l.taxRatePercent}%</span>
        </div>
      ))}
    </div>
  );
}

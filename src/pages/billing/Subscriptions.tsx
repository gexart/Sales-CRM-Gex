import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pause, Play, Repeat, Trash2, Zap } from "lucide-react";
import { PageHeader } from "../../components/layout";
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Select, Skeleton, useToast } from "../../components/ui";
import { date as fmtDate } from "../../lib/format";
import { access, errMsg, useBillingAccess } from "../../lib/billing";

export const FREQ_LABEL: Record<string, string> = { weekly: "Every week", monthly: "Every month", quarterly: "Every 3 months", half_yearly: "Every 6 months", yearly: "Every year" };

/** Recurring invoices: a saved invoice that is created again on a schedule, then emailed and pushed like any other. */
export function SubscriptionsPage() {
  const { can } = useBillingAccess();
  const qc = useQueryClient();
  const toast = useToast();
  const [del, setDel] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["billing-recurring"], queryFn: () => access.get("/recurring"), enabled: can("invoice.create") });
  const rows: any[] = q.data?.data ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const refresh = () => qc.invalidateQueries({ queryKey: ["billing-recurring"] });
  const toggle = useMutation({ mutationFn: (v: { id: string; active: boolean }) => access.put(`/recurring/${v.id}`, { active: v.active }), onSuccess: refresh, onError: (e) => toast("error", errMsg(e)) });
  const runNow = useMutation({ mutationFn: (id: string) => access.post(`/recurring/${id}/run-now`), onSuccess: (r) => (r.data.last_error ? toast("error", r.data.last_error) : toast("success", `Created ${r.data.last_invoice_no ?? "the invoice"}`), refresh(), qc.invalidateQueries({ queryKey: ["billing-invoices"] })), onError: (e) => toast("error", errMsg(e)) });
  const remove = useMutation({ mutationFn: (id: string) => access.del(`/recurring/${id}`), onSuccess: () => (setDel(null), refresh()), onError: (e) => toast("error", errMsg(e)) });
  return (
    <div className="pb-8">
      <PageHeader title="Subscriptions" icon={Repeat} subtitle="Invoices that repeat on their own. Start one from any invoice with Repeat." />
      <div className="px-4 sm:px-6">
        {q.isError ? <ErrorState error={q.error} /> : q.isLoading ? <Skeleton className="h-24" /> : rows.length === 0 ? <Card><EmptyState icon={Repeat} title="No recurring invoices yet" body="Open an invoice and press Repeat." action={<Link to="/billing/invoices"><Button>Go to invoices</Button></Link>} /></Card> : (
          <Card className="divide-y divide-line">
            {rows.map((r) => (
              <div key={r.id} className="space-y-2 px-3.5 py-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1"><div className="truncate font-medium">{r.title}</div><div className="text-xs text-muted">{FREQ_LABEL[r.frequency]} · next {fmtDate(r.next_run)}{r.end_date ? ` · ends ${fmtDate(r.end_date)}` : ""} · made {r.runs}</div></div>
                  <Badge tone={r.active ? "green" : "gray"}>{r.active ? "Active" : "Paused"}</Badge>
                </div>
                {r.last_error && <div className="text-xs text-red-600">Last attempt failed: {r.last_error}</div>}
                {r.last_invoice_no && <div className="text-xs text-muted">Last invoice {r.last_invoice_no}</div>}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" icon={Zap} loading={runNow.isPending && runNow.variables === r.id} onClick={() => runNow.mutate(r.id)}>Create now</Button>
                  <Button size="sm" icon={r.active ? Pause : Play} onClick={() => toggle.mutate({ id: r.id, active: !r.active })}>{r.active ? "Pause" : "Resume"}</Button>
                  <Button size="sm" variant="ghost" icon={Trash2} aria-label="Delete" onClick={() => setDel(r.id)} />
                </div>
              </div>
            ))}
          </Card>
        )}
      </div>
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del)} title="Delete this schedule?" body="Invoices already created stay." confirmLabel="Delete" danger loading={remove.isPending} />
    </div>
  );
}

/** Used inside the invoice screen: pick how often and when it starts. */
export function RepeatFields({ frequency, setFrequency, firstRun, setFirstRun, endDate, setEndDate }: { frequency: string; setFrequency: (v: string) => void; firstRun: string; setFirstRun: (v: string) => void; endDate: string; setEndDate: (v: string) => void }) {
  return (
    <div className="space-y-3">
      <Field label="Repeat"><Select value={frequency} onChange={(e) => setFrequency(e.target.value)} options={Object.entries(FREQ_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Next invoice on"><input className="input" type="date" value={firstRun} onChange={(e) => setFirstRun(e.target.value)} /></Field>
        <Field label="Stop after (optional)"><input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
      </div>
      <p className="text-xs text-muted">Each new invoice uses today's date, the same items and prices, is emailed to the client and sent to the CRM like any other invoice.</p>
    </div>
  );
}

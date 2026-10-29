import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Ban, CheckCircle2, ListOrdered, MailX, Pencil, Reply, Send, ShieldCheck, UserPlus } from "lucide-react";
import { api, type Row } from "../lib/api";
import { useAuth } from "../lib/auth";
import { CONFIGS } from "../lib/entities";
import * as E from "../../shared/enums";
import { dateTime, relative } from "../lib/format";
import { PageHeader } from "../components/layout";
import { AuditTrail, invalidateRecord, useArchive } from "../components/records";
import { EnrollDialog, Highlighted, MarkSentDialog, MessageActions, OutreachComposer, OutreachNav, ResponseDialog, SectionNote, SequenceEditor } from "../components/outreach";
import { Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, KeyValue, Skeleton, StatusBadge, cn, useToast } from "../components/ui";
import { EntityListPage } from "./EntityListPage";
import { useRecord } from "./RecordDetailPage";
import { useAvailable } from "./Prospecting";
import { LinkedAssets } from "./Library";

const VIEWS: Record<string, { label: string; presets: Record<string, string> }> = {
  unsent: { label: "To send", presets: { unsent: "1" } },
  sent: { label: "Sent", presets: { sent: "1" } },
  replied: { label: "Replied", presets: { status: "replied" } },
  all: { label: "All", presets: {} },
};

export function OutreachMessagesPage() {
  const [sp, setSp] = useSearchParams();
  const [composing, setComposing] = useState(false);
  const view = sp.get("view") ?? "unsent";
  const presets = useMemo(() => VIEWS[view]?.presets ?? VIEWS.unsent.presets, [view]);
  return (
    <>
      <EntityListPage
        key={view}
        cfg={CONFIGS.outreach}
        presets={presets}
        onCreate={() => setComposing(true)}
        headerExtra={<OutreachNav />}
        intro={
          <SectionNote>
            Drafts are prepared here and sent from your own email app, phone, LinkedIn or WhatsApp. A message counts as sent only after you confirm it with
            <b> Mark as sent</b>. Brevo sending will be available once it is configured and validated.
          </SectionNote>
        }
        toolbarExtra={
          <div className="flex rounded-md border border-line bg-white p-0.5">
            {Object.entries(VIEWS).map(([k, v]) => (
              <button
                key={k}
                onClick={() => {
                  const n = new URLSearchParams(sp);
                  k === "unsent" ? n.delete("view") : n.set("view", k);
                  n.delete("page");
                  setSp(n, { replace: true });
                }}
                className={cn("h-7 rounded px-2 text-xs font-medium", view === k ? "bg-slate-100 text-ink" : "text-slate-500 hover:text-ink")}
              >
                {v.label}
              </button>
            ))}
          </div>
        }
      />
      <OutreachComposer open={composing} onClose={() => setComposing(false)} />
    </>
  );
}

export function OutreachMessagePage() {
  const { id = "" } = useParams();
  const q = useRecord(CONFIGS.outreach, id);
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState<"replied" | "bounced" | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const archive = useArchive("outreach", id);
  const avail = useAvailable();
  const [brevo, setBrevo] = useState(false);
  const sendBrevo = useMutation({
    mutationFn: () => api.post(`/outreach/${id}/send-brevo`, { confirm: true }),
    onSuccess: () => {
      invalidateRecord(qc);
      qc.invalidateQueries({ queryKey: ["outreach"] });
      setBrevo(false);
      toast("success", "Sent through Brevo. Delivery status updates automatically.");
    },
    onError: (e) => (setBrevo(false), toast("error", (e as Error).message)),
  });
  const setStatus = useMutation({
    mutationFn: (status: string) => api.patch(`/outreach/${id}`, { status }),
    onSuccess: () => {
      invalidateRecord(qc);
      qc.invalidateQueries({ queryKey: ["outreach"] });
      setConfirmCancel(false);
    },
    onError: (e) => toast("error", (e as Error).message),
  });
  if (q.isError) return <div className="p-6"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;
  if (!q.data) return <div className="space-y-3 p-6"><Skeleton className="h-6 w-64" /><Skeleton className="h-64" /></div>;
  const m = q.data;
  const unsent = E.UNSENT_OUTREACH_STATUSES.includes(m.status);
  const unresolved = /\{\{\s*[a-zA-Z0-9_]+\s*\}\}/.test(`${m.subject ?? ""}${m.body ?? ""}`);
  const isEmail = m.channel === "manual_email" || m.channel === "brevo";
  return (
    <div className="pb-10">
      <PageHeader
        crumbs={[{ label: "Outreach", to: "/outreach" }, { label: m.title }]}
        title={
          <span className="flex items-center gap-2">
            {m.title} <StatusBadge value={m.status} label={E.labelOf(E.OUTREACH_STATUSES, m.status)} />
            {m.archived_at && <Badge>Archived</Badge>}
          </span>
        }
        subtitle={CONFIGS.outreach.subtitleOf?.(m)}
        actions={
          <>
            {unsent && (
              <>
                <Button icon={Pencil} onClick={() => setEditing(true)}>Edit</Button>
                {m.status === "draft" && <Button onClick={() => setStatus.mutate("ready_for_review")} loading={setStatus.isPending}>Submit for review</Button>}
                {m.status === "ready_for_review" && (
                  <Button icon={ShieldCheck} disabled={unresolved} title={unresolved ? "Resolve placeholders first" : undefined} onClick={() => setStatus.mutate("approved")}>
                    Approve
                  </Button>
                )}
                <Button icon={Ban} variant="ghost" onClick={() => setConfirmCancel(true)}>Cancel</Button>
                {m.status === "approved" && avail.data?.brevo && (
                  <Button icon={Send} disabled={unresolved || !m.contact_email} title={!m.contact_email ? "The contact has no email" : "Send through Brevo"} onClick={() => setBrevo(true)}>Send via Brevo</Button>
                )}
                <Button variant="primary" icon={CheckCircle2} disabled={unresolved || !m.body} title={unresolved ? "Resolve placeholders first" : undefined} onClick={() => setSending(true)}>
                  Mark as sent
                </Button>
              </>
            )}
            {m.status === "failed" && avail.data?.brevo && <Button variant="primary" icon={Send} onClick={() => setBrevo(true)}>Retry Brevo send</Button>}
            {["sent", "delivered"].includes(m.status) && (
              <>
                <Button icon={MailX} onClick={() => setResponse("bounced")}>Record bounce</Button>
                <Button variant="primary" icon={Reply} onClick={() => setResponse("replied")}>Record reply</Button>
              </>
            )}
            {!unsent && !m.archived_at && <Button icon={Archive} variant="ghost" onClick={() => archive.mutate(true)}>Archive</Button>}
          </>
        }
      />
      <div className="grid gap-4 px-4 sm:px-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          {unresolved && unsent && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              This draft still contains placeholders. Edit it to fill them in before copying or sending.
            </div>
          )}
          <Card>
            <CardHeader title={isEmail ? "Email" : E.labelOf(E.OUTREACH_CHANNELS, m.channel)} icon={Send} action={<MessageActions subject={m.subject ?? ""} body={m.body ?? ""} to={m.contact_email} channel={m.channel} />} />
            <div className="p-4">
              {isEmail && (
                <div className="mb-3 border-b border-line pb-2">
                  <div className="text-[11px] text-muted">To</div>
                  <div>{m.contact_name ? `${m.contact_name}${m.contact_email ? ` <${m.contact_email}>` : " — no email on record"}` : "—"}</div>
                  <div className="mt-2 text-[11px] text-muted">Subject</div>
                  <div className="font-medium"><Highlighted text={m.subject ?? "—"} /></div>
                </div>
              )}
              <div className="leading-relaxed whitespace-pre-wrap"><Highlighted text={m.body ?? ""} /></div>
            </div>
          </Card>
          <LinkedAssets type="outreach" id={id} title="Attachments to send with this message" />
          {(m.outcome || m.notes) && (
            <Card className="p-4">
              {m.outcome && <KeyValue label="Outcome">{m.outcome}</KeyValue>}
              {m.notes && <KeyValue label="Notes">{m.notes}</KeyValue>}
            </Card>
          )}
        </div>
        <div className="space-y-4">
          <Card className="p-4">
            <KeyValue label="Recipient">{m.contact_id ? <Link className="font-medium text-ink underline decoration-stone-300 underline-offset-2 hover:decoration-ink" to={`/contacts/${m.contact_id}`}>{m.contact_name}</Link> : null}</KeyValue>
            <KeyValue label="Account">{m.account_id ? <Link className="font-medium text-ink underline decoration-stone-300 underline-offset-2 hover:decoration-ink" to={`/accounts/${m.account_id}`}>{m.account_name}</Link> : null}</KeyValue>
            <KeyValue label="Prospect">{m.prospect_id ? <Link className="font-medium text-ink underline decoration-stone-300 underline-offset-2 hover:decoration-ink" to={`/prospecting/${m.prospect_id}`}>{m.prospect_name}</Link> : null}</KeyValue>
            <KeyValue label="Campaign">{m.campaign_name}</KeyValue>
            <KeyValue label="Template">{m.template_name}</KeyValue>
            <KeyValue label="Service">{m.product_name}</KeyValue>
            <KeyValue label="Planned">{m.planned_send_at ? dateTime(m.planned_send_at) : null}</KeyValue>
            <KeyValue label="Sent">{m.sent_at ? `${dateTime(m.sent_at)} · ${m.sent_via_integration ? "via provider" : "manual, confirmed by user"}` : null}</KeyValue>
            <KeyValue label="Reply">{m.replied_at ? dateTime(m.replied_at) : null}</KeyValue>
            <KeyValue label="Follow-up">{m.next_follow_up_at ? dateTime(m.next_follow_up_at) : null}</KeyValue>
            <KeyValue label="Owner">{m.owner_name}</KeyValue>
            <KeyValue label="Updated">{relative(m.updated_at)}</KeyValue>
          </Card>
          <AuditTrail entityType="outreach" entityId={id} />
        </div>
      </div>
      <OutreachComposer open={editing} onClose={() => setEditing(false)} message={m} />
      <MarkSentDialog message={m} open={sending} onClose={() => setSending(false)} key={sending ? "open" : "closed"} />
      <ResponseDialog message={m} outcome={response} onClose={() => setResponse(null)} key={response ?? "none"} />
      <ConfirmDialog open={brevo} onClose={() => setBrevo(false)} title="Send via Brevo?" body={<>This sends the email now to <b>{m.contact_email}</b> from the configured Brevo sender. Attachments are not sent automatically.</>} confirmLabel="Send now" loading={sendBrevo.isPending} onConfirm={() => sendBrevo.mutate()} />
      <ConfirmDialog open={confirmCancel} onClose={() => setConfirmCancel(false)} title="Cancel this draft?" body="It will not be sent and stays in history as cancelled." confirmLabel="Cancel draft" danger loading={setStatus.isPending} onConfirm={() => setStatus.mutate("cancelled")} />
    </div>
  );
}

export function TemplatesPage() {
  return <EntityListPage cfg={CONFIGS.templates} headerExtra={<OutreachNav />} intro={<SectionNote>Templates use safe placeholders such as {"{{contact_first_name}}"} and {"{{company_name}}"}. Unknown placeholders are rejected, and a message with unresolved placeholders cannot be approved or marked as sent.</SectionNote>} />;
}

export function SequencesPage() {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <EntityListPage
        cfg={CONFIGS.sequences}
        headerExtra={<OutreachNav />}
        onCreate={() => setCreating(true)}
        intro={<SectionNote>Sequences schedule follow-up tasks and prepare draft messages for each enrolled contact. They never send anything automatically.</SectionNote>}
      />
      <SequenceEditor open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

export function SequenceDetailPage() {
  const { id = "" } = useParams();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useRecord(CONFIGS.sequences, id);
  const detail = useQuery({ queryKey: ["sequences", "detail", id], queryFn: () => api.get(`/sequences/${id}/detail`).then((r) => r.data) });
  const [editing, setEditing] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const stop = useMutation({
    mutationFn: (eid: string) => api.post(`/sequence-enrollments/${eid}/stop`),
    onSuccess: () => {
      invalidateRecord(qc);
      qc.invalidateQueries({ queryKey: ["sequences"] });
      toast("success", "Stopped. Remaining tasks and unsent drafts were cancelled.");
    },
    onError: (e) => toast("error", (e as Error).message),
  });
  if (q.isError) return <div className="p-6"><ErrorState error={q.error} /></div>;
  if (!q.data) return <div className="p-6"><Skeleton className="h-64" /></div>;
  const s = q.data;
  const steps: Row[] = detail.data?.steps ?? [];
  const enrollments: Row[] = detail.data?.enrollments ?? [];
  return (
    <div className="pb-10">
      <PageHeader
        crumbs={[{ label: "Outreach", to: "/outreach" }, { label: "Sequences", to: "/outreach/sequences" }, { label: s.name }]}
        title={<span className="flex items-center gap-2">{s.name} <StatusBadge value={s.status} label={E.labelOf(E.ACTIVE_STATUSES, s.status)} /></span>}
        subtitle={s.description}
        actions={
          <>
            {isManager && <Button icon={Pencil} onClick={() => setEditing(true)}>Edit</Button>}
            <Button variant="primary" icon={UserPlus} disabled={s.status !== "active"} onClick={() => setEnrolling(true)}>Enroll contact</Button>
          </>
        }
      />
      <div className="grid gap-4 px-4 sm:px-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Steps" icon={ListOrdered} />
          <ol className="space-y-3 p-4">
            {steps.map((st) => (
              <li key={st.id} className="flex gap-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-semibold text-ink">D{st.day_offset + 1}</span>
                <div>
                  <div className="font-medium">{E.labelOf(E.OUTREACH_CHANNELS, st.channel)}</div>
                  <div className="text-xs text-muted">{st.template_name ? `Draft from “${st.template_name}”` : "Task only"}{st.note ? ` · ${st.note}` : ""}</div>
                </div>
              </li>
            ))}
            {detail.isLoading && <Skeleton className="h-24" />}
          </ol>
        </Card>
        <Card>
          <CardHeader title="Enrolled contacts" icon={UserPlus} subtitle={`${enrollments.filter((e) => e.status === "active").length} active`} />
          {!enrollments.length ? (
            <EmptyState compact icon={UserPlus} title="No one enrolled yet" body="Enroll a contact to schedule this sequence's tasks and drafts." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-line bg-slate-50/70">
                  <tr><th className="th">Contact</th><th className="th">Account</th><th className="th">Started</th><th className="th">Progress</th><th className="th">Status</th><th className="th" /></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {enrollments.map((e) => (
                    <tr key={e.id}>
                      <td className="td"><Link className="font-medium hover:text-ink" to={`/contacts/${e.contact_id}`}>{e.contact_name}</Link></td>
                      <td className="td text-muted">{e.account_name ?? "—"}</td>
                      <td className="td text-muted">{e.started_at}</td>
                      <td className="td tabular-nums">{e.task_done}/{e.task_total} tasks</td>
                      <td className="td"><StatusBadge value={e.status === "stopped" ? "cancelled" : e.status} label={E.labelOf(E.ENROLLMENT_STATUSES, e.status)} /></td>
                      <td className="td text-right">{e.status === "active" && <Button size="sm" variant="ghost" loading={stop.isPending && stop.variables === e.id} onClick={() => stop.mutate(e.id)}>Stop</Button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
      <SequenceEditor open={editing} onClose={() => setEditing(false)} sequence={s} steps={steps} />
      <EnrollDialog open={enrolling} onClose={() => setEnrolling(false)} sequenceId={id} key={enrolling ? "o" : "c"} />
    </div>
  );
}

/** Outreach messages for one record, used on account/contact/prospect pages. */
export function OutreachList({ filter, defaults }: { filter: Record<string, string>; defaults: Parameters<typeof OutreachComposer>[0]["defaults"] }) {
  const [composing, setComposing] = useState(false);
  const q = useQuery({ queryKey: ["outreach", "for", filter], queryFn: () => api.get<{ data: Row[] }>(`/outreach?${new URLSearchParams({ ...filter, pageSize: "50" })}`) });
  const rows = q.data?.data ?? [];
  return (
    <Card>
      <CardHeader title="Outreach messages" icon={Send} action={<Button size="sm" icon={Send} onClick={() => setComposing(true)}>Create outreach</Button>} />
      {q.isLoading ? (
        <div className="p-4"><Skeleton className="h-12" /></div>
      ) : rows.length ? (
        <ul className="divide-y divide-line px-4">
          {rows.map((m) => (
            <li key={m.id} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <Link to={`/outreach/${m.id}`} className="block truncate font-medium hover:text-ink">{m.title}</Link>
                <div className="truncate text-xs text-muted">{E.labelOf(E.OUTREACH_CHANNELS, m.channel)}{m.contact_name && ` · ${m.contact_name}`} · {m.sent_at ? `sent ${relative(m.sent_at)}` : `updated ${relative(m.updated_at)}`}</div>
              </div>
              <StatusBadge value={m.status} label={E.labelOf(E.OUTREACH_STATUSES, m.status)} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState compact icon={Send} title="No outreach yet" body="Draft a personalised message from a template, copy it into your mail app, then confirm when sent." />
      )}
      <OutreachComposer open={composing} onClose={() => setComposing(false)} defaults={defaults} />
    </Card>
  );
}

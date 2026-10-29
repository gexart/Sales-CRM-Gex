import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Copy, ExternalLink, FileText, ListOrdered, Mail, Phone, Plus, Send, Trash2 } from "lucide-react";
import { api, ApiError, qs, type Page, type Row } from "../lib/api";
import * as E from "../../shared/enums";
import { PLACEHOLDERS, type RenderResult } from "../../shared/templating";
import { fromLocalInput, toLocalInput } from "../lib/format";
import { RefSelect, useDebounced } from "./forms";
import { invalidateRecord } from "./records";
import { Badge, Button, Dialog, Field, Select, SlideOver, cn, useToast } from "./ui";

export function OutreachNav() {
  const items = [
    { to: "/outreach", label: "Messages", icon: Send, end: true },
    { to: "/outreach/calls", label: "Calls", icon: Phone },
    { to: "/outreach/templates", label: "Templates", icon: FileText },
    { to: "/outreach/sequences", label: "Sequences", icon: ListOrdered },
  ];
  return (
    <div className="flex rounded-md border border-line bg-white p-0.5 shadow-[var(--shadow-card)]">
      {items.map((i) => (
        <NavLink
          key={i.to}
          to={i.to}
          end={i.end}
          className={({ isActive }) => cn("flex h-7 items-center gap-1 rounded px-2 text-xs font-medium", isActive ? "bg-slate-100 text-ink" : "text-slate-500 hover:text-ink")}
        >
          <i.icon className="size-3.5" /> {i.label}
        </NavLink>
      ))}
    </div>
  );
}

export function CopyButton({ text, label, disabled, title }: { text: string; label: string; disabled?: boolean; title?: string }) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      icon={done ? Check : Copy}
      disabled={disabled}
      title={title}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          toast("error", "Clipboard is not available in this browser");
        }
      }}
    >
      {done ? "Copied" : label}
    </Button>
  );
}

/** Renders text with any remaining {{placeholders}} highlighted. */
export function Highlighted({ text }: { text: string }) {
  const parts = text.split(/(\{\{\s*[a-zA-Z0-9_]+\s*\}\})/g);
  return (
    <>
      {parts.map((p, i) =>
        /^\{\{/.test(p) ? (
          <mark key={i} className="rounded bg-amber-100 px-0.5 text-amber-900">
            {p}
          </mark>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

const MAILTO_LIMIT = 1900;
export function mailtoHref(to: string | null | undefined, subject: string, body: string) {
  const href = `mailto:${encodeURIComponent(to ?? "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return href.length <= MAILTO_LIMIT ? href : null;
}

export function MessageActions({ subject, body, to, channel }: { subject: string; body: string; to?: string | null; channel: string }) {
  const unresolved = /\{\{\s*[a-zA-Z0-9_]+\s*\}\}/.test(subject + body);
  const why = unresolved ? "Resolve the highlighted placeholders first" : undefined;
  const isEmail = channel === "manual_email";
  const href = isEmail && !unresolved ? mailtoHref(to, subject, body) : null;
  return (
    <div className="flex flex-wrap gap-2">
      {isEmail && <CopyButton text={subject} label="Copy subject" disabled={unresolved || !subject} title={why} />}
      <CopyButton text={body} label={isEmail ? "Copy email body" : "Copy message"} disabled={unresolved || !body} title={why} />
      {isEmail && <CopyButton text={`Subject: ${subject}\n\n${body}`} label="Copy complete email" disabled={unresolved || !body} title={why} />}
      {isEmail && (
        <a
          href={href ?? undefined}
          aria-disabled={!href}
          title={unresolved ? why : !href ? "Too long for a mail link — use the copy buttons" : "Opens your email app with this draft. Opening it does not send anything."}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-white px-2 text-xs font-medium shadow-[var(--shadow-card)] hover:bg-slate-50",
            !href && "pointer-events-none opacity-50",
          )}
        >
          <ExternalLink className="size-3.5" /> Open in email app
        </a>
      )}
    </div>
  );
}

function Warnings({ subject, body }: { subject?: RenderResult; body?: RenderResult }) {
  const missing = [...new Set([...(subject?.missing ?? []), ...(body?.missing ?? [])])];
  const unknown = [...new Set([...(subject?.unknown ?? []), ...(body?.unknown ?? [])])];
  if (!missing.length && !unknown.length) return null;
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
      <div className="flex items-center gap-1.5 font-medium">
        <AlertTriangle className="size-3.5" /> This message cannot be sent yet
      </div>
      {missing.length > 0 && (
        <p className="mt-1">
          No value on record for {missing.map((m) => <code key={m} className="mx-0.5">{`{{${m}}}`}</code>)}. Add it to the record or replace it in the text.
        </p>
      )}
      {unknown.length > 0 && <p className="mt-1">Unsupported placeholder(s): {unknown.map((u) => <code key={u} className="mx-0.5">{`{{${u}}}`}</code>)}.</p>}
    </div>
  );
}

export interface ComposerDefaults {
  contact_id?: string;
  contact_name?: string;
  account_id?: string;
  account_name?: string;
  prospect_id?: string;
  prospect_name?: string;
  campaign_id?: string;
  campaign_name?: string;
}

export function OutreachComposer({ open, onClose, defaults, message }: { open: boolean; onClose: () => void; defaults?: ComposerDefaults; message?: Row | null }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const editing = !!message;
  const [channel, setChannel] = useState("manual_email");
  const [contactId, setContactId] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [productId, setProductId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setChannel(message?.channel ?? "manual_email");
    setContactId(message?.contact_id ?? defaults?.contact_id ?? null);
    setTemplateId(message?.template_id ?? null);
    setProductId(message?.product_id ?? null);
    setTitle(message?.title ?? "");
    setSubject(message?.subject ?? "");
    setBody(message?.body ?? "");
    setError(null);
  }, [open, message, defaults]);

  const accountId = message?.account_id ?? defaults?.account_id ?? null;
  const prospectId = message?.prospect_id ?? defaults?.prospect_id ?? null;
  const scope = { contact_id: contactId, account_id: accountId, prospect_id: prospectId, product_id: productId };

  const templates = useQuery({
    queryKey: ["templates", "list", { status: "active", pageSize: 100 }],
    queryFn: () => api.get<Page<Row>>(`/templates${qs({ status: "active", pageSize: 100, sort: "name", dir: "asc" })}`),
    enabled: open,
  });

  // Applying a template fills the editor with text personalised for this recipient.
  const apply = useMutation({
    mutationFn: (tid: string) => api.post<{ data: Row }>("/outreach/render", { template_id: tid, ...scope }),
    onSuccess: (r) => {
      setSubject(r.data.subject.text);
      setBody(r.data.body.text);
      if (!productId && r.data.template?.product_id) setProductId(r.data.template.product_id);
      if (!title) setTitle(r.data.template?.name ?? "");
    },
    onError: (e) => setError((e as Error).message),
  });

  const debounced = useDebounced(JSON.stringify({ subject, body, ...scope }), 300);
  const preview = useQuery({
    queryKey: ["outreach-preview", debounced],
    queryFn: () => api.post<{ data: Row }>("/outreach/render", JSON.parse(debounced)).then((r) => r.data),
    enabled: open && (!!subject || !!body),
    placeholderData: (p) => p,
  });
  const p = preview.data;
  const finalSubject = p?.subject.text ?? subject;
  const finalBody = p?.body.text ?? body;

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        title: title || finalSubject || "Outreach",
        channel,
        contact_id: contactId,
        product_id: productId,
        template_id: templateId,
        subject: finalSubject,
        body: finalBody,
        ...(editing ? {} : { account_id: accountId, prospect_id: prospectId, campaign_id: defaults?.campaign_id ?? null }),
      };
      return editing ? api.patch(`/outreach/${message!.id}`, payload) : api.post("/outreach", payload);
    },
    onSuccess: (r) => {
      invalidateRecord(qc);
      qc.invalidateQueries({ queryKey: ["outreach"] });
      toast("success", editing ? "Draft updated" : "Draft saved. Send it from your email app, then mark it as sent.");
      onClose();
      if (!editing) nav(`/outreach/${r.data.id}`);
    },
    onError: (e) => setError(e instanceof ApiError && Object.keys(e.fieldErrors).length ? Object.values(e.fieldErrors).join(" ") : (e as Error).message),
  });

  const insert = (key: string) => {
    const el = bodyRef.current;
    const token = `{{${key}}}`;
    if (!el) return setBody((b) => b + token);
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const isEmail = channel === "manual_email";
  return (
    <SlideOver
      open={open}
      onClose={onClose}
      width="max-w-5xl"
      title={editing ? "Edit outreach draft" : "Create outreach"}
      subtitle={[defaults?.account_name ?? message?.account_name, defaults?.prospect_name ?? message?.prospect_name].filter(Boolean).join(" · ") || undefined}
      footer={
        <>
          <span className="mr-auto self-center text-xs text-muted">Saving creates a draft. Nothing is sent from the CRM.</span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!body.trim()} onClick={() => save.mutate()}>
            {editing ? "Save draft" : "Save as draft"}
          </Button>
        </>
      }
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Channel">
              <Select options={E.OUTREACH_CHANNELS.options.filter((o) => o.value !== "brevo")} value={channel} onChange={(e) => setChannel(e.target.value)} />
            </Field>
            <Field label="Recipient">
              <RefSelect
                kind="contacts"
                value={contactId}
                label={message?.contact_name ?? defaults?.contact_name}
                onChange={(v) => setContactId(v)}
                filter={accountId ? { account_id: accountId } : undefined}
                placeholder={prospectId ? "Prospect's known contact" : "Choose a contact"}
              />
            </Field>
            <Field label="Template">
              <Select
                placeholder="— Write from scratch —"
                options={(templates.data?.data ?? []).map((t) => ({ value: t.id, label: t.name }))}
                value={templateId ?? ""}
                onChange={(e) => {
                  const v = e.target.value || null;
                  setTemplateId(v);
                  if (v) apply.mutate(v);
                }}
              />
            </Field>
            <Field label="Service ({{service_name}})">
              <RefSelect kind="products" value={productId} label={message?.product_name} onChange={(v) => setProductId(v)} placeholder="Optional" />
            </Field>
          </div>
          <Field label="Internal title">
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Intro — SEO for Sanjeevani" />
          </Field>
          {isEmail && (
            <Field label="Subject">
              <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </Field>
          )}
          <Field label={isEmail ? "Email body" : channel === "phone" ? "Call script" : "Message"}>
            <textarea ref={bodyRef} className="input h-auto min-h-64 py-2 leading-relaxed" value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
          <div>
            <div className="label">Insert personalisation</div>
            <div className="flex flex-wrap gap-1">
              {Object.entries(PLACEHOLDERS).map(([k, label]) => (
                <button key={k} type="button" onClick={() => insert(k)} title={`{{${k}}}`} className="rounded-full border border-line px-2 py-0.5 text-[11px] text-slate-600 hover:border-brand-300 hover:bg-brand-50">
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="label mb-0">Preview for this recipient</div>
            {p?.recipient?.email ? <Badge tone="brand">{p.recipient.email}</Badge> : isEmail ? <Badge tone="amber">No email on record</Badge> : null}
          </div>
          <Warnings subject={p?.subject} body={p?.body} />
          <div className="rounded-lg border border-line bg-slate-50/60 p-4">
            {isEmail && (
              <div className="mb-3 border-b border-line pb-2">
                <div className="text-[11px] text-muted">Subject</div>
                <div className="font-medium">
                  <Highlighted text={finalSubject || "—"} />
                </div>
              </div>
            )}
            <div className="text-[13px] leading-relaxed whitespace-pre-wrap">
              <Highlighted text={finalBody || "Your message preview appears here."} />
            </div>
          </div>
          <MessageActions subject={finalSubject} body={finalBody} to={p?.recipient?.email} channel={channel} />
          <p className="text-xs text-muted">
            Copying or opening your email app does not record a send. After sending, open the saved draft and choose <b>Mark as sent</b>.
          </p>
          {error && <p className="rounded-md bg-red-50 px-2.5 py-2 text-xs text-red-700">{error}</p>}
        </div>
      </div>
    </SlideOver>
  );
}

export function MarkSentDialog({ message, open, onClose }: { message: Row; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [sentAt, setSentAt] = useState(toLocalInput(new Date().toISOString()));
  const [follow, setFollow] = useState("");
  const m = useMutation({
    mutationFn: () => api.post(`/outreach/${message.id}/mark-sent`, { confirm: true, sent_at: fromLocalInput(sentAt), next_follow_up_at: fromLocalInput(follow) }),
    onSuccess: () => {
      invalidateRecord(qc);
      qc.invalidateQueries({ queryKey: ["outreach"] });
      toast("success", follow ? "Recorded as sent; follow-up task created" : "Recorded as sent");
      onClose();
    },
  });
  const label = message.channel === "phone" ? "call was made" : "message was sent";
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Mark as sent"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!confirm} loading={m.isPending} onClick={() => m.mutate()}>
            Record as sent
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5 accent-brand-600" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
          <span>I confirm this {label} by me, outside the CRM.</span>
        </label>
        <Field label="When">
          <input type="datetime-local" className="input" value={sentAt} onChange={(e) => setSentAt(e.target.value)} />
        </Field>
        <Field label="Follow up on (optional)" help="Creates a follow-up task.">
          <input type="datetime-local" className="input" value={follow} onChange={(e) => setFollow(e.target.value)} />
        </Field>
        <p className="text-xs text-muted">This is recorded as a manual send on the contact and account timelines. Delivery cannot be confirmed for manual email.</p>
        {m.error && <p className="text-xs text-red-600">{(m.error as Error).message}</p>}
      </div>
    </Dialog>
  );
}

export function ResponseDialog({ message, outcome, onClose }: { message: Row; outcome: "replied" | "bounced" | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [at, setAt] = useState(toLocalInput(new Date().toISOString()));
  const [note, setNote] = useState("");
  const m = useMutation({
    mutationFn: () => api.post(`/outreach/${message.id}/record-response`, { outcome, at: fromLocalInput(at), note: note || null }),
    onSuccess: () => {
      invalidateRecord(qc);
      qc.invalidateQueries({ queryKey: ["outreach"] });
      toast("success", outcome === "replied" ? "Reply recorded" : "Bounce recorded");
      onClose();
    },
  });
  return (
    <Dialog
      open={!!outcome}
      onClose={onClose}
      title={outcome === "replied" ? "Record a reply" : "Record a bounce"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="When">
          <input type="datetime-local" className="input" value={at} onChange={(e) => setAt(e.target.value)} />
        </Field>
        <Field label={outcome === "replied" ? "What did they say?" : "Bounce details"}>
          <textarea className="input h-auto min-h-20 py-1.5" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {m.error && <p className="text-xs text-red-600">{(m.error as Error).message}</p>}
      </div>
    </Dialog>
  );
}

export function EnrollDialog({ open, onClose, sequenceId, contact }: { open: boolean; onClose: () => void; sequenceId?: string; contact?: { id: string; name: string } }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [seq, setSeq] = useState<string | null>(sequenceId ?? null);
  const [contactId, setContactId] = useState<string | null>(contact?.id ?? null);
  const [start, setStart] = useState(new Date().toLocaleDateString("en-CA"));
  const [product, setProduct] = useState<string | null>(null);
  const sequences = useQuery({
    queryKey: ["sequences", "list", { status: "active" }],
    queryFn: () => api.get<Page<Row>>(`/sequences${qs({ status: "active", pageSize: 100 })}`),
    enabled: open && !sequenceId,
  });
  const m = useMutation({
    mutationFn: () => api.post<{ data: Row }>(`/sequences/${seq}/enroll`, { contact_id: contactId, start_date: start, product_id: product }),
    onSuccess: (r) => {
      invalidateRecord(qc);
      qc.invalidateQueries({ queryKey: ["sequences"] });
      qc.invalidateQueries({ queryKey: ["outreach"] });
      qc.invalidateQueries({ queryKey: ["enrollments"] });
      toast("success", `Enrolled: ${r.data.tasks} tasks scheduled and ${r.data.drafts} drafts prepared`);
      onClose();
    },
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Enroll in sequence"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!seq || !contactId || !start} loading={m.isPending} onClick={() => m.mutate()}>
            Enroll
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {!sequenceId && (
          <Field label="Sequence" required>
            <Select placeholder="Choose…" options={(sequences.data?.data ?? []).map((s) => ({ value: s.id, label: `${s.name} (${s.step_count} steps)` }))} value={seq ?? ""} onChange={(e) => setSeq(e.target.value || null)} />
          </Field>
        )}
        {!contact && (
          <Field label="Contact" required>
            <RefSelect kind="contacts" value={contactId} onChange={(v) => setContactId(v)} />
          </Field>
        )}
        <Field label="Start date" required>
          <input type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Service for {{service_name}} (optional)">
          <RefSelect kind="products" value={product} onChange={(v) => setProduct(v)} placeholder="Optional" />
        </Field>
        <p className="text-xs text-muted">Enrolling schedules a task for every step and prepares draft emails for steps with a template. Nothing is sent automatically.</p>
        {m.error && <p className="text-xs text-red-600">{(m.error as Error).message}</p>}
      </div>
    </Dialog>
  );
}

type StepDraft = { day_offset: number; channel: string; template_id: string | null; task_type: string; note: string };

export function SequenceEditor({ open, onClose, sequence, steps }: { open: boolean; onClose: () => void; sequence?: Row | null; steps?: Row[] }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("active");
  const [rows, setRows] = useState<StepDraft[]>([]);
  const templates = useQuery({ queryKey: ["templates", "list", { pageSize: 100 }], queryFn: () => api.get<Page<Row>>(`/templates${qs({ pageSize: 100, sort: "name", dir: "asc" })}`), enabled: open });
  useEffect(() => {
    if (!open) return;
    setName(sequence?.name ?? "");
    setDescription(sequence?.description ?? "");
    setStatus(sequence?.status ?? "active");
    setRows(
      steps?.length
        ? steps.map((s) => ({ day_offset: s.day_offset, channel: s.channel, template_id: s.template_id, task_type: s.task_type ?? "send_email", note: s.note ?? "" }))
        : [{ day_offset: 0, channel: "manual_email", template_id: null, task_type: "send_email", note: "" }],
    );
  }, [open, sequence, steps]);
  const save = useMutation({
    mutationFn: () => {
      const body = { name, description: description || null, status, steps: rows.map((r) => ({ ...r, note: r.note || null })) };
      return sequence ? api.patch(`/sequences/${sequence.id}`, body) : api.post("/sequences", body);
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["sequences"] });
      toast("success", "Sequence saved");
      onClose();
      if (!sequence) nav(`/outreach/sequences/${r.data.id}`);
    },
  });
  const set = (i: number, patch: Partial<StepDraft>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <SlideOver
      open={open}
      onClose={onClose}
      width="max-w-3xl"
      title={sequence ? "Edit sequence" : "New sequence"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!name.trim() || !rows.length} onClick={() => save.mutate()}>
            Save sequence
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Name" required className="col-span-2">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Status">
            <Select options={E.ACTIVE_STATUSES.options} value={status} onChange={(e) => setStatus(e.target.value)} />
          </Field>
          <Field label="Description" className="col-span-3">
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
        <div>
          <div className="label">Steps (day 1 = enrollment start date)</div>
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-12 items-start gap-2 rounded-lg border border-line p-2.5">
                <Field label="Day" className="col-span-2">
                  <input type="number" min={1} max={366} className="input" value={r.day_offset + 1} onChange={(e) => set(i, { day_offset: Math.max(0, Number(e.target.value) - 1) })} />
                </Field>
                <Field label="Channel" className="col-span-3">
                  <Select options={E.OUTREACH_CHANNELS.options.filter((o) => o.value !== "brevo")} value={r.channel} onChange={(e) => set(i, { channel: e.target.value, task_type: e.target.value === "phone" ? "follow_up_call" : "send_email" })} />
                </Field>
                <Field label="Template (creates a draft)" className="col-span-6">
                  <Select placeholder="— Task only —" options={(templates.data?.data ?? []).map((t) => ({ value: t.id, label: t.name }))} value={r.template_id ?? ""} onChange={(e) => set(i, { template_id: e.target.value || null })} />
                </Field>
                <div className="col-span-1 pt-5">
                  <button aria-label="Remove step" disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30">
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <input className="input col-span-11 col-start-1" placeholder="Note for the task (optional)" value={r.note} onChange={(e) => set(i, { note: e.target.value })} />
              </div>
            ))}
          </div>
          <Button size="sm" icon={Plus} className="mt-2" onClick={() => setRows((rs) => [...rs, { day_offset: (rs.at(-1)?.day_offset ?? 0) + 3, channel: "manual_email", template_id: null, task_type: "send_email", note: "" }])}>
            Add step
          </Button>
        </div>
        {save.error && <p className="text-xs text-red-600">{(save.error as Error).message}</p>}
      </div>
    </SlideOver>
  );
}

export function SectionNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-line bg-white px-3 py-2 text-xs text-slate-600 shadow-[var(--shadow-card)]">
      <Mail className="mt-0.5 size-3.5 shrink-0 text-brand-600" />
      <div>{children}</div>
    </div>
  );
}

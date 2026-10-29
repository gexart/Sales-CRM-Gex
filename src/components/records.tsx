import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity, ArrowRightLeft, CalendarCheck, CheckCircle2, CheckSquare, Circle, FileSearch, History, Network, Mail, MessageCircle, Phone,
  Plus, StickyNote, Users, Zap, type LucideIcon,
} from "lucide-react";
import { api, ApiError, qs, type Page, type Row } from "../lib/api";
import * as E from "../../shared/enums";
import { CONFIGS, type FieldDef } from "../lib/entities";
import { date, dateTime, fromLocalInput, hostOf, isOverdue, money, relative, toLocalInput } from "../lib/format";
import { Badge, Button, Card, CardHeader, Dialog, EmptyState, Field, KeyValue, Select, Skeleton, StatusBadge, cn, useToast } from "./ui";
import { EntityForm } from "./forms";

const ACT_ICON: Record<string, LucideIcon> = {
  note: StickyNote, call: Phone, email: Mail, meeting: Users, linkedin: Network, whatsapp: MessageCircle, stage_change: ArrowRightLeft,
  status_change: ArrowRightLeft, conversion: Zap, audit: FileSearch, task_completed: CheckCircle2, system: Activity,
};

export type ParentRef = { account_id?: string; contact_id?: string; prospect_id?: string; opportunity_id?: string; campaign_id?: string };

export function invalidateRecord(qc: ReturnType<typeof useQueryClient>) {
  for (const k of ["activities", "tasks", "accounts", "contacts", "prospects", "opportunities", "insights", "dashboard", "audit-logs"]) qc.invalidateQueries({ queryKey: [k] });
}

export function LogActivityDialog({ open, onClose, parent, defaultType = "note" }: { open: boolean; onClose: () => void; parent: ParentRef; defaultType?: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [type, setType] = useState(defaultType);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [when, setWhen] = useState(toLocalInput(new Date().toISOString()));
  const m = useMutation({
    mutationFn: () => api.post("/activities", { type, subject, body, occurred_at: fromLocalInput(when), ...parent }),
    onSuccess: () => {
      invalidateRecord(qc);
      toast("success", "Activity logged");
      setSubject("");
      setBody("");
      onClose();
    },
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Log activity"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} disabled={!subject.trim()} onClick={() => m.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type">
          <Select options={E.ACTIVITY_TYPES.options.filter((o) => E.LOGGABLE_ACTIVITY_TYPES.includes(o.value))} value={type} onChange={(e) => setType(e.target.value)} />
        </Field>
        <Field label="When">
          <input type="datetime-local" className="input" value={when} onChange={(e) => setWhen(e.target.value)} />
        </Field>
        <Field label="Summary" required className="col-span-2">
          <input autoFocus className="input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={type === "call" ? "Discussed website redesign timeline" : "What happened?"} />
        </Field>
        <Field label="Details" className="col-span-2">
          <textarea className="input h-auto min-h-24 py-1.5" value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <p className="col-span-2 text-xs text-muted">Logging an email or call records that it happened. It does not send anything.</p>
        {m.error && <p className="col-span-2 text-xs text-red-600">{(m.error as Error).message}</p>}
      </div>
    </Dialog>
  );
}

export function Timeline({ parent, types, title = "Activity", limit = 50, compact }: { parent: ParentRef; types?: string[]; title?: string; limit?: number; compact?: boolean }) {
  const [logging, setLogging] = useState(false);
  const q = useQuery({
    queryKey: ["activities", parent, types, limit],
    queryFn: () => api.get<{ data: Row[] }>(`/activities${qs({ ...parent, types: types?.join(","), limit })}`).then((r) => r.data),
  });
  const canLog = !parent.campaign_id;
  return (
    <Card>
      <CardHeader title={title} icon={History} action={canLog && <Button size="sm" icon={Plus} onClick={() => setLogging(true)}>Log activity</Button>} />
      <div className={cn("px-4", compact ? "py-2" : "py-3")}>
        {q.isLoading ? (
          <div className="space-y-3 py-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-8" />)}
          </div>
        ) : !q.data?.length ? (
          <EmptyState compact icon={History} title="No activity yet" body="Calls, emails, meetings, notes and system events will appear here." />
        ) : (
          <ol className="relative space-y-3 before:absolute before:top-2 before:bottom-2 before:left-[13px] before:w-px before:bg-line">
            {q.data.map((a) => {
              const Icon = ACT_ICON[a.type] ?? Activity;
              return (
                <li key={a.id} className="relative flex gap-3">
                  <span className="z-10 flex size-7 shrink-0 items-center justify-center rounded-full border border-line bg-white text-slate-500">
                    <Icon className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium">{a.subject}</span>
                      <span className="text-xs text-muted" title={dateTime(a.occurred_at)}>
                        {relative(a.occurred_at)}
                      </span>
                    </div>
                    <div className="text-xs text-muted">
                      {E.labelOf(E.ACTIVITY_TYPES, a.type)}
                      {a.actor_name && ` · ${a.actor_name}`}
                      {a.contact_name && !parent.contact_id && ` · ${a.contact_name}`}
                      {a.opportunity_name && !parent.opportunity_id && ` · ${a.opportunity_name}`}
                    </div>
                    {a.body && <p className="mt-1 text-[13px] whitespace-pre-wrap text-slate-700">{a.body}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
      {canLog && <LogActivityDialog open={logging} onClose={() => setLogging(false)} parent={parent} />}
    </Card>
  );
}

export function CompleteTaskDialog({ task, onClose }: { task: Row | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [outcome, setOutcome] = useState("");
  const [followUp, setFollowUp] = useState(false);
  const [followDate, setFollowDate] = useState("");
  const m = useMutation({
    mutationFn: async () => {
      await api.patch(`/tasks/${task!.id}`, { status: "completed", outcome: outcome || null });
      if (followUp) {
        await api.post("/tasks", {
          title: `Follow up: ${task!.title}`.slice(0, 200),
          type: task!.type === "meeting" ? "follow_up_call" : task!.type,
          priority: task!.priority,
          due_at: fromLocalInput(followDate),
          account_id: task!.account_id,
          contact_id: task!.contact_id,
          prospect_id: task!.prospect_id,
          opportunity_id: task!.opportunity_id,
          description: outcome ? `Previous outcome: ${outcome}` : null,
        });
      }
    },
    onSuccess: () => {
      invalidateRecord(qc);
      toast("success", followUp ? "Task completed and follow-up created" : "Task completed");
      setOutcome("");
      setFollowUp(false);
      onClose();
    },
  });
  return (
    <Dialog
      open={!!task}
      onClose={onClose}
      title="Complete task"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} disabled={followUp && !followDate} onClick={() => m.mutate()}>
            Mark complete
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="font-medium">{task?.title}</div>
        <Field label="Outcome">
          <textarea autoFocus className="input h-auto min-h-20 py-1.5" value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="What happened? What did you agree?" />
        </Field>
        <label className="flex items-center gap-2">
          <input type="checkbox" className="accent-brand-600" checked={followUp} onChange={(e) => setFollowUp(e.target.checked)} />
          Create a follow-up task
        </label>
        {followUp && (
          <Field label="Follow-up due">
            <input type="datetime-local" className="input" value={followDate} onChange={(e) => setFollowDate(e.target.value)} />
          </Field>
        )}
        {m.error && <p className="text-xs text-red-600">{(m.error as Error).message}</p>}
      </div>
    </Dialog>
  );
}

export function TaskRow({ t, onComplete, showRelated }: { t: Row; onComplete: (t: Row) => void; showRelated?: boolean }) {
  const open = ["open", "in_progress"].includes(t.status);
  const late = open && isOverdue(t.due_at);
  return (
    <li className="flex items-start gap-2.5 py-2">
      <button
        aria-label={open ? "Complete task" : "Completed"}
        disabled={!open}
        onClick={() => onComplete(t)}
        className={cn("mt-0.5 shrink-0 rounded-full", open ? "text-slate-300 hover:text-emerald-600" : "text-emerald-600")}
      >
        {open ? <Circle className="size-4" /> : <CheckCircle2 className="size-4" />}
      </button>
      <div className="min-w-0 flex-1">
        <Link to={`/tasks/${t.id}`} className={cn("block truncate font-medium hover:text-brand-700", !open && "text-slate-400 line-through")}>
          {t.title}
        </Link>
        <div className="flex flex-wrap gap-x-2 text-xs text-muted">
          <span>{E.labelOf(E.TASK_TYPES, t.type)}</span>
          {t.due_at && <span className={late ? "font-medium text-red-600" : ""}>{late ? "Overdue · " : ""}{dateTime(t.due_at)}</span>}
          {showRelated && (t.account_name ?? t.prospect_name) && <span>{t.account_name ?? t.prospect_name}</span>}
          {t.owner_name && <span>{t.owner_name}</span>}
        </div>
      </div>
      {t.priority === "high" || t.priority === "urgent" ? <StatusBadge value={t.priority} label={E.labelOf(E.PRIORITIES, t.priority)} /> : null}
    </li>
  );
}

export function RelatedTasks({ parent, defaults }: { parent: ParentRef; defaults?: Row }) {
  const [creating, setCreating] = useState(false);
  const [completing, setCompleting] = useState<Row | null>(null);
  const [showDone, setShowDone] = useState(false);
  const q = useQuery({
    queryKey: ["tasks", "related", parent, showDone],
    queryFn: () => api.get<Page<Row>>(`/tasks${qs({ ...parent, open: showDone ? undefined : 1, sort: "due_at", dir: "asc", pageSize: 50 })}`),
  });
  const rows = q.data?.data ?? [];
  return (
    <Card>
      <CardHeader
        title="Tasks"
        icon={CheckSquare}
        action={
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => setShowDone((s) => !s)}>
              {showDone ? "Open only" : "Show all"}
            </Button>
            <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>
              Add task
            </Button>
          </div>
        }
      />
      <div className="px-4">
        {q.isLoading ? (
          <div className="space-y-2 py-3">
            <Skeleton className="h-6" />
            <Skeleton className="h-6" />
          </div>
        ) : rows.length ? (
          <ul className="divide-y divide-line">
            {rows.map((t) => <TaskRow key={t.id} t={t} onComplete={setCompleting} />)}
          </ul>
        ) : (
          <EmptyState compact icon={CalendarCheck} title={showDone ? "No tasks" : "No open tasks"} body="Schedule the next step so nothing slips." />
        )}
      </div>
      <EntityForm cfg={CONFIGS.tasks} open={creating} onClose={() => setCreating(false)} defaults={{ ...parent, ...defaults }} />
      <CompleteTaskDialog task={completing} onClose={() => setCompleting(null)} />
    </Card>
  );
}

export function AuditTrail({ entityType, entityId }: { entityType: string; entityId: string }) {
  const q = useQuery({
    queryKey: ["audit-logs", entityType, entityId],
    queryFn: () => api.get<{ data: Row[] }>(`/audit-logs${qs({ entity_type: entityType, entity_id: entityId })}`).then((r) => r.data),
  });
  return (
    <Card>
      <CardHeader title="Audit history" icon={History} subtitle="Who changed what, and when" />
      <ul className="divide-y divide-line px-4">
        {q.isLoading && <li className="py-3"><Skeleton className="h-6" /></li>}
        {q.data?.map((l) => {
          const changes = l.changes ? (JSON.parse(l.changes) as Record<string, [unknown, unknown]>) : null;
          return (
            <li key={l.id} className="py-2">
              <div className="flex justify-between gap-2">
                <span>{l.summary ?? l.action}</span>
                <span className="shrink-0 text-xs text-muted" title={dateTime(l.created_at)}>{relative(l.created_at)}</span>
              </div>
              <div className="text-xs text-muted">{l.actor_name ?? "System"}</div>
              {changes && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {Object.entries(changes).slice(0, 8).map(([k, [a, b]]) => (
                    <Badge key={k} tone="gray" className="max-w-full">
                      <span className="truncate">{k.replace(/_/g, " ")}: {String(a ?? "—").slice(0, 24)} → {String(b ?? "—").slice(0, 24)}</span>
                    </Badge>
                  ))}
                </div>
              )}
            </li>
          );
        })}
        {q.data && !q.data.length && <li className="py-4 text-center text-xs text-muted">No history yet</li>}
      </ul>
    </Card>
  );
}

/** Formats a stored field value for read-only display. */
export function displayValue(f: FieldDef, r: Row): ReactNode {
  const v = r[f.name];
  if (v === null || v === undefined || v === "") return null;
  switch (f.type) {
    case "select":
      return E.labelOf({ options: f.options! }, v);
    case "money":
      return money(v, r.currency ?? "INR");
    case "date":
      return date(v);
    case "datetime":
      return dateTime(v);
    case "url":
      return (
        <a href={v} target="_blank" rel="noreferrer noopener" className="text-brand-700 hover:underline">
          {hostOf(v)}
        </a>
      );
    case "email":
      return <a href={`mailto:${v}`} className="text-brand-700 hover:underline">{v}</a>;
    case "textarea":
      return <span className="whitespace-pre-wrap">{v}</span>;
    case "ref": {
      const name = r[f.name.replace(/_id$/, "_name")];
      const to = { account_id: "/accounts/", contact_id: "/contacts/", primary_contact_id: "/contacts/", campaign_id: "/campaigns/", source_campaign_id: "/campaigns/", prospect_id: "/prospecting/", opportunity_id: "/opportunities/", product_id: "/products/" }[f.name];
      return to ? <Link to={`${to}${v}`} className="text-brand-700 hover:underline">{name ?? "Open"}</Link> : (name ?? v);
    }
    case "number":
      return f.name === "probability" ? `${v}%` : String(v);
    default:
      return String(v);
  }
}

export function FieldGrid({ fields, record }: { fields: FieldDef[]; record: Row }) {
  const sections: { name: string; fields: FieldDef[] }[] = [];
  for (const f of fields) {
    if (f.type === "multiref") continue;
    const name = f.section ?? sections.at(-1)?.name ?? "Details";
    if (!sections.length || sections.at(-1)!.name !== name) sections.push({ name, fields: [] });
    sections.at(-1)!.fields.push(f);
  }
  return (
    <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
      {sections.map((s) => (
        <div key={s.name}>
          <div className="mb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">{s.name}</div>
          {s.fields.map((f) => (
            <KeyValue key={f.name} label={f.label}>
              {displayValue(f, record)}
            </KeyValue>
          ))}
        </div>
      ))}
    </div>
  );
}

export function useArchive(route: string, id: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (archive: boolean) => api.post(`/${route}/${id}/${archive ? "archive" : "restore"}`),
    onSuccess: (_r, archive) => {
      invalidateRecord(qc);
      qc.invalidateQueries({ queryKey: [route] });
      toast("success", archive ? "Archived. History is kept and it can be restored." : "Restored");
    },
    onError: (e) => toast("error", e instanceof ApiError ? e.message : "Could not update"),
  });
}

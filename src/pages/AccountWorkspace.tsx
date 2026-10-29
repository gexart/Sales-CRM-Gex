import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive, ArchiveRestore, Briefcase, Building2, ChevronDown, ClipboardList, ExternalLink, FileSearch, FileText, Gauge, Globe,
  Lightbulb, ListChecks, Mail, MapPin, Package, Pencil, Phone, Plus, Presentation, Send, Sparkles, Target, UserSearch, Users,
} from "lucide-react";
import { api, ApiError, qs, type Page, type Row } from "../lib/api";
import { useAuth } from "../lib/auth";
import { CONFIGS } from "../lib/entities";
import * as E from "../../shared/enums";
import { date, dateTime, hostOf, money, relative } from "../lib/format";
import { EntityForm } from "../components/forms";
import { AuditTrail, FieldGrid, LogActivityDialog, RelatedTasks, Timeline, invalidateRecord, useArchive } from "../components/records";
import {
  Avatar, Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, KeyValue, Menu, MenuItem, ScoreRing, Select, Skeleton,
  StatusBadge, Tabs, cn, useToast,
} from "../components/ui";
import { DataTable } from "./EntityListPage";
import { useRecord } from "./RecordDetailPage";
import { AuditReport, AuditsTab, useAuditTypes } from "./Audits";
import { OutreachList } from "./Outreach";
import { CompetitorsCard, DeckDialog, PitchDialog, ProposalDialog } from "./SalesMaterial";
import { EnrichmentDialog } from "./Prospecting";
import { LinkedAssets } from "./Library";
import { CallsList } from "./Calls";
import { OutreachComposer } from "../components/outreach";

type Tab = "overview" | "audits" | "insights" | "contacts" | "services" | "opportunities" | "activities" | "outreach" | "assets" | "notes";
const TABS: { value: Tab; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "audits", label: "Audits" },
  { value: "insights", label: "AI Insights" },
  { value: "contacts", label: "Contacts" },
  { value: "services", label: "Products & Services" },
  { value: "opportunities", label: "Opportunities" },
  { value: "activities", label: "Activities" },
  { value: "outreach", label: "Outreach" },
  { value: "assets", label: "Sales Assets" },
  { value: "notes", label: "Notes" },
];

export function useInsights(id: string) {
  return useQuery({ queryKey: ["insights", id], queryFn: () => api.get(`/accounts/${id}/insights`).then((r) => r.data) });
}

export function AccountWorkspace() {
  const { id = "", runId } = useParams();
  const [sp, setSp] = useSearchParams();
  const tab = (runId ? "audits" : (sp.get("tab") as Tab)) || "overview";
  const setTab = (t: Tab) => (runId ? navTab(t) : setSp(t === "overview" ? {} : { tab: t }, { replace: true }));
  const nav = useNavigate();
  const navTab = (t: Tab) => nav(`/accounts/${id}${t === "overview" ? "" : `?tab=${t}`}`);
  const q = useRecord(CONFIGS.accounts, id);
  const insights = useInsights(id);

  if (q.isError)
    return (
      <div className="p-6">
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </div>
    );
  if (!q.data)
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-20" />
        <Skeleton className="h-8 w-2/3" />
        <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
      </div>
    );
  const a = q.data;

  return (
    <div className="pb-10">
      <AccountHeader a={a} onTab={setTab} />
      <div className="sticky top-0 z-20 bg-canvas/95 px-4 backdrop-blur sm:px-6">
        <Tabs tabs={TABS.map((t) => ({ ...t, count: t.value === "contacts" ? a.contact_count : t.value === "opportunities" ? a.open_opportunity_count : undefined }))} value={tab} onChange={setTab} />
      </div>
      <div className="grid gap-4 px-4 pt-4 sm:px-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          {tab === "overview" && <OverviewTab a={a} insights={insights.data} onTab={setTab} />}
          {tab === "audits" && (runId ? <AuditReport runId={runId} account={a} /> : (<><AuditsTab account={a} /><CompetitorsCard accountId={id} /></>))}
          {tab === "insights" && <InsightsTab a={a} insights={insights.data} loading={insights.isLoading} />}
          {tab === "contacts" && <ContactsTab a={a} />}
          {tab === "services" && <ServicesTab accountId={id} full />}
          {tab === "opportunities" && <OpportunitiesTab a={a} />}
          {tab === "activities" && (
            <>
              <Card>
                <CardHeader title="Calls" icon={Phone} />
                <CallsList filter={{ account_id: id }} compact />
              </Card>
              <Timeline parent={{ account_id: id }} title="Account timeline" />
            </>
          )}
          {tab === "outreach" && <OutreachTab a={a} />}
          {tab === "assets" && <LinkedAssets type="account" id={id} />}
          {tab === "notes" && <NotesTab a={a} />}
        </div>
        <aside className="space-y-4">
          <IntelligencePanel a={a} insights={insights.data} loading={insights.isLoading} onTab={setTab} />
          {tab !== "services" && <ServicesTab accountId={id} />}
          <PresencePanel a={a} />
          {tab === "activities" && <RelatedTasks parent={{ account_id: id }} defaults={{ account_name: a.name }} />}
        </aside>
      </div>
    </div>
  );
}

// ─── Header & action area ───
function AccountHeader({ a, onTab }: { a: Row; onTab: (t: Tab) => void }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const types = useAuditTypes();
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState<"opportunity" | "task" | "contact" | null>(null);
  const [logging, setLogging] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [composing, setComposing] = useState(false);
  const [material, setMaterial] = useState<"pitch" | "deck" | "proposal" | null>(null);
  const [finding, setFinding] = useState(false);
  const archive = useArchive("accounts", a.id);
  const run = useMutation({
    mutationFn: (type: string) => api.post<{ data: Row }>(`/accounts/${a.id}/audits`, { audit_type: type }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["audits", a.id] });
      toast("info", "Audit started. Results appear in a few seconds.");
      nav(`/accounts/${a.id}/audits/${r.data.id}`);
    },
    onError: (e) => toast("error", e instanceof ApiError ? e.message : "Could not start the audit"),
  });
  return (
    <div className="px-4 pt-4 sm:px-6">
      <nav aria-label="Breadcrumb" className="mb-2 text-xs text-muted">
        <Link to="/accounts" className="hover:text-ink">
          Accounts
        </Link>{" "}
        / <span>{a.name}</span>
      </nav>
      <div className="flex flex-wrap items-start gap-4 pb-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-neutral-800 to-black text-[15px] font-semibold text-white shadow-sm">
          {a.name.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2 text-lg font-semibold tracking-tight">
            {a.name}
            <StatusBadge value={a.status} label={E.labelOf(E.ACCOUNT_STATUSES, a.status)} />
            {a.qualification && <StatusBadge value={a.qualification} label={E.labelOf(E.QUALIFICATION_LEVELS, a.qualification)} />}
            {a.archived_at && <Badge>Archived</Badge>}
          </h1>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            {a.website && (
              <a href={a.website} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-medium text-ink underline decoration-stone-300 underline-offset-2 hover:decoration-ink">
                <Globe className="size-3" /> {hostOf(a.website)}
              </a>
            )}
            {a.industry && <span className="inline-flex items-center gap-1"><Building2 className="size-3" /> {a.industry}</span>}
            {(a.city || a.state) && <span className="inline-flex items-center gap-1"><MapPin className="size-3" /> {[a.city, a.state].filter(Boolean).join(", ")}</span>}
            <span>{E.labelOf(E.ACCOUNT_TYPES, a.type)}</span>
            <span className="inline-flex items-center gap-1"><Avatar name={a.owner_name} size="sm" /> {a.owner_name ?? "Unassigned"}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button icon={a.archived_at ? ArchiveRestore : Archive} onClick={() => (a.archived_at ? archive.mutate(false) : setConfirmArchive(true))} className="max-md:hidden">
            {a.archived_at ? "Restore" : "Archive"}
          </Button>
          <Button icon={Pencil} onClick={() => setEditing(true)}>
            Edit
          </Button>
        </div>
      </div>
      {/* Action area */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-white p-2 shadow-[var(--shadow-card)]">
        <Menu
          align="left"
          width="w-72"
          trigger={(p) => (
            <Button {...p} variant="primary" icon={FileSearch} loading={run.isPending}>
              Run audit <ChevronDown className="size-3.5" />
            </Button>
          )}
        >
          {(close) =>
            (types.data ?? []).map((t) => (
              <MenuItem
                key={t.key}
                icon={t.implemented ? FileSearch : Gauge}
                disabled={!t.implemented || (t.target === "website" && !a.website)}
                hint={!t.implemented ? t.plannedNote : !a.website ? "Add the website to this account first" : t.description}
                onClick={() => (close(), run.mutate(t.key))}
              >
                <span className="flex items-center justify-between gap-2">
                  Run {t.label}
                  {!t.implemented && <Badge>Planned</Badge>}
                </span>
              </MenuItem>
            ))
          }
        </Menu>
        <Menu
          align="left"
          width="w-64"
          trigger={(p) => (
            <Button {...p} icon={Sparkles}>
              Sales material <ChevronDown className="size-3.5" />
            </Button>
          )}
        >
          {(close) => (
            <>
              <MenuItem icon={Sparkles} onClick={() => (close(), setMaterial("pitch"))}>Generate sales pitch</MenuItem>
              <MenuItem icon={Presentation} onClick={() => (close(), setMaterial("deck"))}>Generate pitch deck (.pptx)</MenuItem>
              <MenuItem icon={FileText} onClick={() => (close(), setMaterial("proposal"))}>Generate PDF proposal</MenuItem>
            </>
          )}
        </Menu>
        <Button icon={Briefcase} onClick={() => setCreating("opportunity")}>
          Create opportunity
        </Button>
        <Button icon={ListChecks} onClick={() => setCreating("task")}>
          Add task
        </Button>
        <Menu
          align="left"
          trigger={(p) => (
            <Button {...p} icon={Send}>
              Outreach <ChevronDown className="size-3.5" />
            </Button>
          )}
        >
          {(close) => (
            <>
              <MenuItem icon={Mail} onClick={() => (close(), setLogging("email"))}>Log an email sent</MenuItem>
              <MenuItem icon={Users} onClick={() => (close(), setLogging("call"))}>Log a call</MenuItem>
              <MenuItem icon={Users} onClick={() => (close(), setLogging("meeting"))}>Log a meeting</MenuItem>
              <MenuItem icon={Send} onClick={() => (close(), setComposing(true))}>Create outreach (draft)</MenuItem>
            </>
          )}
        </Menu>
        <Button icon={Users} variant="ghost" onClick={() => setCreating("contact")}>
          Add contact
        </Button>
        <Button icon={UserSearch} variant="ghost" onClick={() => setFinding(true)}>
          Find decision-makers
        </Button>
        <span className="ml-auto hidden text-xs text-muted lg:inline">Updated {relative(a.updated_at)}</span>
      </div>
      <EntityForm cfg={CONFIGS.accounts} open={editing} onClose={() => setEditing(false)} record={a} />
      <EntityForm cfg={CONFIGS.opportunities} open={creating === "opportunity"} onClose={() => setCreating(null)} defaults={{ account_id: a.id, account_name: a.name, name: `${a.name} — ` }} onSaved={() => onTab("opportunities")} />
      <EntityForm cfg={CONFIGS.tasks} open={creating === "task"} onClose={() => setCreating(null)} defaults={{ account_id: a.id, account_name: a.name, owner_id: user!.id }} />
      <EntityForm cfg={CONFIGS.contacts} open={creating === "contact"} onClose={() => setCreating(null)} defaults={{ account_id: a.id, account_name: a.name }} onSaved={() => onTab("contacts")} />
      <OutreachComposer open={composing} onClose={() => setComposing(false)} defaults={{ account_id: a.id, account_name: a.name }} />
      <PitchDialog open={material === "pitch"} onClose={() => setMaterial(null)} account={a} />
      <DeckDialog open={material === "deck"} onClose={() => setMaterial(null)} account={a} />
      <ProposalDialog open={material === "proposal"} onClose={() => setMaterial(null)} account={a} />
      <EnrichmentDialog open={finding} onClose={() => setFinding(false)} kind="accounts" id={a.id} name={a.name} />
      <LogActivityDialog open={!!logging} onClose={() => setLogging(null)} parent={{ account_id: a.id }} defaultType={logging ?? "note"} key={logging ?? "x"} />
      <ConfirmDialog
        open={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        title="Archive account?"
        body="The account is hidden from lists. Contacts, opportunities, audits and history stay linked, and you can restore it."
        confirmLabel="Archive"
        loading={archive.isPending}
        onConfirm={() => archive.mutate(true, { onSuccess: () => setConfirmArchive(false) })}
      />
    </div>
  );
}

// ─── Right-hand intelligence panel ───
function IntelligencePanel({ a, insights, loading, onTab }: { a: Row; insights?: Row; loading: boolean; onTab: (t: Tab) => void }) {
  if (loading || !insights)
    return (
      <Card className="space-y-2 p-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-16" />
        <Skeleton className="h-10" />
      </Card>
    );
  const cur = insights.open_opportunities[0]?.currency ?? "INR";
  return (
    <Card>
      <CardHeader title="Account intelligence" icon={Lightbulb} subtitle="Computed from CRM records" />
      <div className="space-y-3 p-4">
        <div className="grid grid-cols-2 gap-2">
          <MiniStat label="Open pipeline" value={money(insights.open_pipeline_minor, cur, true)} sub={`${insights.open_opportunities.length} open · weighted ${money(insights.weighted_pipeline_minor, cur, true)}`} />
          <MiniStat label="Won" value={money(insights.won_minor, cur, true)} sub={insights.qualification ? E.labelOf(E.QUALIFICATION_LEVELS, insights.qualification) : "Not qualified yet"} />
        </div>
        <KeyValue label="Last activity">{insights.last_activity ? <span title={dateTime(insights.last_activity.occurred_at)}>{insights.last_activity.subject} · {relative(insights.last_activity.occurred_at)}</span> : null}</KeyValue>
        <KeyValue label="Next action">
          {insights.next_task ? (
            <Link to={`/tasks/${insights.next_task.id}`} className="font-medium text-ink underline decoration-stone-300 underline-offset-2 hover:decoration-ink">
              {insights.next_task.title} · {date(insights.next_task.due_at)}
            </Link>
          ) : null}
        </KeyValue>
        <KeyValue label="Decision-makers">
          {insights.contacts.filter((c: Row) => c.decision_role === "decision_maker").map((c: Row) => (
            <Link key={c.id} to={`/contacts/${c.id}`} className="mr-1 font-medium text-ink underline decoration-stone-300 underline-offset-2 hover:decoration-ink">{c.name}</Link>
          ))}
          {!insights.has_decision_maker && <span className="text-amber-700">None identified</span>}
        </KeyValue>
        {insights.audits.length > 0 && (
          <div className="flex gap-3 border-t border-line pt-3">
            {insights.audits.map((r: Row) => (
              <Link key={r.id} to={`/accounts/${a.id}/audits/${r.id}`} className="flex flex-col items-center gap-1 text-[11px] text-muted hover:text-ink">
                <ScoreRing score={r.overall_score} size={40} />
                {r.audit_type.toUpperCase()}
              </Link>
            ))}
          </div>
        )}
        {insights.next_steps.length > 0 && (
          <div className="border-t border-line pt-3">
            <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Recommended next steps</div>
            <ul className="space-y-1.5">
              {insights.next_steps.slice(0, 4).map((s: Row, i: number) => (
                <li key={i} className="flex gap-2">
                  <Target className="mt-0.5 size-3.5 shrink-0 text-ink" />
                  <span>
                    <span className="font-medium">{s.text}</span>
                    <span className="block text-xs text-muted">{s.reason}</span>
                  </span>
                </li>
              ))}
            </ul>
            {insights.next_steps.length > 4 && (
              <button onClick={() => onTab("insights")} className="mt-1 text-xs font-medium text-ink">
                +{insights.next_steps.length - 4} more
              </button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

function MiniStat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-md bg-slate-50 px-2.5 py-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="text-[15px] font-semibold tabular-nums">{value}</div>
      {sub && <div className="truncate text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

function PresencePanel({ a }: { a: Row }) {
  const [editing, setEditing] = useState(false);
  const items = [
    ["Website", a.website],
    ["LinkedIn", a.linkedin_url],
    ["Instagram", a.instagram_url],
    ["Facebook", a.facebook_url],
    ["YouTube", a.youtube_url],
    ["Google Business", a.google_business_url],
  ];
  return (
    <Card>
      <CardHeader title="Online presence" icon={Globe} />
      <ul className="divide-y divide-line px-4">
        {items.map(([label, url]) => (
          <li key={label} className="flex h-9 items-center justify-between gap-2">
            <span className="text-slate-600">{label}</span>
            {url ? (
              <a href={url} target="_blank" rel="noreferrer noopener" className="inline-flex max-w-[60%] items-center gap-1 truncate text-xs font-medium text-ink underline decoration-stone-300 underline-offset-2 hover:decoration-ink">
                <span className="truncate">{hostOf(url)}</span>
                <ExternalLink className="size-3 shrink-0" />
              </a>
            ) : (
              <button onClick={() => setEditing(true)} className="text-xs text-muted hover:text-ink">
                Not set · <span className="text-ink">+ Add</span>
              </button>
            )}
          </li>
        ))}
      </ul>
      <EntityForm cfg={CONFIGS.accounts} open={editing} onClose={() => setEditing(false)} record={a} />
    </Card>
  );
}

// ─── Service fit (catalogue-driven, per account) ───
export function ServicesTab({ accountId, full }: { accountId: string; full?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["insights", "assessments", accountId], queryFn: () => api.get<{ data: Row[] }>(`/accounts/${accountId}/assessments`).then((r) => r.data) });
  const [draft, setDraft] = useState<Record<string, { status: string; note: string }>>({});
  const save = useMutation({
    mutationFn: ({ pid, status, note }: { pid: string; status: string; note: string }) => api.put(`/accounts/${accountId}/assessments/${pid}`, { status, note: note || null }),
    onSuccess: (_r, v) => {
      setDraft(({ [v.pid]: _, ...rest }) => rest);
      invalidateRecord(qc);
      toast("success", "Service fit saved");
    },
    onError: (e) => toast("error", (e as Error).message),
  });
  const rows = q.data ?? [];
  const assessed = rows.filter((r) => r.status !== "not_assessed").length;
  const shown = full ? rows : [...rows].sort((a, b) => Number(b.status !== "not_assessed") - Number(a.status !== "not_assessed")).slice(0, 8);
  return (
    <Card>
      <CardHeader title="Service fit" icon={Package} subtitle={`${assessed} of ${rows.length} Gexart services assessed`} action={!full && <Link to={`?tab=services`} className="text-xs font-medium text-ink">All</Link>} />
      {q.isLoading ? (
        <div className="space-y-2 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-6" />)}</div>
      ) : (
        <ul className="divide-y divide-line">
          {shown.map((r) => {
            const d = draft[r.product_id];
            const status = d?.status ?? r.status;
            const dirty = !!d && (d.status !== r.status || d.note !== (r.note ?? ""));
            return (
              <li key={r.product_id} className={cn("px-4 py-2", full && "py-2.5")}>
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium" title={r.name}>{r.name}</div>
                    {full && <div className="text-[11px] text-muted">{r.sku} · {E.labelOf(E.PRODUCT_CATEGORIES, r.category)}{r.source?.startsWith("audit:") && " · from audit"}{r.updated_by_name && ` · ${r.updated_by_name}, ${relative(r.updated_at)}`}</div>}
                  </div>
                  <Select
                    aria-label={`Fit for ${r.name}`}
                    className={cn("h-7 w-36 text-xs", status !== "not_assessed" && "border-brand-200 bg-brand-50/40")}
                    options={E.ASSESSMENT_STATUSES.options}
                    value={status}
                    onChange={(e) => setDraft((s) => ({ ...s, [r.product_id]: { status: e.target.value, note: s[r.product_id]?.note ?? r.note ?? "" } }))}
                  />
                  <Button size="sm" variant={dirty ? "primary" : "ghost"} disabled={!dirty} loading={save.isPending && save.variables?.pid === r.product_id} onClick={() => save.mutate({ pid: r.product_id, status, note: d!.note })}>
                    Save
                  </Button>
                </div>
                {(full || dirty) && (
                  <input
                    className="input mt-1.5 h-7 text-xs"
                    placeholder="Assessment note (evidence, what was discussed)…"
                    value={d?.note ?? r.note ?? ""}
                    onChange={(e) => setDraft((s) => ({ ...s, [r.product_id]: { status: s[r.product_id]?.status ?? r.status, note: e.target.value } }))}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ─── Tabs ───
function OverviewTab({ a, insights, onTab }: { a: Row; insights?: Row; onTab: (t: Tab) => void }) {
  const overviewFields = useMemo(() => CONFIGS.accounts.fields.filter((f) => !["notes", "linkedin_url", "instagram_url", "facebook_url", "youtube_url", "google_business_url", "qualification_note"].includes(f.name)), []);
  return (
    <>
      <DigitalSnapshot a={a} insights={insights} onTab={onTab} />
      <Card className="p-4">
        <FieldGrid fields={overviewFields} record={a} />
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Key contacts" icon={Users} action={<button onClick={() => onTab("contacts")} className="text-xs font-medium text-ink">View all</button>} />
          <ul className="divide-y divide-line px-4">
            {insights?.contacts.map((c: Row) => (
              <li key={c.id} className="flex items-center gap-2 py-2">
                <Avatar name={c.name} />
                <div className="min-w-0 flex-1">
                  <Link to={`/contacts/${c.id}`} className="block truncate font-medium hover:text-ink">{c.name}</Link>
                  <div className="truncate text-xs text-muted">{[c.job_title, c.decision_role && E.labelOf(E.DECISION_ROLES, c.decision_role)].filter(Boolean).join(" · ")}</div>
                </div>
                <StatusBadge value={c.status} label={E.labelOf(E.CONTACT_STATUSES, c.status)} />
              </li>
            ))}
            {insights && !insights.contacts.length && <li className="py-4 text-center text-xs text-muted">No contacts on file</li>}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Open opportunities" icon={Briefcase} action={<button onClick={() => onTab("opportunities")} className="text-xs font-medium text-ink">View all</button>} />
          <ul className="divide-y divide-line px-4">
            {insights?.open_opportunities.map((o: Row) => (
              <li key={o.id} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <Link to={`/opportunities/${o.id}`} className="block truncate font-medium hover:text-ink">{o.name}</Link>
                  <div className="text-xs text-muted">{E.labelOf(E.OPPORTUNITY_STAGES, o.stage)} · close {date(o.expected_close_date)}</div>
                </div>
                <span className="font-medium tabular-nums">{money(o.amount_minor, o.currency)}</span>
              </li>
            ))}
            {insights && !insights.open_opportunities.length && <li className="py-4 text-center text-xs text-muted">No open opportunities</li>}
          </ul>
        </Card>
      </div>
      <Timeline parent={{ account_id: a.id }} title="Recent activity" limit={6} compact />
    </>
  );
}

/** Snapshot of the latest audit per type, like a digital-health card. */
function DigitalSnapshot({ a, insights, onTab }: { a: Row; insights?: Row; onTab: (t: Tab) => void }) {
  const types = useAuditTypes();
  const latest = new Map<string, Row>((insights?.audits ?? []).map((r: Row) => [r.audit_type, r]));
  const implemented = (types.data ?? []).filter((t) => t.implemented);
  return (
    <Card>
      <CardHeader
        title="Digital health snapshot"
        icon={Gauge}
        subtitle={a.website ? `Latest audit of ${hostOf(a.website)} per type` : "Add a website to run audits"}
        action={<Button size="sm" onClick={() => onTab("audits")}>Open audits</Button>}
      />
      <div className="grid gap-px bg-line sm:grid-cols-3">
        {implemented.map((t) => {
          const r = latest.get(t.key);
          return (
            <Link key={t.key} to={r ? `/accounts/${a.id}/audits/${r.id}` : "?tab=audits"} className="flex items-center gap-3 bg-white p-4 transition-colors hover:bg-slate-50">
              <ScoreRing score={r && String(r.status).startsWith("completed") ? r.overall_score : null} size={52} />
              <div className="min-w-0">
                <div className="font-medium">{t.label}</div>
                <div className="text-xs text-muted">
                  {r ? (String(r.status).startsWith("completed") ? `Scanned ${relative(r.completed_at)}` : E.labelOf(E.AUDIT_STATUSES, r.status)) : "Not run yet"}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
      <div className="border-t border-line px-4 py-2 text-[11px] text-muted">Scores reflect the documented check rubric for the pages inspected — not search rankings or commercial outcomes.</div>
    </Card>
  );
}

function InsightsTab({ a, insights, loading }: { a: Row; insights?: Row; loading: boolean }) {
  if (loading || !insights) return <Skeleton className="h-64" />;
  const Group = ({ title, rows, tone, empty }: { title: string; rows: Row[]; tone: "amber" | "green" | "gray"; empty: string }) => (
    <div>
      <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {rows.length ? rows.map((s) => <Badge key={s.id} tone={tone}>{s.name}{s.status !== "not_assessed" && tone === "gray" ? ` · ${E.labelOf(E.ASSESSMENT_STATUSES, s.status)}` : ""}</Badge>) : <span className="text-xs text-muted">{empty}</span>}
      </div>
    </div>
  );
  return (
    <>
      <Card className="border-brand-200 bg-brand-50/40 p-4">
        <div className="flex gap-3">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-ink" />
          <div>
            <div className="font-medium">No AI provider is connected</div>
            <p className="mt-0.5 text-xs text-slate-600">
              Everything below is rule-based and computed only from records stored for {a.name}: contacts, deals, tasks, audits and service-fit assessments. AI-drafted
              summaries (Phase D) will be labelled as drafts and will never invent facts about the company.
            </p>
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Recommended next steps" icon={Target} subtitle="Each recommendation shows the rule that produced it" />
        <ul className="divide-y divide-line px-4">
          {insights.next_steps.map((s: Row, i: number) => (
            <li key={i} className="py-2.5">
              <div className="font-medium">{s.text}</div>
              <div className="text-xs text-muted">Because: {s.reason}</div>
            </li>
          ))}
          {!insights.next_steps.length && <li className="py-6 text-center text-xs text-muted">No gaps detected by the current rules.</li>}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Service opportunities" icon={Package} subtitle="From recorded service-fit assessments — not assumptions" />
        <div className="space-y-4 p-4">
          <Group title="Relevant / needs assessment" rows={insights.service_opportunities} tone="amber" empty="None recorded. Assess service fit or run an audit." />
          <Group title="Already pitched" rows={insights.services_pitched} tone="green" empty="Nothing pitched yet." />
          <Group title="Not yet pitched" rows={insights.services_not_pitched.slice(0, 24)} tone="gray" empty="—" />
        </div>
      </Card>
      {insights.qualification_note && (
        <Card className="p-4">
          <div className="mb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Qualification evidence (user-entered)</div>
          <p className="whitespace-pre-wrap">{insights.qualification_note}</p>
        </Card>
      )}
    </>
  );
}

function ContactsTab({ a }: { a: Row }) {
  const nav = useNavigate();
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ["contacts", "account", a.id], queryFn: () => api.get<Page<Row>>(`/contacts${qs({ account_id: a.id, pageSize: 100, sort: "name", dir: "asc" })}`) });
  return (
    <Card>
      <CardHeader title="Contacts" icon={Users} subtitle={q.data ? `${q.data.meta.total} on file` : undefined} action={<Button size="sm" icon={Plus} onClick={() => setCreating(true)}>Add contact</Button>} />
      <DataTable
        cfg={CONFIGS.contacts}
        rows={q.data?.data ?? []}
        loading={q.isLoading}
        hidden={["account", "owner_name", "phone"]}
        onRowClick={(r) => nav(`/contacts/${r.id}`)}
        emptyState={<EmptyState compact icon={Users} title="No contacts yet" body="Add the people you deal with, including the decision-maker." />}
      />
      <EntityForm cfg={CONFIGS.contacts} open={creating} onClose={() => setCreating(false)} defaults={{ account_id: a.id, account_name: a.name }} />
    </Card>
  );
}

function OpportunitiesTab({ a }: { a: Row }) {
  const nav = useNavigate();
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ["opportunities", "account", a.id], queryFn: () => api.get<Page<Row>>(`/opportunities${qs({ account_id: a.id, pageSize: 100 })}`) });
  return (
    <Card>
      <CardHeader title="Opportunities" icon={Briefcase} action={<Button size="sm" icon={Plus} onClick={() => setCreating(true)}>Create opportunity</Button>} />
      <DataTable
        cfg={CONFIGS.opportunities}
        rows={q.data?.data ?? []}
        loading={q.isLoading}
        hidden={["account"]}
        onRowClick={(r) => nav(`/opportunities/${r.id}`)}
        emptyState={<EmptyState compact icon={Briefcase} title="No opportunities" body="Create one when there is a concrete potential sale — contacting a company is not a deal." />}
      />
      <EntityForm cfg={CONFIGS.opportunities} open={creating} onClose={() => setCreating(false)} defaults={{ account_id: a.id, account_name: a.name, name: `${a.name} — ` }} />
    </Card>
  );
}

function OutreachTab({ a }: { a: Row }) {
  return (
    <>
      <OutreachList filter={{ account_id: a.id }} defaults={{ account_id: a.id, account_name: a.name }} />
      <Timeline parent={{ account_id: a.id }} types={E.OUTREACH_ACTIVITY_TYPES} title="Outreach history" />
    </>
  );
}

function NotesTab({ a }: { a: Row }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [notes, setNotes] = useState(a.notes ?? "");
  useEffect(() => setNotes(a.notes ?? ""), [a.notes]);
  const m = useMutation({
    mutationFn: () => api.patch(`/accounts/${a.id}`, { notes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["audit-logs"] });
      toast("success", "Notes saved");
    },
    onError: (e) => toast("error", (e as Error).message),
  });
  return (
    <>
      <Card>
        <CardHeader title="Internal notes" icon={ClipboardList} action={<Button size="sm" variant="primary" disabled={notes === (a.notes ?? "")} loading={m.isPending} onClick={() => m.mutate()}>Save</Button>} />
        <div className="p-3">
          <textarea className="input h-auto min-h-48 py-2 leading-relaxed" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Context, history, buying process, sensitivities…" />
        </div>
      </Card>
      <AuditTrail entityType="account" entityId={a.id} />
    </>
  );
}

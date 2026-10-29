import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Briefcase, CheckCircle2, ListOrdered, Megaphone, Package, Pencil, Phone, Send, Telescope, UserSearch, Zap } from "lucide-react";
import { EnrollDialog, OutreachComposer } from "../components/outreach";
import { OutreachList } from "./Outreach";
import { EnrichmentDialog, QualificationCard } from "./Prospecting";
import { LineItemsCard } from "./SalesMaterial";
import { LinkedAssets } from "./Library";
import { CallsList } from "./Calls";
import { api, ApiError, qs, type Page, type Row } from "../lib/api";
import { useAuth } from "../lib/auth";
import { CONFIGS, type EntityConfig } from "../lib/entities";
import * as E from "../../shared/enums";
import { date, money } from "../lib/format";
import { PageHeader } from "../components/layout";
import { EntityForm, RefSelect } from "../components/forms";
import { AuditTrail, CompleteTaskDialog, FieldGrid, RelatedTasks, Timeline, invalidateRecord, useArchive } from "../components/records";
import { Badge, Button, Card, CardHeader, ConfirmDialog, Dialog, EmptyState, ErrorState, Field, KeyValue, Skeleton, StatusBadge, cn, useToast } from "../components/ui";
import { DataTable } from "./EntityListPage";

export function useRecord(cfg: EntityConfig, id: string) {
  return useQuery({ queryKey: [cfg.route, "one", id], queryFn: () => api.get(`/${cfg.route}/${id}`).then((r) => r.data) });
}

function statusOf(cfg: EntityConfig, r: Row): ReactNode {
  const map: Record<string, [string, { options: E.Option[] }]> = {
    contact: ["status", E.CONTACT_STATUSES],
    prospect: ["status", E.PROSPECT_STATUSES],
    campaign: ["status", E.CAMPAIGN_STATUSES],
    product: ["status", E.ACTIVE_STATUSES],
    opportunity: ["stage", E.OPPORTUNITY_STAGES],
    task: ["status", E.TASK_STATUSES],
  };
  const m = map[cfg.key];
  return m ? <StatusBadge value={r[m[0]]} label={E.labelOf(m[1], r[m[0]])} /> : null;
}

export function RecordDetailPage({ cfg, crumb }: { cfg: EntityConfig; crumb: { label: string; to: string } }) {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const q = useRecord(cfg, id);
  const [editing, setEditing] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const archive = useArchive(cfg.route, id);
  const canWrite = cfg.writeRoles.includes(user!.role);

  if (q.isError)
    return (
      <div className="p-6">
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </div>
    );
  if (!q.data)
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-40" />
      </div>
    );
  const r = q.data;
  const parentKey = `${cfg.key}_id` as const;

  return (
    <div className="pb-10">
      <PageHeader
        crumbs={[crumb, { label: cfg.titleOf(r) }]}
        title={
          <span className="flex items-center gap-2">
            {cfg.titleOf(r)} {statusOf(cfg, r)} {r.archived_at && <Badge>Archived</Badge>}
          </span>
        }
        subtitle={cfg.subtitleOf?.(r)}
        actions={
          canWrite && (
            <>
              <EntityActions cfg={cfg} r={r} />
              <Button icon={r.archived_at ? ArchiveRestore : Archive} onClick={() => (r.archived_at ? archive.mutate(false) : setConfirmArchive(true))}>
                {r.archived_at ? "Restore" : "Archive"}
              </Button>
              <Button variant="primary" icon={Pencil} onClick={() => setEditing(true)}>
                Edit
              </Button>
            </>
          )
        }
      />
      <div className="grid gap-4 px-4 sm:px-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          {cfg.key === "opportunity" && <StageStepper r={r} canWrite={canWrite} />}
          <Card className="p-4">
            <FieldGrid fields={cfg.fields} record={r} />
          </Card>
          <EntityRelated cfg={cfg} r={r} />
          {cfg.key !== "product" && cfg.key !== "task" && <Timeline parent={{ [parentKey]: id }} />}
        </div>
        <div className="space-y-4">
          {cfg.key === "prospect" && <QualificationCard p={r} />}
          {["contact", "prospect", "opportunity"].includes(cfg.key) && (
            <RelatedTasks parent={{ [parentKey]: id }} defaults={r.account_id ? { account_id: r.account_id, account_name: r.account_name } : undefined} />
          )}
          <AuditTrail entityType={cfg.key} entityId={id} />
        </div>
      </div>
      <EntityForm cfg={cfg} open={editing} onClose={() => setEditing(false)} record={r} />
      <ConfirmDialog
        open={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        title={`Archive ${cfg.label.toLowerCase()}?`}
        body="It will be hidden from lists. Its history and links are kept, and you can restore it later."
        confirmLabel="Archive"
        loading={archive.isPending}
        onConfirm={() => archive.mutate(true, { onSuccess: () => setConfirmArchive(false) })}
      />
    </div>
  );
}

function EntityActions({ cfg, r }: { cfg: EntityConfig; r: Row }) {
  const [converting, setConverting] = useState(false);
  const [completing, setCompleting] = useState<Row | null>(null);
  const [composing, setComposing] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [finding, setFinding] = useState(false);
  if (cfg.key === "contact") {
    const blocked = r.status === "do_not_contact";
    return (
      <>
        <Button icon={ListOrdered} disabled={blocked} onClick={() => setEnrolling(true)}>Enroll in sequence</Button>
        <Button icon={Send} disabled={blocked} title={blocked ? "Marked Do not contact" : undefined} onClick={() => setComposing(true)}>Create outreach</Button>
        <OutreachComposer open={composing} onClose={() => setComposing(false)} defaults={{ contact_id: r.id, contact_name: r.full_name, account_id: r.account_id ?? undefined, account_name: r.account_name ?? undefined }} />
        <EnrollDialog open={enrolling} onClose={() => setEnrolling(false)} contact={{ id: r.id, name: r.full_name }} key={enrolling ? "o" : "c"} />
      </>
    );
  }
  if (cfg.key === "prospect") {
    if (r.status === "converted")
      return (
        <Link to={`/accounts/${r.converted_account_id}`}>
          <Button icon={Zap}>View account</Button>
        </Link>
      );
    return (
      <>
        <Button icon={UserSearch} onClick={() => setFinding(true)}>Find contacts</Button>
        <Button icon={Send} onClick={() => setComposing(true)}>Create outreach</Button>
        <OutreachComposer open={composing} onClose={() => setComposing(false)} defaults={{ prospect_id: r.id, prospect_name: r.company_name, campaign_id: r.campaign_id ?? undefined }} />
        <EnrichmentDialog open={finding} onClose={() => setFinding(false)} kind="prospects" id={r.id} name={r.company_name} />
        <Button icon={Zap} disabled={r.status !== "qualified"} title={r.status !== "qualified" ? "Move the prospect to Qualified first" : undefined} onClick={() => setConverting(true)}>
          Convert
        </Button>
        <ConvertDialog prospect={r} open={converting} onClose={() => setConverting(false)} />
      </>
    );
  }
  if (cfg.key === "task" && ["open", "in_progress"].includes(r.status)) {
    return (
      <>
        <Button icon={CheckCircle2} onClick={() => setCompleting(r)}>
          Complete
        </Button>
        <CompleteTaskDialog task={completing} onClose={() => setCompleting(null)} />
      </>
    );
  }
  return null;
}

function ConvertDialog({ prospect, open, onClose }: { prospect: Row; open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [mode, setMode] = useState<"create" | "link">("create");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [createContact, setCreateContact] = useState(!!prospect.contact_name);
  const [dupes, setDupes] = useState<Row[] | null>(null);
  const m = useMutation({
    mutationFn: () => api.post<{ data: Row }>(`/prospects/${prospect.id}/convert`, { account_mode: mode, account_id: accountId, create_contact: createContact }),
    onSuccess: (r) => {
      invalidateRecord(qc);
      toast("success", r.data.account_created ? "Converted into a new account" : "Converted and linked to the existing account");
      nav(`/accounts/${r.data.account_id}`);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "possible_duplicate") {
        setDupes((e.details as { matches: Row[] }).matches);
        setMode("link");
      }
    },
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Convert prospect"
      width="max-w-lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} disabled={mode === "link" && !accountId} onClick={() => m.mutate()}>
            Convert
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-slate-600">
          Creates or links an account{prospect.contact_name ? " and contact" : ""} for <b>{prospect.company_name}</b>. Campaign attribution
          {prospect.campaign_name ? ` (${prospect.campaign_name})` : ""} and activity history are kept. This does not create a deal.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {(["create", "link"] as const).map((v) => (
            <button key={v} onClick={() => setMode(v)} className={cn("rounded-lg border p-3 text-left transition-colors", mode === v ? "border-brand-400 bg-brand-50" : "border-line hover:bg-slate-50")}>
              <div className="font-medium">{v === "create" ? "Create new account" : "Link existing account"}</div>
              <div className="text-xs text-muted">{v === "create" ? "Blocked if a matching account exists" : "Choose the company's existing record"}</div>
            </button>
          ))}
        </div>
        {dupes && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
            Matching accounts already exist: {dupes.map((d) => d.name).join(", ")}. Link one of them instead of creating a duplicate.
          </div>
        )}
        {mode === "link" && (
          <Field label="Account" required>
            <RefSelect kind="accounts" value={accountId} onChange={(v) => setAccountId(v)} />
          </Field>
        )}
        {prospect.contact_name && (
          <label className="flex items-center gap-2">
            <input type="checkbox" className="accent-brand-600" checked={createContact} onChange={(e) => setCreateContact(e.target.checked)} />
            Create contact “{prospect.contact_name}” (an existing contact with the same email is linked instead)
          </label>
        )}
        {m.error && !(m.error instanceof ApiError && m.error.code === "possible_duplicate") && <p className="text-xs text-red-600">{(m.error as Error).message}</p>}
      </div>
    </Dialog>
  );
}

function StageStepper({ r, canWrite }: { r: Row; canWrite: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [pendingClose, setPendingClose] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const m = useMutation({
    mutationFn: (body: Row) => api.patch(`/opportunities/${r.id}`, body),
    onSuccess: () => {
      invalidateRecord(qc);
      qc.invalidateQueries({ queryKey: ["opportunities"] });
      toast("success", "Stage updated");
      setPendingClose(null);
      setReason("");
    },
    onError: (e) => toast("error", (e as Error).message),
  });
  const stages = E.OPPORTUNITY_STAGES.options;
  const idx = stages.findIndex((s) => s.value === r.stage);
  return (
    <Card className="p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-muted">
          Value <b className="text-ink">{money(r.amount_minor, r.currency)}</b> · Probability <b className="text-ink">{r.probability}%</b> · Weighted{" "}
          <b className="text-ink">{money(r.weighted_minor, r.currency)}</b> · Close {date(r.expected_close_date)}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-5">
        {stages.map((s, i) => (
          <button
            key={s.value}
            disabled={!canWrite || m.isPending || s.value === r.stage}
            onClick={() => (E.CLOSED_STAGES.includes(s.value) ? setPendingClose(s.value) : m.mutate({ stage: s.value }))}
            className={cn(
              "h-7 truncate rounded px-2 text-[11px] font-medium whitespace-nowrap transition-colors",
              s.value === r.stage
                ? s.value === "closed_lost"
                  ? "bg-red-600 text-white"
                  : "bg-brand-600 text-white"
                : i < idx && !E.CLOSED_STAGES.includes(r.stage)
                  ? "bg-brand-100 text-brand-800 hover:bg-brand-200"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
      <Dialog
        open={!!pendingClose}
        onClose={() => setPendingClose(null)}
        title={pendingClose === "closed_won" ? "Mark as won" : "Mark as lost"}
        footer={
          <>
            <Button onClick={() => setPendingClose(null)}>Cancel</Button>
            <Button variant={pendingClose === "closed_lost" ? "danger" : "primary"} loading={m.isPending} onClick={() => m.mutate({ stage: pendingClose, win_loss_reason: reason || null })}>
              Confirm
            </Button>
          </>
        }
      >
        <Field label={pendingClose === "closed_won" ? "Why did we win?" : "Why did we lose?"} help="Recorded for win/loss analysis.">
          <textarea autoFocus className="input h-auto min-h-20 py-1.5" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Dialog>
    </Card>
  );
}

function EntityRelated({ cfg, r }: { cfg: EntityConfig; r: Row }) {
  const nav = useNavigate();
  if (cfg.key === "campaign") return <CampaignRelated r={r} />;
  if (cfg.key === "opportunity")
    return (
      <>
        <LineItemsCard opp={r} canWrite />
        <LinkedAssets type="opportunity" id={r.id} title="Proposals & documents" />
      </>
    );
  if (cfg.key === "product") {
    return r.features ? (
      <Card>
        <CardHeader title="Features & deliverables" icon={Package} />
        <ul className="list-disc space-y-0.5 py-3 pr-4 pl-9">
          {String(r.features)
            .split("\n")
            .filter(Boolean)
            .map((f, i) => <li key={i}>{f}</li>)}
        </ul>
      </Card>
    ) : null;
  }
  if (cfg.key === "contact")
    return (
      <>
        <OutreachList filter={{ contact_id: r.id }} defaults={{ contact_id: r.id, contact_name: r.full_name, account_id: r.account_id ?? undefined, account_name: r.account_name ?? undefined }} />
        <Card>
          <CardHeader title="Calls" icon={Phone} />
          <CallsList filter={{ contact_id: r.id }} compact />
        </Card>
        {r.account_id && <RelatedList title="Opportunities at this account" icon={Briefcase} cfg={CONFIGS.opportunities} params={{ account_id: r.account_id }} onOpen={(x) => nav(`/opportunities/${x.id}`)} />}
      </>
    );
  if (cfg.key === "prospect") return <OutreachList filter={{ prospect_id: r.id }} defaults={{ prospect_id: r.id, prospect_name: r.company_name, campaign_id: r.campaign_id ?? undefined }} />;
  return null;
}

function RelatedList({ title, icon, cfg, params, onOpen, hidden }: { title: string; icon: typeof Briefcase; cfg: EntityConfig; params: Record<string, string>; onOpen: (r: Row) => void; hidden?: string[] }) {
  const q = useQuery({ queryKey: [cfg.route, "related", params], queryFn: () => api.get<Page<Row>>(`/${cfg.route}${qs({ ...params, pageSize: 20 })}`) });
  return (
    <Card>
      <CardHeader title={title} icon={icon} subtitle={q.data ? `${q.data.meta.total} total` : undefined} />
      <DataTable cfg={cfg} rows={q.data?.data ?? []} loading={q.isLoading} hidden={hidden} onRowClick={onOpen} emptyState={<EmptyState compact icon={icon} title={`No ${cfg.plural.toLowerCase()}`} />} />
    </Card>
  );
}

function CampaignRelated({ r }: { r: Row }) {
  const nav = useNavigate();
  const ids: string[] = JSON.parse(r.product_ids_json ?? "[]").filter(Boolean);
  const products = useQuery({ queryKey: ["products", "list", { pageSize: 100 }], queryFn: () => api.get<Page<Row>>(`/products${qs({ pageSize: 100 })}`) });
  const linked = (products.data?.data ?? []).filter((p) => ids.includes(p.id));
  const spendPct = r.budget_minor ? Math.round((Number(r.actual_spend_minor ?? 0) / Number(r.budget_minor)) * 100) : null;
  return (
    <>
      <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
        <Metric label="Prospects" value={`${r.prospect_count}${r.target_leads ? ` / ${r.target_leads}` : ""}`} />
        <Metric label="Opportunities" value={r.opportunity_count} />
        <Metric label="Budget" value={money(r.budget_minor, r.currency)} />
        <Metric label="Spend" value={r.actual_spend_minor === null ? "Not tracked" : `${money(r.actual_spend_minor, r.currency)}${spendPct !== null ? ` (${spendPct}%)` : ""}`} />
      </Card>
      <Card>
        <CardHeader title="Products & services" icon={Package} />
        <div className="flex flex-wrap gap-1.5 p-4">
          {linked.length ? linked.map((p) => <Link key={p.id} to={`/products/${p.id}`}><Badge tone="brand">{p.name}</Badge></Link>) : <span className="text-xs text-muted">No products linked. Edit the campaign to add them.</span>}
        </div>
      </Card>
      <RelatedList title="Attributed prospects" icon={Telescope} cfg={CONFIGS.prospects} params={{ campaign_id: r.id }} onOpen={(x) => nav(`/prospecting/${x.id}`)} hidden={["campaign_name", "owner_name", "website"]} />
      <RelatedList title="Attributed opportunities" icon={Megaphone} cfg={CONFIGS.opportunities} params={{ campaign_id: r.id }} onOpen={(x) => nav(`/opportunities/${x.id}`)} />
    </>
  );
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export { KeyValue };

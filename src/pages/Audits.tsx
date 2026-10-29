import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertOctagon, AlertTriangle, ArrowLeft, Briefcase, CheckCircle2, ChevronDown, ChevronRight, CircleSlash, ClipboardCopy, FileSearch, Info, ListChecks,
  Package, RefreshCw, TrendingDown, TrendingUp,
} from "lucide-react";
import { api, ApiError, type Row } from "../lib/api";
import { CONFIGS } from "../lib/entities";
import * as E from "../../shared/enums";
import { dateTime, hostOf, relative } from "../lib/format";
import { EntityForm } from "../components/forms";
import { invalidateRecord } from "../components/records";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, ScoreRing, Skeleton, StatusBadge, cn, useToast } from "../components/ui";

export function useAuditTypes() {
  return useQuery({ queryKey: ["audit-types"], queryFn: () => api.get<{ data: Row[] }>("/audits/types").then((r) => r.data), staleTime: Infinity });
}

const ACTIVE = ["queued", "running"];

export function AuditsTab({ account }: { account: Row }) {
  const types = useAuditTypes();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const runs = useQuery({
    queryKey: ["audits", account.id],
    queryFn: () => api.get<{ data: Row[] }>(`/accounts/${account.id}/audits`).then((r) => r.data),
    refetchInterval: (q) => ((q.state.data ?? []).some((r) => ACTIVE.includes(r.status)) ? 2000 : false),
  });
  const run = useMutation({
    mutationFn: (type: string) => api.post<{ data: Row }>(`/accounts/${account.id}/audits`, { audit_type: type }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["audits", account.id] });
      nav(`/accounts/${account.id}/audits/${r.data.id}`);
    },
    onError: (e) => toast("error", e instanceof ApiError ? e.message : "Could not start the audit"),
  });
  const latest = new Map<string, Row>();
  for (const r of runs.data ?? []) if (!latest.has(r.audit_type)) latest.set(r.audit_type, r);

  return (
    <>
      {!account.website && (
        <Card className="flex items-center gap-2 border-amber-200 bg-amber-50 p-3 text-amber-900">
          <AlertTriangle className="size-4" /> Add the company website (Edit) to run website, SEO and AEO audits.
        </Card>
      )}
      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {(types.data ?? []).map((t) => {
          const r = latest.get(t.key);
          return (
            <Card key={t.key} className={cn("flex flex-col p-4", !t.implemented && "bg-slate-50/60")}>
              <div className="flex items-start gap-3">
                <ScoreRing score={r && r.status.startsWith("completed") ? r.overall_score : null} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 font-medium">
                    {t.label} {!t.implemented && <Badge>Planned</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-muted">{t.implemented ? t.description : t.plannedNote}</p>
                </div>
              </div>
              <div className="mt-auto flex items-center justify-between gap-2 pt-3 text-xs text-muted">
                <span>{r ? `${E.labelOf(E.AUDIT_STATUSES, r.status)} · ${relative(r.created_at)}` : t.implemented ? "Not run yet" : " "}</span>
                {t.implemented && (
                  <Button size="sm" variant={r ? "secondary" : "primary"} icon={r ? RefreshCw : FileSearch} disabled={!account.website || (r && ACTIVE.includes(r.status))} loading={run.isPending && run.variables === t.key} onClick={() => run.mutate(t.key)}>
                    {r ? "Re-run" : "Run"}
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>
      <Card>
        <CardHeader title="Audit history" icon={FileSearch} subtitle="Every run is kept so results can be compared over time" />
        {runs.isLoading ? (
          <div className="space-y-2 p-4"><Skeleton className="h-6" /><Skeleton className="h-6" /></div>
        ) : !runs.data?.length ? (
          <EmptyState compact icon={FileSearch} title="No audits yet" body="Run a website, SEO or AEO audit to collect evidence for your pitch." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-line bg-slate-50/70">
                <tr>
                  <th className="th">Audit</th>
                  <th className="th">Target</th>
                  <th className="th">Status</th>
                  <th className="th text-right">Score</th>
                  <th className="th text-right">Issues</th>
                  <th className="th">Run by</th>
                  <th className="th">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {runs.data.map((r) => (
                  <tr key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => nav(`/accounts/${account.id}/audits/${r.id}`)}>
                    <td className="td font-medium">{types.data?.find((t) => t.key === r.audit_type)?.label ?? r.audit_type}</td>
                    <td className="td text-muted">{hostOf(r.target)}</td>
                    <td className="td">
                      <StatusBadge value={r.status} label={ACTIVE.includes(r.status) ? `${E.labelOf(E.AUDIT_STATUSES, r.status)} ${r.progress}%` : E.labelOf(E.AUDIT_STATUSES, r.status)} />
                    </td>
                    <td className="td text-right font-semibold tabular-nums">{r.overall_score ?? "—"}</td>
                    <td className="td text-right tabular-nums">{r.status.startsWith("completed") ? r.issue_count : "—"}</td>
                    <td className="td text-muted">{r.initiated_by_name}</td>
                    <td className="td text-muted" title={dateTime(r.created_at)}>{relative(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

const SEVERITY_META: Record<string, { label: string; icon: typeof AlertOctagon; cls: string }> = {
  critical: { label: "Critical", icon: AlertOctagon, cls: "text-red-700 bg-red-50 ring-red-200" },
  high: { label: "High priority", icon: AlertTriangle, cls: "text-orange-700 bg-orange-50 ring-orange-200" },
  medium: { label: "Medium priority", icon: AlertTriangle, cls: "text-amber-700 bg-amber-50 ring-amber-200" },
  low: { label: "Low priority", icon: Info, cls: "text-sky-700 bg-sky-50 ring-sky-200" },
  positive: { label: "Passed checks", icon: CheckCircle2, cls: "text-emerald-700 bg-emerald-50 ring-emerald-200" },
  unavailable: { label: "Could not be checked", icon: CircleSlash, cls: "text-slate-600 bg-slate-100 ring-slate-200" },
};

export function AuditReport({ runId, account }: { runId: string; account: Row }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const q = useQuery({
    queryKey: ["audits", "run", runId],
    queryFn: () => api.get(`/audits/${runId}`).then((r) => r.data),
    refetchInterval: (query) => (query.state.data && ACTIVE.includes(query.state.data.status) ? 1500 : false),
  });
  const done = q.data && !ACTIVE.includes(q.data.status);
  // When a run finishes, refresh the account's snapshot, insights and timeline.
  useEffect(() => {
    if (done) {
      qc.invalidateQueries({ queryKey: ["insights"] });
      qc.invalidateQueries({ queryKey: ["audits", account.id] });
      qc.invalidateQueries({ queryKey: ["activities"] });
    }
  }, [done, qc, account.id]);
  const compare = useQuery({ queryKey: ["audits", "compare", runId], queryFn: () => api.get(`/audits/${runId}/compare`).then((r) => r.data), enabled: !!done && q.data?.status !== "failed" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState<"task" | "opportunity" | null>(null);

  const rerun = useMutation({
    mutationFn: () => api.post<{ data: Row }>(`/accounts/${account.id}/audits`, { audit_type: q.data!.audit_type, target: q.data!.target }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["audits", account.id] });
      nav(`/accounts/${account.id}/audits/${r.data.id}`);
    },
    onError: (e) => toast("error", (e as Error).message),
  });
  const cancel = useMutation({ mutationFn: () => api.post(`/audits/${runId}/cancel`), onSuccess: () => qc.invalidateQueries({ queryKey: ["audits"] }) });

  const findings: Row[] = q.data?.findings ?? [];
  const chosen = findings.filter((f) => selected.has(f.id));
  const relatedProducts = useMemo(() => {
    const m = new Map<string, Row>();
    for (const f of chosen.length ? chosen : findings.filter((x) => x.result === "fail" || x.result === "warn")) for (const p of f.related_products) m.set(p.id, p);
    return [...m.values()];
  }, [chosen, findings]);
  const apply = useMutation({
    mutationFn: () => api.post<{ data: Row }>(`/audits/${runId}/apply-services`, { product_ids: relatedProducts.map((p) => p.id), finding_ids: chosen.map((f) => f.id) }),
    onSuccess: (r) => {
      invalidateRecord(qc);
      toast("success", `${r.data.updated} service(s) marked relevant${r.data.skipped ? `; ${r.data.skipped} already further along were left unchanged` : ""}`);
    },
    onError: (e) => toast("error", (e as Error).message),
  });

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-96" />;
  const r = q.data;
  const summaryText = () => {
    const list = (chosen.length ? chosen : findings.filter((f) => f.result === "fail" || f.result === "warn")).map((f) => `• ${f.title}: ${f.detail}${f.recommendation ? ` Recommendation: ${f.recommendation}` : ""}`);
    return `${r.type_label} — ${account.name} (${hostOf(r.target)})\nScanned ${dateTime(r.completed_at ?? r.created_at)} · Score ${r.overall_score ?? "N/A"}/100 (${r.audit_version})\nScope: ${r.scope?.pages?.length ?? 0} page(s) inspected.\n\n${list.join("\n")}`;
  };
  const groups = ["critical", "high", "medium", "low", "positive", "unavailable"].map((sev) => ({
    sev,
    items: findings.filter((f) => (sev === "unavailable" ? f.result === "unavailable" : f.result !== "unavailable" && f.severity === sev)),
  }));
  const toggle = (set: Set<string>, id: string, fn: (s: Set<string>) => void) => {
    const n = new Set(set);
    n.has(id) ? n.delete(id) : n.add(id);
    fn(n);
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <Link to={`/accounts/${account.id}?tab=audits`} className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink">
          <ArrowLeft className="size-3.5" /> All audits
        </Link>
      </div>
      <Card>
        <div className="flex flex-wrap items-center gap-4 p-4">
          <ScoreRing score={r.overall_score} size={64} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-base font-semibold">
              {r.type_label}
              <StatusBadge value={r.status} label={E.labelOf(E.AUDIT_STATUSES, r.status)} />
            </div>
            <div className="text-xs text-muted">
              <a href={r.target} target="_blank" rel="noreferrer noopener" className="text-brand-700 hover:underline">{r.target}</a> · started {dateTime(r.created_at)} by {r.initiated_by_name}
              {r.completed_at && ` · finished ${dateTime(r.completed_at)}`} · rubric {r.audit_version}
            </div>
          </div>
          <div className="flex gap-2">
            {ACTIVE.includes(r.status) ? (
              <Button onClick={() => cancel.mutate()} loading={cancel.isPending}>Cancel</Button>
            ) : (
              <Button icon={RefreshCw} onClick={() => rerun.mutate()} loading={rerun.isPending}>Re-run</Button>
            )}
          </div>
        </div>
        {ACTIVE.includes(r.status) && (
          <div className="px-4 pb-4">
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-brand-500 transition-[width] duration-500" style={{ width: `${Math.max(5, r.progress)}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-muted">Fetching robots.txt, pages and links politely. This usually takes 5–20 seconds.</p>
          </div>
        )}
        {r.status === "failed" && <div className="px-4 pb-4"><ErrorState error={new Error(r.error ?? "The audit failed")} /></div>}
        {done && r.status !== "failed" && (
          <>
            <div className="grid gap-px border-t border-line bg-line sm:grid-cols-5">
              {r.categories.map((c: Row) => (
                <div key={c.category} className="bg-white p-3">
                  <div className="text-[11px] text-muted">{c.label} · {c.weight}%</div>
                  <div className="text-lg font-semibold tabular-nums">{c.score ?? "N/A"}</div>
                  <div className="mt-1 h-1 rounded-full bg-slate-100">
                    <div className={cn("h-full rounded-full", c.score === null ? "" : c.score >= 80 ? "bg-emerald-500" : c.score >= 50 ? "bg-amber-500" : "bg-red-500")} style={{ width: `${c.score ?? 0}%` }} />
                  </div>
                  <div className="mt-1 text-[10px] text-muted">{c.checks_passed} passed · {c.checks_failed} issues{c.checks_unavailable ? ` · ${c.checks_unavailable} n/a` : ""}</div>
                </div>
              ))}
            </div>
            <div className="space-y-1 border-t border-line px-4 py-3 text-xs text-muted">
              <div>
                <b className="text-slate-700">Scope:</b> {r.scope?.pages?.length ?? 0} page(s) inspected ({r.scope?.pages?.map((p: Row) => new URL(p.url).pathname).join(", ")}); {r.scope?.links_checked ?? 0} internal links checked of {r.scope?.links_discovered ?? 0} discovered. {r.scope?.note} Not a full-site crawl.
              </div>
              {r.warnings.map((w: string, i: number) => (
                <div key={i} className="text-amber-700">⚠ {w}</div>
              ))}
              <div>Score = weighted share of passed checks (warnings count half; unavailable checks excluded). It does not measure rankings, traffic or AI visibility.</div>
            </div>
          </>
        )}
      </Card>

      {compare.data && (
        <Card className="flex flex-wrap items-center gap-4 p-3 text-xs">
          <span className="flex items-center gap-1 font-medium">
            {compare.data.score_change === null ? null : compare.data.score_change >= 0 ? <TrendingUp className="size-4 text-emerald-600" /> : <TrendingDown className="size-4 text-red-600" />}
            vs {relative(compare.data.previous.created_at)}: {compare.data.score_change === null ? "N/A" : `${compare.data.score_change > 0 ? "+" : ""}${compare.data.score_change} points`}
          </span>
          {!compare.data.same_rubric && <Badge tone="amber">Different rubric version — compare with care</Badge>}
          <span className="text-emerald-700">{compare.data.resolved.length} resolved</span>
          <span className="text-red-700">{compare.data.new_issues.length} new issues</span>
          <Link to={`/accounts/${account.id}/audits/${compare.data.previous.id}`} className="ml-auto text-brand-700 hover:underline">Open previous</Link>
        </Card>
      )}

      {done && r.status !== "failed" && (
        <Card className="sticky top-11 z-10 flex flex-wrap items-center gap-2 p-2.5">
          <span className="px-1 text-xs text-muted">{chosen.length ? `${chosen.length} finding(s) selected` : "Acting on all issues — select findings to narrow"}</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" icon={Package} disabled={!relatedProducts.length} loading={apply.isPending} onClick={() => apply.mutate()} title={relatedProducts.map((p) => p.name).join(", ")}>
              Mark {relatedProducts.length} related service(s) relevant
            </Button>
            <Button size="sm" icon={ListChecks} onClick={() => setCreating("task")}>Follow-up task</Button>
            <Button size="sm" icon={Briefcase} onClick={() => setCreating("opportunity")}>Create opportunity</Button>
            <Button
              size="sm"
              icon={ClipboardCopy}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(summaryText());
                  toast("success", "Audit summary copied");
                } catch {
                  toast("error", "Clipboard is not available in this browser");
                }
              }}
            >
              Copy summary
            </Button>
          </div>
        </Card>
      )}

      {done &&
        groups.map(({ sev, items }) =>
          items.length ? (
            <Card key={sev}>
              <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
                <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset", SEVERITY_META[sev].cls)}>
                  {(() => {
                    const I = SEVERITY_META[sev].icon;
                    return <I className="size-3.5" />;
                  })()}
                  {SEVERITY_META[sev].label}
                </span>
                <span className="text-xs text-muted">{items.length}</span>
              </div>
              <ul className="divide-y divide-line">
                {items.map((f) => {
                  const expanded = open.has(f.id);
                  const actionable = f.result === "fail" || f.result === "warn";
                  return (
                    <li key={f.id} className="px-4 py-2.5">
                      <div className="flex items-start gap-2.5">
                        {actionable ? (
                          <input type="checkbox" aria-label={`Select ${f.title}`} className="mt-1 accent-brand-600" checked={selected.has(f.id)} onChange={() => toggle(selected, f.id, setSelected)} />
                        ) : (
                          <span className="w-[13px]" />
                        )}
                        <button className="min-w-0 flex-1 text-left" onClick={() => toggle(open, f.id, setOpen)} aria-expanded={expanded}>
                          <div className="flex items-center gap-1.5 font-medium">
                            {expanded ? <ChevronDown className="size-3.5 text-slate-400" /> : <ChevronRight className="size-3.5 text-slate-400" />}
                            {f.title}
                            {f.result === "warn" && <Badge tone="amber">Partial</Badge>}
                          </div>
                          <div className="pl-5 text-xs text-slate-600">{f.detail}</div>
                        </button>
                        {f.effort && <Badge tone="gray">{f.effort} effort</Badge>}
                      </div>
                      {expanded && (
                        <div className="mt-2 space-y-2 pl-11 text-xs">
                          {f.recommendation && (
                            <div>
                              <span className="font-semibold text-slate-700">Recommendation: </span>
                              {f.recommendation}
                            </div>
                          )}
                          {f.related_products.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1">
                              <span className="font-semibold text-slate-700">Related Gexart services:</span>
                              {f.related_products.map((p: Row) => <Badge key={p.id} tone="brand">{p.name}</Badge>)}
                            </div>
                          )}
                          {f.evidence.length > 0 && (
                            <div>
                              <div className="font-semibold text-slate-700">Evidence (observed {dateTime(f.evidence[0].captured_at)})</div>
                              <ul className="mt-1 space-y-0.5">
                                {f.evidence.map((e: Row) => (
                                  <li key={e.id} className="flex gap-2 font-mono text-[11px] text-slate-600">
                                    {e.url && <a href={e.url} target="_blank" rel="noreferrer noopener" className="shrink-0 text-brand-700 hover:underline">{new URL(e.url).pathname || "/"}</a>}
                                    <span className="break-all">{e.observation}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          ) : null,
        )}

      <EntityForm
        cfg={CONFIGS.tasks}
        open={creating === "task"}
        onClose={() => setCreating(null)}
        defaults={{
          title: `Discuss ${r.type_label.toLowerCase()} findings with ${account.name}`.slice(0, 200),
          type: "follow_up_call",
          account_id: account.id,
          account_name: account.name,
          description: done ? summaryText().slice(0, 5000) : "",
        }}
      />
      <EntityForm
        cfg={CONFIGS.opportunities}
        open={creating === "opportunity"}
        onClose={() => setCreating(null)}
        defaults={{
          name: `${account.name} — ${relatedProducts.slice(0, 2).map((p) => p.name).join(" & ") || r.type_label}`.slice(0, 200),
          account_id: account.id,
          account_name: account.name,
          notes: done ? `Based on ${r.type_label} (${dateTime(r.completed_at)}).\n\n${summaryText()}`.slice(0, 10000) : "",
        }}
      />
    </>
  );
}

/** /audits/:runId → the report inside its account workspace (used by notification links). */
export function AuditRedirect() {
  const { runId = "" } = useParams();
  const q = useQuery({ queryKey: ["audits", "run", runId], queryFn: () => api.get(`/audits/${runId}`).then((r) => r.data) });
  if (q.isError) return <div className="p-6"><ErrorState error={q.error} /></div>;
  if (!q.data) return <div className="p-6"><Skeleton className="h-40" /></div>;
  return <Navigate to={`/accounts/${q.data.account_id}/audits/${runId}`} replace />;
}

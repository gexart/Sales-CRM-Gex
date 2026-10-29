import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Activity, AlarmClock, BarChart3, Briefcase, Building2, CalendarClock, CheckCircle2, Filter, Megaphone, Send, Target, Telescope, TrendingUp, Trophy, Users,
  type LucideIcon,
} from "lucide-react";
import { api, qs, type Row } from "../lib/api";
import { useAuth } from "../lib/auth";
import * as E from "../../shared/enums";
import { dateTime, money, moneyList, pct, relative } from "../lib/format";
import { PageHeader } from "../components/layout";
import { Card, CardHeader, EmptyState, ErrorState, Select, Skeleton, StatusBadge, cn } from "../components/ui";

export type PeriodKey = "today" | "week" | "month" | "last_month" | "quarter" | "custom";
export function periodRange(p: PeriodKey, custom: { from: string; to: string }) {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (p === "today") return { from: start.toISOString(), to: now.toISOString() };
  if (p === "week") {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return { from: start.toISOString(), to: now.toISOString() };
  }
  if (p === "month") return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), to: now.toISOString() };
  if (p === "quarter") return { from: new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1).toISOString(), to: now.toISOString() };
  if (p === "last_month") return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString(), to: new Date(now.getFullYear(), now.getMonth(), 1).toISOString() };
  return {
    from: custom.from ? new Date(`${custom.from}T00:00:00`).toISOString() : new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
    to: custom.to ? new Date(`${custom.to}T23:59:59`).toISOString() : now.toISOString(),
  };
}

export function PeriodPicker({ value, onChange, custom, onCustom }: { value: PeriodKey; onChange: (p: PeriodKey) => void; custom: { from: string; to: string }; onCustom: (c: { from: string; to: string }) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        aria-label="Period"
        className="w-36"
        value={value}
        onChange={(e) => onChange(e.target.value as PeriodKey)}
        options={[
          { value: "today", label: "Today" },
          { value: "week", label: "This week" },
          { value: "month", label: "This month" },
          { value: "last_month", label: "Last month" },
          { value: "quarter", label: "This quarter" },
          { value: "custom", label: "Custom range" },
        ]}
      />
      {value === "custom" && (
        <>
          <input type="date" aria-label="From" className="input w-36" value={custom.from} onChange={(e) => onCustom({ ...custom, from: e.target.value })} />
          <input type="date" aria-label="To" className="input w-36" value={custom.to} onChange={(e) => onCustom({ ...custom, to: e.target.value })} />
        </>
      )}
    </div>
  );
}

export function useDashboard(period: PeriodKey, custom: { from: string; to: string }) {
  const range = useMemo(() => periodRange(period, custom), [period, custom]);
  return useQuery({
    queryKey: ["dashboard", period === "custom" ? custom : period],
    queryFn: () => api.get(`/dashboard${qs(range)}`).then((r) => r.data),
    placeholderData: (p) => p,
  });
}

function Kpi({ label, value, icon: Icon, sub, to, tone = "brand" }: { label: string; value: ReactNode; icon: LucideIcon; sub?: ReactNode; to?: string; tone?: "brand" | "red" | "green" }) {
  const body = (
    <Card className={cn("flex items-start gap-3 p-3.5 transition-shadow", to && "hover:shadow-[var(--shadow-pop)]")}>
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", tone === "red" ? "bg-red-50 text-red-600" : tone === "green" ? "bg-emerald-50 text-emerald-600" : "bg-brand-50 text-ink")}>
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <div className="truncate text-xs text-muted">{label}</div>
        <div className="truncate text-xl font-semibold tracking-tight tabular-nums">{value}</div>
        {sub && <div className="truncate text-[11px] text-muted">{sub}</div>}
      </div>
    </Card>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

export function Bars({ rows, max, format }: { rows: { label: string; value: number; sub?: string }[]; max?: number; format?: (v: number) => string }) {
  const m = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="mb-0.5 flex justify-between gap-2 text-xs">
            <span className="truncate text-slate-600">{r.label}</span>
            <span className="shrink-0 font-medium tabular-nums">{format ? format(r.value) : r.value}{r.sub && <span className="font-normal text-muted"> · {r.sub}</span>}</span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-ink transition-[width] duration-500" style={{ width: `${(r.value / m) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Dashboard() {
  const { user } = useAuth();
  const [period, setPeriod] = useState<PeriodKey>("month");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const q = useDashboard(period, custom);
  const d = q.data;
  const k = d?.kpis;
  const hour = new Date().getHours();

  return (
    <div className="pb-10">
      <PageHeader
        title={`Good ${hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening"}, ${user?.name.split(" ")[0]}`}
        subtitle={d ? (d.scope === "team" ? "Team-wide figures from live CRM records" : "Figures for records you own") : " "}
        actions={<PeriodPicker value={period} onChange={setPeriod} custom={custom} onCustom={setCustom} />}
      />
      <div className="space-y-4 px-4 sm:px-6">
        {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {!k
            ? Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-[74px] rounded-[10px]" />)
            : (
              <>
                <Kpi label="Accounts" value={k.accounts} icon={Building2} to="/accounts" />
                <Kpi label="Contacts" value={k.contacts} icon={Users} to="/contacts" />
                <Kpi label="Active prospects" value={k.prospects} icon={Telescope} to="/prospecting" sub={`${k.qualified_prospects} qualified`} />
                <Kpi label="Qualified prospects" value={k.qualified_prospects} icon={Target} to="/prospecting?status=qualified" sub="Ready to convert" />
                <Kpi label="Open opportunities" value={k.open_opportunities} icon={Briefcase} to="/opportunities" />
                <Kpi label="Pipeline value" value={moneyList(k.pipeline)} icon={TrendingUp} sub={k.pipeline.length ? `Weighted ${moneyList(k.pipeline.map((p: Row) => ({ currency: p.currency, amount_minor: p.weighted_minor })))}` : "No open deals"} />
                <Kpi label="Closed-won (period)" value={moneyList(k.won)} icon={Trophy} tone="green" sub={`Win rate ${pct(k.win_rate)} of ${k.closed_count} closed`} />
                <Kpi label="Meetings scheduled" value={k.meetings_scheduled} icon={CalendarClock} to="/tasks?type=meeting&status=open" sub="Upcoming meeting tasks" />
                <Kpi label="Overdue tasks" value={k.overdue_tasks} icon={AlarmClock} tone={k.overdue_tasks ? "red" : "brand"} to="/tasks?view=overdue" />
                <Kpi label="Outreach (period)" value={k.outreach_activities} icon={Send} sub="Logged calls, emails, LinkedIn, WhatsApp" />
              </>
            )}
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader title="Prospect funnel" icon={Filter} subtitle="All-time, by qualification stage" />
            <div className="p-4">
              {d ? (
                d.prospect_funnel.length ? (
                  <Bars rows={E.PROSPECT_STATUSES.options.map((o) => ({ label: o.label, value: Number(d.prospect_funnel.find((f: Row) => f.status === o.value)?.n ?? 0) }))} />
                ) : (
                  <EmptyState compact icon={Telescope} title="No prospects yet" body="Add prospects manually to start the funnel." />
                )
              ) : <Skeleton className="h-40" />}
            </div>
          </Card>
          <Card>
            <CardHeader title="Pipeline by stage" icon={BarChart3} subtitle="Deal value per stage" />
            <div className="p-4">
              {d ? (
                d.stages.length ? (
                  <Bars
                    rows={E.OPPORTUNITY_STAGES.options.filter((o) => !E.CLOSED_STAGES.includes(o.value)).map((o) => {
                      const s = d.stages.find((x: Row) => x.stage === o.value);
                      return { label: o.label, value: Number(s?.amount_minor ?? 0), sub: `${s?.n ?? 0}` };
                    })}
                    format={(v) => money(v, "INR", true)}
                  />
                ) : (
                  <EmptyState compact icon={Briefcase} title="No opportunities yet" />
                )
              ) : <Skeleton className="h-40" />}
            </div>
          </Card>
          <Card>
            <CardHeader title="My open tasks" icon={CheckCircle2} action={<Link to="/tasks" className="text-xs font-medium text-ink">All tasks</Link>} />
            <ul className="divide-y divide-line px-4">
              {d?.my_tasks.map((t: Row) => {
                const late = t.due_at && new Date(t.due_at) < new Date();
                return (
                  <li key={t.id} className="py-2">
                    <Link to={`/tasks/${t.id}`} className="block truncate font-medium hover:text-ink">{t.title}</Link>
                    <div className="flex gap-2 text-xs text-muted">
                      <span className={late ? "font-medium text-red-600" : ""}>{t.due_at ? dateTime(t.due_at) : "No due date"}</span>
                      {t.account_name && <span className="truncate">{t.account_name}</span>}
                    </div>
                  </li>
                );
              })}
              {d && !d.my_tasks.length && <li className="py-6 text-center text-xs text-muted">No open tasks assigned to you</li>}
              {!d && <li className="py-3"><Skeleton className="h-24" /></li>}
            </ul>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title="Recent activity" icon={Activity} />
            <ul className="divide-y divide-line px-4">
              {d?.recent_activity.map((a: Row) => (
                <li key={a.id} className="flex items-center gap-3 py-2">
                  <span className="w-24 shrink-0 text-[11px] font-medium text-muted uppercase">{E.labelOf(E.ACTIVITY_TYPES, a.type)}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {a.subject}
                    {a.account_name && (
                      <>
                        {" · "}
                        <Link to={`/accounts/${a.account_id}`} className="font-medium text-ink underline decoration-stone-300 underline-offset-2 hover:decoration-ink">{a.account_name}</Link>
                      </>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-muted">{a.actor_name} · {relative(a.occurred_at)}</span>
                </li>
              ))}
              {d && !d.recent_activity.length && <li className="py-6 text-center text-xs text-muted">No activity recorded yet</li>}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Lead sources" icon={Target} subtitle="Prospects created in period" />
            <div className="p-4">
              {d?.lead_sources.length ? (
                <Bars rows={d.lead_sources.map((s: Row) => ({ label: s.source === "unknown" ? "Not recorded" : E.labelOf(E.LEAD_SOURCES, s.source), value: Number(s.n) }))} />
              ) : (
                <p className="py-6 text-center text-xs text-muted">No prospects created in this period</p>
              )}
            </div>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Campaign performance" icon={Megaphone} action={<Link to="/campaigns" className="text-xs font-medium text-ink">Campaigns</Link>} />
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-line bg-slate-50/70">
                  <tr>
                    <th className="th">Campaign</th>
                    <th className="th text-right">Prospects</th>
                    <th className="th text-right">Qualified</th>
                    <th className="th text-right">Converted</th>
                    <th className="th text-right">Opps</th>
                    <th className="th text-right">Won</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {d?.campaigns.map((c: Row) => (
                    <tr key={c.id}>
                      <td className="td"><Link to={`/campaigns/${c.id}`} className="font-medium hover:text-ink">{c.name}</Link></td>
                      <td className="td text-right tabular-nums">{c.prospects}{c.target_leads ? <span className="text-muted">/{c.target_leads}</span> : null}</td>
                      <td className="td text-right tabular-nums">{c.qualified}</td>
                      <td className="td text-right tabular-nums">{c.converted}</td>
                      <td className="td text-right tabular-nums">{c.opportunities}</td>
                      <td className="td text-right tabular-nums">{money(c.won_minor, "INR", true)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {d && !d.campaigns.length && <p className="py-6 text-center text-xs text-muted">No planned, active or completed campaigns</p>}
            </div>
          </Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader title="Recent prospects" icon={Telescope} />
              <ul className="divide-y divide-line px-4">
                {d?.recent_prospects.map((p: Row) => (
                  <li key={p.id} className="flex items-center gap-2 py-2">
                    <Link to={`/prospecting/${p.id}`} className="min-w-0 flex-1 truncate font-medium hover:text-ink">{p.company_name}</Link>
                    <StatusBadge value={p.status} label={E.labelOf(E.PROSPECT_STATUSES, p.status)} />
                  </li>
                ))}
                {d && !d.recent_prospects.length && <li className="py-6 text-center text-xs text-muted">None yet</li>}
              </ul>
            </Card>
            <Card>
              <CardHeader title="Recently updated accounts" icon={Building2} />
              <ul className="divide-y divide-line px-4">
                {d?.recent_accounts.map((a: Row) => (
                  <li key={a.id} className="py-2">
                    <Link to={`/accounts/${a.id}`} className="block truncate font-medium hover:text-ink">{a.name}</Link>
                    <div className="text-xs text-muted">{E.labelOf(E.ACCOUNT_STATUSES, a.status)} · {relative(a.updated_at)}</div>
                  </li>
                ))}
                {d && !d.recent_accounts.length && <li className="py-6 text-center text-xs text-muted">None yet</li>}
              </ul>
            </Card>
          </div>
        </div>

        {d?.scope === "team" && d.owners.length > 0 && (
          <Card>
            <CardHeader title="Sales performance by owner" icon={Users} subtitle="Pipeline is current; won, outreach and tasks are for the selected period" />
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-line bg-slate-50/70">
                  <tr>
                    <th className="th">Owner</th>
                    <th className="th text-right">Open opps</th>
                    <th className="th text-right">Pipeline</th>
                    <th className="th text-right">Won</th>
                    <th className="th text-right">Outreach</th>
                    <th className="th text-right">Tasks done</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {d.owners.map((o: Row) => (
                    <tr key={o.id}>
                      <td className="td font-medium">{o.name}</td>
                      <td className="td text-right tabular-nums">{o.open_opps}</td>
                      <td className="td text-right tabular-nums">{money(o.pipeline_minor, "INR", true)}</td>
                      <td className="td text-right tabular-nums">{money(o.won_minor, "INR", true)}</td>
                      <td className="td text-right tabular-nums">{o.outreach}</td>
                      <td className="td text-right tabular-nums">{o.tasks_completed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

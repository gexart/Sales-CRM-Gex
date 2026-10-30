// Autopilot: revenue cockpit, approval outbox, replies, leads, playbooks and setup (mailbox, Harvey, DNC).
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowRight, Ban, Check, CheckCircle2, CircleDashed, Flame, Inbox, KeyRound, Mail, MailCheck, Pause, Pencil, Play, Plus, RefreshCw,
  Rocket, Search, Send, ShieldCheck, Sparkles, Target, Trash2, X,
} from "lucide-react";
import { api, type Row } from "../lib/api";
import { useAuth } from "../lib/auth";
import { dateTime, money, relative } from "../lib/format";
import { PageHeader } from "../components/layout";
import { CopyButton } from "../components/outreach";
import { Badge, Button, Card, CardHeader, Dialog, EmptyState, ErrorState, Field, ScoreRing, Select, SlideOver, Skeleton, Tabs, cn, useToast, type Tone } from "../components/ui";

type TabKey = "cockpit" | "outbox" | "replies" | "leads" | "playbooks" | "setup";
const inr = (minor: number | null | undefined, compact = false) => money(minor ?? 0, "INR", compact);
const period = () => new Date().toISOString().slice(0, 7);
const monthName = (p: string) => new Date(`${p}-01T00:00:00Z`).toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

const STAGE_LABEL: Record<string, [string, Tone]> = {
  found: ["Found", "gray"], researched: ["Researched", "blue"], no_email: ["No email", "gray"], drafted: ["Awaiting approval", "amber"], approved: ["Approved", "violet"],
  in_sequence: ["In sequence", "violet"], replied: ["Replied", "brand"], interested: ["Interested", "green"], meeting: ["Meeting", "green"], won: ["Won", "green"],
  lost: ["Lost", "red"], opted_out: ["Opted out", "red"], bounced: ["Bounced", "red"], skipped: ["Skipped", "gray"], finished: ["Sequence done", "gray"],
};
const CLASS_LABEL: Record<string, [string, Tone]> = {
  interested: ["Interested", "green"], question: ["Question", "blue"], objection: ["Objection", "amber"], not_now: ["Not now", "amber"], not_interested: ["Not interested", "red"],
  opt_out: ["Opted out", "red"], out_of_office: ["Out of office", "gray"], bounce: ["Bounced", "red"], other: ["Reply", "gray"],
};
const StageBadge = ({ s }: { s: string }) => <Badge tone={STAGE_LABEL[s]?.[1] ?? "gray"}>{STAGE_LABEL[s]?.[0] ?? s}</Badge>;
const ClassBadge = ({ s }: { s: string | null }) => (s ? <Badge tone={CLASS_LABEL[s]?.[1] ?? "gray"}>{CLASS_LABEL[s]?.[0] ?? s}</Badge> : null);

export function AutopilotPage() {
  const { isManager } = useAuth();
  const [sp, setSp] = useSearchParams();
  const toast = useToast();
  const tab = (sp.get("tab") as TabKey) || "cockpit";
  const setTab = (t: TabKey) => setSp(t === "cockpit" ? {} : { tab: t }, { replace: true });
  const outbox = useQuery({ queryKey: ["ap-outbox"], enabled: isManager, queryFn: () => api.get<{ data: Row }>("/autopilot/outbox").then((r) => r.data), refetchInterval: 60_000 });

  useEffect(() => {
    const ok = sp.get("mailbox");
    const err = sp.get("mailbox_error");
    if (ok) toast("success", `Connected ${ok}`);
    if (err) toast("error", err);
    if (ok || err) setSp({ tab: "setup" }, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pending = (outbox.data?.sequences?.length ?? 0) + (outbox.data?.replies?.length ?? 0);
  const tabs = [
    { value: "cockpit" as const, label: "Revenue cockpit" },
    ...(isManager
      ? [
          { value: "outbox" as const, label: "Outbox", count: pending || undefined },
          { value: "replies" as const, label: "Replies" },
          { value: "leads" as const, label: "Leads" },
          { value: "playbooks" as const, label: "Playbooks" },
          { value: "setup" as const, label: "Setup" },
        ]
      : []),
  ];
  return (
    <div className="pb-12">
      <PageHeader title="Autopilot" icon={Rocket} subtitle="Finds leads, researches them, drafts outreach for your approval, sends, follows up and catches replies." />
      <div className="space-y-4 px-4 sm:px-6">
        <Tabs tabs={tabs} value={tab} onChange={setTab} />
        {tab === "cockpit" && <Cockpit onGo={setTab} />}
        {tab === "outbox" && <Outbox q={outbox} />}
        {tab === "replies" && <Replies />}
        {tab === "leads" && <Leads />}
        {tab === "playbooks" && <Playbooks />}
        {tab === "setup" && <Setup />}
      </div>
    </div>
  );
}

// ─── Cockpit ───
function BigRing({ pct }: { pct: number }) {
  const size = 168, r = 70, c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, pct));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90">
      <defs>
        <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F9A15C" />
          <stop offset="1" stopColor="#E2650F" />
        </linearGradient>
      </defs>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth={14} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="url(#ring-grad)" strokeWidth={14} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - c * v} className="transition-[stroke-dashoffset] duration-700" />
    </svg>
  );
}

function Cockpit({ onGo }: { onGo: (t: TabKey) => void }) {
  const { isManager } = useAuth();
  const [p, setP] = useState(period());
  const [editGoal, setEditGoal] = useState(false);
  const q = useQuery({ queryKey: ["cockpit", p], queryFn: () => api.get<{ data: Row }>(`/cockpit?period=${p}`).then((r) => r.data) });
  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.isError) return <ErrorState error={q.error} />;
  const d = q.data!;
  const target = Number(d.goal?.target_minor ?? 0);
  const won = Number(d.won.amount_minor);
  const pct = target ? won / target : 0;
  const f = d.funnel ?? {};
  const funnel = [
    { k: "Leads found", v: Number(f.found ?? 0) },
    { k: "Emailed", v: Number(f.emailed ?? 0) },
    { k: "Replied", v: Number(f.replied ?? 0) },
    { k: "Interested", v: Number(f.interested ?? 0) },
    { k: "Meetings", v: Number(f.meetings ?? 0) },
  ];
  const max = Math.max(1, ...funnel.map((x) => x.v));
  const avg = Number(d.goal?.avg_deal_minor ?? 0);
  const gap = Number(d.gap_minor);
  const deals = avg ? Math.ceil(gap / avg) : null;

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="relative overflow-hidden bg-night p-6 text-snow sm:p-7">
          <div className="pointer-events-none absolute -top-24 -right-24 size-80 rounded-full bg-brand-500/25 blur-3xl" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center">
            <div className="relative flex items-center justify-center">
              <BigRing pct={pct} />
              <div className="absolute text-center">
                <div className="text-3xl font-semibold tabular-nums">{target ? Math.round(pct * 100) : 0}%</div>
                <div className="text-[10px] font-semibold tracking-[0.18em] text-snow/50 uppercase">of goal</div>
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <select value={p} onChange={(e) => setP(e.target.value)} className="rounded-md bg-snow/10 px-2 py-1 text-xs text-snow ring-1 ring-snow/15 focus:outline-none [&>option]:text-navy">
                  {[-1, 0, 1].map((o) => {
                    const dt = new Date();
                    dt.setUTCDate(1);
                    dt.setUTCMonth(dt.getUTCMonth() + o);
                    const v = dt.toISOString().slice(0, 7);
                    return <option key={v} value={v}>{monthName(v)}</option>;
                  })}
                </select>
                {isManager && (
                  <button onClick={() => setEditGoal(true)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-snow/70 hover:bg-snow/10 hover:text-snow">
                    <Target className="size-3.5" /> {target ? "Edit goal" : "Set goal"}
                  </button>
                )}
              </div>
              <div className="mt-3 flex flex-wrap items-baseline gap-x-3">
                <span className="text-4xl font-semibold tracking-tight tabular-nums">{inr(won)}</span>
                <span className="text-sm text-snow/55">won of {target ? inr(target) : "— (no goal set)"}</span>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <HeroStat label="Still to close" value={inr(gap, true)} />
                <HeroStat label="Days left" value={String(d.days_left)} />
                <HeroStat label="Needed per day" value={inr(d.needed_per_day_minor, true)} />
                <HeroStat label="Deals needed" value={deals !== null ? String(deals) : "set avg deal"} hint={avg ? `at ${inr(avg, true)} avg` : undefined} />
              </div>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={Target} label="Weighted pipeline" value={inr(d.open?.weighted, true)} sub={`${d.open?.n ?? 0} open deals · ${inr(d.open?.amount, true)} total`} />
        <Kpi icon={Flame} label="Closing this month" value={inr(d.closing_this_period?.weighted, true)} sub={`${d.closing_this_period?.n ?? 0} deals expected to close`} accent />
        <Kpi icon={Inbox} label="Replies waiting for you" value={String(d.replies_to_send)} sub="Drafted answers to approve" onClick={isManager ? () => onGo("outbox") : undefined} />
        <Kpi icon={AlertTriangle} label="Overdue tasks" value={String(d.overdue_tasks)} sub="Follow-ups slipping" />
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader title="Today's moves" icon={Sparkles} subtitle="The fastest money is in deals that are already warm" />
          <ul className="divide-y divide-line">
            {Number(d.replies_to_send) > 0 && (
              <Move tone="hot" title={`Answer ${d.replies_to_send} interested ${Number(d.replies_to_send) === 1 ? "reply" : "replies"}`} body="Replies go cold within hours. Drafts are ready in the Outbox." action={isManager ? <Button size="sm" variant="primary" onClick={() => onGo("outbox")}>Open outbox</Button> : null} />
            )}
            {(d.hot_deals as Row[]).map((o) => (
              <Move key={o.id} tone="deal" title={`${o.account_name}: ${o.name}`} body={`${String(o.stage).replace(/_/g, " ")} · ${inr(o.amount_minor, true)} · ${o.probability}%${o.expected_close_date ? ` · closes ${o.expected_close_date}` : ""}`} action={<Link to={`/opportunities/${o.id}`} className="text-xs font-medium text-brand-600 hover:underline">Open</Link>} />
            ))}
            {(d.stale_deals as Row[]).map((o) => (
              <Move key={`s${o.id}`} tone="stale" title={`Nudge ${o.account_name}`} body={`${o.name} · no update ${relative(String(o.updated_at))}`} action={<Link to={`/opportunities/${o.id}`} className="text-xs font-medium text-brand-600 hover:underline">Open</Link>} />
            ))}
            {Number(f.awaiting_approval ?? 0) > 0 && isManager && (
              <Move tone="info" title={`${f.awaiting_approval} new sequences waiting for approval`} body="Approve them so the autopilot can start sending in the next window." action={<Button size="sm" onClick={() => onGo("outbox")}>Review</Button>} />
            )}
            {!Number(d.replies_to_send) && !(d.hot_deals as Row[]).length && !(d.stale_deals as Row[]).length && !Number(f.awaiting_approval ?? 0) && (
              <li className="px-4 py-8 text-center text-sm text-muted">Nothing urgent. Add deals to the pipeline or start a playbook to fill it.</li>
            )}
          </ul>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Autopilot funnel" icon={Rocket} subtitle={monthName(p)} />
          <div className="space-y-3 p-4">
            {funnel.map((x, i) => (
              <div key={x.k}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-muted">{x.k}</span>
                  <span className="font-semibold tabular-nums">
                    {x.v}
                    {i > 0 && funnel[i - 1].v > 0 && <span className="ml-1.5 font-normal text-muted">{Math.round((x.v / funnel[i - 1].v) * 100)}%</span>}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600 transition-[width] duration-500" style={{ width: `${(x.v / max) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
          {target > 0 && avg > 0 && (
            <div className="border-t border-line bg-canvas px-4 py-3 text-xs text-muted">
              <b className="text-ink">Reality check:</b> {deals} more deal{deals === 1 ? "" : "s"} at {inr(avg, true)}. At typical rates (≈25% of meetings close, ≈30% of interested replies book a call), that means about{" "}
              <b className="text-ink">{Math.ceil((deals ?? 0) / 0.25)} meetings</b> and <b className="text-ink">{Math.ceil((deals ?? 0) / 0.25 / 0.3)} interested replies</b> this month. Warm leads and referrals convert far faster than cold email.
            </div>
          )}
        </Card>
      </div>
      <GoalDialog open={editGoal} onClose={() => setEditGoal(false)} period={p} goal={d.goal} key={editGoal ? "o" : "c"} />
    </div>
  );
}

function HeroStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-snow/[0.06] px-3 py-2.5 ring-1 ring-snow/10">
      <div className="text-[10px] font-semibold tracking-[0.12em] text-snow/45 uppercase">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-[10px] text-snow/45">{hint}</div>}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub, accent, onClick }: { icon: typeof Target; label: string; value: string; sub: string; accent?: boolean; onClick?: () => void }) {
  return (
    <Card className={cn("p-4", onClick && "cursor-pointer transition hover:shadow-[var(--shadow-pop)]")} onClick={onClick}>
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className={cn("flex size-7 items-center justify-center rounded-lg", accent ? "bg-brand-500 text-snow" : "bg-brand-50 text-brand-600")}><Icon className="size-3.5" /></span>
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-muted">{sub}</div>
    </Card>
  );
}

function Move({ tone, title, body, action }: { tone: "hot" | "deal" | "stale" | "info"; title: string; body: string; action?: ReactNode }) {
  const dot = { hot: "bg-brand-500", deal: "bg-emerald-500", stale: "bg-amber-500", info: "bg-sky-500" }[tone];
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className={cn("size-2 shrink-0 rounded-full", dot)} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium">{title}</div>
        <div className="truncate text-xs text-muted">{body}</div>
      </div>
      {action}
    </li>
  );
}

function GoalDialog({ open, onClose, period: p, goal }: { open: boolean; onClose: () => void; period: string; goal: Row | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [target, setTarget] = useState(goal?.target_minor ? String(Number(goal.target_minor) / 100) : "1000000");
  const [avg, setAvg] = useState(goal?.avg_deal_minor ? String(Number(goal.avg_deal_minor) / 100) : "50000");
  const save = useMutation({
    mutationFn: () => api.put(`/revenue-goals/${p}`, { target_minor: Math.round(Number(target) * 100), avg_deal_minor: avg ? Math.round(Number(avg) * 100) : null }),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ["cockpit"] }), toast("success", "Goal saved"), onClose()),
    onError: (e) => toast("error", (e as Error).message),
  });
  return (
    <Dialog open={open} onClose={onClose} title={`Revenue goal · ${monthName(p)}`}>
      <div className="space-y-3">
        <Field label="Target (₹)" help="Revenue closed (won) in the month.">
          <input className="input" inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value.replace(/[^\d]/g, ""))} />
        </Field>
        <Field label="Average deal size (₹)" help="Used to work out how many deals, meetings and replies the goal needs.">
          <input className="input" inputMode="numeric" value={avg} onChange={(e) => setAvg(e.target.value.replace(/[^\d]/g, ""))} />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!Number(target)} onClick={() => save.mutate()}>Save goal</Button>
        </div>
      </div>
    </Dialog>
  );
}

// ─── Outbox ───
function Outbox({ q }: { q: ReturnType<typeof useQuery<Row>> }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const refresh = () => (qc.invalidateQueries({ queryKey: ["ap-outbox"] }), qc.invalidateQueries({ queryKey: ["cockpit"] }));
  const approve = useMutation({
    mutationFn: (ids: string[]) => api.post<{ data: { approved: number; blocked: number } }>("/autopilot/leads/approve", { ids }),
    onSuccess: (r) => (setSelected(new Set()), refresh(), toast("success", `${r.data.approved} sequence(s) approved${r.data.blocked ? ` · ${r.data.blocked} blocked by do-not-contact` : ""}`)),
    onError: (e) => toast("error", (e as Error).message),
  });
  if (q.isLoading) return <Skeleton className="h-80" />;
  if (q.isError) return <ErrorState error={q.error} />;
  const seqs = (q.data?.sequences ?? []) as Row[];
  const replies = (q.data?.replies ?? []) as Row[];
  if (!seqs.length && !replies.length) return <Card><EmptyState icon={MailCheck} title="Outbox is clear" body="New sequences and reply drafts appear here for your approval before anything is sent." /></Card>;
  return (
    <div className="space-y-5">
      {replies.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><Flame className="size-4 text-brand-500" /> Replies to send ({replies.length})</h2>
          {replies.map((m) => <ReplyDraft key={String(m.id)} m={m} onDone={refresh} />)}
        </section>
      )}
      {seqs.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">New sequences ({seqs.length})</h2>
            <span className="text-xs text-muted">Each sends email 1 in the next send window, then follow-ups only if there is no reply.</span>
            <div className="ml-auto flex gap-2">
              {selected.size > 0 && <Button size="sm" variant="primary" icon={Check} loading={approve.isPending} onClick={() => approve.mutate([...selected])}>Approve {selected.size} selected</Button>}
              <Button size="sm" icon={CheckCircle2} loading={approve.isPending && !selected.size} onClick={() => approve.mutate(seqs.map((s) => String(s.id)))}>Approve all</Button>
            </div>
          </div>
          {seqs.map((s) => (
            <SequenceCard
              key={String(s.id)}
              s={s}
              footerAddress={q.data?.footer_address as string | null}
              checked={selected.has(String(s.id))}
              onCheck={(v) => setSelected((x) => { const n = new Set(x); if (v) n.add(String(s.id)); else n.delete(String(s.id)); return n; })}
              onApprove={() => approve.mutate([String(s.id)])}
              onDone={refresh}
            />
          ))}
        </section>
      )}
    </div>
  );
}

function SequenceCard({ s, footerAddress, checked, onCheck, onApprove, onDone }: { s: Row; footerAddress: string | null; checked: boolean; onCheck: (v: boolean) => void; onApprove: () => void; onDone: () => void }) {
  const toast = useToast();
  const [step, setStep] = useState(0);
  const msgs = (s.messages ?? []) as Row[];
  const m = msgs[step];
  const reject = useMutation({ mutationFn: () => api.post(`/autopilot/leads/${s.id}/reject`), onSuccess: () => (toast("success", "Skipped"), onDone()) });
  const obs = ((s.research?.observations ?? []) as { text: string; source: string }[]).slice(0, 4);
  return (
    <Card className={cn("overflow-hidden", checked && "ring-2 ring-brand-500/40")}>
      <div className="flex flex-wrap items-start gap-3 border-b border-line px-4 py-3">
        <input type="checkbox" className="mt-1 accent-brand-600" checked={checked} onChange={(e) => onCheck(e.target.checked)} aria-label={`Select ${s.company_name}`} />
        <ScoreRing score={s.qualification_score as number | null} size={38} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/prospects/${s.prospect_id}`} className="font-semibold hover:underline">{String(s.company_name)}</Link>
            <Badge tone="gray">{String(s.playbook_name)}</Badge>
            {s.research?.hiring && <Badge tone="green">Hiring</Badge>}
          </div>
          <div className="text-xs text-muted">{String(s.email)} {s.geography ? `· ${s.geography}` : ""} {s.website ? <>· <a href={String(s.website)} target="_blank" rel="noreferrer noopener" className="hover:underline">{String(s.website).replace(/^https?:\/\//, "")}</a></> : null}</div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" icon={X} loading={reject.isPending} onClick={() => reject.mutate()}>Skip</Button>
          <Button size="sm" variant="primary" icon={Check} onClick={onApprove}>Approve</Button>
        </div>
      </div>
      {obs.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-line bg-canvas px-4 py-2">
          {obs.map((o, i) => (
            <a key={i} href={o.source.startsWith("http") ? o.source : undefined} target="_blank" rel="noreferrer noopener" title={`Source: ${o.source}`} className="rounded-full bg-white px-2 py-0.5 text-[11px] text-muted ring-1 ring-line hover:text-ink">
              {o.text}
            </a>
          ))}
        </div>
      )}
      <div className="flex gap-1 px-4 pt-3">
        {msgs.map((x, i) => (
          <button key={String(x.id)} onClick={() => setStep(i)} className={cn("rounded-md px-2.5 py-1 text-xs font-medium", i === step ? "bg-ink text-white" : "text-muted hover:bg-slate-100")}>
            {i === 0 ? "Email 1" : `Follow-up ${i}`}
          </button>
        ))}
        <span className="ml-auto self-center text-[11px] text-muted">{m?.generator === "template" ? "Template (add a Claude key for AI-written emails)" : m?.generator ? "Written by Claude" : ""}</span>
      </div>
      {m && <MessageEditor key={String(m.id)} m={m} footer={footerAddress} />}
    </Card>
  );
}

function MessageEditor({ m, footer }: { m: Row; footer: string | null }) {
  const toast = useToast();
  const [subject, setSubject] = useState(String(m.subject ?? ""));
  const [body, setBody] = useState(String(m.body ?? ""));
  const dirty = subject !== m.subject || body !== m.body;
  const save = useMutation({ mutationFn: () => api.patch(`/autopilot/messages/${m.id}`, { subject, body }), onSuccess: () => toast("success", "Saved"), onError: (e) => toast("error", (e as Error).message) });
  return (
    <div className="space-y-2 p-4">
      <input className="input font-medium" value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" />
      <textarea className="input h-44 py-2 leading-relaxed" value={body} onChange={(e) => setBody(e.target.value)} aria-label="Email body" />
      <div className="flex items-start gap-3">
        <p className="flex-1 text-[11px] whitespace-pre-line text-muted">
          {"Added automatically:\n"}Not the right time? Just reply "no thanks" and I won't email again.{footer ? `\n${footer}` : "\n⚠ Set your business postal address in Settings → Configuration"}
        </p>
        {dirty && <Button size="sm" icon={Pencil} loading={save.isPending} onClick={() => save.mutate()}>Save edits</Button>}
      </div>
    </div>
  );
}

function ReplyDraft({ m, onDone }: { m: Row; onDone: () => void }) {
  const toast = useToast();
  const [subject, setSubject] = useState(String(m.subject ?? ""));
  const [body, setBody] = useState(String(m.body ?? ""));
  const send = useMutation({ mutationFn: () => api.post(`/autopilot/messages/${m.id}/send`, { subject, body }), onSuccess: () => (toast("success", "Reply sent"), onDone()), onError: (e) => toast("error", (e as Error).message) });
  const discard = useMutation({ mutationFn: () => api.post(`/autopilot/messages/${m.id}/discard`), onSuccess: onDone });
  return (
    <Card className="overflow-hidden ring-1 ring-brand-300/50">
      <div className="flex items-center gap-2 border-b border-line bg-brand-50/60 px-4 py-2.5">
        <Flame className="size-4 text-brand-500" />
        <Link to={`/prospects/${m.prospect_id}`} className="font-semibold hover:underline">{String(m.company_name)}</Link>
        <ClassBadge s={m.their_class as string | null} />
        <span className="ml-auto text-xs text-muted">{String(m.to_email)}</span>
      </div>
      <div className="grid gap-0 lg:grid-cols-2">
        <div className="border-b border-line p-4 lg:border-r lg:border-b-0">
          <div className="mb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">They wrote</div>
          <p className="text-[13px] whitespace-pre-line">{String(m.their_reply ?? "")}</p>
        </div>
        <div className="space-y-2 p-4">
          <div className="text-[11px] font-semibold tracking-wide text-muted uppercase">Your reply (drafted, edit freely)</div>
          <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Reply subject" />
          <textarea className="input h-36 py-2" value={body} onChange={(e) => setBody(e.target.value)} aria-label="Reply body" />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" loading={discard.isPending} onClick={() => discard.mutate()}>Discard</Button>
            <Button size="sm" variant="primary" icon={Send} loading={send.isPending} onClick={() => send.mutate()}>Send now</Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ─── Replies ───
function Replies() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ap-inbox"], queryFn: () => api.get<{ data: Row[] }>("/autopilot/inbox").then((r) => r.data), refetchInterval: 60_000 });
  const mark = useMutation({ mutationFn: ({ lead, stage }: { lead: string; stage: string }) => api.post(`/autopilot/leads/${lead}/stage`, { stage }), onSuccess: () => qc.invalidateQueries({ queryKey: ["ap-inbox"] }) });
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.isError) return <ErrorState error={q.error} />;
  if (!q.data?.length) return <Card><EmptyState icon={Inbox} title="No replies yet" body="Replies to autopilot emails show up here within 15 minutes, sorted by what they mean." /></Card>;
  return (
    <Card>
      <ul className="divide-y divide-line">
        {q.data.map((m) => (
          <li key={String(m.id)} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link to={`/prospects/${m.prospect_id}`} className="font-medium hover:underline">{String(m.company_name)}</Link>
                <ClassBadge s={m.classification as string} />
                <StageBadge s={String(m.lead_stage)} />
                <span className="text-xs text-muted">{relative(String(m.received_at))}</span>
              </div>
              <p className="mt-1 line-clamp-3 text-[13px] whitespace-pre-line text-muted">{String(m.body ?? "")}</p>
            </div>
            {!["opt_out", "bounce", "out_of_office"].includes(String(m.classification)) && (
              <div className="flex shrink-0 gap-1.5">
                <Button size="sm" onClick={() => mark.mutate({ lead: String(m.lead_id), stage: "meeting" })}>Meeting booked</Button>
                <Button size="sm" variant="ghost" onClick={() => mark.mutate({ lead: String(m.lead_id), stage: "won" })}>Won</Button>
                <Button size="sm" variant="ghost" onClick={() => mark.mutate({ lead: String(m.lead_id), stage: "lost" })}>Lost</Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ─── Leads ───
const STAGE_FILTERS: { label: string; value: string }[] = [
  { label: "All", value: "" },
  { label: "Researching", value: "found,researched" },
  { label: "Awaiting approval", value: "drafted" },
  { label: "In sequence", value: "approved,in_sequence" },
  { label: "Replied", value: "replied,interested,meeting" },
  { label: "Won", value: "won" },
  { label: "Stopped", value: "opted_out,bounced,lost,skipped,no_email,finished" },
];

function Leads() {
  const [stage, setStage] = useState("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["ap-leads", stage, search], queryFn: () => api.get<{ data: Row[] }>(`/autopilot/leads?stage=${encodeURIComponent(stage)}&q=${encodeURIComponent(search)}`).then((r) => r.data) });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {STAGE_FILTERS.map((f) => (
          <button key={f.label} onClick={() => setStage(f.value)} className={cn("rounded-full px-3 py-1 text-xs font-medium ring-1", stage === f.value ? "bg-ink text-white ring-ink" : "text-muted ring-line hover:text-ink")}>
            {f.label}
          </button>
        ))}
        <div className="relative ml-auto w-full max-w-xs">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted" />
          <input className="input pl-8" placeholder="Search company or email" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <Card className="overflow-x-auto">
        {q.isLoading ? <Skeleton className="m-4 h-40" /> : !q.data?.length ? <EmptyState icon={CircleDashed} title="No leads here" compact /> : (
          <table className="w-full">
            <thead className="border-b border-line bg-slate-50/70"><tr><th className="th">Company</th><th className="th">Stage</th><th className="th">Email</th><th className="th">Score</th><th className="th">Playbook</th><th className="th">Updated</th></tr></thead>
            <tbody className="divide-y divide-line">
              {q.data.map((l) => (
                <tr key={String(l.id)} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen(String(l.id))}>
                  <td className="td font-medium">{String(l.company_name)}<div className="text-[11px] font-normal text-muted">{String(l.geography ?? "")}</div></td>
                  <td className="td"><StageBadge s={String(l.stage)} />{l.skip_reason ? <div className="mt-0.5 max-w-[220px] truncate text-[11px] text-muted">{String(l.skip_reason)}</div> : null}</td>
                  <td className="td text-muted">{String(l.email ?? "—")}</td>
                  <td className="td">{l.qualification_score ?? "—"}</td>
                  <td className="td text-muted">{String(l.playbook_name)}</td>
                  <td className="td text-muted">{relative(String(l.updated_at))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <LeadDetail id={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function LeadDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ["ap-lead", id], enabled: !!id, queryFn: () => api.get<{ data: Row }>(`/autopilot/leads/${id}`).then((r) => r.data) });
  const l = q.data;
  return (
    <SlideOver open={!!id} onClose={onClose} title={l ? String(l.company_name) : "Lead"} subtitle={l ? `${STAGE_LABEL[String(l.stage)]?.[0] ?? l.stage} · ${l.email ?? "no email"}` : undefined}>
      {!l ? <Skeleton className="h-60" /> : (
        <div className="space-y-4">
          {l.research && (
            <section>
              <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">What the research found</h3>
              <ul className="space-y-1 text-[13px]">
                {((l.research.observations ?? []) as { text: string; source: string }[]).map((o, i) => <li key={i}>• {o.text} <span className="text-[11px] text-muted">({o.source})</span></li>)}
                {l.research.hiring && <li>• They appear to be hiring (careers page found)</li>}
                {(l.research.tech ?? []).length > 0 && <li>• Tech: {(l.research.tech as string[]).join(", ")}</li>}
              </ul>
            </section>
          )}
          <section>
            <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">Conversation</h3>
            <div className="space-y-2">
              {(l.messages as Row[]).map((m) => (
                <div key={String(m.id)} className={cn("rounded-lg p-3 text-[13px] ring-1", m.direction === "in" ? "bg-brand-50/60 ring-brand-200" : "bg-white ring-line")}>
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                    <b className="text-ink">{m.direction === "in" ? "Them" : m.kind === "reply" ? "Our reply" : `Email ${m.step}`}</b>
                    <Badge tone={m.status === "sent" || m.status === "received" ? "green" : m.status === "failed" ? "red" : "gray"}>{String(m.status).replace(/_/g, " ")}</Badge>
                    {m.classification && <ClassBadge s={String(m.classification)} />}
                    <span>{dateTime(String(m.sent_at ?? m.received_at ?? m.scheduled_for ?? m.created_at))}</span>
                  </div>
                  <div className="font-medium">{String(m.subject ?? "")}</div>
                  <p className="mt-1 whitespace-pre-line text-muted">{String(m.body ?? "")}</p>
                  {m.error && <p className="mt-1 text-xs text-red-600">{String(m.error)}</p>}
                </div>
              ))}
            </div>
          </section>
          <Link to={`/prospects/${l.prospect_id}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">Open prospect <ArrowRight className="size-3" /></Link>
        </div>
      )}
    </SlideOver>
  );
}

// ─── Playbooks ───
function Playbooks() {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const q = useQuery({ queryKey: ["ap-overview"], queryFn: () => api.get<{ data: Row }>("/autopilot/overview").then((r) => r.data) });
  const status = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.post(`/autopilot/playbooks/${id}/status`, { status }),
    onSuccess: (_r, v) => (qc.invalidateQueries({ queryKey: ["ap-overview"] }), toast("success", v.status === "active" ? "Autopilot started. First run is underway." : "Paused")),
    onError: (e) => toast("error", (e as Error).message),
  });
  const run = useMutation({ mutationFn: (id: string) => api.post(`/autopilot/playbooks/${id}/run`), onSuccess: () => toast("success", "Run started. Check Leads and the Outbox in a minute."), onError: (e) => toast("error", (e as Error).message) });
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.isError) return <ErrorState error={q.error} />;
  const pbs = q.data!.playbooks as Row[];
  return (
    <div className="space-y-3">
      <div className="flex items-center">
        <p className="text-xs text-muted">A playbook is one target market + one offer. Start with one niche you already win in.</p>
        <Button className="ml-auto" variant="primary" icon={Plus} onClick={() => setEditing("new")}>New playbook</Button>
      </div>
      {!pbs.length && <Card><EmptyState icon={Rocket} title="No playbooks yet" body="Create one: who to target (e.g. dentists in Kolkata), what you offer, and how many leads a day." action={<Button variant="primary" icon={Plus} onClick={() => setEditing("new")}>New playbook</Button>} /></Card>}
      <div className="grid gap-3 lg:grid-cols-2">
        {pbs.map((p) => {
          const st = (p.stages ?? {}) as Record<string, number>;
          const n = (...k: string[]) => k.reduce((a, x) => a + Number(st[x] ?? 0), 0);
          const active = p.status === "active";
          return (
            <Card key={String(p.id)} className="flex flex-col p-4">
              <div className="flex items-start gap-3">
                <span className={cn("mt-0.5 flex size-9 items-center justify-center rounded-xl", active ? "bg-brand-500 text-snow" : "bg-slate-100 text-muted")}><Rocket className="size-4" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><span className="font-semibold">{String(p.name)}</span><Badge tone={active ? "green" : "amber"}>{active ? "Running" : "Paused"}</Badge></div>
                  <div className="mt-0.5 truncate text-xs text-muted">{(JSON.parse(String(p.searches || "[]")) as Row[]).map((s) => `${s.query}${s.location ? ` · ${s.location}` : ""}`).join(" | ") || (p.use_existing ? "Existing CRM prospects" : "No searches set")}</div>
                  <div className="text-xs text-muted">From {String(p.mailbox_email ?? "— no mailbox")} · {String(p.daily_new_leads)} new leads/day · {p.require_approval ? "approval required" : "sends without approval"}</div>
                </div>
              </div>
              {p.paused_reason && <p className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800">{String(p.paused_reason)}</p>}
              <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                {[["Researching", n("found", "researched")], ["To approve", n("drafted")], ["Sending", n("approved", "in_sequence")], ["Replied", n("replied", "interested", "meeting", "won")]].map(([k, v]) => (
                  <div key={String(k)} className="rounded-lg bg-canvas py-2"><div className="text-lg font-semibold tabular-nums">{v}</div><div className="text-[10px] text-muted">{k}</div></div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant={active ? "secondary" : "primary"} icon={active ? Pause : Play} loading={status.isPending && status.variables?.id === p.id} onClick={() => status.mutate({ id: String(p.id), status: active ? "paused" : "active" })}>{active ? "Pause" : "Start"}</Button>
                <Button size="sm" icon={RefreshCw} loading={run.isPending && run.variables === p.id} onClick={() => run.mutate(String(p.id))}>Run now</Button>
                <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(p)}>Edit</Button>
              </div>
            </Card>
          );
        })}
      </div>
      {editing && <PlaybookForm pb={editing === "new" ? null : editing} mailboxes={q.data!.mailboxes as Row[]} onClose={() => setEditing(null)} />}
    </div>
  );
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function PlaybookForm({ pb, mailboxes, onClose }: { pb: Row | null; mailboxes: Row[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const init = useMemo(() => {
    const w = pb ? JSON.parse(String(pb.send_window)) : { start: "10:00", end: "18:00", days: [1, 2, 3, 4, 5, 6], tz: "Asia/Kolkata" };
    return {
      name: String(pb?.name ?? ""),
      searches: pb ? (JSON.parse(String(pb.searches || "[]")) as { query: string; location: string }[]) : [{ query: "dental clinic", location: "Kolkata" }],
      use_existing: !!pb?.use_existing,
      service_fit: String(pb?.service_fit ?? ""),
      offer: String(pb?.offer ?? "We build fast, mobile-first websites and run local SEO so clinics like yours get found on Google and turn visitors into booked appointments."),
      entry_offer: String(pb?.entry_offer ?? "a free 10-minute video audit of your website and Google listing"),
      booking_url: String(pb?.booking_url ?? ""),
      signature: String(pb?.signature ?? ""),
      min_score: Number(pb?.min_score ?? 35),
      daily_new_leads: Number(pb?.daily_new_leads ?? 15),
      follow_up_days: pb ? (JSON.parse(String(pb.follow_up_days)) as number[]) : [3, 5],
      require_approval: pb ? !!pb.require_approval : true,
      window: w as { start: string; end: string; days: number[]; tz: string },
      mailbox_id: String(pb?.mailbox_id ?? mailboxes[0]?.id ?? ""),
    };
  }, [pb, mailboxes]);
  const [f, setF] = useState(init);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name, searches: f.searches.filter((s) => s.query.trim()), use_existing: f.use_existing, service_fit: f.service_fit || null, offer: f.offer, entry_offer: f.entry_offer || null,
        booking_url: f.booking_url || null, signature: f.signature || null, min_score: f.min_score, daily_new_leads: f.daily_new_leads, follow_up_days: f.follow_up_days,
        require_approval: f.require_approval, send_window: f.window, mailbox_id: f.mailbox_id || null,
      };
      return pb ? api.put(`/autopilot/playbooks/${pb.id}`, body) : api.post("/autopilot/playbooks", body);
    },
    onSuccess: () => (qc.invalidateQueries({ queryKey: ["ap-overview"] }), toast("success", pb ? "Playbook saved" : "Playbook created. Press Start when ready."), onClose()),
    onError: (e) => toast("error", (e as Error).message),
  });
  return (
    <SlideOver open onClose={onClose} title={pb ? "Edit playbook" : "New playbook"} subtitle="Who to target, what to offer, how fast" width="max-w-2xl"
      footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.name || f.offer.length < 20} onClick={() => save.mutate()}>{pb ? "Save" : "Create playbook"}</Button></div>}>
      <div className="space-y-4">
        <Field label="Name" required><input className="input" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Dentists · Kolkata · Website + SEO" /></Field>
        <div>
          <div className="label">Where to find leads (Google Places searches)</div>
          <div className="space-y-2">
            {f.searches.map((s, i) => (
              <div key={i} className="flex gap-2">
                <input className="input" placeholder="Business type, e.g. dental clinic" value={s.query} onChange={(e) => set("searches", f.searches.map((x, j) => (j === i ? { ...x, query: e.target.value } : x)))} />
                <input className="input" placeholder="City / area" value={s.location} onChange={(e) => set("searches", f.searches.map((x, j) => (j === i ? { ...x, location: e.target.value } : x)))} />
                <Button variant="ghost" icon={X} aria-label="Remove search" onClick={() => set("searches", f.searches.filter((_, j) => j !== i))} />
              </div>
            ))}
            <Button size="sm" icon={Plus} onClick={() => set("searches", [...f.searches, { query: "", location: "" }])}>Add search</Button>
          </div>
          <label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" className="accent-brand-600" checked={f.use_existing} onChange={(e) => set("use_existing", e.target.checked)} /> Also work through qualified prospects already in the CRM (including Harvey's)</label>
        </div>
        <Field label="What you offer them" required help="One or two sentences, in plain words. The AI uses this plus each lead's research."><textarea className="input h-24 py-2" value={f.offer} onChange={(e) => set("offer", e.target.value)} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Low-commitment ask" help="Offering something useful gets far more replies than asking for a call."><input className="input" value={f.entry_offer} onChange={(e) => set("entry_offer", e.target.value)} /></Field>
          <Field label="Booking link" help="Calendly, Google Calendar booking page…"><input className="input" value={f.booking_url} onChange={(e) => set("booking_url", e.target.value)} placeholder="https://" /></Field>
        </div>
        <Field label="Signature" help="Your name and role, e.g. 'Rati · Growth Lead, Gexart'. The first word is used to sign emails."><textarea className="input h-16 py-2" value={f.signature} onChange={(e) => set("signature", e.target.value)} /></Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Sending mailbox"><Select value={f.mailbox_id} onChange={(e) => set("mailbox_id", e.target.value)} options={mailboxes.map((m) => ({ value: String(m.id), label: String(m.email) }))} placeholder="Connect one in Setup" /></Field>
          <Field label="New leads per day"><input className="input" type="number" min={1} max={100} value={f.daily_new_leads} onChange={(e) => set("daily_new_leads", Number(e.target.value))} /></Field>
          <Field label="Minimum lead score"><input className="input" type="number" min={0} max={100} value={f.min_score} onChange={(e) => set("min_score", Number(e.target.value))} /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Follow-up 1 after (days)"><input className="input" type="number" min={1} max={30} value={f.follow_up_days[0]} onChange={(e) => set("follow_up_days", [Number(e.target.value), f.follow_up_days[1]])} /></Field>
          <Field label="Follow-up 2 after (days)"><input className="input" type="number" min={1} max={30} value={f.follow_up_days[1]} onChange={(e) => set("follow_up_days", [f.follow_up_days[0], Number(e.target.value)])} /></Field>
        </div>
        <div>
          <div className="label">Send window (recipient business hours, {f.window.tz})</div>
          <div className="flex flex-wrap items-center gap-2">
            <input className="input w-28" type="time" value={f.window.start} onChange={(e) => set("window", { ...f.window, start: e.target.value })} />
            <span className="text-xs text-muted">to</span>
            <input className="input w-28" type="time" value={f.window.end} onChange={(e) => set("window", { ...f.window, end: e.target.value })} />
            <div className="flex gap-1">
              {DAYS.map((d, i) => (
                <button key={d} type="button" onClick={() => set("window", { ...f.window, days: f.window.days.includes(i) ? f.window.days.filter((x) => x !== i) : [...f.window.days, i].sort() })} className={cn("rounded-md px-2 py-1 text-[11px] font-medium ring-1", f.window.days.includes(i) ? "bg-ink text-white ring-ink" : "text-muted ring-line")}>
                  {d}
                </button>
              ))}
            </div>
          </div>
        </div>
        <label className="flex items-start gap-2 rounded-lg bg-canvas p-3 text-xs">
          <input type="checkbox" className="mt-0.5 accent-brand-600" checked={f.require_approval} onChange={(e) => set("require_approval", e.target.checked)} />
          <span><b>Approve every sequence before it sends</b> (recommended). Replies are always held for your approval regardless.</span>
        </label>
      </div>
    </SlideOver>
  );
}

// ─── Setup ───
function Check1({ ok, title, body, action }: { ok: boolean; title: string; body: ReactNode; action?: ReactNode }) {
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted" />}
      <div className="min-w-0 flex-1"><div className="text-[13px] font-medium">{title}</div><div className="text-xs text-muted">{body}</div></div>
      {action}
    </li>
  );
}

function Setup() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["ap-overview"], queryFn: () => api.get<{ data: Row }>("/autopilot/overview").then((r) => r.data) });
  const connect = useMutation({ mutationFn: () => api.get<{ data: { url: string } }>("/mailboxes/google/start"), onSuccess: (r) => window.location.assign(r.data.url), onError: (e) => toast("error", (e as Error).message) });
  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.isError) return <ErrorState error={q.error} />;
  const d = q.data!;
  const ch = d.checks as Record<string, boolean>;
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card className="xl:col-span-2">
        <CardHeader title="Launch checklist" icon={ShieldCheck} subtitle="Everything the autopilot needs to send safely" />
        <ul className="divide-y divide-line">
          <Check1 ok={ch.google_client} title="Google OAuth client" body={<>Create it in Google Cloud (Gmail API enabled, consent screen <b>Internal</b>), with this redirect URI: <code className="break-all">{String(d.redirect_uri)}</code> <CopyButton text={String(d.redirect_uri)} label="Copy" /></>} action={<Link to="/settings?tab=config" className="text-xs font-medium text-brand-600 hover:underline">Configure</Link>} />
          <Check1 ok={ch.mailbox} title="Cold-email mailbox connected" body="A Google Workspace mailbox on a separate domain (e.g. gexart-mail.com), warmed up for 2–3 weeks. New mailboxes start at 5 emails/day and ramp up weekly." action={isAdmin && ch.google_client ? <Button size="sm" variant="primary" icon={Mail} loading={connect.isPending} onClick={() => connect.mutate()}>Connect Google mailbox</Button> : null} />
          <Check1 ok={ch.postal_address} title="Business postal address" body="Required in every cold email, next to the opt-out line." action={<Link to="/settings?tab=config" className="text-xs font-medium text-brand-600 hover:underline">Add</Link>} />
          <Check1 ok={ch.claude} title="Claude API key (recommended)" body="Writes a personal email for each business from its research, and drafts answers to replies. Without it, a template is used." action={<Link to="/settings?tab=config" className="text-xs font-medium text-brand-600 hover:underline">Add</Link>} />
          <Check1 ok={ch.places} title="Google Places key (for finding new leads)" body="Without it, playbooks can still work through prospects already in the CRM or from Harvey." action={<Link to="/settings?tab=config" className="text-xs font-medium text-brand-600 hover:underline">Add</Link>} />
        </ul>
      </Card>
      <Mailboxes boxes={d.mailboxes as Row[]} onChange={() => qc.invalidateQueries({ queryKey: ["ap-overview"] })} />
      <HarveyBridge />
      <DoNotContact />
    </div>
  );
}

function Mailboxes({ boxes, onChange }: { boxes: Row[]; onChange: () => void }) {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const test = useMutation({ mutationFn: (id: string) => api.post<{ data: { email: string } }>(`/mailboxes/${id}/test`), onSuccess: (r) => (toast("success", `${r.data.email} is working`), onChange()), onError: (e) => toast("error", (e as Error).message) });
  const del = useMutation({ mutationFn: (id: string) => api.del(`/mailboxes/${id}`), onSuccess: () => (toast("success", "Disconnected"), onChange()) });
  const upd = useMutation({ mutationFn: ({ id, body }: { id: string; body: Row }) => api.patch(`/mailboxes/${id}`, body), onSuccess: () => (toast("success", "Saved"), onChange()), onError: (e) => toast("error", (e as Error).message) });
  return (
    <Card>
      <CardHeader title="Sending mailboxes" icon={Mail} />
      {!boxes.length ? <EmptyState icon={Mail} title="No mailbox connected" body="Connect one from the checklist above." compact /> : (
        <ul className="divide-y divide-line">
          {boxes.map((m) => (
            <li key={String(m.id)} className="space-y-2 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="font-medium">{String(m.email)}</span>
                <Badge tone={m.status === "active" ? "green" : m.status === "error" ? "red" : "amber"}>{String(m.status)}</Badge>
                <span className="ml-auto text-xs text-muted">{String(m.sent_today)} sent in 24h</span>
              </div>
              {m.last_error && <p className="text-xs text-red-600">{String(m.last_error)}</p>}
              {isAdmin && <MailboxSettings m={m} onSave={(body) => upd.mutate({ id: String(m.id), body })} saving={upd.isPending} />}
              {isAdmin && (
                <div className="flex gap-2">
                  <Button size="sm" loading={test.isPending} onClick={() => test.mutate(String(m.id))}>Test</Button>
                  <Button size="sm" variant="ghost" icon={Trash2} loading={del.isPending} onClick={() => del.mutate(String(m.id))}>Disconnect</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function MailboxSettings({ m, onSave, saving }: { m: Row; onSave: (b: Row) => void; saving: boolean }) {
  const [name, setName] = useState(String(m.from_name ?? ""));
  const [cap, setCap] = useState(Number(m.daily_cap));
  const [warm, setWarm] = useState(String(m.warmup_started_on ?? ""));
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <input className="input col-span-2" placeholder="From name, e.g. Rati from Gexart" value={name} onChange={(e) => setName(e.target.value)} aria-label="From name" />
      <input className="input" type="number" min={1} max={200} value={cap} onChange={(e) => setCap(Number(e.target.value))} aria-label="Daily cap" title="Daily cap" />
      <input className="input" type="date" value={warm} onChange={(e) => setWarm(e.target.value)} aria-label="Warm-up start" title="Warm-up started on (caps ramp up from 5/day)" />
      <Button size="sm" className="col-span-2 sm:col-span-4 sm:justify-self-start" loading={saving} onClick={() => onSave({ from_name: name || null, daily_cap: cap, warmup_started_on: warm || null, status: m.status === "paused" ? "paused" : "active" })}>Save mailbox settings</Button>
    </div>
  );
}

function HarveyBridge() {
  const toast = useToast();
  const [token, setToken] = useState<string | null>(null);
  const create = useMutation({ mutationFn: () => api.post<{ data: { token: string } }>("/devices", { name: "Harvey on my PC", kind: "harvey" }), onSuccess: (r) => setToken(r.data.token), onError: (e) => toast("error", (e as Error).message) });
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return (
    <Card>
      <CardHeader title="Harvey bridge" icon={KeyRound} subtitle="Sync the open-source Harvey agent running on your PC" />
      <div className="space-y-3 p-4 text-[13px]">
        <p className="text-muted">Harvey's leads become CRM prospects, its replies and meetings land on timelines with tasks, and opt-outs are shared both ways. Setup steps are in <code>integrations/harvey/README.md</code>.</p>
        <Button size="sm" variant="primary" icon={KeyRound} loading={create.isPending} onClick={() => create.mutate()}>Create bridge token</Button>
        {token && (
          <div className="space-y-1.5 rounded-lg border border-line bg-canvas p-3 text-xs">
            <div className="font-medium">Shown once. Put these in <code>integrations\harvey\.env</code>:</div>
            <div className="flex items-center gap-2"><code className="flex-1 truncate rounded bg-white px-2 py-1">GEXART_CRM_URL={origin}</code><CopyButton text={`GEXART_CRM_URL=${origin}`} label="Copy" /></div>
            <div className="flex items-center gap-2"><code className="flex-1 truncate rounded bg-white px-2 py-1">GEXART_CRM_TOKEN={token}</code><CopyButton text={`GEXART_CRM_TOKEN=${token}`} label="Copy" /></div>
          </div>
        )}
      </div>
    </Card>
  );
}

function DoNotContact() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState("");
  const [reason, setReason] = useState("manual");
  const q = useQuery({ queryKey: ["dnc"], queryFn: () => api.get<{ data: Row[] }>("/do-not-contact").then((r) => r.data) });
  const add = useMutation({
    mutationFn: () => api.post("/do-not-contact", { values: text.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean), reason }),
    onSuccess: () => (setText(""), qc.invalidateQueries({ queryKey: ["dnc"] }), toast("success", "Added")),
    onError: (e) => toast("error", (e as Error).message),
  });
  const del = useMutation({ mutationFn: (v: string) => api.del(`/do-not-contact/${encodeURIComponent(v)}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["dnc"] }), onError: (e) => toast("error", (e as Error).message) });
  return (
    <Card className="xl:col-span-2">
      <CardHeader title="Do not contact" icon={Ban} subtitle="Checked before every send, by the autopilot and by Harvey. Opt-outs are permanent." />
      <div className="flex flex-col gap-2 border-b border-line p-4 sm:flex-row">
        <input className="input" placeholder="Emails or domains (customers, competitors…), separated by commas" value={text} onChange={(e) => setText(e.target.value)} />
        <Select className="sm:w-40" value={reason} onChange={(e) => setReason(e.target.value)} options={[{ value: "manual", label: "Manual" }, { value: "customer", label: "Customer" }, { value: "competitor", label: "Competitor" }, { value: "opt_out", label: "Opted out" }]} />
        <Button variant="primary" disabled={!text.trim()} loading={add.isPending} onClick={() => add.mutate()}>Add</Button>
      </div>
      <ul className="max-h-80 divide-y divide-line overflow-y-auto">
        {q.data?.map((r) => (
          <li key={String(r.value)} className="flex items-center gap-3 px-4 py-2 text-[13px]">
            <span className="flex-1 truncate font-mono text-xs">{String(r.value)}</span>
            <Badge tone={r.reason === "opt_out" || r.reason === "bounce" ? "red" : "gray"}>{String(r.reason).replace("_", " ")}</Badge>
            <span className="w-24 text-right text-[11px] text-muted">{String(r.source ?? "")}</span>
            {isAdmin && !["opt_out", "complaint"].includes(String(r.reason)) && <button aria-label={`Remove ${r.value}`} className="text-muted hover:text-red-600" onClick={() => del.mutate(String(r.value))}><X className="size-3.5" /></button>}
          </li>
        ))}
        {q.data && !q.data.length && <li className="px-4 py-6 text-center text-xs text-muted">Empty. Opt-outs and bounces are added automatically.</li>}
      </ul>
    </Card>
  );
}

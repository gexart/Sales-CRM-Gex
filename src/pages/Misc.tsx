import { useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, KeyRound, Package, Plug, Plus, ShieldCheck, UserCog, Users } from "lucide-react";
import { api, ApiError, type Row } from "../lib/api";
import { useAuth } from "../lib/auth";
import * as E from "../../shared/enums";
import { dateTime, money, moneyList, pct, relative } from "../lib/format";
import { GxMark, Logo, PageHeader } from "../components/layout";
import { Badge, Button, Card, CardHeader, Dialog, ErrorState, Field, Select, Skeleton, StatusBadge, Tabs, useToast } from "../components/ui";
import { Bars, PeriodPicker, useDashboard, type PeriodKey } from "./Dashboard";
import { DevicesSettings } from "./Calls";

// ─── Sign-in & first-run setup ───
export function AuthPage({ mode }: { mode: "login" | "setup" }) {
  const { refresh } = useAuth();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(mode === "setup" ? "/auth/setup" : "/auth/login", mode === "setup" ? form : { email: form.email, password: form.password });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError && err.code === "validation_error" ? Object.values(err.fieldErrors).join(" ") || err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid min-h-dvh bg-canvas lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-night p-12 text-white lg:flex lg:flex-col">
        <Logo dark />
        <GxMark tile={false} className="pointer-events-none absolute -right-24 bottom-[-6%] w-[78%] text-white/[0.04]" />
        <div className="relative mt-auto max-w-md">
          <p className="text-[11px] font-semibold tracking-[0.2em] text-white/40 uppercase">Gexart Sales CRM</p>
          <h2 className="mt-3 text-3xl leading-tight font-semibold">Every account, audit, pitch and call in one place.</h2>
          <p className="mt-3 text-sm text-white/55">Research prospects, run audits, send proposals and track every deal from first touch to close.</p>
        </div>
      </aside>
      <main className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          <h1 className="text-xl font-semibold">{mode === "setup" ? "Create the administrator account" : "Welcome back"}</h1>
          <p className="mt-1 text-[13px] text-muted">
            {mode === "setup" ? "No users exist yet. This first account becomes the administrator; setup closes once it is created." : "Sign in to the Gexart sales workspace. Access is by invitation."}
          </p>
          <form onSubmit={submit} className="mt-7 space-y-4">
            {mode === "setup" && (
              <Field label="Full name">
                <input className="input h-10" autoComplete="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
            )}
            <Field label="Work email">
              <input className="input h-10" type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Password" help={mode === "setup" ? "At least 10 characters." : undefined}>
              <input className="input h-10" type="password" autoComplete={mode === "setup" ? "new-password" : "current-password"} required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </Field>
            {error && <p className="rounded-md bg-red-50 px-2.5 py-2 text-xs text-red-700">{error}</p>}
            <Button type="submit" variant="primary" loading={busy} className="h-10 w-full">
              {mode === "setup" ? "Create administrator" : "Sign in"}
            </Button>
          </form>
          <p className="mt-10 text-[11px] text-stone-400">© {new Date().getFullYear()} Gexart</p>
        </div>
      </main>
    </div>
  );
}

// ─── Reports ───
function Metric({ label, value, formula }: { label: string; value: ReactNode; formula: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-[11px] text-muted">{formula}</div>
    </Card>
  );
}

export function ReportsPage() {
  const [period, setPeriod] = useState<PeriodKey>("quarter");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const q = useDashboard(period, custom);
  const d = q.data;
  const funnel = (s: string) => Number(d?.prospect_funnel.find((f: Row) => f.status === s)?.n ?? 0);
  const qualifiedOrConverted = funnel("qualified") + funnel("converted");
  const decided = qualifiedOrConverted + funnel("disqualified");
  return (
    <div className="pb-10">
      <PageHeader title="Reports" icon={BarChart3} subtitle="Every figure is computed from stored records; formulas are shown under each metric." actions={<PeriodPicker value={period} onChange={setPeriod} custom={custom} onCustom={setCustom} />} />
      <div className="space-y-4 px-4 sm:px-6">
        {q.isError && <ErrorState error={q.error} />}
        {!d ? (
          <Skeleton className="h-64" />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="Win rate (period)" value={pct(d.kpis.win_rate)} formula={`Closed-won ÷ all closed in period (${d.kpis.won_count} / ${d.kpis.closed_count})`} />
              <Metric label="Qualification rate (all-time)" value={pct(decided ? qualifiedOrConverted / decided : null)} formula="(Qualified + converted) ÷ prospects with a qualification decision" />
              <Metric label="Closed-won value (period)" value={moneyList(d.kpis.won, false)} formula="Sum of deal value where stage = Closed won and closed in period" />
              <Metric label="Open pipeline" value={moneyList(d.kpis.pipeline, false)} formula="Sum of deal value for stages before Closed" />
              <Metric label="Messages sent (period)" value={d.kpis.messages_sent} formula={`Outreach confirmed as sent in period. Drafts are never counted (${d.kpis.messages_unsent} awaiting send).`} />
              <Metric label="Reply rate (period)" value={pct(d.kpis.reply_rate)} formula={`Replied ÷ messages sent in period (${d.kpis.messages_replied} / ${d.kpis.messages_sent}); replies are recorded by users`} />
              <Metric label="Bounces (period)" value={d.kpis.messages_bounced} formula="Sent messages recorded as bounced" />
              <Metric label="Outreach activity (period)" value={d.kpis.outreach_activities} formula="All logged calls, emails, LinkedIn and WhatsApp activities" />
              <Metric label="Overdue follow-ups" value={d.kpis.overdue_tasks} formula="Open or in-progress tasks with a due date in the past" />
              <Metric label="Meetings scheduled" value={d.kpis.meetings_scheduled} formula="Open meeting tasks due from now. Unconfirmed meetings are never counted as completed." />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader title="Pipeline by stage" icon={BarChart3} />
                <div className="p-4">
                  <Bars
                    rows={E.OPPORTUNITY_STAGES.options.map((o) => {
                      const s = d.stages.find((x: Row) => x.stage === o.value);
                      return { label: o.label, value: Number(s?.amount_minor ?? 0), sub: `${s?.n ?? 0} deals` };
                    })}
                    format={(v) => money(v, "INR", true)}
                  />
                </div>
              </Card>
              <Card>
                <CardHeader title="Prospects by source (period)" icon={BarChart3} />
                <div className="p-4">
                  {d.lead_sources.length ? <Bars rows={d.lead_sources.map((s: Row) => ({ label: s.source === "unknown" ? "Not recorded" : E.labelOf(E.LEAD_SOURCES, s.source), value: Number(s.n) }))} /> : <p className="py-6 text-center text-xs text-muted">No prospects created in this period</p>}
                </div>
              </Card>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader title="Service performance" icon={Package} subtitle="Pitched = discussed, proposed, won or lost in service fit" />
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="border-b border-line bg-slate-50/70"><tr><th className="th">Service</th><th className="th text-right">Pitched</th><th className="th text-right">Won accts</th><th className="th text-right">Deals</th><th className="th text-right">Won value</th></tr></thead>
                    <tbody className="divide-y divide-line">
                      {d.product_performance.map((p: Row) => (
                        <tr key={p.id}>
                          <td className="td font-medium">{p.name}</td>
                          <td className="td text-right tabular-nums">{p.pitched}</td>
                          <td className="td text-right tabular-nums">{p.won_accounts}</td>
                          <td className="td text-right tabular-nums">{p.deals}</td>
                          <td className="td text-right tabular-nums">{money(p.won_minor, "INR", true)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
              <div className="space-y-4">
                <Card>
                  <CardHeader title="Prospects by industry" icon={BarChart3} subtitle="All active prospects" />
                  <div className="p-4">
                    {d.industries.length ? <Bars rows={d.industries.map((s: Row) => ({ label: s.industry, value: Number(s.n) }))} /> : <p className="py-6 text-center text-xs text-muted">No prospects yet</p>}
                  </div>
                </Card>
                <div className="grid grid-cols-3 gap-3">
                  <Metric label="Calls recorded" value={d.activity_counts.calls ?? 0} formula="Recordings in period" />
                  <Metric label="Audits run" value={d.activity_counts.audits ?? 0} formula="All audit types in period" />
                  <Metric label="Documents generated" value={d.activity_counts.documents ?? 0} formula="PDF proposals and decks" />
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Settings ───
export function SettingsPage() {
  const { isAdmin, isManager } = useAuth();
  const [sp, setSp] = useSearchParams();
  type T = "profile" | "devices" | "users" | "integrations" | "audit";
  const tab = (sp.get("tab") as T) || "profile";
  const setTab = (t: T) => setSp(t === "profile" ? {} : { tab: t }, { replace: true });
  const tabs = [
    { value: "profile" as const, label: "Profile" },
    { value: "devices" as const, label: "Phone app" },
    ...(isAdmin ? [{ value: "users" as const, label: "Users & roles" }] : []),
    ...(isManager ? [{ value: "integrations" as const, label: "Integrations" }, { value: "audit" as const, label: "Audit log" }] : []),
  ];
  return (
    <div className="pb-10">
      <PageHeader title="Settings" icon={UserCog} />
      <div className="space-y-4 px-4 sm:px-6">
        <Tabs tabs={tabs} value={tab} onChange={setTab} />
        {tab === "profile" && <Profile />}
        {tab === "devices" && <DevicesSettings />}
        {tab === "users" && <UsersAdmin />}
        {tab === "integrations" && <Integrations />}
        {tab === "audit" && <AuditLog />}
      </div>
    </div>
  );
}

function Profile() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user!.name);
  const [tz, setTz] = useState(user!.timezone);
  const [pw, setPw] = useState("");
  const zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? ["Asia/Kolkata", "UTC"];
  const m = useMutation({
    mutationFn: () => api.patch("/users/me", { name, timezone: tz, ...(pw ? { password: pw } : {}) }),
    onSuccess: () => {
      setPw("");
      refresh();
      toast("success", "Profile saved");
    },
    onError: (e) => toast("error", (e as Error).message),
  });
  return (
    <Card className="max-w-lg space-y-3 p-5">
      <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Email"><input className="input" value={user!.email} disabled /></Field>
      <Field label="Timezone" help="Dates are stored in UTC and shown in this timezone.">
        <Select options={zones.map((z) => ({ value: z, label: z }))} value={tz} onChange={(e) => setTz(e.target.value)} />
      </Field>
      <Field label="New password" help="Leave blank to keep the current password. At least 10 characters.">
        <input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
      </Field>
      <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>Save profile</Button>
    </Card>
  );
}

function UsersAdmin() {
  const qc = useQueryClient();
  const toast = useToast();
  const { user: me } = useAuth();
  const q = useQuery({ queryKey: ["users", "all"], queryFn: () => api.get<{ data: Row[] }>("/users?all=1").then((r) => r.data) });
  const [inviting, setInviting] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", role: "rep", password: "" });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Row }) => api.patch(`/users/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast("success", "User updated");
    },
    onError: (e) => toast("error", (e as Error).message),
  });
  const create = useMutation({
    mutationFn: () => api.post("/users", form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setInviting(false);
      setForm({ name: "", email: "", role: "rep", password: "" });
      toast("success", "User created. Share the temporary password securely.");
    },
  });
  return (
    <Card>
      <CardHeader title="Users & roles" icon={Users} subtitle="Permissions are enforced by the server on every request" action={<Button size="sm" icon={Plus} onClick={() => setInviting(true)}>Add user</Button>} />
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-line bg-slate-50/70">
            <tr><th className="th">Name</th><th className="th">Email</th><th className="th">Role</th><th className="th">Status</th><th className="th">Last sign-in</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {q.data?.map((u) => (
              <tr key={u.id}>
                <td className="td font-medium">{u.name}{u.id === me!.id && <span className="text-muted"> (you)</span>}</td>
                <td className="td text-muted">{u.email}</td>
                <td className="td">
                  <Select className="h-7 w-48 text-xs" options={E.ROLES.options} value={u.role} onChange={(e) => update.mutate({ id: u.id, body: { role: e.target.value } })} />
                </td>
                <td className="td">
                  <Select className="h-7 w-28 text-xs" options={[{ value: "active", label: "Active" }, { value: "disabled", label: "Disabled" }]} value={u.status} onChange={(e) => update.mutate({ id: u.id, body: { status: e.target.value } })} />
                </td>
                <td className="td text-muted">{u.last_login_at ? relative(u.last_login_at) : "Never"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-line px-4 py-3 text-xs text-muted">
        <ShieldCheck className="mr-1 inline size-3.5" /> Administrators manage users and integrations. Managers see all sales records and reports. Sales reps see records they own (and contacts/deals under accounts they own).
      </div>
      <Dialog
        open={inviting}
        onClose={() => setInviting(false)}
        title="Add user"
        footer={<><Button onClick={() => setInviting(false)}>Cancel</Button><Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>Create user</Button></>}
      >
        <div className="space-y-3">
          <Field label="Name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Email"><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Role"><Select options={E.ROLES.options} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} /></Field>
          <Field label="Temporary password" help="At least 10 characters. Ask them to change it in Settings → Profile.">
            <input className="input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          {create.error && <p className="text-xs text-red-600">{create.error instanceof ApiError ? Object.values(create.error.fieldErrors).join(" ") || create.error.message : "Failed"}</p>}
        </div>
      </Dialog>
    </Card>
  );
}

function Integrations() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["integrations"], queryFn: () => api.get<{ data: Row[] }>("/integrations").then((r) => r.data) });
  const validate = useMutation({
    mutationFn: (provider: string) => api.post<{ data: Row }>(`/integrations/${provider}/validate`),
    onSuccess: (r, provider) => {
      qc.invalidateQueries({ queryKey: ["integrations"] });
      toast(r.data.ok ? "success" : "error", r.data.ok ? `${provider} validated` : r.data.error);
    },
    onError: (e) => toast("error", (e as Error).message),
  });
  const STATUS: Record<string, [string, string]> = {
    available: ["active", "Built in"],
    connected: ["active", "Connected"],
    not_validated: ["paused", "Key set · not validated"],
    not_configured: ["inactive", "Not configured"],
  };
  const groups = ["Email", "Lead data", "Audits", "AI", "Calls", "Data"];
  return (
    <div className="space-y-5">
      <Card className="flex items-start gap-2 p-3 text-xs text-slate-600">
        <KeyRound className="mt-0.5 size-3.5 shrink-0 text-ink" />
        <span>
          API keys are stored as Cloudflare Worker secrets (<code>wrangler secret put NAME</code>), never in the browser or the database. A provider shows
          <b> Connected</b> only after a successful validation call. Daily call caps protect paid credits (wrangler vars <code>QUOTA_*</code>).
        </span>
      </Card>
      {q.isLoading && <Skeleton className="h-40" />}
      {q.isError && <ErrorState error={q.error} />}
      {groups.map((g) => {
        const items = (q.data ?? []).filter((i) => i.group === g);
        if (!items.length) return null;
        return (
          <section key={g}>
            <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">{g}</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {items.map((i) => (
                <Card key={i.provider} className="flex flex-col p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><Plug className="size-4" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{i.label}</div>
                      <p className="mt-0.5 text-xs text-muted">{i.description}</p>
                    </div>
                    <StatusBadge value={STATUS[i.status][0]} label={STATUS[i.status][1]} />
                  </div>
                  <div className="mt-3 space-y-1 text-xs text-slate-600">
                    <div><b className="text-slate-700">Setup:</b> {i.setup}</div>
                    <div><b className="text-slate-700">Free tier:</b> {i.free_tier}</div>
                    {i.calls_today > 0 && <div>{i.calls_today} call(s) today</div>}
                    {i.webhook_url && <div className="break-all"><b className="text-slate-700">Webhook URL:</b> <code>{i.webhook_url}</code></div>}
                    {i.last_success_at && <div className="text-emerald-700">Last successful check {dateTime(i.last_success_at)}</div>}
                    {i.last_error && <div className="text-red-700">Last error {dateTime(i.last_error_at)}: {i.last_error}</div>}
                  </div>
                  {i.can_validate && isAdmin && (
                    <div className="mt-3">
                      <Button size="sm" loading={validate.isPending && validate.variables === i.provider} onClick={() => validate.mutate(i.provider)}>Validate</Button>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function AuditLog() {
  const q = useQuery({ queryKey: ["audit-logs", "all"], queryFn: () => api.get<{ data: Row[] }>("/audit-logs").then((r) => r.data) });
  return (
    <Card>
      <CardHeader title="Audit log" icon={ShieldCheck} subtitle="Last 200 security and data events" />
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-line bg-slate-50/70">
            <tr><th className="th">When</th><th className="th">Who</th><th className="th">Action</th><th className="th">Record</th><th className="th">Summary</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {q.data?.map((l) => (
              <tr key={l.id}>
                <td className="td text-muted" title={dateTime(l.created_at)}>{relative(l.created_at)}</td>
                <td className="td">{l.actor_name ?? "System"}</td>
                <td className="td"><Badge>{l.action}</Badge></td>
                <td className="td text-muted">{l.entity_type}</td>
                <td className="td max-w-md truncate">{l.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

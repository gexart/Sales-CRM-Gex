import { useMemo, useState } from "react";
import { NavLink, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, Eye, FileUp, Gauge, MapPin, RefreshCw, Search, ShieldAlert, Star, Telescope, Upload, UserPlus, Users } from "lucide-react";
import { api, ApiError, type Row } from "../lib/api";
import { useAuth } from "../lib/auth";
import { CONFIGS } from "../lib/entities";
import * as E from "../../shared/enums";
import { relative } from "../lib/format";
import { PageHeader } from "../components/layout";
import { RefSelect } from "../components/forms";
import { invalidateRecord } from "../components/records";
import { Badge, Button, Card, CardHeader, Dialog, EmptyState, ErrorState, Field, Select, Skeleton, StatusBadge, cn, useToast } from "../components/ui";
import { EntityListPage } from "./EntityListPage";

export function useAvailable() {
  return useQuery({ queryKey: ["integrations", "available"], queryFn: () => api.get("/integrations/available").then((r) => r.data), staleTime: 60_000 });
}

export function ProspectingNav() {
  return (
    <div className="flex rounded-md border border-line bg-white p-0.5 shadow-[var(--shadow-card)]">
      {[
        { to: "/prospecting", label: "Prospects", icon: Telescope, end: true },
        { to: "/prospecting/discover", label: "Lead discovery", icon: MapPin },
        { to: "/prospecting/import", label: "Import CSV", icon: FileUp },
      ].map((i) => (
        <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => cn("flex h-7 items-center gap-1 rounded px-2 text-xs font-medium", isActive ? "bg-slate-100 text-ink" : "text-slate-500 hover:text-ink")}>
          <i.icon className="size-3.5" /> {i.label}
        </NavLink>
      ))}
    </div>
  );
}

export function ProspectsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const rescore = useMutation({
    mutationFn: () => api.post<{ data: Row }>("/prospects/rescore"),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["prospects"] });
      toast("success", `Re-scored ${r.data.scored} prospect(s)`);
    },
  });
  return (
    <EntityListPage
      cfg={CONFIGS.prospects}
      headerExtra={
        <>
          <ProspectingNav />
          <Button icon={Gauge} loading={rescore.isPending} onClick={() => rescore.mutate()} title="Recalculate qualification scores from current data">Re-score</Button>
        </>
      }
    />
  );
}

// ─── CSV import ───
export function ImportPage() {
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Row | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [includeDupes, setIncludeDupes] = useState(false);
  const [campaign, setCampaign] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "valid" | "duplicate" | "error">("all");
  const history = useQuery({ queryKey: ["imports"], queryFn: () => api.get<{ data: Row[] }>("/imports").then((r) => r.data) });
  const run = useMutation({
    mutationFn: (m?: Record<string, string>) => api.post<{ data: Row }>("/imports/prospects/preview", { csv, file_name: fileName, mapping: m }),
    onSuccess: (r) => {
      setPreview(r.data);
      setMapping(r.data.mapping);
      setSelected(new Set(r.data.rows.filter((x: Row) => x.status === "valid").map((x: Row) => x.index)));
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "mapping_required") {
        const d = e.details as { headers: string[]; mapping: Record<string, string> };
        setPreview({ headers: d.headers, mapping: d.mapping, rows: [], counts: null, fields: [] });
        setMapping(d.mapping);
      }
    },
  });
  const commit = useMutation({
    mutationFn: () => api.post<{ data: Row }>(`/imports/${preview!.id}/commit`, { rows: [...selected], include_duplicates: includeDupes, campaign_id: campaign }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["prospects"] });
      qc.invalidateQueries({ queryKey: ["imports"] });
      toast("success", `Imported ${r.data.created} prospect(s)`);
      nav("/prospecting?sort=created_at");
    },
    onError: (e) => toast("error", (e as Error).message),
  });
  const rows: Row[] = preview?.rows ?? [];
  const shown = filter === "all" ? rows : rows.filter((r) => r.status === filter);
  const FIELDS = [
    "company_name", "website", "industry", "geography", "company_size", "contact_name", "contact_title", "email", "phone", "linkedin_url", "service_fit", "estimated_value", "research_notes", "next_action",
  ];
  return (
    <div className="pb-10">
      <PageHeader title="Import prospects" icon={FileUp} subtitle="Upload → map columns → review duplicates and errors → confirm" actions={<ProspectingNav />} />
      <div className="space-y-4 px-4 sm:px-6">
        <Card className="flex flex-wrap items-center gap-3 p-4">
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-line px-4 py-3 hover:border-brand-300 hover:bg-brand-50/30">
            <Upload className="size-4 text-slate-500" />
            <span>{fileName ?? "Choose a CSV file"}</span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 5_000_000) return toast("error", "CSV files up to 5 MB");
                setFileName(f.name);
                setCsv(await f.text());
                setPreview(null);
              }}
            />
          </label>
          <Button variant="primary" disabled={!csv} loading={run.isPending} onClick={() => run.mutate(undefined)}>Preview import</Button>
          <a href="/api/v1/imports/template/prospects.csv" className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-brand-700"><Download className="size-3.5" /> Download template</a>
        </Card>
        {run.error && !(run.error instanceof ApiError && run.error.code === "mapping_required") && <ErrorState error={run.error} />}
        {preview && (
          <Card>
            <CardHeader title="Column mapping" subtitle="Detected automatically; adjust and re-run the preview if needed" />
            <div className="grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4">
              {FIELDS.map((f) => (
                <Field key={f} label={f.replace(/_/g, " ")} required={f === "company_name"}>
                  <Select placeholder="— not imported —" options={(preview.headers as string[]).map((h) => ({ value: h, label: h }))} value={mapping[f] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [f]: e.target.value }))} />
                </Field>
              ))}
            </div>
            <div className="border-t border-line px-4 py-2"><Button size="sm" icon={RefreshCw} loading={run.isPending} onClick={() => run.mutate(Object.fromEntries(Object.entries(mapping).filter(([, v]) => v)))}>Re-run preview with this mapping</Button></div>
          </Card>
        )}
        {preview?.counts && (
          <Card>
            <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
              {(["all", "valid", "duplicate", "error"] as const).map((k) => (
                <button key={k} onClick={() => setFilter(k)} className={cn("rounded-full border px-2.5 py-0.5 text-xs", filter === k ? "border-brand-300 bg-brand-50 text-brand-700" : "border-line text-slate-600")}>
                  {k === "all" ? `All ${rows.length}` : `${k[0].toUpperCase()}${k.slice(1)} ${preview.counts[k]}`}
                </button>
              ))}
              <label className="ml-2 flex items-center gap-1.5 text-xs"><input type="checkbox" className="accent-brand-600" checked={includeDupes} onChange={(e) => setIncludeDupes(e.target.checked)} /> Allow importing possible duplicates I select</label>
              <div className="ml-auto flex items-center gap-2">
                <div className="w-52"><RefSelect kind="campaigns" value={campaign} onChange={setCampaign} placeholder="Attribute to campaign…" /></div>
                <Button variant="primary" icon={CheckCircle2} disabled={!selected.size} loading={commit.isPending} onClick={() => commit.mutate()}>Import {selected.size} row(s)</Button>
              </div>
            </div>
            <div className="max-h-[60vh] overflow-auto">
              <table className="w-full">
                <thead className="sticky top-0 border-b border-line bg-slate-50"><tr><th className="th w-8" /><th className="th">Row</th><th className="th">Status</th><th className="th">Company</th><th className="th">Website</th><th className="th">Contact</th><th className="th">Issue</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {shown.slice(0, 1000).map((r) => {
                    const selectable = r.status === "valid" || (r.status === "duplicate" && includeDupes);
                    return (
                      <tr key={r.index} className={cn(r.status === "error" && "bg-red-50/40")}>
                        <td className="td"><input type="checkbox" aria-label={`Select row ${r.index + 2}`} className="accent-brand-600" disabled={!selectable} checked={selected.has(r.index)} onChange={() => setSelected((s) => { const n = new Set(s); n.has(r.index) ? n.delete(r.index) : n.add(r.index); return n; })} /></td>
                        <td className="td text-muted">{r.index + 2}</td>
                        <td className="td"><StatusBadge value={r.status === "valid" ? "active" : r.status === "duplicate" ? "medium" : "failed"} label={r.status} /></td>
                        <td className="td font-medium">{r.data.company_name}</td>
                        <td className="td text-muted">{r.data.website}</td>
                        <td className="td text-muted">{[r.data.contact_name, r.data.email].filter(Boolean).join(" · ")}</td>
                        <td className="td text-xs whitespace-normal text-slate-600">{r.status === "error" ? r.errors.join("; ") : r.duplicate ? `Matches ${r.duplicate.kind} “${r.duplicate.name}”` : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
        <Card>
          <CardHeader title="Import history" />
          <ul className="divide-y divide-line px-4">
            {history.data?.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center gap-3 py-2 text-[13px]">
                <span className="font-medium">{j.file_name ?? "CSV"}</span>
                <StatusBadge value={j.status === "completed" ? "completed" : j.status === "failed" ? "failed" : "draft"} label={j.status} />
                <span className="text-muted">{j.total_rows} rows · {j.created_rows} imported · {j.duplicate_rows} duplicates · {j.error_rows} errors</span>
                <span className="ml-auto text-xs text-muted">{j.created_by_name} · {relative(j.created_at)}</span>
                {j.error_rows > 0 && <a className="text-xs text-brand-700" href={`/api/v1/imports/${j.id}/errors.csv`}>Error report</a>}
              </li>
            ))}
            {history.data && !history.data.length && <li className="py-4 text-center text-xs text-muted">No imports yet</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}

// ─── Google Places discovery ───
export function DiscoveryPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const avail = useAvailable();
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [max, setMax] = useState(20);
  const [campaign, setCampaign] = useState<string | null>(null);
  const [serviceFit, setServiceFit] = useState("");
  const [job, setJob] = useState<Row | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const jobs = useQuery({ queryKey: ["discovery", "jobs"], queryFn: () => api.get<{ data: Row[] }>("/discovery/jobs").then((r) => r.data) });
  const search = useMutation({
    mutationFn: () => api.post<{ data: Row }>("/discovery/search", { query, location: location || null, campaign_id: campaign, max_results: max }),
    onSuccess: (r) => {
      setJob(r.data);
      setSelected(new Set(r.data.results.filter((x: Row) => !x.duplicate_id).map((x: Row) => x.id)));
      qc.invalidateQueries({ queryKey: ["discovery"] });
    },
  });
  const open = useMutation({ mutationFn: (id: string) => api.get<{ data: Row }>(`/discovery/jobs/${id}`), onSuccess: (r) => (setJob(r.data), setSelected(new Set())) });
  const importSel = useMutation({
    mutationFn: () => api.post<{ data: Row }>(`/discovery/jobs/${job!.id}/import`, { result_ids: [...selected], campaign_id: campaign, service_fit: serviceFit || null }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["prospects"] });
      toast("success", `${r.data.created} prospect(s) added`);
      nav("/prospecting?discovery_source=google_places");
    },
    onError: (e) => toast("error", (e as Error).message),
  });
  if (avail.data && !avail.data.google_places) {
    return (
      <div className="pb-10">
        <PageHeader title="Lead discovery" icon={MapPin} actions={<ProspectingNav />} />
        <div className="px-4 sm:px-6"><Card><EmptyState icon={MapPin} title="Google Places is not configured" body="An admin needs to add a Google Places API key (Settings → Integrations shows the steps). Meanwhile, add prospects manually or import a CSV." /></Card></div>
      </div>
    );
  }
  const results: Row[] = job?.results ?? [];
  return (
    <div className="pb-10">
      <PageHeader title="Lead discovery" icon={MapPin} subtitle="Official Google Places API · results are reviewed before anything is saved · kept for 30 days" actions={<ProspectingNav />} />
      <div className="space-y-4 px-4 sm:px-6">
        <Card className="grid gap-3 p-4 md:grid-cols-[2fr_1.5fr_0.7fr_1.3fr_auto] md:items-end">
          <Field label="What"><input className="input" placeholder="e.g. multispeciality hospitals, real estate developers" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && query && search.mutate()} /></Field>
          <Field label="Where"><input className="input" placeholder="e.g. Kolkata, West Bengal" value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
          <Field label="Max"><Select options={[10, 20, 40, 60].map((n) => ({ value: String(n), label: String(n) }))} value={String(max)} onChange={(e) => setMax(Number(e.target.value))} /></Field>
          <Field label="Campaign"><RefSelect kind="campaigns" value={campaign} onChange={setCampaign} placeholder="Optional" /></Field>
          <Button variant="primary" icon={Search} disabled={!query.trim()} loading={search.isPending} onClick={() => search.mutate()}>Search</Button>
        </Card>
        {search.error && <ErrorState error={search.error} />}
        {job && (
          <Card>
            <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
              <span className="font-medium">“{job.query}”{job.location ? ` in ${job.location}` : ""}</span>
              <span className="text-xs text-muted">{results.length} result(s) · {results.filter((r) => r.duplicate_id).length} already in CRM</span>
              <div className="ml-auto flex items-center gap-2">
                <input className="input w-56" placeholder="Service fit for imported leads" value={serviceFit} onChange={(e) => setServiceFit(e.target.value)} />
                <Button size="sm" onClick={() => setSelected(new Set(results.filter((r) => !r.duplicate_id && !r.imported_prospect_id).map((r) => r.id)))}>Select new</Button>
                <Button variant="primary" icon={UserPlus} disabled={!selected.size} loading={importSel.isPending} onClick={() => importSel.mutate()}>Import {selected.size}</Button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-line bg-slate-50/70"><tr><th className="th w-8" /><th className="th">Company</th><th className="th">Category</th><th className="th">Location</th><th className="th">Website</th><th className="th">Phone</th><th className="th">Rating</th><th className="th">CRM status</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {results.map((r) => (
                    <tr key={r.id}>
                      <td className="td"><input type="checkbox" aria-label={`Select ${r.name}`} className="accent-brand-600" disabled={!!r.imported_prospect_id} checked={selected.has(r.id)} onChange={() => setSelected((s) => { const n = new Set(s); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; })} /></td>
                      <td className="td font-medium">{r.maps_url ? <a href={r.maps_url} target="_blank" rel="noreferrer noopener" className="hover:text-brand-700">{r.name}</a> : r.name}</td>
                      <td className="td text-muted">{r.category ?? "—"}</td>
                      <td className="td max-w-56 truncate text-muted" title={r.address}>{r.city ?? r.address ?? "—"}</td>
                      <td className="td">{r.website ? <a href={r.website} target="_blank" rel="noreferrer noopener" className="text-brand-700 hover:underline">{new URL(r.website).hostname.replace(/^www\./, "")}</a> : <span className="text-amber-700">No website</span>}</td>
                      <td className="td text-muted">{r.phone ?? "—"}</td>
                      <td className="td tabular-nums">{r.rating ? <span className="inline-flex items-center gap-0.5"><Star className="size-3 fill-amber-400 text-amber-400" />{r.rating} <span className="text-muted">({r.review_count})</span></span> : "—"}</td>
                      <td className="td">{r.imported_prospect_id ? <Badge tone="green">Imported</Badge> : r.duplicate_id ? <Badge tone="amber">In CRM: {r.duplicate_name}</Badge> : <Badge>New</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
        <Card>
          <CardHeader title="Recent searches" />
          <ul className="divide-y divide-line px-4">
            {jobs.data?.map((j) => (
              <li key={j.id} className="flex items-center gap-3 py-2">
                <button className="font-medium hover:text-brand-700" onClick={() => open.mutate(j.id)}>{j.query}{j.location ? ` · ${j.location}` : ""}</button>
                <StatusBadge value={j.status} label={j.status} />
                <span className="text-xs text-muted">{j.result_count} results · {j.imported} imported</span>
                <span className="ml-auto text-xs text-muted">{relative(j.created_at)}</span>
              </li>
            ))}
            {jobs.data && !jobs.data.length && <li className="py-4 text-center text-xs text-muted">No searches yet</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}

// ─── Qualification card (prospect detail) ───
export function QualificationCard({ p }: { p: Row }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [overriding, setOverriding] = useState(false);
  const [level, setLevel] = useState(p.qualification_override ?? "");
  const [reason, setReason] = useState(p.qualification_override_reason ?? "");
  const factors: Row[] = useMemo(() => (p.qualification_factors ? JSON.parse(p.qualification_factors) : []), [p.qualification_factors]);
  const score = useMutation({ mutationFn: () => api.post(`/prospects/${p.id}/score`), onSuccess: () => qc.invalidateQueries({ queryKey: ["prospects"] }) });
  const override = useMutation({
    mutationFn: () => api.post(`/prospects/${p.id}/qualification-override`, { level: level || null, reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prospects"] });
      invalidateRecord(qc);
      setOverriding(false);
      toast("success", "Qualification updated");
    },
    onError: (e) => toast("error", (e as Error).message),
  });
  const effective = p.qualification_override ?? p.qualification_level;
  return (
    <Card>
      <CardHeader title="Qualification" icon={Gauge} subtitle="From recorded facts, not a forecast" action={<Button size="sm" icon={RefreshCw} loading={score.isPending} onClick={() => score.mutate()}>Recalculate</Button>} />
      <div className="space-y-3 p-4">
        <div className="flex items-center gap-3">
          <div className="text-2xl font-semibold tabular-nums">{p.qualification_score ?? "—"}<span className="text-sm text-muted">/100</span></div>
          {effective && <StatusBadge value={effective} label={E.labelOf(E.QUALIFICATION_LEVELS, effective)} />}
          {p.qualification_override && <Badge tone="violet">Overridden</Badge>}
        </div>
        {p.qualification_override && <p className="text-xs text-slate-600">Override reason: {p.qualification_override_reason}</p>}
        <ul className="space-y-1">
          {factors.map((f) => (
            <li key={f.key} className="flex items-start gap-2 text-xs">
              <span className={cn("mt-0.5 size-2 shrink-0 rounded-full", f.observed ? "bg-emerald-500" : "bg-slate-300")} />
              <span className="flex-1"><span className="font-medium text-ink">{f.label}</span> <span className="text-muted">— {f.detail}</span></span>
              <span className="tabular-nums text-muted">{f.points}/{f.max}</span>
            </li>
          ))}
          {!factors.length && <li className="text-xs text-muted">Not scored yet. Click Recalculate.</li>}
        </ul>
        {overriding ? (
          <div className="space-y-2 rounded-md border border-line p-2.5">
            <Select options={E.QUALIFICATION_LEVELS.options} placeholder="Remove override" value={level} onChange={(e) => setLevel(e.target.value)} />
            <input className="input" placeholder="Why? (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex gap-2"><Button size="sm" onClick={() => setOverriding(false)}>Cancel</Button><Button size="sm" variant="primary" loading={override.isPending} onClick={() => override.mutate()}>Save</Button></div>
          </div>
        ) : (
          <button className="text-xs font-medium text-brand-700" onClick={() => setOverriding(true)}>Override level…</button>
        )}
      </div>
    </Card>
  );
}

// ─── Contact finder ───
export function EnrichmentDialog({ open, onClose, kind, id, name }: { open: boolean; onClose: () => void; kind: "accounts" | "prospects"; id: string; name: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { isAdmin } = useAuth();
  const avail = useAvailable();
  const providers = E.ENRICHMENT_PROVIDERS.options.filter((p) => p.value !== "lusha");
  const [chosen, setChosen] = useState<string[]>(["website"]);
  const [saving, setSaving] = useState<Row | null>(null);
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [role, setRole] = useState("decision_maker");
  const results = useQuery({ queryKey: ["enrichment", kind, id], queryFn: () => api.get<{ data: Row[] }>(`/${kind}/${id}/enrichment`).then((r) => r.data), enabled: open });
  const run = useMutation({
    mutationFn: () => api.post<{ data: Row }>(`/${kind}/${id}/enrich`, { providers: chosen }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["enrichment", kind, id] });
      toast(r.data.errors.length ? "info" : "success", `${r.data.found} result(s) found${r.data.errors.length ? `; ${r.data.errors.map((e: Row) => `${e.provider}: ${e.error}`).join(" · ")}` : ""}`);
    },
    onError: (e) => toast("error", (e as Error).message),
  });
  const reveal = useMutation({
    mutationFn: ({ rid, via }: { rid: string; via: string }) => api.post(`/enrichment-results/${rid}/reveal?via=${via}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["enrichment", kind, id] }),
    onError: (e) => toast("error", (e as Error).message),
  });
  const save = useMutation({
    mutationFn: () => api.post<{ data: Row }>(`/enrichment-results/${saving!.id}/save`, { first_name: first, last_name: last || null, decision_role: role }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["enrichment", kind, id] });
      invalidateRecord(qc);
      toast("success", r.data.existing ? "Linked to an existing contact" : "Saved as contact");
      setSaving(null);
    },
    onError: (e) => toast("error", (e as Error).message),
  });
  const ok = (p: string) => p === "website" || !!avail.data?.enrichment?.[p];
  const rows = results.data ?? [];
  return (
    <Dialog open={open} onClose={onClose} title={`Find decision-makers · ${name}`} width="max-w-4xl">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {providers.map((p) => (
            <label key={p.value} title={ok(p.value) ? "" : "Not configured — add the API key in Settings → Integrations"} className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs", chosen.includes(p.value) ? "border-brand-300 bg-brand-50 text-brand-700" : "border-line", !ok(p.value) && "opacity-50")}>
              <input type="checkbox" className="accent-brand-600" disabled={!ok(p.value)} checked={chosen.includes(p.value)} onChange={() => setChosen((c) => (c.includes(p.value) ? c.filter((x) => x !== p.value) : [...c, p.value]))} />
              {p.label}
            </label>
          ))}
          <Button variant="primary" icon={Search} className="ml-auto" disabled={!chosen.length} loading={run.isPending} onClick={() => run.mutate()}>Search</Button>
        </div>
        <p className="flex items-start gap-1.5 text-xs text-muted">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
          Results come from the company's own website and the providers you connect. Nothing is guessed. Verify details and respect contact preferences before outreach. {!isAdmin && "Ask an admin to connect more providers."}
        </p>
        {results.isLoading ? <Skeleton className="h-32" /> : rows.length ? (
          <div className="max-h-[50vh] overflow-auto rounded-md border border-line">
            <table className="w-full">
              <thead className="sticky top-0 border-b border-line bg-slate-50"><tr><th className="th">Source</th><th className="th">Person</th><th className="th">Email</th><th className="th">Phone</th><th className="th" /></tr></thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="td"><Badge>{E.labelOf(E.ENRICHMENT_PROVIDERS, r.provider).split(" (")[0]}</Badge></td>
                    <td className="td whitespace-normal">
                      <div className="font-medium">{r.full_name ?? "—"}</div>
                      <div className="text-xs text-muted">{r.title}{r.linkedin_url && <> · <a href={r.linkedin_url} target="_blank" rel="noreferrer noopener" className="text-brand-700">LinkedIn</a></>}{r.source_url && <> · <a href={r.source_url} target="_blank" rel="noreferrer noopener" className="text-brand-700">source</a></>}</div>
                    </td>
                    <td className="td">{r.email ?? (r.email_status === "available_on_reveal" ? <span className="text-xs text-muted">Hidden until revealed</span> : "—")}{r.email && r.email_status && <div className="text-[10px] text-muted">{r.email_status}</div>}</td>
                    <td className="td">{r.phone ?? "—"}</td>
                    <td className="td text-right">
                      <div className="flex justify-end gap-1">
                        {!r.revealed && (r.provider === "apollo" || r.provider === "rocketreach") && <Button size="sm" icon={Eye} loading={reveal.isPending && reveal.variables?.rid === r.id} onClick={() => reveal.mutate({ rid: r.id, via: r.provider })} title="Uses provider credits">Reveal</Button>}
                        {r.full_name && avail.data?.enrichment?.lusha && !r.email && <Button size="sm" onClick={() => reveal.mutate({ rid: r.id, via: "lusha" })}>Lusha</Button>}
                        {r.saved_contact_id ? <Badge tone="green">Saved</Badge> : (r.email || r.phone || r.full_name) && (
                          <Button size="sm" variant="primary" icon={UserPlus} onClick={() => { const [f, ...l] = String(r.full_name ?? "").split(" "); setFirst(f ?? ""); setLast(l.join(" ")); setSaving(r); }}>Save</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState compact icon={Users} title="No results yet" body="Choose sources and search. The free “Company website” source reads publicly listed emails, phones and LinkedIn links." />
        )}
      </div>
      <Dialog open={!!saving} onClose={() => setSaving(null)} title="Save as contact" footer={<><Button onClick={() => setSaving(null)}>Cancel</Button><Button variant="primary" disabled={!first.trim()} loading={save.isPending} onClick={() => save.mutate()}>Save contact</Button></>}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" required><input className="input" value={first} onChange={(e) => setFirst(e.target.value)} placeholder={saving?.email ? "Name not published — enter it" : ""} /></Field>
          <Field label="Last name"><input className="input" value={last} onChange={(e) => setLast(e.target.value)} /></Field>
          <Field label="Decision role" className="col-span-2"><Select options={E.DECISION_ROLES.options} value={role} onChange={(e) => setRole(e.target.value)} /></Field>
          <p className="col-span-2 text-xs text-muted">{saving?.email ?? ""} {saving?.phone ?? ""} · source recorded on the contact.</p>
        </div>
      </Dialog>
    </Dialog>
  );
}


import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Download, FileText, ListPlus, Plus, Presentation, Sparkles, Swords, Trash2, Wand2 } from "lucide-react";
import { api, type Row } from "../lib/api";
import { useAuth } from "../lib/auth";
import * as E from "../../shared/enums";
import { money } from "../lib/format";
import { buildPptx, type Slide } from "../lib/deck";
import { RefSelect } from "../components/forms";
import { CopyButton } from "../components/outreach";
import { invalidateRecord } from "../components/records";
import { Badge, Button, Card, CardHeader, Dialog, EmptyState, Field, Select, SlideOver, cn, useToast } from "../components/ui";
import { useAvailable } from "./Prospecting";

function useAccountAudits(accountId: string, enabled: boolean) {
  return useQuery({ queryKey: ["audits", accountId], queryFn: () => api.get<{ data: Row[] }>(`/accounts/${accountId}/audits`).then((r) => r.data), enabled });
}
function usePriceBook(enabled = true) {
  return useQuery({ queryKey: ["packages", "price-book"], queryFn: () => api.get<{ data: Row[] }>("/price-book").then((r) => r.data), enabled, staleTime: 60_000 });
}

function AuditPicker({ accountId, value, onChange, enabled }: { accountId: string; value: string[]; onChange: (v: string[]) => void; enabled: boolean }) {
  const q = useAccountAudits(accountId, enabled);
  const done = (q.data ?? []).filter((r) => String(r.status).startsWith("completed"));
  const latest = new Map<string, Row>();
  for (const r of done) if (!latest.has(r.audit_type)) latest.set(r.audit_type, r);
  return (
    <Field label="Audit evidence" help={value.length ? undefined : "None selected = latest completed audit of each type."}>
      <div className="flex flex-wrap gap-1.5">
        {[...latest.values()].map((r) => {
          const on = value.includes(r.id);
          return (
            <button key={r.id} type="button" onClick={() => onChange(on ? value.filter((x) => x !== r.id) : [...value, r.id])} className={cn("rounded-full border px-2 py-0.5 text-xs", on ? "border-brand-300 bg-brand-50 text-brand-700" : "border-line text-slate-600")}>
              {r.audit_type.toUpperCase()} · {r.overall_score ?? "N/A"} · {r.issue_count} issues
            </button>
          );
        })}
        {!latest.size && <span className="text-xs text-muted">No completed audits. Pitches will rely on service fit and your notes.</span>}
      </div>
    </Field>
  );
}

function ServicePicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const pb = usePriceBook();
  return (
    <Field label="Services to pitch" help={value.length ? undefined : "None selected = services marked relevant plus those linked to audit findings."}>
      <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
        {(pb.data ?? []).filter((p) => p.status === "active").map((p) => {
          const on = value.includes(p.id);
          return (
            <button key={p.id} type="button" onClick={() => onChange(on ? value.filter((x) => x !== p.id) : [...value, p.id])} className={cn("rounded-full border px-2 py-0.5 text-xs", on ? "border-brand-300 bg-brand-50 text-brand-700" : "border-line text-slate-600")}>
              {p.name}
            </button>
          );
        })}
      </div>
    </Field>
  );
}

// ─── Pitch generator ───
export function PitchDialog({ open, onClose, account }: { open: boolean; onClose: () => void; account: Row }) {
  const avail = useAvailable();
  const toast = useToast();
  const [formats, setFormats] = useState<string[]>(["sales_email", "cold_call_script", "intro_30s"]);
  const [audits, setAudits] = useState<string[]>([]);
  const [products, setProducts] = useState<string[]>([]);
  const [contact, setContact] = useState<string | null>(null);
  const [tone, setTone] = useState("professional");
  const [language, setLanguage] = useState("English");
  const [objective, setObjective] = useState("Book a 20-minute discovery call");
  const [useAi, setUseAi] = useState(true);
  const [result, setResult] = useState<Row | null>(null);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const m = useMutation({
    mutationFn: () => api.post<{ data: Row }>(`/accounts/${account.id}/pitch`, { formats, audit_run_ids: audits, product_ids: products, contact_id: contact, tone, language, objective, use_ai: useAi && !!avail.data?.claude }),
    onSuccess: (r) => (setResult(r.data), setEdits({})),
    onError: (e) => toast("error", (e as Error).message),
  });
  return (
    <SlideOver open={open} onClose={onClose} title="Generate sales pitch" subtitle={`${account.name} · problem → evidence → solution → price`} width="max-w-5xl">
      <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-3">
          <Field label="Formats">
            <div className="flex flex-wrap gap-1.5">
              {E.PITCH_FORMATS.options.map((f) => (
                <button key={f.value} type="button" onClick={() => setFormats((s) => (s.includes(f.value) ? s.filter((x) => x !== f.value) : [...s, f.value]))} className={cn("rounded-full border px-2 py-0.5 text-xs", formats.includes(f.value) ? "border-brand-300 bg-brand-50 text-brand-700" : "border-line text-slate-600")}>
                  {f.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Decision-maker"><RefSelect kind="contacts" value={contact} onChange={setContact} filter={{ account_id: account.id }} placeholder="Best match automatically" /></Field>
          <AuditPicker accountId={account.id} value={audits} onChange={setAudits} enabled={open} />
          <ServicePicker value={products} onChange={setProducts} />
          <Field label="Objective"><input className="input" value={objective} onChange={(e) => setObjective(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tone"><Select options={E.TONES.options} value={tone} onChange={(e) => setTone(e.target.value)} /></Field>
            <Field label="Language"><Select options={["English", "Hindi", "Bengali", "Hinglish"].map((l) => ({ value: l, label: l }))} value={language} onChange={(e) => setLanguage(e.target.value)} /></Field>
          </div>
          <label className={cn("flex items-center gap-2 text-xs", !avail.data?.claude && "opacity-60")}>
            <input type="checkbox" className="accent-brand-600" disabled={!avail.data?.claude} checked={useAi && !!avail.data?.claude} onChange={(e) => setUseAi(e.target.checked)} />
            Write with Claude {avail.data?.claude ? "(uses only CRM facts; review before use)" : "(not configured — fixed templates used)"}
          </label>
          <Button variant="primary" icon={Wand2} className="w-full" disabled={!formats.length} loading={m.isPending} onClick={() => m.mutate()}>Generate</Button>
        </div>
        <div className="min-w-0 space-y-3">
          {!result ? (
            <EmptyState icon={Sparkles} title="Your pitch appears here" body="Built from audit findings, service fit and your price book. Everything is editable; nothing is sent." />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge tone={result.generator === "claude" ? "violet" : "gray"}>{result.generator === "claude" ? `AI draft · ${result.model}` : "Template"}</Badge>
                <span className="text-muted">Review and edit before sending.</span>
              </div>
              {result.problems.length > 0 && (
                <Card>
                  <CardHeader title="Problem → solution" />
                  <table className="w-full text-xs">
                    <thead className="border-b border-line bg-slate-50"><tr><th className="th">Problem (evidence)</th><th className="th">Solution</th></tr></thead>
                    <tbody className="divide-y divide-line">
                      {result.problems.map((p: Row, i: number) => (
                        <tr key={i}><td className="td whitespace-normal"><Badge tone={p.severity === "critical" || p.severity === "high" ? "red" : "amber"}>{p.severity}</Badge> <b>{p.problem}</b><div className="text-muted">{p.evidence}</div></td><td className="td whitespace-normal">{p.solution ?? <span className="text-muted">—</span>}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}
              {result.pricing.length > 0 && (
                <Card className="p-3 text-xs">
                  <div className="mb-1 font-semibold">Prices used (from price book)</div>
                  {result.pricing.map((s: Row) => <div key={s.service}>{s.service}: {s.packages.length ? s.packages.map((p: Row) => `${p.name} ${p.price}`).join(" · ") : "catalogue / custom"}</div>)}
                </Card>
              )}
              {result.sections.map((s: Row, i: number) => (
                <Card key={i}>
                  <CardHeader title={s.title || E.labelOf(E.PITCH_FORMATS, s.format)} action={<CopyButton text={edits[i] ?? s.content} label="Copy" />} />
                  <textarea className="input h-auto min-h-40 rounded-none border-0 py-3 leading-relaxed focus:ring-0" value={edits[i] ?? s.content} onChange={(e) => setEdits((x) => ({ ...x, [i]: e.target.value }))} />
                </Card>
              ))}
              {(result.assumptions.length > 0 || result.missing_information.length > 0) && (
                <Card className="space-y-2 border-amber-200 bg-amber-50/50 p-3 text-xs">
                  {result.assumptions.length > 0 && <div><b>Assumptions:</b> {result.assumptions.join(" · ")}</div>}
                  {result.missing_information.length > 0 && <div><b>Find out before sending:</b> {result.missing_information.join(" · ")}</div>}
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </SlideOver>
  );
}

// ─── PDF proposal ───
export function ProposalDialog({ open, onClose, account }: { open: boolean; onClose: () => void; account: Row }) {
  const qc = useQueryClient();
  const toast = useToast();
  const pb = usePriceBook(open);
  const [items, setItems] = useState<{ product_id: string; package_id: string | null; quantity: number }[]>([]);
  const [audits, setAudits] = useState<string[]>([]);
  const [contact, setContact] = useState<string | null>(null);
  const [opp, setOpp] = useState<string | null>(null);
  const [title, setTitle] = useState("Digital Growth Proposal");
  const [validity, setValidity] = useState(30);
  const [intro, setIntro] = useState("");
  const [done, setDone] = useState<Row | null>(null);
  useEffect(() => {
    if (open) setDone(null);
  }, [open]);
  const m = useMutation({
    mutationFn: () => api.post<{ data: Row }>(`/accounts/${account.id}/proposal`, { items, audit_run_ids: audits, contact_id: contact, opportunity_id: opp, title, validity_days: validity, intro_note: intro || null }),
    onSuccess: (r) => {
      setDone(r.data);
      qc.invalidateQueries({ queryKey: ["assets"] });
      invalidateRecord(qc);
    },
    onError: (e) => toast("error", (e as Error).message),
  });
  const products = (pb.data ?? []).filter((p) => p.status === "active");
  const line = (it: (typeof items)[number]) => {
    const p = products.find((x) => x.id === it.product_id);
    const k = p?.packages.find((x: Row) => x.id === it.package_id);
    const price = k ? k.price_minor : p?.default_price_minor;
    return { p, k, price: price === null || price === undefined ? null : price * it.quantity, currency: k?.currency ?? p?.currency ?? "INR" };
  };
  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title="Generate PDF proposal"
      subtitle="Fixed Gexart layout: cover · summary · findings · solutions · investment · next steps"
      width="max-w-3xl"
      footer={
        done ? (
          <>
            <Button onClick={onClose}>Close</Button>
            <a href={`/api/v1/assets/${done.asset_id}/download`}><Button variant="primary" icon={Download}>Download PDF</Button></a>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" icon={FileText} disabled={!items.length || items.some((i) => !i.product_id)} loading={m.isPending} onClick={() => m.mutate()}>Generate PDF</Button>
          </>
        )
      }
    >
      {done ? (
        <EmptyState icon={FileText} title="Proposal generated" body={<>“{done.title}” is saved to Sales Assets and linked to this account. Download it, review it, then send it yourself.</>} />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Field label="Valid for (days)"><input type="number" min={1} max={180} className="input" value={validity} onChange={(e) => setValidity(Number(e.target.value))} /></Field>
            <Field label="Prepared for"><RefSelect kind="contacts" value={contact} onChange={setContact} filter={{ account_id: account.id }} placeholder="Best match automatically" /></Field>
            <Field label="Opportunity (optional)"><RefSelect kind="opportunities" value={opp} onChange={setOpp} filter={{ account_id: account.id }} placeholder="Link to a deal" /></Field>
          </div>
          <AuditPicker accountId={account.id} value={audits} onChange={setAudits} enabled={open} />
          <Field label="Services & packages" help="Prices come from the price book. Items without a price appear as “Custom quote”.">
            <div className="space-y-2">
              {items.map((it, i) => {
                const l = line(it);
                return (
                  <div key={i} className="grid grid-cols-[1.4fr_1.2fr_70px_110px_32px] items-center gap-2">
                    <Select placeholder="Service…" options={products.map((p) => ({ value: p.id, label: p.name }))} value={it.product_id} onChange={(e) => setItems((s) => s.map((x, j) => (j === i ? { ...x, product_id: e.target.value, package_id: null } : x)))} />
                    <Select placeholder={l.p?.packages.length ? "Package…" : "Catalogue price"} options={(l.p?.packages ?? []).map((k: Row) => ({ value: k.id, label: `${k.name} · ${k.price_minor === null ? "custom" : money(k.price_minor, k.currency)}` }))} value={it.package_id ?? ""} onChange={(e) => setItems((s) => s.map((x, j) => (j === i ? { ...x, package_id: e.target.value || null } : x)))} />
                    <input type="number" min={1} aria-label="Quantity" className="input" value={it.quantity} onChange={(e) => setItems((s) => s.map((x, j) => (j === i ? { ...x, quantity: Math.max(1, Number(e.target.value)) } : x)))} />
                    <span className="text-right text-xs tabular-nums">{l.price === null ? "Custom quote" : money(l.price, l.currency)}</span>
                    <button aria-label="Remove" onClick={() => setItems((s) => s.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-600"><Trash2 className="size-4" /></button>
                  </div>
                );
              })}
              <Button size="sm" icon={Plus} onClick={() => setItems((s) => [...s, { product_id: "", package_id: null, quantity: 1 }])}>Add service</Button>
            </div>
          </Field>
          <Field label="Cover note (optional)"><textarea className="input h-auto min-h-20 py-1.5" value={intro} onChange={(e) => setIntro(e.target.value)} placeholder="A short personal note shown on the cover page" /></Field>
        </div>
      )}
    </SlideOver>
  );
}

// ─── PPT deck (Claude outline → editable → .pptx) ───
export function DeckDialog({ open, onClose, account }: { open: boolean; onClose: () => void; account: Row }) {
  const avail = useAvailable();
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [template, setTemplate] = useState("website_seo_audit");
  const [audience, setAudience] = useState("");
  const [objective, setObjective] = useState("");
  const [audits, setAudits] = useState<string[]>([]);
  const [products, setProducts] = useState<string[]>([]);
  const [useAi, setUseAi] = useState(true);
  const [outline, setOutline] = useState<{ slides: Slide[]; generator: string; model: string | null; assumptions: string[]; missing_information: string[] } | null>(null);
  const [building, setBuilding] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const gen = useMutation({
    mutationFn: () => api.post<{ data: Row }>(`/accounts/${account.id}/deck-outline`, { template, audience: audience || null, objective: objective || null, audit_run_ids: audits, product_ids: products, use_ai: useAi && !!avail.data?.claude }),
    onSuccess: (r) => (setOutline(r.data as never), setSaved(null)),
    onError: (e) => toast("error", (e as Error).message),
  });
  const setSlide = (i: number, patch: Partial<Slide>) => setOutline((o) => (o ? { ...o, slides: o.slides.map((s, j) => (j === i ? { ...s, ...patch } : s)) } : o));
  const move = (i: number, d: number) => setOutline((o) => {
    if (!o) return o;
    const s = [...o.slides];
    const [x] = s.splice(i, 1);
    s.splice(Math.max(0, Math.min(s.length, i + d)), 0, x);
    return { ...o, slides: s };
  });
  const build = async () => {
    if (!outline) return;
    setBuilding(true);
    try {
      const title = `${E.labelOf(E.DECK_TEMPLATES, template)} - ${account.name}`;
      const blob = await buildPptx(outline.slides, { title, company: account.name, author: user!.name });
      const f = new FormData();
      f.set("file", new File([blob], `${title}.pptx`, { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }));
      f.set("title", title);
      f.set("template", template);
      f.set("generator", outline.generator);
      if (outline.model) f.set("model", outline.model);
      f.set("outline", JSON.stringify(outline.slides));
      const r = await api.upload<{ data: Row }>(`/accounts/${account.id}/decks`, f);
      setSaved(r.data.asset_id);
      qc.invalidateQueries({ queryKey: ["assets"] });
      toast("success", "Deck saved to Sales Assets");
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBuilding(false);
    }
  };
  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title="Generate pitch deck (.pptx)"
      subtitle={`${account.name} · Gexart master design · ${avail.data?.claude ? "outline by Claude" : "template outline"}`}
      width="max-w-5xl"
      footer={
        <>
          {saved && <a href={`/api/v1/assets/${saved}/download`}><Button icon={Download}>Download .pptx</Button></a>}
          <Button variant="primary" icon={Presentation} disabled={!outline?.slides.length} loading={building} onClick={build}>{saved ? "Rebuild & save new version" : "Build .pptx & save"}</Button>
        </>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-3">
          <Field label="Deck type"><Select options={E.DECK_TEMPLATES.options} value={template} onChange={(e) => setTemplate(e.target.value)} /></Field>
          <Field label="Audience"><input className="input" placeholder="e.g. Hospital director and marketing head" value={audience} onChange={(e) => setAudience(e.target.value)} /></Field>
          <Field label="Objective"><input className="input" placeholder="e.g. Agree a 3-month SEO + website pilot" value={objective} onChange={(e) => setObjective(e.target.value)} /></Field>
          <AuditPicker accountId={account.id} value={audits} onChange={setAudits} enabled={open} />
          <ServicePicker value={products} onChange={setProducts} />
          <label className={cn("flex items-center gap-2 text-xs", !avail.data?.claude && "opacity-60")}>
            <input type="checkbox" className="accent-brand-600" disabled={!avail.data?.claude} checked={useAi && !!avail.data?.claude} onChange={(e) => setUseAi(e.target.checked)} />
            Outline with Claude {avail.data?.claude ? "" : "(add ANTHROPIC_API_KEY to enable)"}
          </label>
          <Button variant="primary" icon={Sparkles} className="w-full" loading={gen.isPending} onClick={() => gen.mutate()}>{outline ? "Regenerate outline" : "Generate outline"}</Button>
          {outline && (outline.assumptions.length > 0 || outline.missing_information.length > 0) && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
              {outline.assumptions.length > 0 && <div><b>Assumptions:</b> {outline.assumptions.join(" · ")}</div>}
              {outline.missing_information.length > 0 && <div><b>Missing:</b> {outline.missing_information.join(" · ")}</div>}
            </div>
          )}
        </div>
        <div className="min-w-0 space-y-2">
          {!outline ? (
            <EmptyState icon={Presentation} title="Outline appears here" body="Review, reorder, edit or remove slides, then build a real PowerPoint file in the fixed Gexart design." />
          ) : (
            outline.slides.map((s, i) => (
              <Card key={i} className="p-3">
                <div className="flex items-center gap-2">
                  <Badge>{i + 1}</Badge>
                  <Select className="h-7 w-32 text-xs" options={["title", "section", "bullets", "two_column", "table", "metrics", "closing"].map((l) => ({ value: l, label: l.replace("_", " ") }))} value={s.layout} onChange={(e) => setSlide(i, { layout: e.target.value as Slide["layout"] })} />
                  <input className="input h-7 flex-1 font-medium" value={s.title} onChange={(e) => setSlide(i, { title: e.target.value })} />
                  <button aria-label="Move up" onClick={() => move(i, -1)} className="rounded p-1 text-slate-400 hover:bg-slate-100"><ArrowUp className="size-3.5" /></button>
                  <button aria-label="Move down" onClick={() => move(i, 1)} className="rounded p-1 text-slate-400 hover:bg-slate-100"><ArrowDown className="size-3.5" /></button>
                  <button aria-label="Remove slide" onClick={() => setOutline((o) => (o ? { ...o, slides: o.slides.filter((_, j) => j !== i) } : o))} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="size-3.5" /></button>
                </div>
                {s.layout === "two_column" ? (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <textarea className="input h-auto min-h-20 py-1.5 text-xs" value={[s.left_heading, ...s.left_bullets].join("\n")} onChange={(e) => { const [h, ...b] = e.target.value.split("\n"); setSlide(i, { left_heading: h ?? "", left_bullets: b }); }} />
                    <textarea className="input h-auto min-h-20 py-1.5 text-xs" value={[s.right_heading, ...s.right_bullets].join("\n")} onChange={(e) => { const [h, ...b] = e.target.value.split("\n"); setSlide(i, { right_heading: h ?? "", right_bullets: b }); }} />
                  </div>
                ) : s.layout === "table" ? (
                  <textarea className="input mt-2 h-auto min-h-20 py-1.5 font-mono text-xs" value={[s.table_headers.join(" | "), ...s.table_rows.map((r) => r.join(" | "))].join("\n")} onChange={(e) => { const [h, ...rows] = e.target.value.split("\n"); setSlide(i, { table_headers: (h ?? "").split("|").map((x) => x.trim()), table_rows: rows.filter(Boolean).map((r) => r.split("|").map((x) => x.trim())) }); }} />
                ) : s.layout === "metrics" ? (
                  <textarea className="input mt-2 h-auto min-h-16 py-1.5 text-xs" value={s.metrics.map((m) => `${m.label}: ${m.value}`).join("\n")} onChange={(e) => setSlide(i, { metrics: e.target.value.split("\n").filter(Boolean).map((l) => { const [label, ...v] = l.split(":"); return { label: label.trim(), value: v.join(":").trim() }; }) })} />
                ) : (
                  <textarea className="input mt-2 h-auto min-h-16 py-1.5 text-xs" placeholder={s.layout === "title" ? "Subtitle" : "One bullet per line"} value={s.layout === "title" ? s.subtitle : s.bullets.join("\n")} onChange={(e) => (s.layout === "title" ? setSlide(i, { subtitle: e.target.value }) : setSlide(i, { bullets: e.target.value.split("\n") }))} />
                )}
                {s.notes && <p className="mt-1 text-[11px] text-muted">Notes: {s.notes}</p>}
              </Card>
            ))
          )}
        </div>
      </div>
    </SlideOver>
  );
}

// ─── Opportunity line items ───
export function LineItemsCard({ opp, canWrite }: { opp: Row; canWrite: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const pb = usePriceBook();
  const items = useQuery({ queryKey: ["opportunities", "items", opp.id], queryFn: () => api.get<{ data: Row[] }>(`/opportunities/${opp.id}/items`).then((r) => r.data) });
  const [adding, setAdding] = useState(false);
  const [pid, setPid] = useState("");
  const [kid, setKid] = useState("");
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState("");
  const [disc, setDisc] = useState("0");
  const products = (pb.data ?? []).filter((p) => p.status === "active");
  const product = products.find((p) => p.id === pid);
  const pkg = product?.packages.find((k: Row) => k.id === kid);
  useEffect(() => {
    const v = pkg ? pkg.price_minor : product?.default_price_minor;
    setPrice(v === null || v === undefined ? "" : String(v / 100));
  }, [pid, kid]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = () => qc.invalidateQueries({ queryKey: ["opportunities"] });
  const add = useMutation({
    mutationFn: () => api.post(`/opportunities/${opp.id}/items`, { product_id: pid, package_id: kid || null, quantity: qty, unit_price_minor: Math.round(Number(price || 0) * 100), discount_pct: Number(disc || 0), billing_frequency: pkg?.billing_frequency ?? null }),
    onSuccess: () => (refresh(), setAdding(false), setPid(""), setKid(""), setQty(1)),
    onError: (e) => toast("error", (e as Error).message),
  });
  const del = useMutation({ mutationFn: (id: string) => api.del(`/opportunities/${opp.id}/items/${id}`), onSuccess: refresh });
  const apply = useMutation({ mutationFn: () => api.post(`/opportunities/${opp.id}/items/apply-total`), onSuccess: () => (refresh(), invalidateRecord(qc), toast("success", "Deal value updated from line items")) });
  const rows = items.data ?? [];
  const lineTotal = (i: Row) => Math.round(i.unit_price_minor * i.quantity * (1 - i.discount_pct / 100));
  return (
    <Card>
      <CardHeader title="Products & pricing" icon={ListPlus} subtitle="Deal-specific prices; the catalogue is not changed" action={canWrite && <div className="flex gap-1">{rows.length > 0 && <Button size="sm" loading={apply.isPending} onClick={() => apply.mutate()} title="One-time + first-year recurring">Use as deal value</Button>}<Button size="sm" icon={Plus} onClick={() => setAdding(true)}>Add</Button></div>} />
      {rows.length ? (
        <table className="w-full">
          <thead className="border-b border-line bg-slate-50/70"><tr><th className="th">Item</th><th className="th">Billing</th><th className="th text-right">Qty</th><th className="th text-right">Unit</th><th className="th text-right">Disc.</th><th className="th text-right">Total</th><th className="th" /></tr></thead>
          <tbody className="divide-y divide-line">
            {rows.map((i) => (
              <tr key={i.id}>
                <td className="td font-medium">{i.product_name}{i.package_name ? <span className="font-normal text-muted"> · {i.package_name}</span> : null}</td>
                <td className="td text-muted">{i.billing_frequency ? E.labelOf(E.PACKAGE_BILLING, i.billing_frequency) : "One-time"}</td>
                <td className="td text-right tabular-nums">{i.quantity}</td>
                <td className="td text-right tabular-nums">{money(i.unit_price_minor, i.currency)}</td>
                <td className="td text-right tabular-nums">{i.discount_pct ? `${i.discount_pct}%` : "—"}</td>
                <td className="td text-right font-medium tabular-nums">{money(lineTotal(i), i.currency)}</td>
                <td className="td text-right">{canWrite && <button aria-label="Remove" onClick={() => del.mutate(i.id)} className="text-slate-400 hover:text-red-600"><Trash2 className="size-3.5" /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="px-4 py-4 text-xs text-muted">No line items. Add services from the price book to build the quote.</p>
      )}
      <Dialog open={adding} onClose={() => setAdding(false)} title="Add line item" footer={<><Button onClick={() => setAdding(false)}>Cancel</Button><Button variant="primary" disabled={!pid} loading={add.isPending} onClick={() => add.mutate()}>Add</Button></>}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Service" className="col-span-2"><Select placeholder="Choose…" options={products.map((p) => ({ value: p.id, label: p.name }))} value={pid} onChange={(e) => (setPid(e.target.value), setKid(""))} /></Field>
          <Field label="Package" className="col-span-2"><Select placeholder="No package (catalogue price)" options={(product?.packages ?? []).map((k: Row) => ({ value: k.id, label: k.name }))} value={kid} onChange={(e) => setKid(e.target.value)} /></Field>
          <Field label="Unit price" help="Deal-specific; editable"><input type="number" min={0} className="input" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
          <Field label="Quantity"><input type="number" min={1} className="input" value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value)))} /></Field>
          <Field label="Discount %"><input type="number" min={0} max={100} className="input" value={disc} onChange={(e) => setDisc(e.target.value)} /></Field>
        </div>
      </Dialog>
    </Card>
  );
}

// ─── Competitors ───
export function CompetitorsCard({ accountId }: { accountId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["audits", "competitors", accountId], queryFn: () => api.get<{ data: Row[] }>(`/accounts/${accountId}/competitors`).then((r) => r.data) });
  const [name, setName] = useState("");
  const [site, setSite] = useState("");
  const add = useMutation({
    mutationFn: () => api.post(`/accounts/${accountId}/competitors`, { name, website: site || null }),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ["audits", "competitors", accountId] }), setName(""), setSite("")),
    onError: (e) => toast("error", (e as Error).message),
  });
  const del = useMutation({ mutationFn: (id: string) => api.del(`/accounts/${accountId}/competitors/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["audits", "competitors", accountId] }) });
  return (
    <Card>
      <CardHeader title="Competitors" icon={Swords} subtitle="Used by the competitor analysis (up to 3 with websites are compared)" />
      <ul className="divide-y divide-line px-4">
        {q.data?.map((c) => (
          <li key={c.id} className="flex items-center gap-2 py-2">
            <span className="font-medium">{c.name}</span>
            {c.website && <a href={c.website} target="_blank" rel="noreferrer noopener" className="text-xs text-brand-700">{new URL(c.website).hostname}</a>}
            <button aria-label="Remove" onClick={() => del.mutate(c.id)} className="ml-auto text-slate-400 hover:text-red-600"><Trash2 className="size-3.5" /></button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2 border-t border-line p-3">
        <input className="input w-44" placeholder="Competitor name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input w-56" placeholder="competitor.com" value={site} onChange={(e) => setSite(e.target.value)} />
        <Button icon={Plus} disabled={!name.trim()} loading={add.isPending} onClick={() => add.mutate()}>Add</Button>
      </div>
    </Card>
  );
}


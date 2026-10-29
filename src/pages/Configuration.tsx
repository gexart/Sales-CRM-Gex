// Settings → Configuration: every API key and setting in one place, saved together.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, Eye, EyeOff, KeyRound, Lock, RotateCcw, Sparkles, XCircle } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { dateTime } from "../lib/format";
import { checkConfigValue, type ConfigField, type ConfigSection } from "../../shared/config";
import { CopyButton } from "../components/outreach";
import { Button, Card, ErrorState, Skeleton, cn, useToast } from "../components/ui";

interface Value {
  key: string;
  source: "crm" | "worker" | "none";
  value: string | null;
  preview: string | null;
  updated_at: string | null;
  updated_by: string | null;
}
interface ConfigData {
  sections: ConfigSection[];
  values: Value[];
  encryption: "worker_secret" | "database_key";
  brevo_webhook_url: string | null;
}
type Test = { state: "running" | "ok" | "error"; message?: string };

const randomSecret = () => [...crypto.getRandomValues(new Uint8Array(24))].map((x) => x.toString(16).padStart(2, "0")).join("");

export function ConfigurationSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["config"], queryFn: () => api.get<{ data: ConfigData }>("/settings/config").then((r) => r.data) });
  // key → new value; null means "remove the value saved in the CRM".
  const [draft, setDraft] = useState<Record<string, string | null>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tests, setTests] = useState<Record<string, Test>>({});

  const values = new Map((q.data?.values ?? []).map((v) => [v.key, v]));
  const fields = (q.data?.sections ?? []).flatMap((s) => s.fields);
  // A secret opened with "Replace" but left empty is not a change (and must not clear the key).
  const payload = Object.fromEntries(Object.entries(draft).filter(([k, v]) => !(v === "" && fields.find((f) => f.key === k)?.kind === "secret")));
  const dirty = Object.keys(payload).length;

  const set = (f: ConfigField, v: string | null) => {
    setErrors(({ [f.key]: _, ...rest }) => rest);
    setDraft((d) => {
      const original = values.get(f.key)?.value ?? "";
      if (f.kind !== "secret" && v === original) {
        const { [f.key]: _, ...rest } = d;
        return rest;
      }
      return { ...d, [f.key]: v };
    });
  };
  const reset = (key: string) => setDraft(({ [key]: _, ...rest }) => rest);

  const save = useMutation({
    mutationFn: () => {
      const local: Record<string, string> = {};
      for (const [k, v] of Object.entries(payload)) {
        const f = fields.find((x) => x.key === k);
        const err = f && v ? checkConfigValue(f, v.trim()) : null;
        if (err) local[k] = err;
      }
      if (Object.keys(local).length) throw new ApiError(400, "validation_error", "Fix the highlighted settings", local);
      return api.put<{ data: { changed: string[] } }>("/settings/config", { values: payload });
    },
    onSuccess: () => {
      setDraft({});
      setErrors({});
      setTests({});
      qc.invalidateQueries({ queryKey: ["config"] });
      qc.invalidateQueries({ queryKey: ["integrations"] });
      qc.invalidateQueries({ queryKey: ["integrations-available"] });
      toast("success", "Settings saved");
    },
    onError: (e) => {
      if (e instanceof ApiError && e.details && typeof e.details === "object" && !Array.isArray(e.details)) setErrors(e.details as Record<string, string>);
      toast("error", (e as Error).message);
    },
  });

  const testable = fields.filter((f) => f.provider && values.get(f.key)?.source !== "none");
  const [testing, setTesting] = useState(false);
  const testAll = async () => {
    setTesting(true);
    for (const f of testable) {
      setTests((t) => ({ ...t, [f.key]: { state: "running" } }));
      try {
        const r = await api.post<{ data: { ok: boolean; error: string | null } }>(`/integrations/${f.provider}/validate`);
        setTests((t) => ({ ...t, [f.key]: r.data.ok ? { state: "ok" } : { state: "error", message: r.data.error ?? "Failed" } }));
      } catch (e) {
        setTests((t) => ({ ...t, [f.key]: { state: "error", message: (e as Error).message } }));
      }
    }
    setTesting(false);
    qc.invalidateQueries({ queryKey: ["integrations"] });
  };

  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.isError) return <ErrorState error={q.error} />;
  const data = q.data!;
  const setCount = fields.filter((f) => values.get(f.key)?.source !== "none").length;

  return (
    <div className="mx-auto max-w-4xl space-y-4 pb-24">
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-4 bg-night p-5 text-white sm:flex-row sm:items-center">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
            <KeyRound className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold">Set up everything in one place</div>
            <p className="mt-0.5 text-xs text-white/60">
              Paste your keys, then save once. {setCount} of {fields.length} settings are set. Values saved here take effect within seconds and override Cloudflare Worker secrets of the same name.
            </p>
          </div>
          <Button icon={Sparkles} loading={testing} disabled={!testable.length || dirty > 0} title={dirty ? "Save your changes first" : undefined} onClick={testAll} className="border-white/20 bg-white/10 text-white hover:bg-white/20">
            Test connections
          </Button>
        </div>
        <div className="flex items-start gap-2 px-5 py-3 text-xs text-muted">
          <Lock className="mt-0.5 size-3.5 shrink-0 text-ink" />
          <span>
            Keys are encrypted before they are stored and are never shown again, only their last four characters.
            {data.encryption === "database_key" && " For extra separation, add a SETTINGS_ENCRYPTION_KEY Worker secret before saving keys (keys saved earlier must then be re-entered)."}
          </span>
        </div>
      </Card>

      {data.sections.map((s) => {
        const done = s.fields.filter((f) => values.get(f.key)?.source !== "none").length;
        return (
          <Card key={s.id}>
            <div className="flex items-start gap-3 border-b border-line px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold">{s.title}</h2>
                <p className="mt-0.5 text-xs text-muted">{s.description}</p>
              </div>
              <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums", done === s.fields.length ? "bg-ink text-white" : "bg-brand-50 text-muted")}>
                {done}/{s.fields.length} set
              </span>
            </div>
            <div className="grid gap-x-6 gap-y-5 p-5 md:grid-cols-2">
              {s.fields.map((f) => (
                <FieldRow
                  key={f.key}
                  f={f}
                  v={values.get(f.key)!}
                  draft={f.key in draft ? draft[f.key] : undefined}
                  error={errors[f.key]}
                  test={tests[f.key]}
                  onChange={(v) => set(f, v)}
                  onReset={() => reset(f.key)}
                />
              ))}
            </div>
            {s.id === "email" && data.brevo_webhook_url && (
              <div className="flex flex-wrap items-center gap-2 border-t border-line bg-canvas px-5 py-3 text-xs">
                <span className="font-medium">Brevo webhook URL</span>
                <code className="min-w-0 flex-1 truncate rounded border border-line bg-white px-2 py-1">{data.brevo_webhook_url}</code>
                <CopyButton text={data.brevo_webhook_url} label="Copy URL" />
              </div>
            )}
          </Card>
        );
      })}

      {dirty > 0 && (
        <div className="fixed inset-x-0 bottom-5 z-30 flex justify-center px-4">
          <div className="flex items-center gap-3 rounded-full bg-night py-2 pr-2 pl-5 text-sm text-white shadow-[var(--shadow-pop)] ring-1 ring-white/10">
            <span className="tabular-nums">{dirty} unsaved {dirty === 1 ? "change" : "changes"}</span>
            <button className="rounded-full px-3 py-1.5 text-xs text-white/70 hover:bg-white/10 hover:text-white" onClick={() => (setDraft({}), setErrors({}))}>
              Discard
            </button>
            <Button size="sm" loading={save.isPending} onClick={() => save.mutate()} className="rounded-full border-white bg-white text-ink hover:bg-white/90">
              Save changes
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function FieldRow({ f, v, draft, error, test, onChange, onReset }: { f: ConfigField; v: Value; draft: string | null | undefined; error?: string; test?: Test; onChange: (v: string | null) => void; onReset: () => void }) {
  const [show, setShow] = useState(false);
  const secret = f.kind === "secret";
  const editing = draft !== undefined && draft !== null;
  const removing = draft === null;
  const source = v.source === "crm" ? "Saved in CRM" : v.source === "worker" ? (secret ? "Cloudflare secret" : "Default") : null;

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <label htmlFor={`cfg-${f.key}`} className="text-xs font-medium text-ink">{f.label}</label>
        {source && !editing && !removing && <span className="rounded bg-brand-50 px-1.5 py-px text-[10px] font-medium text-muted">{source}</span>}
        {test && <TestBadge t={test} />}
        {f.link && (
          <a href={f.link} target="_blank" rel="noreferrer noopener" className="ml-auto inline-flex items-center gap-0.5 text-[11px] text-muted hover:text-ink">
            Get key <ExternalLink className="size-3" />
          </a>
        )}
      </div>

      {secret && !editing && !removing && v.source !== "none" ? (
        <div className="flex h-9 items-center gap-2 rounded-md border border-line bg-canvas pr-1 pl-3 text-[13px]">
          <Lock className="size-3.5 text-muted" />
          <span className="flex-1 font-mono text-xs tracking-wider text-muted">{v.preview}</span>
          <button className="rounded px-2 py-1 text-xs font-medium hover:bg-white" onClick={() => onChange("")}>Replace</button>
          {v.source === "crm" && <button className="rounded px-2 py-1 text-xs text-red-600 hover:bg-white" onClick={() => onChange(null)}>Remove</button>}
        </div>
      ) : removing ? (
        <div className="flex h-9 items-center gap-2 rounded-md border border-dashed border-red-300 bg-red-50/50 px-3 text-xs text-red-700">
          <span className="flex-1">Will be removed when you save</span>
          <button className="inline-flex items-center gap-1 font-medium hover:underline" onClick={onReset}><RotateCcw className="size-3" /> Undo</button>
        </div>
      ) : (
        <div className="relative flex gap-2">
          <div className="relative flex-1">
            <input
              id={`cfg-${f.key}`}
              className={cn("input h-9", secret && "pr-9 font-mono text-xs", error && "border-red-400 focus:border-red-500")}
              type={secret && !show ? "password" : "text"}
              inputMode={f.kind === "number" ? "numeric" : undefined}
              autoComplete="off"
              spellCheck={false}
              placeholder={f.placeholder ?? (secret ? "Paste key" : "")}
              value={editing ? draft! : (v.value ?? "")}
              onChange={(e) => onChange(e.target.value)}
              autoFocus={secret && editing && draft === ""}
            />
            {secret && (
              <button type="button" aria-label={show ? "Hide" : "Show"} className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted hover:text-ink" onClick={() => setShow(!show)}>
                {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
            )}
          </div>
          {f.key === "BREVO_WEBHOOK_SECRET" && (
            <Button size="sm" className="h-9" onClick={() => (onChange(randomSecret()), setShow(true))}>Generate</Button>
          )}
          {secret && editing && v.source !== "none" && (
            <Button size="sm" variant="ghost" className="h-9" onClick={onReset}>Cancel</Button>
          )}
        </div>
      )}

      {error ? (
        <p className="mt-1 text-xs text-red-600">{error}</p>
      ) : test?.state === "error" ? (
        <p className="mt-1 text-xs text-red-600">{test.message}</p>
      ) : (
        <p className="mt-1 text-[11px] text-muted">
          {f.help}
          {v.updated_at && v.source === "crm" && !editing && <span className="text-stone-400"> · Updated {dateTime(v.updated_at)}{v.updated_by ? ` by ${v.updated_by}` : ""}</span>}
        </p>
      )}
    </div>
  );
}

function TestBadge({ t }: { t: Test }) {
  if (t.state === "running") return <span className="text-[10px] text-muted">Testing…</span>;
  if (t.state === "ok") return <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-emerald-700"><CheckCircle2 className="size-3" /> Connected</span>;
  return <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-red-600"><XCircle className="size-3" /> Failed</span>;
}

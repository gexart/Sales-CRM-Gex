import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronDown, X } from "lucide-react";
import { api, ApiError, qs, type Page, type Row } from "../lib/api";
import { REF_SOURCES, type EntityConfig, type FieldDef, type RefKind } from "../lib/entities";
import { fromLocalInput, toLocalInput } from "../lib/format";
import { useAuth } from "../lib/auth";
import { Button, Field, Select, SlideOver, cn, useToast } from "./ui";

export function useUsers() {
  return useQuery({ queryKey: ["users"], queryFn: () => api.get<{ data: Row[] }>("/users").then((r) => r.data), staleTime: 5 * 60_000 });
}

function useDebounced<T>(value: T, ms = 200) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
export { useDebounced };

function useRefOptions(kind: RefKind, search: string, enabled: boolean, extra?: Record<string, string>) {
  const users = useUsers();
  const term = useDebounced(search);
  const src = REF_SOURCES[kind];
  const q = useQuery({
    queryKey: ["ref", kind, term, extra],
    queryFn: () => api.get<Page<Row>>(`${src.path}${qs({ q: term, pageSize: 20, sort: kind === "products" ? "name" : undefined, dir: "asc", ...extra })}`).then((r) => r.data),
    enabled: enabled && kind !== "users",
    placeholderData: (prev) => prev,
  });
  if (kind === "users") {
    const all = users.data ?? [];
    const t = term.toLowerCase();
    return { rows: all.filter((u) => !t || u.name.toLowerCase().includes(t) || u.email.toLowerCase().includes(t)), loading: users.isLoading };
  }
  return { rows: q.data ?? [], loading: q.isFetching };
}

export function RefSelect({ kind, value, label, onChange, placeholder = "Select…", invalid, filter, id }: { kind: RefKind; value: string | null; label?: string | null; onChange: (id: string | null, row?: Row) => void; placeholder?: string; invalid?: boolean; filter?: Record<string, string>; id?: string }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string | null>(label ?? null);
  const ref = useRef<HTMLDivElement>(null);
  const { rows, loading } = useRefOptions(kind, search, open, filter);
  const src = REF_SOURCES[kind];
  const users = useUsers();
  const display = value ? (picked ?? (kind === "users" ? users.data?.find((u) => u.id === value)?.name : null) ?? "Selected") : null;
  useEffect(() => setPicked(label ?? null), [label]);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button id={id} type="button" aria-invalid={invalid} aria-haspopup="listbox" onClick={() => setOpen((o) => !o)} className="input flex items-center justify-between gap-2 text-left">
        <span className={cn("truncate", !display && "text-slate-400")}>{display ?? placeholder}</span>
        <span className="flex items-center gap-0.5">
          {value && (
            <span
              role="button"
              aria-label="Clear"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
                setPicked(null);
              }}
              className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="size-3" />
            </span>
          )}
          <ChevronDown className="size-3.5 text-slate-400" />
        </span>
      </button>
      {open && (
        <div className="absolute z-40 mt-1 w-full min-w-60 animate-pop-in rounded-lg border border-line bg-white shadow-[var(--shadow-pop)]">
          <div className="border-b border-line p-1.5">
            <input autoFocus className="input h-7" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <ul role="listbox" className="max-h-60 overflow-y-auto p-1">
            {rows.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={r.id === value}
                  onClick={() => {
                    onChange(r.id, r);
                    setPicked(src.label(r));
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-slate-100"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{src.label(r)}</span>
                    {src.sub?.(r) && <span className="block truncate text-xs text-muted">{src.sub(r)}</span>}
                  </span>
                  {r.id === value && <Check className="size-3.5 text-brand-600" />}
                </button>
              </li>
            ))}
            {!rows.length && <li className="px-2 py-3 text-center text-xs text-muted">{loading ? "Loading…" : "No matches"}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

export function MultiRefSelect({ kind, value, onChange }: { kind: RefKind; value: string[]; onChange: (ids: string[]) => void }) {
  const { rows } = useRefOptions(kind, "", true, { pageSize: "100" });
  const src = REF_SOURCES[kind];
  return (
    <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto rounded-md border border-line p-2">
      {rows.map((r) => {
        const on = value.includes(r.id);
        return (
          <button
            key={r.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== r.id) : [...value, r.id])}
            className={cn("rounded-full border px-2 py-0.5 text-xs transition-colors", on ? "border-brand-300 bg-brand-50 text-brand-700" : "border-line text-slate-600 hover:bg-slate-50")}
          >
            {src.label(r)}
          </button>
        );
      })}
      {!rows.length && <span className="text-xs text-muted">Loading…</span>}
    </div>
  );
}

// ─── Value conversion between API rows and form state ───
function toForm(f: FieldDef, v: unknown): unknown {
  if (f.type === "money") return v === null || v === undefined ? "" : String(Number(v) / 100);
  if (f.type === "datetime") return toLocalInput(v as string);
  if (f.type === "multiref") return Array.isArray(v) ? v : [];
  return v ?? "";
}
function fromForm(f: FieldDef, v: unknown): unknown {
  if (f.type === "money") return v === "" || v === null ? null : Math.round(Number(v) * 100);
  if (f.type === "number") return v === "" || v === null ? undefined : Number(v);
  if (f.type === "datetime") return fromLocalInput(v as string);
  if (f.type === "ref") return v || null;
  return v;
}

function zodFieldErrors(cfg: EntityConfig, data: Row): Record<string, string> {
  const r = cfg.schema.safeParse(data);
  if (r.success) return {};
  const out: Record<string, string> = {};
  for (const i of r.error.issues) out[String(i.path[0])] ??= i.message;
  return out;
}

export function EntityForm({ cfg, open, onClose, record, defaults, onSaved }: { cfg: EntityConfig; open: boolean; onClose: () => void; record?: Row | null; defaults?: Row; onSaved?: (row: Row) => void }) {
  const { isManager } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const editing = !!record?.id;
  const fields = useMemo(() => cfg.fields.filter((f) => (!f.managerOnly || isManager) && (!f.editOnly || editing)), [cfg, isManager, editing]);
  const initial = useMemo(() => {
    const base: Row = {};
    const shape = cfg.schema.shape as Record<string, { def?: unknown; _zod?: { def?: { defaultValue?: unknown } } }>;
    for (const f of fields) {
      let v = record?.[f.name];
      if (f.name === "product_ids" && record?.product_ids_json) v = JSON.parse(record.product_ids_json).filter(Boolean);
      if (v === undefined && defaults && f.name in defaults) v = defaults[f.name];
      if (v === undefined && !editing) v = shape[f.name]?._zod?.def?.defaultValue;
      base[f.name] = toForm(f, v);
    }
    return base;
  }, [fields, record, defaults, editing, cfg]);
  const [values, setValues] = useState<Row>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dupes, setDupes] = useState<Row[] | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [labels, setLabels] = useState<Row>({});
  useEffect(() => {
    if (open) {
      setValues(initial);
      setErrors({});
      setDupes(null);
      setFormError(null);
      setLabels({});
    }
  }, [open, initial]);

  const save = useMutation({
    mutationFn: async (force: boolean) => {
      const payload: Row = {};
      for (const f of fields) {
        const v = fromForm(f, values[f.name]);
        // When editing, send only changed fields so concurrent edits elsewhere are not overwritten.
        if (editing && JSON.stringify(v ?? null) === JSON.stringify(fromForm(f, initial[f.name]) ?? null)) continue;
        if (v !== undefined) payload[f.name] = v;
      }
      if (force) payload.force = true;
      if (!editing) {
        const errs = zodFieldErrors(cfg, payload);
        if (Object.keys(errs).length) throw new ApiError(400, "validation_error", "Please fix the highlighted fields", Object.entries(errs).map(([path, message]) => ({ path, message })));
      }
      return editing ? api.patch(`/${cfg.route}/${record!.id}`, payload) : api.post(`/${cfg.route}`, payload);
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: [cfg.route] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["ref"] });
      toast("success", `${cfg.label} ${editing ? "updated" : "created"}`);
      onSaved?.(r.data);
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "possible_duplicate") {
        setDupes(((e.details as { matches?: Row[] })?.matches ?? []) as Row[]);
        return;
      }
      if (e instanceof ApiError && Object.keys(e.fieldErrors).length) setErrors(e.fieldErrors);
      setFormError(e instanceof Error ? e.message : "Could not save");
    },
  });

  const set = (name: string, v: unknown) => {
    setValues((s) => ({ ...s, [name]: v }));
    if (errors[name]) setErrors(({ [name]: _, ...rest }) => rest);
  };

  let lastSection: string | undefined;
  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${cfg.label.toLowerCase()}` : `New ${cfg.label.toLowerCase()}`}
      subtitle={editing ? cfg.titleOf(record!) : undefined}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending && !dupes} onClick={() => save.mutate(false)} form="entity-form">
            {editing ? "Save changes" : `Create ${cfg.label.toLowerCase()}`}
          </Button>
        </>
      }
    >
      <form
        id="entity-form"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(false);
        }}
        className="grid grid-cols-2 gap-x-3 gap-y-3"
      >
        {dupes && (
          <div className="col-span-2 rounded-md border border-amber-200 bg-amber-50 p-3">
            <div className="flex items-center gap-2 font-medium text-amber-900">
              <AlertTriangle className="size-4" /> Possible duplicate
            </div>
            <ul className="mt-1.5 space-y-0.5 text-xs text-amber-900">
              {dupes.map((d) => (
                <li key={d.id}>
                  {d.kind ? `${d.kind}: ` : ""}
                  <b>{d.name}</b>
                  {[d.account_name, d.website, d.email, d.phone, d.city].filter(Boolean).map((x) => ` · ${x}`)}
                </li>
              ))}
            </ul>
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={() => setDupes(null)}>
                Review my entry
              </Button>
              <Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate(true)}>
                It's different — save anyway
              </Button>
            </div>
          </div>
        )}
        {formError && !dupes && <div className="col-span-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{formError}</div>}
        {fields.map((f) => {
          const header = f.section && f.section !== lastSection ? f.section : null;
          if (f.section) lastSection = f.section;
          const id = `f-${f.name}`;
          const err = errors[f.name];
          const v = values[f.name];
          const labelKey = f.name.replace(/_id$/, "_name");
          let control;
          switch (f.type) {
            case "textarea":
              control = <textarea id={id} aria-invalid={!!err} className="input h-auto min-h-20 py-1.5" rows={3} value={v as string} onChange={(e) => set(f.name, e.target.value)} />;
              break;
            case "select":
              control = <Select id={id} aria-invalid={!!err} options={f.options!} placeholder={f.required ? undefined : "—"} value={v as string} onChange={(e) => set(f.name, e.target.value)} />;
              break;
            case "ref":
              control = (
                <RefSelect
                  id={id}
                  kind={f.ref!}
                  value={(v as string) || null}
                  label={labels[f.name] ?? record?.[labelKey] ?? defaults?.[labelKey]}
                  invalid={!!err}
                  filter={f.name === "primary_contact_id" && values.account_id ? { account_id: values.account_id as string } : undefined}
                  onChange={(nv, row) => {
                    set(f.name, nv);
                    if (row) setLabels((l) => ({ ...l, [f.name]: REF_SOURCES[f.ref!].label(row) }));
                  }}
                />
              );
              break;
            case "multiref":
              control = <MultiRefSelect kind={f.ref!} value={v as string[]} onChange={(ids) => set(f.name, ids)} />;
              break;
            default:
              control = (
                <input
                  id={id}
                  aria-invalid={!!err}
                  className="input"
                  type={f.type === "money" || f.type === "number" ? "number" : f.type === "datetime" ? "datetime-local" : f.type === "date" ? "date" : f.type === "email" ? "email" : "text"}
                  step={f.type === "money" ? "0.01" : undefined}
                  min={f.type === "money" || f.type === "number" ? 0 : undefined}
                  placeholder={f.placeholder}
                  value={v as string}
                  onChange={(e) => set(f.name, e.target.value)}
                />
              );
          }
          return [
            header && (
              <div key={`h-${header}`} className="col-span-2 mt-2 border-b border-line pb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase first:mt-0">
                {header}
              </div>
            ),
            <Field key={f.name} label={f.label} required={f.required} error={err} help={f.help} className={f.wide || f.type === "textarea" ? "col-span-2" : "col-span-2 sm:col-span-1"}>
              {control}
            </Field>,
          ];
        })}
        <button type="submit" hidden />
      </form>
    </SlideOver>
  );
}

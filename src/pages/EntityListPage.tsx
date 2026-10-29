import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Columns3, Download, Plus, Search, SlidersHorizontal, X } from "lucide-react";
import { api, qs, type Page, type Row } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { EntityConfig } from "../lib/entities";
import { PageHeader } from "../components/layout";
import { EntityForm, RefSelect, useDebounced } from "../components/forms";
import { Button, Card, EmptyState, ErrorState, Menu, Select, Skeleton, cn } from "../components/ui";

const EXPORTABLE = ["accounts", "contacts", "prospects", "opportunities", "tasks", "products"];

function loadHidden(key: string, cfg: EntityConfig): string[] {
  try {
    const v = localStorage.getItem(`gx-cols-${key}`);
    if (v) return JSON.parse(v);
  } catch {
    /* storage unavailable */
  }
  return cfg.columns.filter((c) => c.hidden).map((c) => c.key);
}

export function useEntityList(cfg: EntityConfig, params: Record<string, string | number | undefined>) {
  return useQuery({
    queryKey: [cfg.route, "list", params],
    queryFn: () => api.get<Page<Row>>(`/${cfg.route}${qs(params)}`),
    placeholderData: (prev) => prev,
  });
}

export function DataTable({ cfg, rows, loading, sort, dir, onSort, hidden, onRowClick, emptyState }: { cfg: EntityConfig; rows: Row[]; loading: boolean; sort?: string; dir?: string; onSort?: (s: string) => void; hidden?: string[]; onRowClick: (r: Row) => void; emptyState?: ReactNode }) {
  const cols = cfg.columns.filter((c) => !hidden?.includes(c.key));
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead className="border-b border-line bg-slate-50/70">
          <tr>
            {cols.map((c) => (
              <th key={c.key} className={cn("th", c.className?.includes("text-right") && "text-right")}>
                {c.sort && onSort ? (
                  <button onClick={() => onSort(c.sort!)} className="inline-flex items-center gap-1 uppercase hover:text-ink">
                    {c.label}
                    {sort === c.sort && (dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                  </button>
                ) : (
                  c.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {loading && !rows.length
            ? Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}>
                  {cols.map((c) => (
                    <td key={c.key} className="td">
                      <Skeleton className="w-24" />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((r) => (
                <tr
                  key={r.id}
                  tabIndex={0}
                  onClick={() => onRowClick(r)}
                  onKeyDown={(e) => e.key === "Enter" && onRowClick(r)}
                  className={cn("cursor-pointer transition-colors hover:bg-slate-50 focus:bg-brand-50/50 focus:outline-none", r.archived_at && "opacity-60")}
                >
                  {cols.map((c) => (
                    <td key={c.key} className={cn("td", c.className)}>
                      {c.render ? c.render(r) : (r[c.key] ?? <span className="text-slate-400">—</span>)}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
      {!loading && !rows.length && emptyState}
    </div>
  );
}

export function EntityListPage({ cfg, headerExtra, toolbarExtra, presets, view, onCreate, intro }: { cfg: EntityConfig; headerExtra?: ReactNode; toolbarExtra?: ReactNode; presets?: Record<string, string>; view?: (rows: Row[], loading: boolean) => ReactNode; onCreate?: () => void; intro?: ReactNode }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [search, setSearch] = useState(sp.get("q") ?? "");
  const term = useDebounced(search, 250);
  const [hidden, setHidden] = useState<string[]>(() => loadHidden(cfg.key, cfg));
  const [creating, setCreating] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const canWrite = cfg.writeRoles.includes(user!.role);
  const startCreate = () => (onCreate ? onCreate() : setCreating(true));

  const page = Number(sp.get("page") ?? 1);
  const sort = sp.get("sort") ?? cfg.defaultSort;
  const dir = sp.get("dir") ?? cfg.defaultDir ?? "desc";
  const archived = sp.get("archived") ?? "";
  const filterValues = Object.fromEntries(cfg.filters.map((f) => [f.name, sp.get(f.name) ?? ""]));
  const activeFilters = Object.values(filterValues).filter(Boolean).length;

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) v ? next.set(k, v) : next.delete(k);
    if (!("page" in patch)) next.delete("page");
    setSp(next, { replace: true });
  };
  useEffect(() => {
    if ((sp.get("q") ?? "") !== term) update({ q: term || null });
  }, [term]); // eslint-disable-line react-hooks/exhaustive-deps

  const params = useMemo(
    () => ({ q: term, page, pageSize: view ? 100 : 25, sort, dir, archived, ...filterValues, ...presets }),
    [term, page, sort, dir, archived, JSON.stringify(filterValues), JSON.stringify(presets), !!view], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const list = useEntityList(cfg, params);
  const rows = list.data?.data ?? [];
  const meta = list.data?.meta;
  const pages = meta ? Math.max(1, Math.ceil(meta.total / meta.pageSize)) : 1;

  const toggleCol = (key: string) => {
    const next = hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key];
    setHidden(next);
    try {
      localStorage.setItem(`gx-cols-${cfg.key}`, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="pb-8">
      <PageHeader
        title={cfg.plural}
        icon={cfg.icon}
        subtitle={meta ? `${meta.total.toLocaleString()} ${meta.total === 1 ? cfg.label.toLowerCase() : cfg.plural.toLowerCase()}${archived === "1" ? " archived" : ""}` : " "}
        actions={
          <>
            {headerExtra}
            {canWrite && (
              <Button variant="primary" icon={Plus} onClick={startCreate}>
                New {cfg.label.toLowerCase()}
              </Button>
            )}
          </>
        }
      />
      <div className="space-y-3 px-4 sm:px-6">
        {intro}
        <Card>
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-2.5">
            <div className="relative min-w-52 flex-1 sm:max-w-sm">
              <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-slate-400" />
              <input className="input pl-8" placeholder={cfg.searchPlaceholder} value={search} onChange={(e) => setSearch(e.target.value)} aria-label={`Search ${cfg.plural}`} />
            </div>
            <Button icon={SlidersHorizontal} onClick={() => setShowFilters((s) => !s)} className={cn(activeFilters && "border-brand-300 text-ink")}>
              Filters{activeFilters ? ` · ${activeFilters}` : ""}
            </Button>
            {toolbarExtra}
            <div className="ml-auto flex items-center gap-2">
              {EXPORTABLE.includes(cfg.route) && (
                <a href={`/api/v1/imports/export/${cfg.route}.csv${qs(Object.fromEntries(Object.entries(filterValues).filter(([, v]) => v)))}`} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-white px-3 text-[13px] font-medium shadow-[var(--shadow-card)] hover:bg-slate-50" title="Export the records you can see (current filters)">
                  <Download className="size-3.5" /> <span className="max-sm:hidden">Export</span>
                </a>
              )}
              <Select
                aria-label="Show"
                className="w-32"
                value={archived}
                onChange={(e) => update({ archived: e.target.value || null })}
                options={[
                  { value: "", label: "Active" },
                  { value: "1", label: "Archived" },
                  { value: "all", label: "All" },
                ]}
              />
              {!view && (
                <Menu
                  width="w-52"
                  trigger={(p) => (
                    <Button {...p} icon={Columns3} aria-label="Columns">
                      <span className="max-sm:hidden">Columns</span>
                    </Button>
                  )}
                >
                  {() =>
                    cfg.columns.map((c, i) => (
                      <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-slate-50">
                        <input type="checkbox" disabled={i === 0} checked={!hidden.includes(c.key)} onChange={() => toggleCol(c.key)} className="accent-brand-600" />
                        {c.label}
                      </label>
                    ))
                  }
                </Menu>
              )}
            </div>
          </div>
          {showFilters && (
            <div className="flex flex-wrap items-end gap-2 border-b border-line bg-slate-50/50 p-2.5">
              {cfg.filters.map((f) => (
                <div key={f.name} className="w-44">
                  <label className="label">{f.label}</label>
                  {f.ref ? (
                    <RefSelect kind={f.ref} value={filterValues[f.name] || null} onChange={(v) => update({ [f.name]: v })} placeholder="Any" />
                  ) : (
                    <Select options={f.options!} placeholder="Any" value={filterValues[f.name]} onChange={(e) => update({ [f.name]: e.target.value || null })} />
                  )}
                </div>
              ))}
              {activeFilters > 0 && (
                <Button variant="ghost" icon={X} onClick={() => update(Object.fromEntries(cfg.filters.map((f) => [f.name, null])))}>
                  Clear
                </Button>
              )}
            </div>
          )}
          {list.isError ? (
            <div className="p-3">
              <ErrorState error={list.error} onRetry={() => list.refetch()} />
            </div>
          ) : view ? (
            view(rows, list.isLoading)
          ) : (
            <DataTable
              cfg={cfg}
              rows={rows}
              loading={list.isLoading}
              sort={sort}
              dir={dir}
              hidden={hidden}
              onSort={(s) => update({ sort: s, dir: sort === s && dir === "desc" ? "asc" : "desc" })}
              onRowClick={(r) => nav(cfg.path(r.id))}
              emptyState={
                <EmptyState
                  icon={cfg.icon}
                  title={term || activeFilters ? `No ${cfg.plural.toLowerCase()} match` : `No ${cfg.plural.toLowerCase()} yet`}
                  body={term || activeFilters ? "Try a different search or clear the filters." : undefined}
                  action={
                    canWrite && !term && !activeFilters && archived !== "1" ? (
                      <Button variant="primary" icon={Plus} onClick={startCreate}>
                        New {cfg.label.toLowerCase()}
                      </Button>
                    ) : undefined
                  }
                />
              }
            />
          )}
          {!view && meta && meta.total > meta.pageSize && (
            <div className="flex items-center justify-between border-t border-line px-3 py-2 text-xs text-muted">
              <span>
                {(meta.page - 1) * meta.pageSize + 1}–{Math.min(meta.page * meta.pageSize, meta.total)} of {meta.total.toLocaleString()}
              </span>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" icon={ChevronLeft} disabled={page <= 1} onClick={() => update({ page: String(page - 1) })} aria-label="Previous page" />
                <span className="px-1">
                  Page {page} / {pages}
                </span>
                <Button size="sm" variant="ghost" icon={ChevronRight} disabled={page >= pages} onClick={() => update({ page: String(page + 1) })} aria-label="Next page" />
              </div>
            </div>
          )}
        </Card>
      </div>
      <EntityForm cfg={cfg} open={creating} onClose={() => setCreating(false)} defaults={presets} onSaved={(r) => nav(cfg.path(r.id))} />
    </div>
  );
}

import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Columns3, List } from "lucide-react";
import { api, type Page, type Row } from "../lib/api";
import { CONFIGS } from "../lib/entities";
import * as E from "../../shared/enums";
import { date, money } from "../lib/format";
import { EntityListPage } from "./EntityListPage";
import { Button, Dialog, Field, Skeleton, cn, useToast } from "../components/ui";

function Board({ rows, loading }: { rows: Row[]; loading: boolean }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [closing, setClosing] = useState<{ id: string; stage: string } | null>(null);
  const [reason, setReason] = useState("");
  const move = useMutation({
    mutationFn: ({ id, stage, win_loss_reason }: { id: string; stage: string; win_loss_reason?: string }) => api.patch(`/opportunities/${id}`, { stage, ...(win_loss_reason !== undefined ? { win_loss_reason } : {}) }),
    // Optimistic move with rollback on failure.
    onMutate: async ({ id, stage }) => {
      await qc.cancelQueries({ queryKey: ["opportunities", "list"] });
      const snapshots = qc.getQueriesData<Page<Row>>({ queryKey: ["opportunities", "list"] });
      for (const [key, data] of snapshots) {
        if (data) qc.setQueryData(key, { ...data, data: data.data.map((r) => (r.id === id ? { ...r, stage, probability: E.STAGE_PROBABILITY[stage] } : r)) });
      }
      return { snapshots };
    },
    onError: (e, _v, ctx) => {
      ctx?.snapshots.forEach(([key, data]) => qc.setQueryData(key, data));
      toast("error", (e as Error).message);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["opportunities"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
  const drop = (stage: string) => {
    setOver(null);
    const r = rows.find((x) => x.id === dragId);
    setDragId(null);
    if (!r || r.stage === stage) return;
    if (E.CLOSED_STAGES.includes(stage)) setClosing({ id: r.id, stage });
    else move.mutate({ id: r.id, stage });
  };
  if (loading && !rows.length) return <div className="flex gap-3 p-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-64 w-64" />)}</div>;
  return (
    <div className="flex gap-2.5 overflow-x-auto p-3">
      {E.OPPORTUNITY_STAGES.options.map((s) => {
        const items = rows.filter((r) => r.stage === s.value);
        const total = items.reduce((sum, r) => sum + Number(r.amount_minor ?? 0), 0);
        return (
          <div
            key={s.value}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(s.value);
            }}
            onDragLeave={() => setOver((o) => (o === s.value ? null : o))}
            onDrop={() => drop(s.value)}
            className={cn("flex w-60 shrink-0 flex-col rounded-lg bg-slate-50 ring-1 ring-line transition-colors", over === s.value && "bg-brand-50 ring-brand-300")}
          >
            <div className="px-2.5 pt-2 pb-1.5">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                <span className="truncate">{s.label}</span>
                <span className="rounded bg-white px-1 text-[10px] text-slate-500 ring-1 ring-line">{items.length}</span>
              </div>
              <div className="text-[11px] text-muted tabular-nums">{money(total, items[0]?.currency ?? "INR", true)}</div>
            </div>
            <div className="flex min-h-24 flex-1 flex-col gap-1.5 px-1.5 pb-2">
              {items.map((r) => (
                <div
                  key={r.id}
                  draggable
                  tabIndex={0}
                  onDragStart={() => setDragId(r.id)}
                  onDragEnd={() => setDragId(null)}
                  onClick={() => nav(`/opportunities/${r.id}`)}
                  onKeyDown={(e) => e.key === "Enter" && nav(`/opportunities/${r.id}`)}
                  className={cn("cursor-grab rounded-md border border-line bg-white p-2 shadow-[var(--shadow-card)] transition hover:border-brand-300 active:cursor-grabbing", dragId === r.id && "opacity-40")}
                >
                  <div className="truncate text-[13px] font-medium">{r.name}</div>
                  <div className="truncate text-xs text-muted">{r.account_name}</div>
                  <div className="mt-1 flex items-center justify-between text-[11px]">
                    <span className="font-semibold tabular-nums">{money(r.amount_minor, r.currency, true)}</span>
                    <span className="text-muted">{r.probability}% · {date(r.expected_close_date, { day: "numeric", month: "short" })}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      <Dialog
        open={!!closing}
        onClose={() => setClosing(null)}
        title={closing?.stage === "closed_won" ? "Mark as won" : "Mark as lost"}
        footer={
          <>
            <Button onClick={() => setClosing(null)}>Cancel</Button>
            <Button
              variant={closing?.stage === "closed_lost" ? "danger" : "primary"}
              onClick={() => {
                move.mutate({ ...closing!, win_loss_reason: reason });
                setClosing(null);
                setReason("");
              }}
            >
              Confirm
            </Button>
          </>
        }
      >
        <Field label="Reason" help="Recorded for win/loss analysis.">
          <textarea autoFocus className="input h-auto min-h-20 py-1.5" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Dialog>
    </div>
  );
}

export function OpportunitiesPage() {
  const [sp, setSp] = useSearchParams();
  const board = sp.get("view") !== "list";
  const toggle = (
    <div className="flex rounded-md border border-line bg-white p-0.5 shadow-[var(--shadow-card)]">
      {[
        { v: "board", icon: Columns3, label: "Board" },
        { v: "list", icon: List, label: "List" },
      ].map(({ v, icon: I, label }) => (
        <button
          key={v}
          onClick={() => {
            const n = new URLSearchParams(sp);
            v === "board" ? n.delete("view") : n.set("view", v);
            setSp(n, { replace: true });
          }}
          className={cn("flex h-7 items-center gap-1 rounded px-2 text-xs font-medium", (v === "board") === board ? "bg-slate-100 text-ink" : "text-slate-500 hover:text-ink")}
        >
          <I className="size-3.5" /> {label}
        </button>
      ))}
    </div>
  );
  return <EntityListPage cfg={CONFIGS.opportunities} headerExtra={toggle} view={board ? (rows, loading) => <Board rows={rows} loading={loading} /> : undefined} />;
}

export function TasksPage() {
  const [sp, setSp] = useSearchParams();
  const view = sp.get("view") ?? "open";
  // Computed once per view so the query key stays stable between renders.
  const presets = useMemo<Record<string, Record<string, string>>>(() => {
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return {
      open: { open: "1" },
      today: { open: "1", due_after: startOfDay.toISOString(), due_before: endOfDay.toISOString() },
      overdue: { open: "1", due_before: new Date().toISOString() },
      mine: { open: "1", mine: "1" },
      all: {},
    };
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps
  const tabs = [
    { v: "open", label: "Open" },
    { v: "today", label: "Due today" },
    { v: "overdue", label: "Overdue" },
    { v: "mine", label: "Mine" },
    { v: "all", label: "All" },
  ];
  return (
    <EntityListPage
      key={view}
      cfg={CONFIGS.tasks}
      presets={presets[view] ?? presets.open}
      toolbarExtra={
        <div className="flex rounded-md border border-line bg-white p-0.5">
          {tabs.map((t) => (
            <button
              key={t.v}
              onClick={() => {
                const n = new URLSearchParams(sp);
                t.v === "open" ? n.delete("view") : n.set("view", t.v);
                n.delete("page");
                setSp(n, { replace: true });
              }}
              className={cn("h-7 rounded px-2 text-xs font-medium", view === t.v ? "bg-slate-100 text-ink" : "text-slate-500 hover:text-ink")}
            >
              {t.label}
            </button>
          ))}
        </div>
      }
    />
  );
}

import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Phone, PhoneIncoming, PhoneOutgoing, RefreshCw, Smartphone, Upload, UserPlus } from "lucide-react";
import { api, qs, type Page, type Row } from "../lib/api";
import * as E from "../../shared/enums";
import { dateTime, fromLocalInput, relative, toLocalInput } from "../lib/format";
import { PageHeader } from "../components/layout";
import { EntityForm, RefSelect } from "../components/forms";
import { CopyButton, OutreachNav } from "../components/outreach";
import { CONFIGS } from "../lib/entities";
import { invalidateRecord } from "../components/records";
import { Badge, Button, Card, CardHeader, Dialog, EmptyState, ErrorState, Field, Select, SlideOver, Skeleton, StatusBadge, cn, useToast } from "../components/ui";

const dur = (s: number | null) => (s === null || s === undefined ? "—" : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`);
const STATUS_TONE: Record<string, string> = { uploaded: "queued", transcribing: "running", transcribed: "completed", summarized: "completed", failed: "failed", no_audio: "inactive" };

export function CallsList({ filter, compact }: { filter: Record<string, string>; compact?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["calls", filter],
    queryFn: () => api.get<Page<Row>>(`/calls${qs({ ...filter, pageSize: compact ? 10 : 50 })}`),
    refetchInterval: (query) => ((query.state.data?.data ?? []).some((c) => ["uploaded", "transcribing"].includes(c.status)) ? 5000 : false),
  });
  const rows = q.data?.data ?? [];
  return (
    <>
      {q.isError ? (
        <div className="p-3"><ErrorState error={q.error} /></div>
      ) : q.isLoading ? (
        <div className="p-4"><Skeleton className="h-16" /></div>
      ) : rows.length ? (
        <ul className="divide-y divide-line">
          {rows.map((c) => (
            <li key={c.id}>
              <button onClick={() => setOpen(c.id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">{c.direction === "incoming" ? <PhoneIncoming className="size-4" /> : <PhoneOutgoing className="size-4" />}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{c.contact_name ?? c.prospect_name ?? c.phone_number ?? "Unknown number"}{c.account_name && <span className="font-normal text-muted"> · {c.account_name}</span>}</div>
                  <div className="text-xs text-muted">{dateTime(c.started_at)} · {dur(c.duration_seconds)} · {c.user_name}</div>
                </div>
                {!c.contact_id && !c.prospect_id && <Badge tone="amber">Unmatched</Badge>}
                <StatusBadge value={STATUS_TONE[c.status]} label={E.labelOf(E.CALL_STATUSES, c.status)} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState compact icon={Phone} title="No calls recorded" body="Calls captured by the Gexart Android app (or uploaded here) appear with transcripts and summaries." />
      )}
      <CallDrawer id={open} onClose={() => setOpen(null)} />
    </>
  );
}

function CallDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [relink, setRelink] = useState<string | null>(null);
  const [task, setTask] = useState(false);
  const q = useQuery({
    queryKey: ["calls", "one", id],
    queryFn: () => api.get(`/calls/${id}`).then((r) => r.data),
    enabled: !!id,
    refetchInterval: (query) => (["uploaded", "transcribing"].includes(query.state.data?.status) ? 4000 : false),
  });
  const link = useMutation({ mutationFn: () => api.patch(`/calls/${id}`, { contact_id: relink }), onSuccess: () => (qc.invalidateQueries({ queryKey: ["calls"] }), invalidateRecord(qc), toast("success", "Call linked to contact")) });
  const retry = useMutation({ mutationFn: () => api.post(`/calls/${id}/transcribe`), onSuccess: () => qc.invalidateQueries({ queryKey: ["calls"] }) });
  const c = q.data;
  const s = c?.summary;
  return (
    <SlideOver open={!!id} onClose={onClose} title={c ? `Call with ${c.contact_name ?? c.prospect_name ?? c.phone_number ?? "unknown"}` : "Call"} subtitle={c ? `${dateTime(c.started_at)} · ${dur(c.duration_seconds)} · ${E.labelOf(E.CALL_DIRECTIONS, c.direction)}` : undefined} width="max-w-2xl">
      {!c ? <Skeleton className="h-64" /> : (
        <div className="space-y-4">
          {c.has_audio ? <audio controls preload="metadata" src={`/api/v1/calls/${c.id}/audio`} className="w-full" /> : <p className="text-xs text-muted">No recording attached.</p>}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <StatusBadge value={STATUS_TONE[c.status]} label={E.labelOf(E.CALL_STATUSES, c.status)} />
            {c.contact_id ? <Link className="text-brand-700" to={`/contacts/${c.contact_id}`}>{c.contact_name}</Link> : c.prospect_id ? <Link className="text-brand-700" to={`/prospecting/${c.prospect_id}`}>{c.prospect_name}</Link> : <Badge tone="amber">Not matched to a contact</Badge>}
            {c.account_id && <Link className="text-brand-700" to={`/accounts/${c.account_id}`}>{c.account_name}</Link>}
            {(c.status === "failed" || c.status === "transcribed") && c.has_audio && <Button size="sm" icon={RefreshCw} loading={retry.isPending} onClick={() => retry.mutate()}>Re-process</Button>}
          </div>
          {c.error && <p className="rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-900">{c.error}</p>}
          <div className="flex items-end gap-2">
            <Field label={c.contact_id ? "Link to a different contact" : "Link to contact"} className="flex-1"><RefSelect kind="contacts" value={relink} onChange={setRelink} /></Field>
            <Button disabled={!relink} loading={link.isPending} onClick={() => link.mutate()}>Link</Button>
          </div>
          {s && (
            <Card>
              <CardHeader title="AI summary (draft)" subtitle={`${c.summary_model} · verify against the recording`} action={<Button size="sm" icon={UserPlus} onClick={() => setTask(true)}>Follow-up task</Button>} />
              <div className="space-y-2 p-4 text-[13px]">
                <p>{s.summary}</p>
                {([["Client needs", s.client_needs], ["Objections", s.objections], ["Commitments", s.commitments], ["Next steps", s.next_steps]] as [string, string[]][]).map(([k, v]) =>
                  v?.length ? <div key={k}><div className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">{k}</div><ul className="list-disc pl-5">{v.map((x, i) => <li key={i}>{x}</li>)}</ul></div> : null,
                )}
                <div className="text-xs text-muted">Sentiment: {s.sentiment}</div>
              </div>
            </Card>
          )}
          {c.transcript && (
            <Card>
              <CardHeader title="Transcript" action={<CopyButton text={c.transcript} label="Copy" />} />
              <p className="max-h-80 overflow-y-auto p-4 text-[13px] leading-relaxed whitespace-pre-wrap">{c.transcript}</p>
            </Card>
          )}
          <EntityForm
            cfg={CONFIGS.tasks}
            open={task}
            onClose={() => setTask(false)}
            defaults={{ title: `Follow up: call with ${c.contact_name ?? c.phone_number ?? ""}`.slice(0, 200), type: "follow_up_call", contact_id: c.contact_id, contact_name: c.contact_name, account_id: c.account_id, account_name: c.account_name, description: s ? `Next steps from call on ${dateTime(c.started_at)}:\n${(s.next_steps ?? []).map((x: string) => `- ${x}`).join("\n")}` : "" }}
          />
        </div>
      )}
    </SlideOver>
  );
}

function UploadCallDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [phone, setPhone] = useState("");
  const [direction, setDirection] = useState("outgoing");
  const [when, setWhen] = useState(toLocalInput(new Date().toISOString()));
  const [duration, setDuration] = useState("");
  const m = useMutation({
    mutationFn: () => {
      const f = new FormData();
      if (file) f.set("audio", file);
      f.set("phone_number", phone);
      f.set("direction", direction);
      f.set("started_at", fromLocalInput(when)!);
      if (duration) f.set("duration_seconds", String(Math.round(Number(duration) * 60)));
      return api.upload<{ data: Row }>("/calls/upload", f);
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["calls"] });
      invalidateRecord(qc);
      toast("success", r.data.matched ? `Matched to ${r.data.matched.name}` : "Uploaded; not matched to a contact yet");
      onClose();
    },
    onError: (e) => toast("error", (e as Error).message),
  });
  return (
    <Dialog open={open} onClose={onClose} title="Upload a call recording" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={Upload} disabled={!phone.trim() && !file} loading={m.isPending} onClick={() => m.mutate()}>Upload</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-2 flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-line px-3 py-3 hover:border-brand-300">
          <Upload className="size-4 text-slate-500" /> <span>{file ? file.name : "Choose audio (mp3, m4a, amr, wav…) · optional"}</span>
          <input type="file" accept="audio/*" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <Field label="Phone number"><input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98300 12345" /></Field>
        <Field label="Direction"><Select options={E.CALL_DIRECTIONS.options} value={direction} onChange={(e) => setDirection(e.target.value)} /></Field>
        <Field label="When"><input type="datetime-local" className="input" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
        <Field label="Duration (minutes)"><input type="number" min={0} step="0.5" className="input" value={duration} onChange={(e) => setDuration(e.target.value)} /></Field>
        <p className="col-span-2 text-xs text-muted">Only upload recordings made lawfully with the other party informed. The number is matched to your contacts automatically.</p>
      </div>
    </Dialog>
  );
}

export function CallsPage() {
  const [unmatched, setUnmatched] = useState(false);
  const [uploading, setUploading] = useState(false);
  return (
    <div className="pb-10">
      <PageHeader title="Calls" icon={Phone} subtitle="Recordings from the Gexart Android app, transcribed and summarised" actions={<><OutreachNav /><Button icon={Upload} onClick={() => setUploading(true)}>Upload recording</Button></>} />
      <div className="px-4 sm:px-6">
        <Card>
          <div className="flex items-center gap-2 border-b border-line p-2.5">
            <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" className="accent-brand-600" checked={unmatched} onChange={(e) => setUnmatched(e.target.checked)} /> Unmatched only</label>
            <Link to="/settings?tab=devices" className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-brand-700"><Smartphone className="size-3.5" /> Pair the Android app</Link>
          </div>
          <CallsList filter={unmatched ? { unmatched: "1" } : {}} />
        </Card>
      </div>
      <UploadCallDialog open={uploading} onClose={() => setUploading(false)} key={uploading ? "u" : "x"} />
    </div>
  );
}

// ─── Settings → Devices ───
export function DevicesSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("My Android phone");
  const [token, setToken] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["devices"], queryFn: () => api.get<{ data: Row[] }>("/devices").then((r) => r.data) });
  const pair = useMutation({ mutationFn: () => api.post<{ data: Row }>("/devices", { name }), onSuccess: (r) => (setToken(r.data.token), qc.invalidateQueries({ queryKey: ["devices"] })), onError: (e) => toast("error", (e as Error).message) });
  const revoke = useMutation({ mutationFn: (id: string) => api.post(`/devices/${id}/revoke`), onSuccess: () => qc.invalidateQueries({ queryKey: ["devices"] }) });
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Pair the Gexart Calls Android app" icon={Smartphone} />
        <div className="space-y-3 p-4 text-[13px]">
          <ol className="list-decimal space-y-1 pl-5 text-slate-700">
            <li>Install the app (build from the <code>android/</code> folder in Android Studio, or install the APK your admin shares).</li>
            <li>Turn on your phone dialer's built-in call recording (Phone app → Settings → Call recording) and note its folder.</li>
            <li>Create a pairing token below and paste it with the CRM address into the app.</li>
            <li>In the app, choose the recordings folder and grant phone/call-log permissions.</li>
          </ol>
          <p className="text-xs text-muted">The app uploads only calls with numbers that match your CRM contacts or prospects (configurable), right after each call ends. Inform the people you call that calls are recorded.</p>
          <div className="flex gap-2">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            <Button variant="primary" loading={pair.isPending} onClick={() => pair.mutate()}>Create token</Button>
          </div>
          {token && (
            <div className="space-y-2 rounded-md border border-brand-200 bg-brand-50/50 p-3">
              <div className="text-xs font-medium">Shown once. Paste into the app now:</div>
              <div className="text-xs">CRM address: <code>{origin}</code></div>
              <div className="flex items-center gap-2"><code className="flex-1 truncate rounded bg-white px-2 py-1 text-xs">{token}</code><CopyButton text={token} label="Copy token" /></div>
            </div>
          )}
        </div>
      </Card>
      <Card>
        <CardHeader title="Paired devices" />
        <ul className="divide-y divide-line px-4">
          {q.data?.map((d) => (
            <li key={d.id} className={cn("flex items-center gap-3 py-2", d.revoked_at && "opacity-50")}>
              <Smartphone className="size-4 text-slate-400" />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{d.name}</div>
                <div className="text-xs text-muted">Paired {relative(d.created_at)} · last seen {d.last_seen_at ? relative(d.last_seen_at) : "never"}{d.revoked_at ? " · revoked" : ""}</div>
              </div>
              {!d.revoked_at && <Button size="sm" variant="ghost" icon={Ban} loading={revoke.isPending && revoke.variables === d.id} onClick={() => revoke.mutate(d.id)}>Revoke</Button>}
            </li>
          ))}
          {q.data && !q.data.length && <li className="py-4 text-center text-xs text-muted">No devices yet</li>}
        </ul>
      </Card>
    </div>
  );
}

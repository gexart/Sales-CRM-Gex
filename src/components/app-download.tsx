// Settings → Phone app: download the Gexart Calls Android app (button or QR code) and, for admins,
// publish new builds (import from GitHub Actions or upload an .apk).
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { encode } from "uqr";
import { CloudDownload, Download, Trash2, Upload } from "lucide-react";
import { api, type Row } from "../lib/api";
import { useAuth } from "../lib/auth";
import { relative } from "../lib/format";
import { fileSize } from "../lib/entities";
import { GxMark } from "./layout";
import { Button, Card, ConfirmDialog, Dialog, Field, Skeleton, useToast } from "./ui";

function QrCode({ text, className }: { text: string; className?: string }) {
  const { size, path } = useMemo(() => {
    const qr = encode(text, { ecc: "M", border: 0 });
    let d = "";
    qr.data.forEach((row, y) => row.forEach((on, x) => on && (d += `M${x} ${y}h1v1h-1z`)));
    return { size: qr.size, path: d };
  }, [text]);
  return (
    <svg viewBox={`-2 -2 ${size + 4} ${size + 4}`} className={className} shapeRendering="crispEdges" role="img" aria-label="QR code to download the app">
      <rect x={-2} y={-2} width={size + 4} height={size + 4} fill="#fff" />
      <path d={path} fill="#0a0a0a" />
    </svg>
  );
}

export function AndroidAppCard() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState<Row | null>(null);
  const q = useQuery({ queryKey: ["app-releases"], queryFn: () => api.get<{ data: Row[] }>("/app-releases").then((r) => r.data) });
  const latest = q.data?.[0];
  // Signed links last 30 minutes; refresh well before that while the page is open.
  const link = useQuery({
    queryKey: ["app-release-link", latest?.id],
    enabled: !!latest,
    queryFn: () => api.post<{ data: { url: string; expires_at: string } }>(`/app-releases/${latest!.id}/link`).then((r) => r.data),
    staleTime: 20 * 60_000,
    refetchInterval: 20 * 60_000,
  });
  const sync = useMutation({
    mutationFn: () => api.post<{ data: { imported: boolean; message: string } }>("/app-releases/sync"),
    onSuccess: (r) => (qc.invalidateQueries({ queryKey: ["app-releases"] }), toast(r.data.imported ? "success" : "info", r.data.message)),
    onError: (e) => toast("error", (e as Error).message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/app-releases/${id}`),
    onSuccess: () => (setRemoving(null), qc.invalidateQueries({ queryKey: ["app-releases"] })),
    onError: (e) => toast("error", (e as Error).message),
  });

  return (
    <Card className="overflow-hidden lg:col-span-2">
      <div className="grid md:grid-cols-[1fr_auto]">
        <div className="relative overflow-hidden bg-night p-6 text-white">
          <GxMark tile={false} className="pointer-events-none absolute -right-10 -bottom-8 w-64 text-white/[0.05]" />
          <div className="relative flex items-center gap-3">
            <GxMark className="size-12 rounded-[14px] ring-white/20" />
            <div>
              <div className="text-[15px] font-semibold">Gexart Calls for Android</div>
              <div className="text-xs text-white/55">Uploads your client call recordings to the CRM automatically</div>
            </div>
          </div>
          {q.isLoading ? (
            <Skeleton className="relative mt-6 h-10 w-60 bg-white/10" />
          ) : latest ? (
            <div className="relative mt-6">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/60">
                <span className="rounded-full bg-white px-2 py-0.5 font-semibold text-ink">v{latest.version_name}</span>
                <span>{fileSize(latest.size_bytes)}</span>
                <span>Published {relative(latest.created_at)}</span>
                <span className="font-mono" title={`SHA-256 ${latest.sha256}`}>SHA-256 {latest.sha256.slice(0, 12)}…</span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <a
                  href={`/api/v1/app-releases/${latest.id}/download`}
                  download={latest.file_name}
                  className="inline-flex h-10 items-center gap-2 rounded-lg bg-white px-4 text-[13px] font-semibold text-ink shadow-sm transition hover:bg-white/90"
                >
                  <Download className="size-4" /> Download APK
                </a>
              </div>
              <ol className="mt-5 list-decimal space-y-1 pl-4 text-xs text-white/60">
                <li>On your phone, scan the QR code (or open this page and tap Download).</li>
                <li>Open the downloaded file. When asked, allow your browser to install unknown apps.</li>
                <li>Android may say the app is not from the Play Store. That is expected for an internal app.</li>
              </ol>
            </div>
          ) : (
            <p className="relative mt-6 text-sm text-white/60">
              No build has been published yet.{isAdmin ? " Import the latest build from GitHub or upload an .apk below." : " Ask your administrator to publish one."}
            </p>
          )}
        </div>
        {latest && (
          <div className="flex flex-col items-center justify-center gap-2 border-t border-line p-6 md:border-t-0 md:border-l">
            {link.data ? <QrCode text={link.data.url} className="size-40" /> : <Skeleton className="size-40" />}
            <div className="text-center text-[11px] text-muted">
              Scan with your phone camera
              <br />
              Link refreshes automatically
            </div>
          </div>
        )}
      </div>

      {isAdmin && (
        <div className="border-t border-line">
          <div className="flex flex-wrap items-center gap-2 px-5 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold">Publish a build</div>
              <div className="text-[11px] text-muted">GitHub Actions builds the app on every change to the android folder. New builds are imported every hour, or now:</div>
            </div>
            <Button size="sm" icon={CloudDownload} loading={sync.isPending} onClick={() => sync.mutate()}>Get latest from GitHub</Button>
            <Button size="sm" icon={Upload} onClick={() => setUploading(true)}>Upload .apk</Button>
          </div>
          {(q.data?.length ?? 0) > 1 && (
            <ul className="divide-y divide-line border-t border-line px-5 text-xs">
              {q.data!.slice(1).map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-2">
                  <span className="font-medium">v{r.version_name}</span>
                  <span className="text-muted">{fileSize(r.size_bytes)} · {r.source === "github" ? "GitHub" : `uploaded by ${r.created_by_name ?? "admin"}`} · {relative(r.created_at)}</span>
                  <a className="ml-auto text-muted hover:text-ink" href={`/api/v1/app-releases/${r.id}/download`} download={r.file_name}>Download</a>
                  <button className="text-muted hover:text-red-600" aria-label={`Remove v${r.version_name}`} onClick={() => setRemoving(r)}><Trash2 className="size-3.5" /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <UploadApkDialog open={uploading} onClose={() => setUploading(false)} key={uploading ? "open" : "closed"} />
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={`Remove v${removing?.version_name ?? ""}?`}
        body="The file is deleted from storage. Phones that already installed it are not affected."
        confirmLabel="Remove build"
        danger
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
      />
    </Card>
  );
}

function UploadApkDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [version, setVersion] = useState("");
  const [notes, setNotes] = useState("");
  const [picked, setPicked] = useState<File | null>(null);
  const up = useMutation({
    mutationFn: () => {
      const f = new FormData();
      f.set("file", picked!);
      f.set("version_name", version);
      f.set("notes", notes);
      return api.upload("/app-releases", f);
    },
    onSuccess: () => (qc.invalidateQueries({ queryKey: ["app-releases"] }), toast("success", "Build published"), onClose()),
    onError: (e) => toast("error", (e as Error).message),
  });
  return (
    <Dialog open={open} onClose={onClose} title="Upload Android app build">
      <div className="space-y-3">
        <Field label="APK file" required help="The .apk built by GitHub Actions or Android Studio. Max 80 MB.">
          <input ref={file} type="file" accept=".apk,application/vnd.android.package-archive" className="block w-full text-xs file:mr-3 file:rounded-md file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white" onChange={(e) => setPicked(e.target.files?.[0] ?? null)} />
        </Field>
        <Field label="Version" help="For example 1.0.3. Defaults to today's date.">
          <input className="input" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.0.0" />
        </Field>
        <Field label="Release notes">
          <textarea className="input h-20 py-1.5" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!picked} loading={up.isPending} onClick={() => up.mutate()}>Publish build</Button>
        </div>
      </div>
    </Dialog>
  );
}

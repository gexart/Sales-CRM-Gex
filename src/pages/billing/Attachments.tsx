import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Paperclip, Trash2, Upload } from "lucide-react";
import { Button, Card, CardHeader, useToast } from "../../components/ui";
import { api } from "../../lib/api";
import { access, errMsg } from "../../lib/billing";

/** Up to five files (PDF, image, Word, Excel) attached to an invoice, quotation, purchase or expense. */
export function Attachments({ type, id, canEdit = true }: { type: "invoice" | "document" | "purchase" | "expense"; id: string; canEdit?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const key = ["billing-attachments", type, id];
  const q = useQuery({ queryKey: key, queryFn: () => access.get(`/attachments?entity_type=${type}&entity_id=${id}`) });
  const files: any[] = q.data?.data ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const up = useMutation({
    mutationFn: (f: File) => {
      const form = new FormData();
      form.set("entity_type", type);
      form.set("entity_id", id);
      form.set("file", f);
      return api.upload("/billing-access/attachments", form);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => toast("error", errMsg(e)),
  });
  const del = useMutation({ mutationFn: (fid: string) => access.del(`/attachments/${fid}`), onSuccess: () => qc.invalidateQueries({ queryKey: key }), onError: (e) => toast("error", errMsg(e)) });
  if (!q.data && !canEdit) return null;
  return (
    <Card>
      <CardHeader title={`Attachments (${files.length}/5)`} icon={Paperclip} action={canEdit && files.length < 5 && (
        <label className="btn inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-line px-2 text-xs"><Upload className="size-3.5" />{up.isPending ? "Uploading…" : "Attach file"}
          <input type="file" className="sr-only" accept=".pdf,image/*,.doc,.docx,.xls,.xlsx,.csv,.txt" onChange={(e) => { const f = e.target.files?.[0]; if (f) up.mutate(f); e.target.value = ""; }} />
        </label>
      )} />
      {files.length === 0 ? <p className="px-4 pb-3 text-xs text-muted">Nothing attached.</p> : (
        <ul className="divide-y divide-line">{files.map((f) => (
          <li key={f.id} className="flex items-center gap-2 px-4 py-2 text-[13px]">
            <a className="min-w-0 flex-1 truncate text-brand-700 underline" href={`/api/v1/billing-access/attachments/${f.id}/file`} target="_blank" rel="noreferrer">{f.file_name}</a>
            <span className="text-xs text-muted">{Math.max(1, Math.round(f.size_bytes / 1024))} KB</span>
            {canEdit && <Button size="sm" variant="ghost" icon={Trash2} aria-label="Remove file" onClick={() => del.mutate(f.id)} />}
          </li>
        ))}</ul>
      )}
    </Card>
  );
}

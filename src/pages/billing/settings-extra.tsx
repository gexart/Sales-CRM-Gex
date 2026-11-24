import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookText, PenLine, Plus, Trash2 } from "lucide-react";
import { Button, Card, CardHeader, Dialog, EmptyState, Field, useToast } from "../../components/ui";
import { bill, errMsg } from "../../lib/billing";

type Text = { id: string; name: string; text: string };
type Sig = { id: string; name: string; signature: string; stamp: string };

function useSettingsQuery() {
  return useQuery({ queryKey: ["billing-settings"], queryFn: () => bill.get("/settings/billing") });
}

/** Saved notes or terms: as many as you like, each picked from a list when you make a document. */
export function TextLibrary({ kind, edit }: { kind: "notes" | "terms"; edit: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useSettingsQuery();
  const list: Text[] = q.data?.billing?.textTemplates?.[kind] ?? [];
  const [open, setOpen] = useState<Partial<Text> | null>(null);
  const label = kind === "notes" ? "Saved notes" : "Saved terms & conditions";
  const save = useMutation({
    mutationFn: (next: Text[]) => bill.put("/settings/billing", { textTemplates: { [kind]: next } }),
    onSuccess: () => (toast("success", "Saved"), setOpen(null), qc.invalidateQueries({ queryKey: ["billing-settings"] })),
    onError: (e) => toast("error", errMsg(e)),
  });
  const commit = () => {
    if (!open?.name?.trim() || !open.text?.trim()) return;
    const item: Text = { id: open.id ?? `${kind}_${Date.now().toString(36)}`, name: open.name.trim(), text: open.text };
    save.mutate(open.id ? list.map((x) => (x.id === open.id ? item : x)) : [...list, item]);
  };
  return (
    <Card>
      <CardHeader title={label} icon={BookText} subtitle="Pick any of these on an invoice, quotation or bill" action={edit && <Button size="sm" icon={Plus} onClick={() => setOpen({ name: "", text: "" })}>New</Button>} />
      {list.length === 0 ? <EmptyState compact icon={BookText} title="Nothing saved yet" body="Add the wording you use often." /> : (
        <div className="divide-y divide-line">{list.map((t) => (
          <div key={t.id} className="flex items-start gap-3 px-4 py-2.5">
            <button type="button" disabled={!edit} className="min-w-0 flex-1 text-left" onClick={() => setOpen(t)}><div className="font-medium">{t.name}</div><div className="line-clamp-2 text-xs text-muted">{t.text}</div></button>
            {edit && <Button size="sm" variant="ghost" icon={Trash2} aria-label="Delete" onClick={() => save.mutate(list.filter((x) => x.id !== t.id))} />}
          </div>
        ))}</div>
      )}
      <Dialog open={!!open} onClose={() => setOpen(null)} title={open?.id ? "Edit saved text" : "New saved text"} footer={<><Button onClick={() => setOpen(null)}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!open?.name?.trim() || !open?.text?.trim()} onClick={commit}>Save</Button></>}>
        {open && (
          <div className="space-y-3">
            <Field label="Name" required><input className="input" value={open.name ?? ""} onChange={(e) => setOpen({ ...open, name: e.target.value })} placeholder="e.g. Standard terms" /></Field>
            <Field label={kind === "notes" ? "Note" : "Terms (one point per line)"} required><textarea className={`input ${kind === "terms" ? "min-h-48" : "min-h-24"}`} value={open.text ?? ""} onChange={(e) => setOpen({ ...open, text: e.target.value })} /></Field>
          </div>
        )}
      </Dialog>
    </Card>
  );
}

const readImage = (f: File, done: (d: string) => void, fail: (m: string) => void) => {
  if (f.size > 200_000) return fail("Use an image under 200 KB");
  const r = new FileReader();
  r.onload = () => done(String(r.result));
  r.readAsDataURL(f);
};

function Pick({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const toast = useToast();
  return (
    <Field label={label} help="PNG or JPG under 200 KB. A transparent PNG looks best.">
      <div className="flex items-center gap-3">
        <div className="flex size-20 items-center justify-center overflow-hidden rounded-md border border-line bg-white">{value ? <img src={value} alt="" className="max-h-full max-w-full" /> : <span className="text-[10px] text-muted">None</span>}</div>
        <div className="flex flex-col gap-1">
          <label className="btn inline-flex h-8 cursor-pointer items-center rounded-md border border-line px-3 text-[13px]">Choose file<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && readImage(e.target.files[0], onChange, (m) => toast("error", m))} /></label>
          {value && <button type="button" className="text-xs text-muted underline" onClick={() => onChange("")}>Remove</button>}
        </div>
      </div>
    </Field>
  );
}

/** Signature and company stamp sets. Choose one on each invoice; it prints beside "Authorized Signatory". */
export function SignatureLibrary({ edit }: { edit: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useSettingsQuery();
  const list: Sig[] = q.data?.billing?.branding?.signatures ?? [];
  const [open, setOpen] = useState<Partial<Sig> | null>(null);
  const save = useMutation({
    mutationFn: (next: Sig[]) => bill.put("/settings/billing", { branding: { signatures: next } }),
    onSuccess: () => (toast("success", "Saved"), setOpen(null), qc.invalidateQueries({ queryKey: ["billing-settings"] })),
    onError: (e) => toast("error", errMsg(e)),
  });
  const commit = () => {
    if (!open?.name?.trim()) return;
    const item: Sig = { id: open.id ?? `sig_${Date.now().toString(36)}`, name: open.name.trim(), signature: open.signature ?? "", stamp: open.stamp ?? "" };
    save.mutate(open.id ? list.map((x) => (x.id === open.id ? item : x)) : [...list, item]);
  };
  return (
    <Card className="mt-3">
      <CardHeader title="Signatures & stamps" icon={PenLine} subtitle="Upload your signature and company stamp. The first one is used by default." action={edit && <Button size="sm" icon={Plus} onClick={() => setOpen({ name: "", signature: "", stamp: "" })}>Add</Button>} />
      {list.length === 0 ? <EmptyState compact icon={PenLine} title="No signature yet" body="Add one so your invoices come out signed and stamped." /> : (
        <div className="divide-y divide-line">{list.map((s, i) => (
          <div key={s.id} className="flex items-center gap-3 px-4 py-2.5">
            <div className="flex gap-1.5">{[s.signature, s.stamp].map((img, j) => <div key={j} className="flex size-12 items-center justify-center overflow-hidden rounded border border-line bg-white">{img ? <img src={img} alt="" className="max-h-full max-w-full" /> : null}</div>)}</div>
            <button type="button" disabled={!edit} className="min-w-0 flex-1 text-left" onClick={() => setOpen(s)}><div className="font-medium">{s.name}{i === 0 && <span className="ml-2 text-xs font-normal text-muted">default</span>}</div><div className="text-xs text-muted">{s.signature ? "Signature" : "No signature"} · {s.stamp ? "Stamp" : "No stamp"}</div></button>
            {edit && <Button size="sm" variant="ghost" icon={Trash2} aria-label="Delete" onClick={() => save.mutate(list.filter((x) => x.id !== s.id))} />}
          </div>
        ))}</div>
      )}
      <Dialog open={!!open} onClose={() => setOpen(null)} title={open?.id ? "Edit signature" : "New signature"} footer={<><Button onClick={() => setOpen(null)}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!open?.name?.trim()} onClick={commit}>Save</Button></>}>
        {open && (
          <div className="space-y-3">
            <Field label="Name printed under the signature" required><input className="input" value={open.name ?? ""} onChange={(e) => setOpen({ ...open, name: e.target.value })} placeholder="e.g. Pranay Chatterjee" /></Field>
            <Pick label="Signature" value={open.signature ?? ""} onChange={(v) => setOpen({ ...open, signature: v })} />
            <Pick label="Company stamp" value={open.stamp ?? ""} onChange={(v) => setOpen({ ...open, stamp: v })} />
          </div>
        )}
      </Dialog>
    </Card>
  );
}

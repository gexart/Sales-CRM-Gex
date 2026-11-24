import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, Field, Select, useToast } from "../../components/ui";
import { bill, errMsg, useBillingAccess } from "../../lib/billing";

/**
 * A notes or terms box with a list of saved texts: pick one to fill it in, edit it for this document, or save what you
 * wrote as a new saved text. Saving a new text needs permission to change billing settings.
 */
export function SavedText({ kind, value, onChange, tall }: { kind: "notes" | "terms"; value: string; onChange: (v: string) => void; tall?: boolean }) {
  const { can } = useBillingAccess();
  const qc = useQueryClient();
  const toast = useToast();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const q = useQuery({ queryKey: ["billing-settings"], queryFn: () => bill.get("/settings/billing"), staleTime: 60_000 });
  const list: { id: string; name: string; text: string }[] = q.data?.billing?.textTemplates?.[kind] ?? [];
  const save = useMutation({
    mutationFn: () => bill.put("/settings/billing", { textTemplates: { [kind]: [...list, { id: `${kind}_${Date.now().toString(36)}`, name: name.trim(), text: value }] } }),
    onSuccess: () => (toast("success", "Saved. Pick it any time from the list."), setNaming(false), setName(""), qc.invalidateQueries({ queryKey: ["billing-settings"] })),
    onError: (e) => toast("error", errMsg(e)),
  });
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select className="min-w-0 flex-1" value="" placeholder={list.length ? `Choose a saved ${kind === "notes" ? "note" : "terms"}…` : `No saved ${kind} yet`} onChange={(e) => { const t = list.find((x) => x.id === e.target.value); if (t) onChange(t.text); }} options={list.map((x) => ({ value: x.id, label: x.name }))} />
        {can("settings.manage") && <Button size="sm" disabled={!value.trim()} onClick={() => setNaming(true)}>Save as new</Button>}
      </div>
      <textarea className={`input ${tall ? "min-h-40" : "min-h-20"}`} value={value} onChange={(e) => onChange(e.target.value)} />
      <Dialog open={naming} onClose={() => setNaming(false)} title={`Save these ${kind} for later`} footer={<><Button onClick={() => setNaming(false)}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={name.trim().length < 2} onClick={() => save.mutate()}>Save</Button></>}>
        <Field label="Name" help="e.g. Standard terms, Retainer, Website project"><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
      </Dialog>
    </div>
  );
}

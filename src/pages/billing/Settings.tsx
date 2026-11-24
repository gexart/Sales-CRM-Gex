import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Landmark, Plus, Settings as Cog, Trash2 } from "lucide-react";
import { PageHeader } from "../../components/layout";
import { Badge, Button, Card, CardHeader, ConfirmDialog, Dialog, EmptyState, ErrorState, Field, Select, Skeleton, Tabs, useToast } from "../../components/ui";
import { bill, errMsg, inr, useBillingAccess } from "../../lib/billing";
import { PrintSettings, SignatureLibrary, TextLibrary } from "./settings-extra";

type Tab = "company" | "banks" | "notes" | "format" | "print" | "numbering" | "reminders";
const DOCS: [string, string][] = [["INVOICE", "Sales invoice"], ["QUOTATION", "Quotation"], ["PROFORMA", "Proforma invoice"], ["SALES_ORDER", "Sales order"], ["DELIVERY_CHALLAN", "Delivery challan"], ["PURCHASE_ORDER", "Purchase order"], ["CREDIT_NOTE", "Credit note"]];

/** Billing settings in the same order as Swipe: company, banks, notes & terms, invoice format, numbering, reminders. */
export function BillingSettingsPage() {
  const { can } = useBillingAccess();
  const [sp] = useSearchParams();
  const [tab, setTab] = useState<Tab>((["company", "banks", "notes", "format", "print", "numbering", "reminders"] as Tab[]).find((t) => t === sp.get("tab")) ?? "company");
  const edit = can("settings.manage");
  return (
    <div className="pb-10">
      <PageHeader title="Billing settings" icon={Cog} subtitle={edit ? "How your invoices look and are numbered" : "You can view these but not change them"} />
      <div className="px-4 sm:px-6">
        <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ value: "company", label: "Company" }, { value: "banks", label: "Banks & UPI" }, { value: "notes", label: "Notes & terms" }, { value: "format", label: "Invoice format" }, { value: "print", label: "Print & labels" }, { value: "numbering", label: "Numbering" }, { value: "reminders", label: "Reminders" }]} />
        <div className="mt-3 max-w-3xl">
          {tab === "company" ? <Company edit={edit} /> : tab === "banks" ? <Banks edit={edit} /> : tab === "notes" ? <Notes edit={edit} /> : tab === "format" ? <Format edit={edit} /> : tab === "print" ? <PrintSettings edit={edit} /> : tab === "numbering" ? <Numbering edit={edit} /> : <Reminders edit={edit} />}
        </div>
      </div>
    </div>
  );
}

function useSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["billing-settings"], queryFn: () => bill.get("/settings/billing") });
  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => bill.put("/settings/billing", patch),
    onSuccess: () => (toast("success", "Saved"), qc.invalidateQueries({ queryKey: ["billing-settings"] })),
    onError: (e) => toast("error", errMsg(e)),
  });
  return { s: q.data?.billing, q, save };
}

const readImage = (f: File, done: (dataUrl: string) => void, toast: (t: "error", m: string) => void) => {
  if (f.size > 200_000) return toast("error", "Use an image under 200 KB");
  const r = new FileReader();
  r.onload = () => done(String(r.result));
  r.readAsDataURL(f);
};

function Company({ edit }: { edit: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { s, q } = useSettings();
  const br = useQuery({ queryKey: ["billing-branch"], queryFn: () => bill.get("/settings/locations") });
  const branch = br.data?.branches?.[0];
  const [f, setF] = useState({ legalName: "", gstin: "", address: "", mobile: "", email: "", website: "", stateCode: "19", signatory: "", logo: "", signature: "" });
  useEffect(() => {
    if (!s || !branch) return;
    setF({ legalName: s.company.legalName || branch.name, gstin: branch.gstin ?? "", address: branch.address ?? "", mobile: s.company.mobile || branch.phone || "", email: s.company.email, website: s.company.website, stateCode: branch.stateCode ?? "19", signatory: s.branding.signatoryName, logo: s.branding.logo, signature: s.branding.signature });
  }, [s, branch]);
  const run = useMutation({
    mutationFn: async () => {
      await bill.put(`/settings/branches/${branch.id}`, { name: f.legalName, gstin: f.gstin.trim().toUpperCase() || null, address: f.address, phone: f.mobile, stateCode: f.stateCode });
      await bill.put("/settings/billing", { company: { legalName: f.legalName, mobile: f.mobile, email: f.email, website: f.website }, branding: { logo: f.logo, signature: f.signature, signatoryName: f.signatory } });
    },
    onSuccess: () => (toast("success", "Company details saved"), qc.invalidateQueries({ queryKey: ["billing-settings"] }), qc.invalidateQueries({ queryKey: ["billing-branch"] })),
    onError: (e) => toast("error", errMsg(e)),
  });
  if (q.isLoading || br.isLoading) return <Skeleton className="h-48" />;
  if (q.isError) return <ErrorState error={q.error} />;
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <>
    <Card>
      <CardHeader title="Company details" icon={Building2} subtitle="Printed at the top of every invoice" />
      <div className="space-y-3 p-4">
        <Field label="Business name" required><input className="input" disabled={!edit} value={f.legalName} onChange={set("legalName")} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="GSTIN"><input className="input uppercase" maxLength={15} disabled={!edit} value={f.gstin} onChange={set("gstin")} /></Field>
          <Field label="State code" help="19 = West Bengal"><input className="input" maxLength={2} disabled={!edit} value={f.stateCode} onChange={set("stateCode")} /></Field>
        </div>
        <Field label="Address" help="One line per row, as it should print"><textarea className="input min-h-24" disabled={!edit} value={f.address} onChange={set("address")} /></Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Mobile"><input className="input" disabled={!edit} value={f.mobile} onChange={set("mobile")} placeholder="+91 …" /></Field>
          <Field label="Email"><input className="input" disabled={!edit} value={f.email} onChange={set("email")} /></Field>
          <Field label="Website"><input className="input" disabled={!edit} value={f.website} onChange={set("website")} /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <ImageField label="Logo" help="Square PNG or JPG, under 200 KB" value={f.logo} onChange={(v) => setF({ ...f, logo: v })} edit={edit} />
          <ImageField label="Signature" help="Photo or scan of the signature, under 200 KB" value={f.signature} onChange={(v) => setF({ ...f, signature: v })} edit={edit} />
        </div>
        <Field label="Authorised signatory name"><input className="input" disabled={!edit} value={f.signatory} onChange={set("signatory")} /></Field>
        {edit && <div className="flex justify-end"><Button variant="primary" loading={run.isPending} onClick={() => run.mutate()}>Save company details</Button></div>}
      </div>
    </Card>
    <SignatureLibrary edit={edit} />
    </>
  );
}

function ImageField({ label, help, value, onChange, edit }: { label: string; help: string; value: string; onChange: (v: string) => void; edit: boolean }) {
  const toast = useToast();
  return (
    <Field label={label} help={help}>
      <div className="flex items-center gap-3">
        <div className="flex size-16 items-center justify-center overflow-hidden rounded-md border border-line bg-white">{value ? <img src={value} alt="" className="max-h-full max-w-full" /> : <span className="text-[10px] text-muted">None</span>}</div>
        {edit && (
          <div className="flex flex-col gap-1">
            <label className="btn inline-flex h-8 cursor-pointer items-center rounded-md border border-line px-3 text-[13px]">Choose file<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && readImage(e.target.files[0], onChange, (t, m) => toast(t, m))} /></label>
            {value && <button type="button" className="text-xs text-muted underline" onClick={() => onChange("")}>Remove</button>}
          </div>
        )}
      </div>
    </Field>
  );
}

function Banks({ edit }: { edit: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [add, setAdd] = useState(false);
  const [del, setDel] = useState<string | null>(null);
  const [f, setF] = useState({ name: "", accountNumber: "", ifsc: "", branch: "", upiId: "", isDefault: true });
  const q = useQuery({ queryKey: ["billing-banks"], queryFn: () => bill.get("/masters/banks") });
  const rows: any[] = q.data?.bankAccounts ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const save = useMutation({
    mutationFn: () => bill.post("/masters/banks", { name: f.name, accountType: "BANK", accountNumber: f.accountNumber || undefined, ifsc: f.ifsc.toUpperCase() || undefined, branch: f.branch || undefined, upiId: f.upiId || undefined, isDefault: f.isDefault }),
    onSuccess: () => (toast("success", "Bank added"), setAdd(false), setF({ name: "", accountNumber: "", ifsc: "", branch: "", upiId: "", isDefault: false }), qc.invalidateQueries({ queryKey: ["billing-banks"] })),
    onError: (e) => toast("error", errMsg(e)),
  });
  const remove = useMutation({ mutationFn: (id: string) => bill.del(`/masters/banks/${id}`), onSuccess: () => (setDel(null), qc.invalidateQueries({ queryKey: ["billing-banks"] })), onError: (e) => (toast("error", errMsg(e)), setDel(null)) });
  return (
    <Card>
      <CardHeader title="Banks & UPI" icon={Landmark} subtitle="The default bank and its UPI ID print on invoices, with a payment QR" action={edit && <Button variant="primary" size="sm" icon={Plus} onClick={() => setAdd(true)}>Add bank</Button>} />
      {q.isLoading ? <Skeleton className="m-4 h-16" /> : rows.length === 0 ? <EmptyState compact icon={Landmark} title="No bank added yet" body="Add one so customers see where to pay." /> : (
        <div className="divide-y divide-line">
          {rows.map((b) => (
            <div key={b.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 font-medium">{b.name}{b.isDefault && <Badge tone="green">Default</Badge>}{b.accountType === "CASH" && <Badge>Cash</Badge>}</div>
                <div className="text-xs text-muted">{b.maskedAccountNumber ?? ""}{b.ifsc ? ` · ${b.ifsc}` : ""}{b.branch ? ` · ${b.branch}` : ""}{b.upiId ? ` · UPI ${b.upiId}` : ""}</div>
              </div>
              <div className="text-right text-xs text-muted">Balance<div className="text-sm font-medium text-ink tabular-nums">{inr(b.currentBalancePaise)}</div></div>
              {edit && <Button size="sm" variant="ghost" icon={Trash2} aria-label="Remove bank" onClick={() => setDel(b.id)} />}
            </div>
          ))}
        </div>
      )}
      <Dialog open={add} onClose={() => setAdd(false)} title="Add bank account" footer={<><Button onClick={() => setAdd(false)}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.name} onClick={() => save.mutate()}>Save</Button></>}>
        <div className="space-y-3">
          <Field label="Bank name" required><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Account number" help="Stored encrypted; the full number prints on invoices"><input className="input" inputMode="numeric" value={f.accountNumber} onChange={(e) => setF({ ...f, accountNumber: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="IFSC"><input className="input uppercase" value={f.ifsc} onChange={(e) => setF({ ...f, ifsc: e.target.value })} /></Field>
            <Field label="Branch"><input className="input" value={f.branch} onChange={(e) => setF({ ...f, branch: e.target.value })} /></Field>
          </div>
          <Field label="UPI ID" help="e.g. yourname@bank. Makes the QR on invoices"><input className="input" value={f.upiId} onChange={(e) => setF({ ...f, upiId: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" className="size-4" checked={f.isDefault} onChange={(e) => setF({ ...f, isDefault: e.target.checked })} />Make this the default bank on invoices</label>
        </div>
      </Dialog>
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del)} title="Remove this bank?" body="Past invoices keep their records." confirmLabel="Remove" danger loading={remove.isPending} />
    </Card>
  );
}

function Notes({ edit }: { edit: boolean }) {
  const { s, q, save } = useSettings();
  const [doc, setDoc] = useState("INVOICE");
  const [f, setF] = useState({ notes: "", terms: "" });
  useEffect(() => { if (s) setF({ notes: s.notesTerms?.[doc]?.notes ?? "", terms: s.notesTerms?.[doc]?.terms ?? "" }); }, [s, doc]);
  if (q.isLoading) return <Skeleton className="h-40" />;
  return (
    <>
    <Card>
      <CardHeader title="Default notes & terms" subtitle="Filled in automatically on new documents of each type. Saved texts below can be picked on any document." />
      <div className="space-y-3 p-4">
        <Field label="Document"><Select value={doc} onChange={(e) => setDoc(e.target.value)} options={DOCS.map(([v, l]) => ({ value: v, label: l }))} /></Field>
        <Field label="Notes"><textarea className="input min-h-20" disabled={!edit} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <Field label="Terms and conditions" help="One point per line"><textarea className="input min-h-44" disabled={!edit} value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} /></Field>
        {edit && <div className="flex justify-end"><Button variant="primary" loading={save.isPending} onClick={() => save.mutate({ notesTerms: { [doc]: f } })}>Save</Button></div>}
      </div>
    </Card>
    <div className="mt-3 space-y-3"><TextLibrary kind="notes" edit={edit} /><TextLibrary kind="terms" edit={edit} /></div>
    </>
  );
}

function Format({ edit }: { edit: boolean }) {
  const { s, q, save } = useSettings();
  const banks = useQuery({ queryKey: ["billing-banks"], queryFn: () => bill.get("/masters/banks") });
  const [p, setP] = useState<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [tpl, setTpl] = useState("classic-black");
  useEffect(() => { if (s) (setP(s.preferences), setTpl(s.template.id)); }, [s]);
  if (q.isLoading || !p) return <Skeleton className="h-40" />;
  const tog = (k: string, label: string) => <label key={k} className="flex min-h-9 items-center gap-2.5 text-[13px]"><input type="checkbox" className="size-4" disabled={!edit} checked={!!p[k]} onChange={(e) => setP({ ...p, [k]: e.target.checked })} />{label}</label>;
  return (
    <Card>
      <CardHeader title="Invoice format" subtitle="What customers receive as PDF and on WhatsApp" />
      <div className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {[["classic-black", "Classic black", "Logo and company block, black table header, tax and HSN summary, UPI QR, bank, signature"], ["letterhead", "Gexart letterhead", "The Gexart letterhead with a clean items table"]].map(([id, name, desc]) => (
            <button key={id} type="button" disabled={!edit} onClick={() => setTpl(id!)} className={`rounded-lg border p-3 text-left ${tpl === id ? "border-brand-500 ring-2 ring-brand-500/30" : "border-line"}`}>
              <div className="font-medium">{name}</div><div className="mt-0.5 text-xs text-muted">{desc}</div>
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Copy label"><Select disabled={!edit} value={p.copyLabel} onChange={(e) => setP({ ...p, copyLabel: e.target.value })} options={["ORIGINAL FOR RECIPIENT", "DUPLICATE FOR TRANSPORTER", "TRIPLICATE FOR SUPPLIER", "NONE"].map((v) => ({ value: v, label: v === "NONE" ? "No label" : v }))} /></Field>
          <Field label="Default credit days"><input className="input" type="number" min={0} disabled={!edit} value={p.defaultCreditDays} onChange={(e) => setP({ ...p, defaultCreditDays: Number(e.target.value) })} /></Field>
          <Field label="Default bank on invoices"><Select disabled={!edit} value={p.defaultBankAccountId} placeholder="Use the default bank" onChange={(e) => setP({ ...p, defaultBankAccountId: e.target.value })} options={(banks.data?.bankAccounts ?? []).map((b: any) => ({ value: b.id, label: b.name }))} /></Field> {/* eslint-disable-line @typescript-eslint/no-explicit-any */}
          <Field label="Footer line"><input className="input" disabled={!edit} value={p.footerText} onChange={(e) => setP({ ...p, footerText: e.target.value })} /></Field>
        </div>
        <div className="grid gap-x-6 sm:grid-cols-2">
          {tog("roundOff", "Round off the total to the rupee")}{tog("showHsnSummary", "Show HSN / SAC tax summary")}{tog("showAmountInWords", "Show amount in words")}{tog("showBankOnInvoice", "Show bank details")}{tog("showUpiOnInvoice", "Show UPI payment QR")}{tog("showDueDate", "Show due date")}
        </div>
        {edit && <div className="flex justify-end"><Button variant="primary" loading={save.isPending} onClick={() => save.mutate({ preferences: p, template: { id: tpl } })}>Save format</Button></div>}
      </div>
    </Card>
  );
}

function Numbering({ edit }: { edit: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["billing-numbering"], queryFn: () => bill.get("/settings/numbering") });
  const [open, setOpen] = useState<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const save = useMutation({
    mutationFn: () => bill.put("/settings/numbering", { docType: open.docType, branchId: open.branchId, prefix: open.prefix, suffix: open.suffix, padding: Number(open.padding) }),
    onSuccess: () => (toast("success", "Numbering saved"), setOpen(null), qc.invalidateQueries({ queryKey: ["billing-numbering"] })),
    onError: (e) => toast("error", errMsg(e)),
  });
  const rows: any[] = q.data?.series ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (q.isLoading) return <Skeleton className="h-40" />;
  return (
    <Card>
      <CardHeader title="Numbering" subtitle="Document numbers never skip or repeat. The next number is shown." />
      <div className="divide-y divide-line">
        {rows.map((r) => (
          <button key={r.docType} disabled={!edit} onClick={() => setOpen({ ...r })} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 disabled:cursor-default dark:hover:bg-white/5">
            <div className="min-w-0 flex-1"><div className="font-medium">{r.label}</div><div className="text-xs text-muted">Financial year {r.financialYear}</div></div>
            <div className="text-right text-sm tabular-nums">Next: {r.preview}</div>
          </button>
        ))}
      </div>
      <Dialog open={!!open} onClose={() => setOpen(null)} title={open?.label ?? "Numbering"} footer={<><Button onClick={() => setOpen(null)}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
        {open && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Prefix"><input className="input" value={open.prefix} onChange={(e) => setOpen({ ...open, prefix: e.target.value })} /></Field>
              <Field label="Suffix"><input className="input" value={open.suffix} onChange={(e) => setOpen({ ...open, suffix: e.target.value })} /></Field>
              <Field label="Digits"><input className="input" type="number" min={1} max={10} value={open.padding} onChange={(e) => setOpen({ ...open, padding: e.target.value })} /></Field>
            </div>
            <p className="text-xs text-muted">Example: {open.prefix}{String(open.nextNumber).padStart(Number(open.padding) || 1, "0")}{open.suffix}. You can use {"{FY}"} for the financial year.</p>
          </div>
        )}
      </Dialog>
    </Card>
  );
}

function Reminders({ edit }: { edit: boolean }) {
  const { s, q, save } = useSettings();
  const [r, setR] = useState<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  useEffect(() => { if (s) setR({ ...s.reminders, before: s.reminders.daysBefore.join(", "), after: s.reminders.daysAfter.join(", ") }); }, [s]);
  if (q.isLoading || !r) return <Skeleton className="h-40" />;
  const nums = (v: string) => v.split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n) && n >= 0);
  return (
    <Card>
      <CardHeader title="Payment reminders" subtitle="The wording used when you remind a customer on WhatsApp" />
      <div className="space-y-3 p-4">
        <label className="flex items-center gap-2.5 text-[13px]"><input type="checkbox" className="size-4" disabled={!edit} checked={r.enabled} onChange={(e) => setR({ ...r, enabled: e.target.checked })} />Reminders on</label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Days before due" help="e.g. 3"><input className="input" disabled={!edit} value={r.before} onChange={(e) => setR({ ...r, before: e.target.value })} /></Field>
          <Field label="Days after due" help="e.g. 1, 7, 15"><input className="input" disabled={!edit} value={r.after} onChange={(e) => setR({ ...r, after: e.target.value })} /></Field>
        </div>
        <Field label="Message" help="Use {customer} {invoice} {amount} {due} {link}"><textarea className="input min-h-24" disabled={!edit} value={r.message} onChange={(e) => setR({ ...r, message: e.target.value })} /></Field>
        {edit && <div className="flex justify-end"><Button variant="primary" loading={save.isPending} onClick={() => save.mutate({ reminders: { enabled: r.enabled, daysBefore: nums(r.before), daysAfter: nums(r.after), message: r.message } })}>Save</Button></div>}
      </div>
    </Card>
  );
}

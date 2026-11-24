import { useMemo, useState } from "react";
import { Download, FileUp, Upload } from "lucide-react";
import { ITEM_IMPORT_FIELDS, PARTY_IMPORT_FIELDS, autoDetectColumnMapping, parseItemImportRow, parsePartyImportRow, type ColumnMappingConfig } from "@billing/shared";
import { PageHeader } from "../../components/layout";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Select, Tabs, useToast } from "../../components/ui";
import { access, bill, errMsg, inr, useBillingAccess } from "../../lib/billing";
import { useAuth } from "../../lib/auth";

type Kind = "parties" | "items" | "history";

/** Minimal CSV reader: quoted fields, commas and line breaks inside quotes, Windows or Unix line ends. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (q) {
      if (ch === '"') (src[i + 1] === '"' ? ((cell += '"'), i++) : (q = false));
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === "," || ch === "\t" || ch === ";") (row.push(cell), (cell = ""));
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const TEMPLATES: Record<"parties" | "items", string> = {
  parties: "Name,Phone,Type,GSTIN,Company,Email,Address,State Code,Opening Balance\nAcme Traders,9876543210,Customer,19AAACU7929H1ZX,Acme Pvt Ltd,accounts@acme.test,\"1 Park Street, Kolkata\",19,0\n",
  items: "Item Name,Sale Price,Purchase Price,GST Rate,HSN,Unit,Opening Stock\nWebsite design,25000,0,18,9983,NOS,0\nWidget,120,80,18,8479,PCS,50\n",
};

export function ImportPage() {
  const { can } = useBillingAccess();
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [kind, setKind] = useState<Kind>(can("parties.manage") ? "parties" : "items");
  const [table, setTable] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ done: number; failed: { row: number; reason: string }[] } | null>(null);
  const fields: ColumnMappingConfig[] = kind === "items" ? ITEM_IMPORT_FIELDS : PARTY_IMPORT_FIELDS;
  const headers = table[0] ?? [];
  const objects = useMemo(() => table.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""]))), [table, headers]);
  const parsed = useMemo(() => objects.map((o, i) => (kind === "parties" ? parsePartyImportRow(o, mapping, i + 2) : parseItemImportRow(o, mapping, i + 2))), [objects, mapping, kind]);
  const valid = parsed.filter((p) => p.isValid);
  const missing = fields.filter((f) => f.required && !mapping[f.internalKey]);

  const load = async (file: File) => {
    const rows = parseCsv(await file.text());
    if (rows.length < 2) return toast("error", "The file has no data rows. Save your spreadsheet as CSV and try again.");
    setTable(rows);
    setMapping(autoDetectColumnMapping(rows[0]!, fields));
    setResult(null);
  };
  const reset = (k: Kind) => (setKind(k), setTable([]), setMapping({}), setResult(null));

  const run = async () => {
    setBusy(true);
    const failed: { row: number; reason: string }[] = [];
    let done = 0;
    try {
      if (kind === "items") {
        for (let i = 0; i < valid.length; i += 100) {
          const chunk = valid.slice(i, i + 100);
          try {
            const r = await bill.post("/masters/items/bulk", { items: chunk.map((c) => c.data) });
            done += r.insertedCount ?? chunk.length;
          } catch (e) {
            chunk.forEach((c) => failed.push({ row: c.rowNumber, reason: errMsg(e) }));
          }
        }
      } else {
        const queue = [...valid];
        const worker = async () => {
          for (let p = queue.shift(); p; p = queue.shift()) {
            try {
              const d = p.data;
              await bill.post("/masters/parties", { name: d.name, type: d.type, phone: d.phone, gstin: d.gstin || undefined, stateCode: d.stateCode, company: d.company || undefined, email: d.email || undefined, billingAddress: d.billingAddress || undefined });
              done++;
            } catch (e) {
              failed.push({ row: p.rowNumber, reason: errMsg(e) });
            }
          }
        };
        await Promise.all([worker(), worker(), worker(), worker()]);
      }
    } finally {
      setBusy(false);
      setResult({ done, failed: failed.sort((a, b) => a.row - b.row) });
      toast(failed.length ? "info" : "success", `${done} imported${failed.length ? `, ${failed.length} skipped` : ""}`);
    }
  };
  const download = () => {
    const a = document.createElement("a");
    if (kind === "history") return;
    a.href = URL.createObjectURL(new Blob([TEMPLATES[kind]], { type: "text/csv" }));
    a.download = kind === "parties" ? "customers-template.csv" : "products-template.csv";
    a.click();
  };
  const tabs: { value: Kind; label: string }[] = [];
  if (can("parties.manage")) tabs.push({ value: "parties", label: "Customers & vendors" });
  if (can("items.manage")) tabs.push({ value: "items", label: "Products & services" });
  if (isAdmin) tabs.push({ value: "history", label: "Old invoices" });
  if (!tabs.length) return <div className="p-6"><EmptyState icon={Upload} title="Not available" body="Ask an administrator for permission to manage parties or items." /></div>;

  return (
    <div className="pb-10">
      <PageHeader title="Import" icon={FileUp} subtitle="Bring your customers and products from a spreadsheet" actions={kind !== "history" && <Button icon={Download} onClick={download}>Template</Button>} />
      <div className="max-w-3xl space-y-3 px-4 sm:px-6">
        <Tabs<Kind> tabs={tabs} value={kind} onChange={reset} />
        {kind === "history" ? <HistoryImport /> : <>
        <Card className="p-4">
          <p className="text-[13px] text-muted">Export from Swipe, Vyapar, Tally or Excel and save as <b>CSV</b>. Columns are matched by name (for example "Item Name", "Rate", "GST %", "HSN"). You can fix any column below before importing.</p>
          <label className="mt-3 flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line text-sm hover:border-brand-300">
            <Upload className="size-5 text-slate-500" />
            <span>{table.length ? `${table.length - 1} rows loaded. Choose another file` : "Choose a CSV file"}</span>
            <input type="file" accept=".csv,.tsv,.txt,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
          </label>
        </Card>
        {table.length > 0 && (
          <>
            <Card>
              <CardHeader title="Columns" subtitle={missing.length ? `Still needed: ${missing.map((m) => m.label).join(", ")}` : "All required columns found"} />
              <div className="grid gap-3 p-4 sm:grid-cols-2">
                {fields.map((f) => (
                  <Field key={f.internalKey} label={`${f.label}${f.required ? " *" : ""}`}>
                    <Select value={mapping[f.internalKey] ?? ""} placeholder="Not in my file" onChange={(e) => setMapping({ ...mapping, [f.internalKey]: e.target.value })} options={headers.map((h) => ({ value: h, label: h }))} />
                  </Field>
                ))}
              </div>
            </Card>
            <Card>
              <CardHeader title="Preview" subtitle={`${valid.length} ready · ${parsed.length - valid.length} with problems`} />
              <div className="divide-y divide-line">
                {parsed.slice(0, 8).map((p) => (
                  <div key={p.rowNumber} className="flex items-center gap-3 px-4 py-2 text-[13px]">
                    <span className="w-8 text-xs text-muted">{p.rowNumber}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{p.data.name || "(no name)"}</span>
                    {p.isValid ? <Badge tone="green">OK</Badge> : <span className="max-w-[55%] truncate text-xs text-red-600">{p.errors.join("; ")}</span>}
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2 p-3">
                <Button variant="primary" loading={busy} disabled={!valid.length || missing.length > 0} onClick={run}>Import {valid.length} {kind === "parties" ? "parties" : "items"}</Button>
              </div>
            </Card>
          </>
        )}
        {result && (
          <Card className="p-4 text-[13px]">
            <div className="font-semibold">{result.done} imported{result.failed.length ? `, ${result.failed.length} skipped` : ""}</div>
            {result.failed.slice(0, 20).map((f) => <div key={f.row} className="mt-1 text-xs text-muted">Row {f.row}: {f.reason}</div>)}
          </Card>
        )}
        </>}
      </div>
    </div>
  );
}

/** Loads invoices made in another billing tool (from their PDFs) in one go: company details, bank, terms, signature, customers, products, invoices and payments. */
function HistoryImport() {
  const toast = useToast();
  const [data, setData] = useState<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [preview, setPreview] = useState<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [result, setResult] = useState<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [markPaid, setMarkPaid] = useState(true);
  const [busy, setBusy] = useState(false);
  const load = async (f: File) => {
    try {
      const json = JSON.parse(await f.text());
      setData(json);
      setResult(null);
      const r = await access.post("/import", { ...json, dryRun: true });
      setPreview(r.data);
    } catch (e) {
      setData(null);
      setPreview(null);
      toast("error", errMsg(e));
    }
  };
  const run = async () => {
    setBusy(true);
    try {
      const r = await access.post("/import", { ...data, markPaid, dryRun: false });
      setResult(r.data);
      toast("success", `${r.data.createdInvoices} invoices imported`);
    } catch (e) {
      toast("error", errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Card className="p-4">
        <p className="text-[13px] text-muted">Choose the file prepared from your old invoices. It sets up your company details, bank, notes and terms and signature, then creates every customer and product, every invoice with its original number and date, and the payments already received. It only runs on a workspace with no invoices yet.</p>
        <label className="mt-3 flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line text-sm hover:border-brand-300">
          <Upload className="size-5 text-slate-500" />
          <span>{data ? "File loaded. Choose another" : "Choose the .json file"}</span>
          <input type="file" accept=".json,application/json" className="sr-only" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
        </label>
      </Card>
      {preview && !result && (
        <Card>
          <CardHeader title="What will be created" subtitle={preview.existingInvoices ? `This workspace already has ${preview.existingInvoices} invoice(s), so the import will be refused.` : "Nothing has been saved yet"} />
          <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3">
            {[["Customers", preview.customers], ["Products", preview.products], ["Invoices", preview.invoices], ["Billed", inr(preview.billedPaise)], ["Already received", inr(preview.receivedPaise)], ["Still due", inr(preview.billedPaise - preview.receivedPaise)]].map(([l, v]) => (
              <div key={String(l)} className="rounded-lg border border-line p-2.5"><div className="text-[11px] text-muted">{l}</div><div className="text-lg font-semibold tabular-nums">{v}</div></div>
            ))}
          </div>
          <label className="flex items-center gap-2 px-4 pb-3 text-[13px]"><input type="checkbox" className="size-4" checked={markPaid} onChange={(e) => setMarkPaid(e.target.checked)} />Record the payments that were already received (to the bank, on the invoice date)</label>
          <div className="flex justify-end p-3"><Button variant="primary" loading={busy} disabled={preview.existingInvoices > 0} onClick={run}>Import everything</Button></div>
        </Card>
      )}
      {result && (
        <Card className="space-y-2 p-4 text-[13px]">
          <div className="font-semibold">Done: {result.createdInvoices} invoices, {result.customers} customers, {result.products} products, {result.paymentsRecorded} payments</div>
          {result.totalMismatches?.length ? <div className="text-amber-700 dark:text-amber-300">Totals that differ from the file: {result.totalMismatches.join("; ")}</div> : <div className="text-emerald-700 dark:text-emerald-300">Every invoice total matches the file exactly.</div>}
          {result.warnings?.map((w: string) => <div key={w} className="text-xs text-red-600">{w}</div>)}
        </Card>
      )}
    </>
  );
}

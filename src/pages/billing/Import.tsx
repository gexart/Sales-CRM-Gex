import { useMemo, useState } from "react";
import { Download, FileUp, Upload } from "lucide-react";
import { ITEM_IMPORT_FIELDS, PARTY_IMPORT_FIELDS, autoDetectColumnMapping, parseItemImportRow, parsePartyImportRow, type ColumnMappingConfig } from "@billing/shared";
import { PageHeader } from "../../components/layout";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Select, Tabs, useToast } from "../../components/ui";
import { bill, errMsg, useBillingAccess } from "../../lib/billing";

type Kind = "parties" | "items";

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

const TEMPLATES: Record<Kind, string> = {
  parties: "Name,Phone,Type,GSTIN,Company,Email,Address,State Code,Opening Balance\nAcme Traders,9876543210,Customer,19AAACU7929H1ZX,Acme Pvt Ltd,accounts@acme.test,\"1 Park Street, Kolkata\",19,0\n",
  items: "Item Name,Sale Price,Purchase Price,GST Rate,HSN,Unit,Opening Stock\nWebsite design,25000,0,18,9983,NOS,0\nWidget,120,80,18,8479,PCS,50\n",
};

export function ImportPage() {
  const { can } = useBillingAccess();
  const toast = useToast();
  const [kind, setKind] = useState<Kind>(can("parties.manage") ? "parties" : "items");
  const [table, setTable] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ done: number; failed: { row: number; reason: string }[] } | null>(null);
  const fields: ColumnMappingConfig[] = kind === "parties" ? PARTY_IMPORT_FIELDS : ITEM_IMPORT_FIELDS;
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
    a.href = URL.createObjectURL(new Blob([TEMPLATES[kind]], { type: "text/csv" }));
    a.download = kind === "parties" ? "customers-template.csv" : "products-template.csv";
    a.click();
  };
  const tabs: { value: Kind; label: string }[] = [];
  if (can("parties.manage")) tabs.push({ value: "parties", label: "Customers & vendors" });
  if (can("items.manage")) tabs.push({ value: "items", label: "Products & services" });
  if (!tabs.length) return <div className="p-6"><EmptyState icon={Upload} title="Not available" body="Ask an administrator for permission to manage parties or items." /></div>;

  return (
    <div className="pb-10">
      <PageHeader title="Import" icon={FileUp} subtitle="Bring your customers and products from a spreadsheet" actions={<Button icon={Download} onClick={download}>Template</Button>} />
      <div className="max-w-3xl space-y-3 px-4 sm:px-6">
        <Tabs<Kind> tabs={tabs} value={kind} onChange={reset} />
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
      </div>
    </div>
  );
}

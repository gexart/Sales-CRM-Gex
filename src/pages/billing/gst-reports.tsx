import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FileText } from "lucide-react";
import { Button, Card, EmptyState, ErrorState, Field, Skeleton } from "../../components/ui";
import { bill, inr } from "../../lib/billing";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const thisMonth = () => new Date().toISOString().slice(0, 7);
const rs = (p: number) => inr(p);

/** Download rows as a CSV file that opens in Excel. */
function csv(name: string, head: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const text = [head, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? "border-t border-line pt-2 text-base font-semibold" : "text-[13px]"}`}>
      <span className={strong ? "" : "text-muted"}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function Item({ title, sub, amount, tax }: { title: string; sub: string; amount: number; tax: number }) {
  return (
    <div className="flex items-start justify-between gap-3 px-3.5 py-2.5 text-[13px]">
      <div className="min-w-0">
        <div className="truncate font-medium">{title}</div>
        <div className="truncate text-xs text-muted">{sub}</div>
      </div>
      <div className="text-right tabular-nums">
        <div>{rs(amount)}</div>
        <div className="text-xs text-muted">tax {rs(tax)}</div>
      </div>
    </div>
  );
}

/** GST for one month: what to report in GSTR-1 and an estimate of the GSTR-3B tax to pay. */
export function GstTab() {
  const [month, setMonth] = useState(thisMonth());
  const q = useQuery({ queryKey: ["billing-gst", month], queryFn: () => bill.get(`/reports/gst-summary?month=${month}`), enabled: /^\d{4}-\d{2}$/.test(month) });
  const g = q.data;
  const tax = g ? g.totals.cgst + g.totals.sgst + g.totals.igst + g.totals.cess : 0;
  return (
    <div className="space-y-3">
      <Card className="p-3.5">
        <Field label="Month">
          <input className="input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </Field>
      </Card>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading || !g ? (
        <Skeleton className="h-40" />
      ) : g.invoiceCount === 0 && g.creditNotes.length === 0 ? (
        <Card>
          <EmptyState icon={FileText} title="No invoices in this month" body="Pick another month." />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["Taxable sales", rs(g.totals.taxable)],
                ["GST on sales", rs(tax)],
                ["CGST", rs(g.totals.cgst)],
                ["SGST", rs(g.totals.sgst)],
                ["IGST", rs(g.totals.igst)],
                ["Invoices", String(g.invoiceCount)],
              ] as [string, string][]
            ).map(([l, v]) => (
              <Card key={l} className="p-3">
                <div className="text-[11px] text-muted">{l}</div>
                <div className="mt-0.5 text-[17px] font-semibold tabular-nums">{v}</div>
              </Card>
            ))}
          </div>

          <Card className="space-y-1.5 p-3.5">
            <div className="mb-1 font-medium">GSTR-3B estimate</div>
            <Line label="Tax on sales" value={rs(tax)} />
            <Line label="Less: credit notes" value={`- ${rs(g.gstr3b.creditNoteTax)}`} />
            <Line label="Less: tax paid on purchases (ITC)" value={`- ${rs(g.gstr3b.itc.cgst + g.gstr3b.itc.sgst + g.gstr3b.itc.igst)}`} />
            <Line label={g.gstr3b.payable.total >= 0 ? "Tax to pay" : "Credit to carry forward"} value={rs(Math.abs(g.gstr3b.payable.total))} strong />
            <p className="pt-1 text-xs text-muted">{g.note}</p>
          </Card>

          <Card className="divide-y divide-line">
            <div className="flex items-center justify-between px-3.5 py-2.5">
              <div className="font-medium">B2B invoices ({g.b2b.length})</div>
              {g.b2b.length > 0 && (
                <Button
                  size="sm"
                  icon={Download}
                  onClick={() =>
                    csv(
                      `gstr1-b2b-${month}.csv`,
                      ["GSTIN", "Party", "Invoice no", "Date", "Invoice value", "Place of supply", "Rate %", "Taxable", "CGST", "SGST", "IGST"],
                      g.b2b.map((r: Row) => [r.gstin, r.partyName, r.invoiceNo, r.date, r.invoiceValue / 100, r.placeOfSupply, r.rate, r.taxable / 100, r.cgst / 100, r.sgst / 100, r.igst / 100]),
                    )
                  }
                >
                  CSV
                </Button>
              )}
            </div>
            {g.b2b.length === 0 ? (
              <div className="px-3.5 py-3 text-[13px] text-muted">No sales to GST-registered customers.</div>
            ) : (
              g.b2b.map((r: Row, i: number) => <Item key={i} title={r.partyName} sub={`${r.invoiceNo} · ${r.gstin} · ${r.rate}%`} amount={r.taxable} tax={r.cgst + r.sgst + r.igst} />)
            )}
          </Card>

          <Card className="divide-y divide-line">
            <div className="px-3.5 py-2.5 font-medium">B2C sales (customers without GSTIN)</div>
            {g.b2c.length === 0 ? (
              <div className="px-3.5 py-3 text-[13px] text-muted">None.</div>
            ) : (
              g.b2c.map((r: Row, i: number) => <Item key={i} title={`State ${r.placeOfSupply}`} sub={`${r.rate}%`} amount={r.taxable} tax={r.cgst + r.sgst + r.igst} />)
            )}
          </Card>

          <Card className="divide-y divide-line">
            <div className="flex items-center justify-between px-3.5 py-2.5">
              <div className="font-medium">HSN / SAC summary</div>
              {g.hsn.length > 0 && (
                <Button
                  size="sm"
                  icon={Download}
                  onClick={() =>
                    csv(
                      `gstr1-hsn-${month}.csv`,
                      ["HSN/SAC", "Rate %", "Quantity", "Taxable", "CGST", "SGST", "IGST", "Total value"],
                      g.hsn.map((r: Row) => [r.hsn, r.rate, r.quantity, r.taxable / 100, r.cgst / 100, r.sgst / 100, r.igst / 100, r.value / 100]),
                    )
                  }
                >
                  CSV
                </Button>
              )}
            </div>
            {g.hsn.map((r: Row, i: number) => (
              <Item key={i} title={String(r.hsn)} sub={`${r.rate}% · qty ${r.quantity}`} amount={r.taxable} tax={r.cgst + r.sgst + r.igst} />
            ))}
          </Card>

          {g.creditNotes.length > 0 && (
            <Card className="divide-y divide-line">
              <div className="px-3.5 py-2.5 font-medium">Credit notes ({g.creditNotes.length})</div>
              {g.creditNotes.map((n: Row, i: number) => (
                <Item key={i} title={n.noteNo} sub={`against ${n.invoiceNo ?? "-"} · ${n.partyName ?? ""}`} amount={n.value} tax={n.tax} />
              ))}
            </Card>
          )}

          <Card className="p-3.5 text-[13px]">
            <div className="font-medium">Documents issued</div>
            <div className="mt-1 text-muted">
              {g.documents.count} invoices{g.documents.cancelled ? `, ${g.documents.cancelled} cancelled` : ""} · {g.documents.from} to {g.documents.to}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

/** Accounts for Tally: vouchers and ledgers for a date range, as the XML file Tally imports. */
export function TallyTab() {
  const first = new Date();
  first.setDate(1);
  const [from, setFrom] = useState(first.toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const settings = useQuery({ queryKey: ["billing-settings"], queryFn: () => bill.get("/settings/billing"), staleTime: 60_000 });
  const [name, setName] = useState("");
  const company = name || settings.data?.billing?.company?.legalName || "";
  const url = `/api/v1/billing/accounting/tally-xml?startDate=${from}&endDate=${to}&companyName=${encodeURIComponent(company)}`;
  return (
    <Card className="space-y-3 p-3.5">
      <div className="font-medium">Export to Tally</div>
      <p className="text-[13px] text-muted">Downloads your sales, purchases, payments and ledgers for the dates below as a file that Tally reads.</p>
      <Field label="Company name in Tally" help="Must match the company that is open in Tally">
        <input className="input" value={company} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="From">
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      <a href={url} download>
        <Button variant="primary" icon={Download} disabled={!company || !from || !to}>
          Download Tally file
        </Button>
      </a>
      <p className="text-xs text-muted">In Tally: Gateway of Tally, Import, Vouchers, then choose the downloaded file.</p>
    </Card>
  );
}

import { newId } from '@billing/shared';

/**
 * Report builder: pick what (dataset), grouped by what, which numbers, for which dates — no SQL from the user.
 * Every piece maps to a fixed, whitelisted SQL fragment, so a saved report can never read outside its dataset.
 */

interface Dataset {
  label: string;
  from: string;
  where: string;
  date: string;
  groups: Record<string, { label: string; expr: string }>;
  metrics: Record<string, { label: string; expr: string; money: boolean }>;
}

export const REPORT_DATASETS: Record<string, Dataset> = {
  SALES: {
    label: 'Sales invoices',
    from: 'invoices i',
    where: "i.deleted_at IS NULL AND i.status NOT IN ('CANCELLED', 'DRAFT')",
    date: 'i.date',
    groups: {
      MONTH: { label: 'Month', expr: "substr(i.date, 1, 7)" },
      DAY: { label: 'Day', expr: 'i.date' },
      CUSTOMER: { label: 'Customer', expr: "COALESCE(i.party_name, 'Walk-in')" },
      STATUS: { label: 'Status', expr: 'i.status' },
    },
    metrics: {
      TOTAL: { label: 'Total', expr: 'SUM(i.total_paise)', money: true },
      TAX: { label: 'GST', expr: 'SUM(i.tax_total_paise)', money: true },
      DUE: { label: 'Unpaid', expr: 'SUM(i.balance_amount_paise)', money: true },
      COUNT: { label: 'Invoices', expr: 'COUNT(*)', money: false },
    },
  },
  ITEMS_SOLD: {
    label: 'Items sold',
    from: 'invoice_lines l JOIN invoices i ON i.id = l.invoice_id',
    where: "i.deleted_at IS NULL AND i.status NOT IN ('CANCELLED', 'DRAFT')",
    date: 'i.date',
    groups: {
      ITEM: { label: 'Item', expr: 'l.name' },
      HSN: { label: 'HSN/SAC', expr: "COALESCE(NULLIF(l.hsn_sac, ''), '—')" },
      MONTH: { label: 'Month', expr: "substr(i.date, 1, 7)" },
      CUSTOMER: { label: 'Customer', expr: "COALESCE(i.party_name, 'Walk-in')" },
    },
    metrics: {
      VALUE: { label: 'Sales value', expr: 'SUM(l.line_total_paise)', money: true },
      QTY: { label: 'Quantity', expr: 'ROUND(SUM(l.quantity_thousandths) / 1000.0, 3)', money: false },
      LINES: { label: 'Bill lines', expr: 'COUNT(*)', money: false },
    },
  },
  PURCHASES: {
    label: 'Purchase bills',
    from: 'purchase_bills b LEFT JOIN parties p ON p.id = b.party_id',
    where: "b.status != 'CANCELLED'",
    date: 'b.date',
    groups: {
      MONTH: { label: 'Month', expr: "substr(b.date, 1, 7)" },
      VENDOR: { label: 'Vendor', expr: "COALESCE(p.name, '—')" },
      STATUS: { label: 'Status', expr: 'b.status' },
    },
    metrics: {
      TOTAL: { label: 'Total', expr: 'SUM(b.total_paise)', money: true },
      TAX: { label: 'GST (input)', expr: 'SUM(b.tax_total_paise)', money: true },
      DUE: { label: 'Unpaid', expr: 'SUM(b.total_paise - b.paid_amount_paise)', money: true },
      COUNT: { label: 'Bills', expr: 'COUNT(*)', money: false },
    },
  },
  EXPENSES: {
    label: 'Expenses',
    from: 'expenses e LEFT JOIN accounts a ON a.id = e.category_account_id',
    where: '1 = 1',
    date: 'e.date',
    groups: {
      MONTH: { label: 'Month', expr: "substr(e.date, 1, 7)" },
      CATEGORY: { label: 'Category', expr: "COALESCE(a.name, 'Other')" },
      PAYEE: { label: 'Paid to', expr: "COALESCE(NULLIF(e.payee, ''), '—')" },
      MODE: { label: 'Payment mode', expr: "COALESCE(e.payment_mode, '—')" },
    },
    metrics: {
      TOTAL: { label: 'Amount', expr: 'SUM(e.amount_paise)', money: true },
      TAX: { label: 'GST', expr: 'SUM(e.tax_amount_paise)', money: true },
      COUNT: { label: 'Entries', expr: 'COUNT(*)', money: false },
    },
  },
};

export interface ReportSpec {
  dataset: string;
  groupBy: string;
  metrics: string[];
  from: string;
  to: string;
  sort?: 'GROUP' | 'FIRST_METRIC_DESC';
  limit?: number;
}

type Sql = { exec(q: string, ...b: unknown[]): { toArray(): any[] } };

export class ReportBuilderService {
  constructor(private sql: Sql) {}

  static catalog() {
    return Object.fromEntries(
      Object.entries(REPORT_DATASETS).map(([k, d]) => [
        k,
        {
          label: d.label,
          groups: Object.fromEntries(Object.entries(d.groups).map(([g, v]) => [g, v.label])),
          metrics: Object.fromEntries(Object.entries(d.metrics).map(([m, v]) => [m, { label: v.label, money: v.money }])),
        },
      ]),
    );
  }

  run(spec: ReportSpec) {
    const d = REPORT_DATASETS[spec.dataset];
    if (!d) throw new Error('Unknown report type');
    const g = d.groups[spec.groupBy];
    if (!g) throw new Error('Choose how to group the report');
    if (!spec.metrics.length) throw new Error('Choose at least one number to show');
    const ms = spec.metrics.map((m) => {
      const x = d.metrics[m];
      if (!x) throw new Error(`Unknown number: ${m}`);
      return { key: m, ...x };
    });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(spec.from) || !/^\d{4}-\d{2}-\d{2}$/.test(spec.to) || spec.from > spec.to) throw new Error('Choose a valid date range');
    const limit = Math.min(1000, Math.max(1, spec.limit ?? 500));
    const order = spec.sort === 'FIRST_METRIC_DESC' ? 'm0 DESC' : 'grp ASC';
    const q = `SELECT ${g.expr} AS grp, ${ms.map((m, i) => `${m.expr} AS m${i}`).join(', ')}
      FROM ${d.from} WHERE ${d.where} AND ${d.date} >= ? AND ${d.date} <= ?
      GROUP BY grp ORDER BY ${order} LIMIT ${limit}`;
    const rows = this.sql.exec(q, spec.from, spec.to).toArray().map((r: any) => ({ group: r.grp, values: ms.map((_, i) => Number(r[`m${i}`] ?? 0)) }));
    const totals = ms.map((_, i) => rows.reduce((a, r) => a + r.values[i]!, 0));
    return {
      title: `${d.label} by ${g.label.toLowerCase()}`,
      groupLabel: g.label,
      columns: ms.map((m) => ({ key: m.key, label: m.label, money: m.money })),
      rows,
      totals,
    };
  }

  save(name: string, spec: ReportSpec, userId: string | null) {
    this.run({ ...spec, limit: 1 }); // validates the spec
    const id = `rpt_${newId()}`;
    const now = new Date().toISOString();
    this.sql.exec(
      `INSERT INTO settings (id, key, value_json, updated_at) VALUES (?, ?, ?, ?)`,
      `set_${newId()}`,
      `saved_report:${id}`,
      JSON.stringify({ id, name: name.trim(), spec, createdBy: userId, createdAt: now }),
      now,
    );
    return { id };
  }

  listSaved() {
    return this.sql
      .exec(`SELECT value_json FROM settings WHERE key LIKE 'saved_report:%' ORDER BY updated_at DESC`)
      .toArray()
      .map((r: any) => {
        try {
          return JSON.parse(r.value_json);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  deleteSaved(id: string) {
    this.sql.exec(`DELETE FROM settings WHERE key = ?`, `saved_report:${id}`);
    return { id };
  }
}

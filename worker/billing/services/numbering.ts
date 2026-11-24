import {
  DEFAULT_DOC_PREFIXES,
  DOC_TYPE_LABELS,
  MAX_DOC_NUMBER_LENGTH,
  validateNumberTemplate,
  financialYearOf,
  formatDocNumber,
  newId,
  templatizeFinancialYear,
} from '@billing/shared';

/** Minimal Durable Object SQLite surface (also satisfied by the test double). */
export interface NumberingSql {
  exec(query: string, ...bindings: unknown[]): unknown;
}

/** Rows from a cursor that may offer toArray(), iteration, or only next(). */
function rowsOf(cur: any): unknown[] {
  if (!cur) return [];
  if (typeof cur.toArray === 'function') return cur.toArray();
  if (typeof cur[Symbol.iterator] === 'function') return [...cur];
  const out: unknown[] = [];
  if (typeof cur.next === 'function') {
    for (let r = cur.next(); r && !r.done; r = cur.next()) out.push(r.value);
  }
  return out;
}

export interface AllocateOptions {
  docType: string;
  branchId?: string | null;
  /** Document date (decides the financial year). Defaults to now. */
  date?: string | Date;
  /** Customer / vendor whose own prefix / suffix should be used, if they have one. */
  partyId?: string | null;
}

export interface AllocatedNumber {
  docNumber: string;
  seriesId: string;
  number: number;
  financialYear: string;
}

interface SeriesRow {
  id: string;
  branch_id: string;
  prefix: string;
  suffix: string | null;
  next_number: number;
  padding: number;
  financial_year: string;
}

const first = <T>(rows: unknown[]): T | undefined => rows[0] as T | undefined;

/**
 * The ONE place that allocates document numbers. Must run inside the BusinessDO transaction (writes are
 * serialised per business), so numbers are gapless per series per financial year.
 *  - picks the series for (docType, branch, FY); creates it when missing (copying the previous FY's
 *    prefix/suffix with the FY rolled over, or the default prefix), so there is never a random fallback;
 *  - applies the customer's own prefix / suffix when set, keeping the series' running number.
 */
export function allocateDocNumber(sql: NumberingSql, opts: AllocateOptions): AllocatedNumber {
  const date = opts.date ? new Date(opts.date) : new Date();
  const fy = financialYearOf(date);

  const branch = opts.branchId
    ? first<{ id: string; code: string }>(rowsOf(sql.exec('SELECT id, code FROM branches WHERE id = ?', opts.branchId)))
    : first<{ id: string; code: string }>(rowsOf(sql.exec('SELECT id, code FROM branches ORDER BY is_default DESC, created_at ASC LIMIT 1')));
  const branchId = branch?.id ?? opts.branchId ?? null;
  if (!branchId) throw new Error('NO_BRANCH: create a branch before issuing documents');

  let series = first<SeriesRow>(
    rowsOf(sql
      .exec(
        `SELECT id, branch_id, prefix, suffix, next_number, padding, financial_year FROM document_series
         WHERE doc_type = ? AND branch_id = ? AND financial_year = ? ORDER BY is_default DESC LIMIT 1`,
        opts.docType, branchId, fy.label,
      )),
  );

  if (!series) {
    // Roll over from the latest earlier series of this type (keeps the owner's custom format) or use the default.
    const previous = first<SeriesRow>(
      rowsOf(sql
        .exec(
          `SELECT id, branch_id, prefix, suffix, next_number, padding, financial_year FROM document_series
           WHERE doc_type = ? AND branch_id = ? ORDER BY financial_year DESC, is_default DESC LIMIT 1`,
          opts.docType, branchId,
        )),
    );
    const prefix = previous ? templatizeFinancialYear(previous.prefix, previous.financial_year) : DEFAULT_DOC_PREFIXES[opts.docType] ?? `${opts.docType.slice(0, 4)}/{FY}/`;
    const suffix = previous ? templatizeFinancialYear(previous.suffix ?? '', previous.financial_year) : '';
    const padding = previous ? Number(previous.padding) || 4 : 4;
    const id = newId();
    sql.exec(
      `INSERT INTO document_series (id, branch_id, doc_type, prefix, suffix, next_number, fy_suffix_enabled, financial_year, padding, is_default, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, 1, ?)`,
      id, branchId, opts.docType, prefix, suffix, fy.label, padding, new Date().toISOString(),
    );
    series = { id, branch_id: branchId, prefix, suffix, next_number: 1, padding, financial_year: fy.label };
  }

  const party = opts.partyId
    ? first<{ doc_prefix: string | null; doc_suffix: string | null }>(
        rowsOf(sql.exec('SELECT doc_prefix, doc_suffix FROM parties WHERE id = ?', opts.partyId)),
      )
    : undefined;

  const number = Number(series.next_number) || 1;
  const docNumber = formatDocNumber({
    prefix: series.prefix,
    suffix: series.suffix,
    number,
    padding: Number(series.padding) || 4,
    date,
    branchCode: branch?.code ?? '',
    partyPrefix: party?.doc_prefix,
    partySuffix: party?.doc_suffix,
  });
  sql.exec('UPDATE document_series SET next_number = next_number + 1, updated_at = ? WHERE id = ?', new Date().toISOString(), series.id);
  return { docNumber, seriesId: series.id, number, financialYear: fy.label };
}

/** Preview the next number without consuming it (settings screen). */
export function previewDocNumber(sql: NumberingSql, opts: AllocateOptions): string {
  const date = opts.date ? new Date(opts.date) : new Date();
  const fy = financialYearOf(date);
  const row = first<SeriesRow & { code: string }>(
    rowsOf(sql
      .exec(
        `SELECT s.prefix, s.suffix, s.next_number, s.padding, b.code FROM document_series s JOIN branches b ON b.id = s.branch_id
         WHERE s.doc_type = ? AND s.financial_year = ?${opts.branchId ? ' AND s.branch_id = ?' : ''} ORDER BY s.is_default DESC LIMIT 1`,
        ...(opts.branchId ? [opts.docType, fy.label, opts.branchId] : [opts.docType, fy.label]),
      )),
  );
  return formatDocNumber({
    prefix: row?.prefix ?? DEFAULT_DOC_PREFIXES[opts.docType] ?? '',
    suffix: row?.suffix ?? '',
    number: Number(row?.next_number) || 1,
    padding: Number(row?.padding) || 4,
    date,
    branchCode: row?.code ?? '',
  });
}

/**
 * Durable Object SQLite exposes only `exec(query, ...bindings)`. Some older services were written against a
 * `prepare()` API (node:sqlite / test doubles). This adapter gives either shape the same query/run interface.
 */
export interface SqlRunner {
  all(query: string, ...params: unknown[]): any[];
  run(query: string, ...params: unknown[]): void;
  /** exec-style view for allocateDocNumber */
  asExec(): NumberingSql;
}

const isRead = (q: string) => /^\s*(select|with|pragma)\b/i.test(q) || /\breturning\b/i.test(q);

export function sqlRunner(sql: any): SqlRunner {
  const usePrepare = typeof sql?.prepare === 'function';
  const all = (query: string, ...params: unknown[]): any[] => {
    if (usePrepare) return sql.prepare(query).all(...params);
    const cur = sql.exec(query, ...params);
    return typeof cur?.toArray === 'function' ? cur.toArray() : [];
  };
  const run = (query: string, ...params: unknown[]): void => {
    if (usePrepare) sql.prepare(query).run(...params);
    else sql.exec(query, ...params);
  };
  return {
    all,
    run,
    asExec: () => ({
      exec: (query: string, ...params: unknown[]) => {
        if (isRead(query)) {
          const rows = all(query, ...params);
          return { toArray: () => rows };
        }
        run(query, ...params);
        return { toArray: () => [] };
      },
    }),
  };
}

export interface SeriesSetting {
  docType: string;
  label: string;
  module: string;
  branchId: string;
  prefix: string;
  suffix: string;
  padding: number;
  nextNumber: number;
  financialYear: string;
  /** What the next document will be numbered. */
  preview: string;
}

function resolveBranch(sql: NumberingSql, branchId?: string | null): { id: string; code: string } {
  const b = branchId
    ? first<{ id: string; code: string }>(rowsOf(sql.exec('SELECT id, code FROM branches WHERE id = ?', branchId)))
    : first<{ id: string; code: string }>(rowsOf(sql.exec('SELECT id, code FROM branches ORDER BY is_default DESC, created_at ASC LIMIT 1')));
  if (!b) throw new Error('NO_BRANCH');
  return b;
}

/** Current-FY numbering settings for every document type of one branch (missing series show their defaults). */
export function listSeriesSettings(sql: NumberingSql, branchId?: string | null, date: Date = new Date()): SeriesSetting[] {
  const fy = financialYearOf(date);
  const branch = resolveBranch(sql, branchId);
  const rows = rowsOf(
    sql.exec(
      'SELECT doc_type, prefix, suffix, padding, next_number FROM document_series WHERE branch_id = ? AND financial_year = ? ORDER BY is_default DESC',
      branch.id, fy.label,
    ),
  ) as { doc_type: string; prefix: string; suffix: string | null; padding: number; next_number: number }[];
  return Object.entries(DOC_TYPE_LABELS).map(([docType, meta]) => {
    const r = rows.find((x) => x.doc_type === docType);
    const prefix = r?.prefix ?? DEFAULT_DOC_PREFIXES[docType] ?? '';
    const suffix = r?.suffix ?? '';
    const padding = Number(r?.padding) || 4;
    const nextNumber = Number(r?.next_number) || 1;
    return {
      docType, label: meta.label, module: meta.module, branchId: branch.id, prefix, suffix, padding, nextNumber,
      financialYear: fy.label,
      preview: formatDocNumber({ prefix, suffix, number: nextNumber, padding, date, branchCode: branch.code }),
    };
  });
}

/**
 * Change the prefix / suffix / padding of the current-FY series of one document type. The running number
 * is never reset here (that would create duplicate numbers); a missing series is created starting at 1.
 */
export function saveSeriesSetting(
  sql: NumberingSql,
  input: { docType: string; branchId?: string | null; prefix: string; suffix: string; padding: number },
  date: Date = new Date(),
): SeriesSetting {
  if (!DOC_TYPE_LABELS[input.docType]) throw new Error('UNKNOWN_DOC_TYPE');
  for (const t of [input.prefix, input.suffix]) {
    const err = validateNumberTemplate(t);
    if (err) throw new Error(`INVALID_TEMPLATE: ${err}`);
  }
  const padding = Math.min(Math.max(Math.trunc(input.padding), 1), 10);
  const fy = financialYearOf(date);
  const branch = resolveBranch(sql, input.branchId);
  const sample = formatDocNumber({ prefix: input.prefix, suffix: input.suffix, number: 1, padding, date, branchCode: branch.code });
  if (sample.length > MAX_DOC_NUMBER_LENGTH) throw new Error(`TOO_LONG: numbers must be ${MAX_DOC_NUMBER_LENGTH} characters or fewer for GST (e.g. ${sample})`);
  const existing = first<{ id: string }>(
    rowsOf(sql.exec('SELECT id FROM document_series WHERE doc_type = ? AND branch_id = ? AND financial_year = ? ORDER BY is_default DESC LIMIT 1', input.docType, branch.id, fy.label)),
  );
  const now = new Date().toISOString();
  if (existing) {
    sql.exec('UPDATE document_series SET prefix = ?, suffix = ?, padding = ?, updated_at = ? WHERE id = ?', input.prefix, input.suffix, padding, now, existing.id);
  } else {
    sql.exec(
      `INSERT INTO document_series (id, branch_id, doc_type, prefix, suffix, next_number, fy_suffix_enabled, financial_year, padding, is_default, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, 1, ?)`,
      newId(), branch.id, input.docType, input.prefix, input.suffix, fy.label, padding, now,
    );
  }
  const saved = listSeriesSettings(sql, branch.id, date).find((s) => s.docType === input.docType);
  if (!saved) throw new Error('UNKNOWN_DOC_TYPE');
  return saved;
}

import { financialYearOf } from './numbering';

/** Date-range presets used by every list and report (dates are India calendar dates, YYYY-MM-DD). */
export interface PeriodOption {
  id: string;
  label: string;
  group: 'Quick' | 'Financial year' | 'Calendar year';
}

export interface DateRange {
  /** inclusive, YYYY-MM-DD; undefined = open */
  from?: string;
  to?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** India calendar date parts of an instant. */
function istParts(now: Date) {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return { y: ist.getUTCFullYear(), m: ist.getUTCMonth() + 1, d: ist.getUTCDate() };
}

function shiftDays(y: number, m: number, d: number, days: number): string {
  const t = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

const lastDayOf = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Presets: All, Today, Yesterday, Last 7 days, This month, Last month, this + 2 previous FYs, this + previous calendar year. */
export function periodOptions(now: Date = new Date()): PeriodOption[] {
  const fy = financialYearOf(now).startYear;
  const { y } = istParts(now);
  const fyLabel = (s: number) => `${String(s).slice(-2)}-${String(s + 1).slice(-2)}`;
  return [
    { id: 'all', label: 'All time', group: 'Quick' },
    { id: 'today', label: 'Today', group: 'Quick' },
    { id: 'yesterday', label: 'Yesterday', group: 'Quick' },
    { id: '7d', label: 'Last 7 days', group: 'Quick' },
    { id: 'this_month', label: 'This month', group: 'Quick' },
    { id: 'last_month', label: 'Last month', group: 'Quick' },
    ...[0, 1, 2].map((k) => ({ id: `fy:${fyLabel(fy - k)}`, label: `FY ${fyLabel(fy - k)}`, group: 'Financial year' as const })),
    ...[0, 1].map((k) => ({ id: `year:${y - k}`, label: String(y - k), group: 'Calendar year' as const })),
  ];
}

/** Turn a preset id (or `month:2026-08`, `fy:25-26`, `year:2025`) into an inclusive date range. */
export function periodRange(id: string, now: Date = new Date()): DateRange {
  const { y, m, d } = istParts(now);
  const today = ymd(y, m, d);
  switch (id) {
    case 'all':
      return {};
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const yd = shiftDays(y, m, d, -1);
      return { from: yd, to: yd };
    }
    case '7d':
      return { from: shiftDays(y, m, d, -6), to: today };
    case 'this_month':
      return { from: ymd(y, m, 1), to: today };
    case 'last_month': {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return { from: ymd(py, pm, 1), to: ymd(py, pm, lastDayOf(py, pm)) };
    }
  }
  const fy = /^fy:(\d{2})-(\d{2})$/.exec(id);
  if (fy) {
    const start = 2000 + Number(fy[1]);
    return { from: ymd(start, 4, 1), to: ymd(start + 1, 3, 31) };
  }
  const yr = /^year:(\d{4})$/.exec(id);
  if (yr) return { from: ymd(Number(yr[1]), 1, 1), to: ymd(Number(yr[1]), 12, 31) };
  const mo = /^month:(\d{4})-(\d{2})$/.exec(id);
  if (mo) {
    const yy = Number(mo[1]);
    const mm = Number(mo[2]);
    if (mm >= 1 && mm <= 12) return { from: ymd(yy, mm, 1), to: ymd(yy, mm, lastDayOf(yy, mm)) };
  }
  return {};
}

import type { Lang } from '@/i18n';
import { monthName, monthShort } from './dates';

/**
 * One filter state for the whole Reports screen: charts, statistics, the operations list and the Excel export are
 * all derived from it, so they can never disagree.
 */
export type ReportKind = 'income' | 'expense' | 'compare' | 'net' | 'balance' | 'wallets' | 'categories' | 'debts';
export const REPORT_KINDS: ReportKind[] = ['income', 'expense', 'compare', 'net', 'balance', 'wallets', 'categories', 'debts'];

export type RangePreset = 'day' | 'week' | 'month' | 'year' | 'custom';
export type Granularity = 'day' | 'week' | 'month' | 'year';

export interface ReportFilter {
  kind: ReportKind;
  preset: RangePreset;
  /** any instant inside the shown day / week / month / year (ISO) */
  anchor: string;
  /** custom range, local calendar days YYYY-MM-DD (inclusive) */
  customFrom?: string;
  customTo?: string;
  walletId?: string;
  sourceId?: string;
  categoryId?: string;
  subCategoryId?: string;
  /** charts never mix currencies: one is always selected */
  currency?: string;
  projectId?: string;
}

export interface ResolvedRange {
  from: Date;
  /** inclusive end (23:59:59.999 of the last day) */
  to: Date;
  granularity: Granularity;
  /** calendar days covered (for daily averages) */
  days: number;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

/** YYYY-MM-DD -> local midnight, or null when the text is not a real date. */
export function parseDay(s: string | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((s ?? '').trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null;
}

export const dayString = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Calendar range of the filter in the device's local time. Weeks start on Monday. */
export function resolveRange(f: Pick<ReportFilter, 'preset' | 'anchor' | 'customFrom' | 'customTo'>, now = new Date()): ResolvedRange {
  const a = new Date(f.anchor);
  let from: Date;
  let to: Date;
  let granularity: Granularity = 'day';
  switch (f.preset) {
    case 'day':
      from = startOfDay(a);
      to = endOfDay(a);
      break;
    case 'week': {
      const dow = (a.getDay() + 6) % 7;
      from = new Date(a.getFullYear(), a.getMonth(), a.getDate() - dow);
      to = endOfDay(new Date(from.getFullYear(), from.getMonth(), from.getDate() + 6));
      break;
    }
    case 'year':
      from = new Date(a.getFullYear(), 0, 1);
      to = endOfDay(new Date(a.getFullYear(), 11, 31));
      granularity = 'month';
      break;
    case 'custom': {
      const x = parseDay(f.customFrom) ?? startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
      const y = parseDay(f.customTo) ?? startOfDay(now);
      from = x <= y ? x : y;
      to = endOfDay(x <= y ? y : x);
      break;
    }
    default:
      from = new Date(a.getFullYear(), a.getMonth(), 1);
      to = endOfDay(new Date(a.getFullYear(), a.getMonth() + 1, 0));
  }
  const days = Math.round((startOfDay(to).getTime() - from.getTime()) / 86_400_000) + 1;
  if (f.preset === 'custom') granularity = days <= 62 ? 'day' : days <= 730 ? 'month' : 'year';
  return { from, to, granularity, days };
}

/** Step the anchor one period back (-1) or forward (+1). */
export function shiftAnchor(f: Pick<ReportFilter, 'preset' | 'anchor'>, step: number): string {
  const a = new Date(f.anchor);
  const d = f.preset === 'day' ? new Date(a.getFullYear(), a.getMonth(), a.getDate() + step)
    : f.preset === 'week' ? new Date(a.getFullYear(), a.getMonth(), a.getDate() + 7 * step)
      : f.preset === 'year' ? new Date(a.getFullYear() + step, 0, 1)
        : new Date(a.getFullYear(), a.getMonth() + step, 1);
  return d.toISOString();
}

/** "27 oktabr 2026", "21–27 okt 2026", "oktabr 2026", "2026", "01.10.2026 – 27.10.2026". */
export function rangeLabel(lang: Lang, f: Pick<ReportFilter, 'preset' | 'anchor' | 'customFrom' | 'customTo'>): string {
  const r = resolveRange(f);
  const a = r.from;
  const b = r.to;
  const dmy = (d: Date) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  switch (f.preset) {
    case 'day': return `${a.getDate()} ${monthName(lang, a.getMonth())} ${a.getFullYear()}`;
    case 'week':
      return a.getMonth() === b.getMonth()
        ? `${a.getDate()}–${b.getDate()} ${monthShort(lang, a.getMonth())} ${b.getFullYear()}`
        : `${a.getDate()} ${monthShort(lang, a.getMonth())} – ${b.getDate()} ${monthShort(lang, b.getMonth())} ${b.getFullYear()}`;
    case 'year': return String(a.getFullYear());
    case 'custom': return `${dmy(a)} – ${dmy(b)}`;
    default: return `${monthName(lang, a.getMonth(), true)} ${a.getFullYear()}`;
  }
}

/** Device UTC offset in minutes (Tashkent = 300) so the server buckets by the user's calendar. */
export const tzOffset = (d = new Date()) => -d.getTimezoneOffset();

export type Query = Record<string, string | number | boolean | undefined>;

/** Backend query for the shared filter. The most specific category wins (a parent also matches its sub-categories). */
export function toQuery(f: ReportFilter, now = new Date()): Query {
  const r = resolveRange(f, now);
  return {
    from: r.from.toISOString(),
    to: r.to.toISOString(),
    tz: tzOffset(now),
    walletId: f.walletId,
    sourceId: f.sourceId,
    categoryId: f.subCategoryId ?? f.categoryId,
    currency: f.currency,
    projectId: f.projectId,
  };
}

/** How many non-default filters are active (badge on the filter button). */
export function activeFilterCount(f: ReportFilter): number {
  return [f.walletId, f.sourceId, f.categoryId, f.subCategoryId, f.projectId].filter(Boolean).length;
}

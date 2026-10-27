import type { Lang } from '@/i18n';

/**
 * Display-only formatting; the backend owns all arithmetic. Number style follows the app language:
 *  uz / ru: 1 234 567,50 (narrow no-break space, decimal comma) · en: 1,234,567.50
 *  compact: 1,6 mln / 1,6 млн / 1.6M · 12 ming / 12 тыс. / 12K · 2 mlrd / 2 млрд / 2B
 * The currency code is never translated (UZS, USD). Set by the settings store whenever the language changes.
 */
interface NumberStyle { group: string; decimal: string; k: string; m: string; b: string; join: string }
const NNBSP = '\u202F';
const STYLES: Record<Lang, NumberStyle> = {
  uz: { group: NNBSP, decimal: ',', k: 'ming', m: 'mln', b: 'mlrd', join: ' ' },
  ru: { group: NNBSP, decimal: ',', k: 'тыс.', m: 'млн', b: 'млрд', join: ' ' },
  en: { group: ',', decimal: '.', k: 'K', m: 'M', b: 'B', join: '' },
};
let style: NumberStyle = STYLES.uz;

export function setNumberLang(lang: Lang) {
  style = STYLES[lang] ?? STYLES.uz;
}

/** 1.0 -> "1", 1.55 -> "1,6" (one decimal at most, trailing zero dropped). */
function short(x: number, digits: number) {
  return String(+x.toFixed(digits)).replace('.', style.decimal);
}

/** Grouped integer part + up to 2 decimals in the active style. */
export function fmtNumber(v: number): string {
  const abs = Math.abs(v);
  const hasFraction = Math.abs(abs - Math.trunc(abs)) > 0.004;
  const [int = '0', frac] = abs.toFixed(hasFraction ? 2 : 0).split('.');
  return (v < 0 ? '−' : '') + int.replace(/\B(?=(\d{3})+(?!\d))/g, style.group) + (frac ? `${style.decimal}${frac}` : '');
}

export function fmtMoney(v: number, currency?: string, compact = false): string {
  const abs = Math.abs(v);
  let body: string;
  if (compact && abs >= 1e9) body = `${short(abs / 1e9, 1)}${style.join}${style.b}`;
  else if (compact && abs >= 1e6) body = `${short(abs / 1e6, 1)}${style.join}${style.m}`;
  else body = fmtNumber(abs);
  const sign = v < 0 ? '−' : '';
  return currency ? `${sign}${body} ${currency}` : `${sign}${body}`;
}

/**
 * Money for tight spots (tiles, KPI cells): the full figure while it is short ("850 000 UZS"), otherwise compact
 * ("1,6 mln UZS"). Web has no adjustsFontSizeToFit, so long figures would be cut off instead of shrinking.
 */
export function fitMoney(v: number, currency: string, max = 11): string {
  const full = fmtMoney(v, currency);
  return full.length <= max ? full : fmtMoney(v, currency, true);
}

/** Chart axis label: 0, 950, 12 ming, 1,5 mln, 2 mlrd (display only, negative values keep their sign). */
export function compactMoney(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (abs >= 1e9) return `${sign}${short(abs / 1e9, abs >= 1e10 ? 0 : 1)}${style.join}${style.b}`;
  if (abs >= 1e6) return `${sign}${short(abs / 1e6, abs >= 1e7 ? 0 : 1)}${style.join}${style.m}`;
  if (abs >= 1e3) return `${sign}${short(abs / 1e3, abs >= 1e4 ? 0 : 1)}${style.join}${style.k}`;
  return `${sign}${Math.round(abs)}`;
}
/** Tolerant user input parsing ("1 500 000,50" -> 1500000.5). Null when invalid or not positive. */
export function parseAmount(input: string): number | null {
  const s = input.replace(/[\s ]/g, '').replace(',', '.');
  if (!s || !/^\d+(\.\d+)?$/.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) && v > 0 ? v : null;
}

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Short date in the app language: 26.11.2026 (uz, ru) · Nov 26, 2026 (en). */
export function fmtDate(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const p = (n: number) => String(n).padStart(2, '0');
  if (style === STYLES.en) return `${EN_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export function fmtDateTime(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${fmtDate(d)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** RFC4122-ish v4 id good enough for idempotency keys. */
export function newKey(prefix = 'op'): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return `${prefix}-${c.randomUUID()}`;
  const hex = () => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0');
  return `${prefix}-${hex()}${hex()}${hex()}${hex()}`;
}

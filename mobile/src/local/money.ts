/**
 * Exact money for the local ledger. Amounts are integer MINOR units (tiyin / cents); rates are decimal strings with at
 * most 8 fraction digits. Conversion runs on BigInt. Precision, limits and rounding mirror the backend (`Currencies`):
 * every supported currency has 2 decimals, amounts are positive and below 1e13, conversion rounds half away from zero
 * to the target currency, a derived rate rounds half away from zero to 8 places. JS floats never carry money here.
 */

const DECIMALS: Record<string, number> = { UZS: 2, USD: 2, EUR: 2, RUB: 2, KZT: 2, GBP: 2, TRY: 2, CNY: 2 };
export const SUPPORTED_CURRENCIES = Object.keys(DECIMALS);
export const RATE_SCALE = 8;
const MAX_MAJOR = 10n ** 13n; // backend MaxAmount: < 1e13

export class MoneyError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

export function decimalsOf(currency: string): number {
  const d = DECIMALS[currency.trim().toUpperCase()];
  if (d === undefined) throw new MoneyError('currency.unsupported', `Unsupported currency '${currency}'.`);
  return d;
}

export const normalizeCurrency = (c: string) => c.trim().toUpperCase();

/** Parses user/decimal text ("1 500 000,50", "12.5") into minor units without going through a float. */
export function toMinor(text: string | number, currency: string): number {
  const d = decimalsOf(currency);
  const s = String(text).replace(/[\s  ]/g, '').replace(',', '.');
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new MoneyError('amount.invalid', 'Amount is not a number.');
  const frac = m[2] ?? '';
  if (frac.replace(/0+$/, '').length > d) throw new MoneyError('amount.precision', `More than ${d} fraction digits for ${currency}.`);
  const minor = BigInt(m[1]!) * 10n ** BigInt(d) + BigInt((frac + '0'.repeat(d)).slice(0, d) || '0');
  return checkMinor(minor, currency);
}

/** Validates a positive minor amount within the backend limit and returns it as a safe number. */
export function checkMinor(minor: bigint | number, currency: string): number {
  const v = BigInt(minor);
  if (v <= 0n) throw new MoneyError('amount.not_positive', 'Amount must be greater than zero.');
  if (v >= MAX_MAJOR * 10n ** BigInt(decimalsOf(currency))) throw new MoneyError('amount.too_large', 'Amount is too large.');
  return Number(v);
}

/** Minor units -> exact decimal text for the server ("144000.00" -> "144000", "12.5" -> "12.5"). */
export function minorToDecimal(minor: number, currency: string): string {
  const d = decimalsOf(currency);
  const neg = minor < 0;
  const s = String(Math.abs(minor)).padStart(d + 1, '0');
  const int = s.slice(0, s.length - d);
  const frac = s.slice(s.length - d).replace(/0+$/, '');
  return `${neg ? '-' : ''}${int}${frac ? `.${frac}` : ''}`;
}

/** Minor units -> number for DISPLAY only (formatters). */
export const minorToNumber = (minor: number, currency: string) => Number(minorToDecimal(minor, currency));

function rateToScaled(rate: string | number): bigint {
  const s = String(rate).trim();
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new MoneyError('fx.rate_invalid', 'Exchange rate is not a number.');
  const frac = (m[2] ?? '').replace(/0+$/, '');
  if (frac.length > RATE_SCALE) throw new MoneyError('fx.rate_invalid', `Rate has more than ${RATE_SCALE} fraction digits.`);
  const scaled = BigInt(m[1]!) * 10n ** BigInt(RATE_SCALE) + BigInt((frac + '0'.repeat(RATE_SCALE)).slice(0, RATE_SCALE));
  if (scaled <= 0n) throw new MoneyError('fx.rate_invalid', 'Exchange rate must be greater than zero.');
  return scaled;
}

function scaledToRate(scaled: bigint): string {
  const s = scaled.toString().padStart(RATE_SCALE + 1, '0');
  const frac = s.slice(-RATE_SCALE).replace(/0+$/, '');
  return `${s.slice(0, -RATE_SCALE)}${frac ? `.${frac}` : ''}`;
}

/** num / den rounded half away from zero (both positive here). */
function divRound(num: bigint, den: bigint): bigint {
  const q = num / den;
  return (num % den) * 2n >= den ? q + 1n : q;
}

/** to = amount × rate, rounded half away from zero to the target currency (backend `Currencies.Convert`). */
export function convert(amountMinor: number, from: string, rate: string | number, to: string): number {
  const r = rateToScaled(rate);
  const num = BigInt(amountMinor) * r * 10n ** BigInt(decimalsOf(to));
  const den = 10n ** BigInt(decimalsOf(from)) * 10n ** BigInt(RATE_SCALE);
  const out = divRound(num, den);
  if (out <= 0n) throw new MoneyError('fx.result_zero', 'Converted amount rounds to zero.');
  return checkMinor(out, to);
}

/** Rate implied by both amounts, 8 places half away from zero (backend: Math.Round(toAmount / amount, 8)). */
export function deriveRate(amountMinor: number, from: string, toMinorAmount: number, to: string): string {
  const num = BigInt(toMinorAmount) * 10n ** BigInt(decimalsOf(from)) * 10n ** BigInt(RATE_SCALE);
  const den = BigInt(amountMinor) * 10n ** BigInt(decimalsOf(to));
  return scaledToRate(divRound(num, den));
}

/** Normalised rate text (validates; "12000.00000000" -> "12000"). */
export const normalizeRate = (rate: string | number) => scaledToRate(rateToScaled(rate));

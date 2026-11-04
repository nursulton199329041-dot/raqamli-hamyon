/**
 * Official exchange rate of the Central Bank of Uzbekistan for a day. Only the currency code and the date are sent.
 * Rates are quoted against the sum, so any other pair goes through it. Null when it cannot be told (no connection, a
 * currency the bank does not quote): the form then falls back to the last used rate or asks for the amount.
 */
const TIMEOUT_MS = 6000;

async function sumsPerUnit(currency: string, day: string): Promise<number | null> {
  if (currency === 'UZS') return 1;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://cbu.uz/uz/arkhiv-kursov-valyut/json/${encodeURIComponent(currency)}/${day}/`, { signal: ctrl.signal });
    if (!res.ok) return null;
    const rows = (await res.json()) as { Ccy?: string; Rate?: string; Nominal?: string }[];
    const row = rows.find((r) => r.Ccy === currency);
    const rate = Number(row?.Rate);
    const nominal = Number(row?.Nominal ?? 1);
    return rate > 0 && nominal > 0 ? rate / nominal : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** How much of `to` one unit of `from` is worth on `day` (YYYY-MM-DD). */
export async function officialRate(from: string, to: string, day: string): Promise<number | null> {
  const [a, b] = await Promise.all([sumsPerUnit(from, day), sumsPerUnit(to, day)]);
  return a && b ? Number((a / b).toFixed(6)) : null;
}

/** Display-only formatting; the backend owns all arithmetic. */
export function fmtMoney(v: number, currency?: string, compact = false): string {
  const abs = Math.abs(v);
  let body: string;
  if (compact && abs >= 1e9) body = `${(abs / 1e9).toFixed(abs >= 1e10 ? 0 : 1)} mlrd`;
  else if (compact && abs >= 1e6) body = `${(abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1)} mln`;
  else {
    const hasFraction = Math.abs(abs - Math.trunc(abs)) > 0.004;
    const fixed = abs.toFixed(hasFraction ? 2 : 0);
    const [int = '0', frac] = fixed.split('.');
    body = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (frac ? `.${frac}` : '');
  }
  const sign = v < 0 ? '−' : '';
  return currency ? `${sign}${body} ${currency}` : `${sign}${body}`;
}

/** Tolerant user input parsing ("1 500 000,50" -> 1500000.5). Null when invalid or not positive. */
export function parseAmount(input: string): number | null {
  const s = input.replace(/[\s ]/g, '').replace(',', '.');
  if (!s || !/^\d+(\.\d+)?$/.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) && v > 0 ? v : null;
}

export function fmtDate(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const p = (n: number) => String(n).padStart(2, '0');
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

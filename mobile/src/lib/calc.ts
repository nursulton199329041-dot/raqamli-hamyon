/**
 * Money calculator core. NO floating point anywhere: every operand is parsed into a BigInt scaled by 10^8 and the
 * four operations are done on integers with explicit half-away-from-zero rounding. The result is rounded to the
 * currency precision (default 2) and returned as an exact decimal STRING; only that string is handed to the API.
 *
 * Grammar: number (op number)*, op in + - × ÷ (also * / x). `,` and `.` are both decimal separators.
 * × and ÷ bind tighter than + and -. No parentheses, no unary minus (amounts are positive).
 */
const SCALE_DIGITS = 8;
const ONE = 10n ** BigInt(SCALE_DIGITS);
const MAX_FRACTION = SCALE_DIGITS;
const MAX_LENGTH = 48;

export type CalcError = 'empty' | 'syntax' | 'divzero' | 'nonpositive' | 'overflow';
export type CalcResult = { ok: true; value: string; minor: bigint } | { ok: false; error: CalcError };

type Op = '+' | '-' | '*' | '/';

const OP_GLYPH: Record<Op, string> = { '+': '+', '-': '−', '*': '×', '/': '÷' };

function normalizeOp(ch: string): Op | null {
  switch (ch) {
    case '+': return '+';
    case '-': case '−': case '–': return '-';
    case '*': case '×': case 'x': case 'X': case '·': return '*';
    case '/': case '÷': return '/';
    default: return null;
  }
}

/** a / b rounded half away from zero (b > 0). */
function roundDiv(a: bigint, b: bigint): bigint {
  const neg = a < 0n;
  const abs = neg ? -a : a;
  const q = (abs * 2n + b) / (2n * b);
  return neg ? -q : q;
}

function parseNumber(token: string): bigint | null {
  if (token.split('.').length > 2) return null;
  const [int = '', frac = ''] = token.split('.');
  if (!/^\d*$/.test(int) || !/^\d*$/.test(frac) || (int === '' && frac === '')) return null;
  if (frac.length > MAX_FRACTION) return null;
  return BigInt(int || '0') * ONE + BigInt(frac.padEnd(MAX_FRACTION, '0') || '0');
}

interface Tokens { nums: string[]; ops: Op[] }

/** Splits "150000+25000×2" into numbers and operators. Returns null on malformed input. A trailing operator is dropped. */
function tokenize(expr: string): Tokens | null {
  const nums: string[] = [];
  const ops: Op[] = [];
  let cur = '';
  for (const raw of expr.replace(/[\s  ]/g, '')) {
    const ch = raw === ',' ? '.' : raw;
    if (/[0-9.]/.test(ch)) {
      cur += ch;
      continue;
    }
    const op = normalizeOp(ch);
    if (!op) return null;
    if (cur === '') {
      if (nums.length === 0) return null; // leading operator / unary minus is not allowed
      ops[ops.length - 1] = op; // operator typed twice: the later one wins
      continue;
    }
    nums.push(cur);
    ops.push(op);
    cur = '';
  }
  if (cur !== '') nums.push(cur);
  else if (ops.length > 0) ops.pop(); // trailing operator, e.g. "150000+": evaluate what is complete
  return { nums, ops };
}

export function evaluate(expr: string, decimals = 2): CalcResult {
  if (expr.trim() === '') return { ok: false, error: 'empty' };
  const t = tokenize(expr);
  if (!t || t.nums.length === 0) return { ok: false, error: 'syntax' };
  const values: bigint[] = [];
  for (const n of t.nums) {
    const v = parseNumber(n);
    if (v === null) return { ok: false, error: 'syntax' };
    values.push(v);
  }
  // pass 1: × ÷
  const terms: bigint[] = [values[0] as bigint];
  const adds: ('+' | '-')[] = [];
  for (let i = 0; i < t.ops.length; i += 1) {
    const op = t.ops[i] as Op;
    const rhs = values[i + 1] as bigint;
    if (op === '*') terms[terms.length - 1] = roundDiv((terms[terms.length - 1] as bigint) * rhs, ONE);
    else if (op === '/') {
      if (rhs === 0n) return { ok: false, error: 'divzero' };
      terms[terms.length - 1] = roundDiv((terms[terms.length - 1] as bigint) * ONE, rhs);
    } else {
      adds.push(op);
      terms.push(rhs);
    }
  }
  // pass 2: + −
  let total = terms[0] as bigint;
  for (let i = 0; i < adds.length; i += 1) total = adds[i] === '+' ? total + (terms[i + 1] as bigint) : total - (terms[i + 1] as bigint);

  const unit = 10n ** BigInt(SCALE_DIGITS - decimals);
  const minor = roundDiv(total, unit);
  if (minor <= 0n) return { ok: false, error: 'nonpositive' };
  if (minor > 10n ** 16n) return { ok: false, error: 'overflow' };
  return { ok: true, minor, value: minorToString(minor, decimals) };
}

/** 17500000n, 2 -> "175000" ; 123456n, 2 -> "1234.56" (trailing zeros trimmed). */
export function minorToString(minor: bigint, decimals = 2): string {
  const base = 10n ** BigInt(decimals);
  const int = minor / base;
  const frac = (minor % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return frac ? `${int}.${frac}` : `${int}`;
}

/** Decimal string -> API number. Safe: the string has at most `decimals` fraction digits and < 17 significant digits. */
export function toApiNumber(value: string): number {
  return Number(value);
}

export type Key = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | '+' | '-' | '*' | '/' | '=' | 'C' | 'DEL';

const lastToken = (expr: string) => expr.split(/[+\-×÷*/−]/).pop() ?? '';

/** Keypad state machine. `expr` is the raw (ungrouped) expression text; pure and unit-tested. */
export function pressKey(expr: string, key: Key, decimals = 2): string {
  if (key === 'C') return '';
  if (key === 'DEL') return expr.slice(0, -1);
  if (key === '=') {
    const r = evaluate(expr, decimals);
    return r.ok ? r.value : expr;
  }
  if (expr.length >= MAX_LENGTH && key !== '+' && key !== '-' && key !== '*' && key !== '/') return expr;
  const last = expr.slice(-1);
  const endsWithOp = last !== '' && normalizeOp(last) !== null;
  if (key === '+' || key === '-' || key === '*' || key === '/') {
    if (expr === '') return expr; // amounts start with a number
    const g = OP_GLYPH[key];
    return endsWithOp ? expr.slice(0, -1) + g : expr.endsWith('.') ? `${expr}0${g}` : expr + g;
  }
  const tok = lastToken(expr);
  if (key === '.') {
    if (tok.includes('.')) return expr;
    return expr === '' || endsWithOp ? `${expr}0.` : `${expr}.`;
  }
  // digit
  if (tok === '0') return expr.slice(0, -1) + key; // no leading zeros: "0" then "5" -> "5"
  if (tok.includes('.') && tok.split('.')[1]!.length >= MAX_FRACTION) return expr;
  return expr + key;
}

/** "150000+25000.5" -> "150 000 + 25 000,5" (display only). */
export function formatExpression(expr: string): string {
  return expr
    .replace(/[0-9]+(\.[0-9]*)?/g, (m) => {
      const [int = '', frac] = m.split('.');
      const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
      return frac === undefined ? grouped : `${grouped},${frac}`;
    })
    .replace(/([+−×÷])/g, ' $1 ');
}

export const hasOperator = (expr: string) => /[+−×÷*/-]/.test(expr);

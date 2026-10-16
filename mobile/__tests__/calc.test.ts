import { evaluate, formatExpression, minorToString, pressKey, toApiNumber, type Key } from '@/lib/calc';

const val = (e: string, d = 2) => {
  const r = evaluate(e, d);
  return r.ok ? r.value : `ERR:${r.error}`;
};
const type = (keys: string, d = 2) => {
  let e = '';
  const map: Record<string, Key> = { '+': '+', '-': '-', '*': '*', '/': '/', '=': '=', C: 'C', '<': 'DEL', '.': '.' };
  for (const k of keys) e = pressKey(e, (map[k] ?? k) as Key, d);
  return e;
};

describe('money calculator (exact decimal arithmetic, no floats)', () => {
  it('adds, subtracts, multiplies and divides', () => {
    expect(val('150000+25000')).toBe('175000');
    expect(val('1000000-250000')).toBe('750000');
    expect(val('1500×3')).toBe('4500');
    expect(val('900÷4')).toBe('225');
    expect(val('10000÷3')).toBe('3333.33');
  });

  it('respects operator precedence', () => {
    expect(val('100+50×2')).toBe('200');
    expect(val('100-50÷2')).toBe('75');
    expect(val('2×3+4×5')).toBe('26');
  });

  it('is exact where binary floats are not (0.1 + 0.2, 1.005 rounding, large sums)', () => {
    expect(val('0.1+0.2')).toBe('0.3');
    expect(0.1 + 0.2).not.toBe(0.3); // the float trap this module exists to avoid
    expect(val('1.005×1', 2)).toBe('1.01'); // half away from zero on the exact value
    expect(val('999999999999.99+0.01')).toBe('1000000000000');
    expect(val('4850000.50-0.25')).toBe('4850000.25');
  });

  it('accepts comma and dot decimal separators and any multiplication/division glyph', () => {
    expect(val('1,5+1.5')).toBe('3');
    expect(val('6*7')).toBe('42');
    expect(val('84/2')).toBe('42');
    expect(val('84x2')).toBe('168');
  });

  it('uses the currency precision for the final rounding', () => {
    expect(val('1÷3', 2)).toBe('0.33');
    expect(val('2÷3', 2)).toBe('0.67');
    expect(val('1÷3', 0)).toBe('ERR:nonpositive');
    expect(val('1000÷3', 0)).toBe('333');
    expect(val('1÷8', 3)).toBe('0.125');
  });

  it('evaluates what is complete when an operator is still trailing', () => {
    expect(val('150000+')).toBe('150000');
    expect(val('150000+×')).toBe('150000');
  });

  it('reports errors instead of producing numbers', () => {
    expect(val('')).toBe('ERR:empty');
    expect(val('5÷0')).toBe('ERR:divzero');
    expect(val('5-10')).toBe('ERR:nonpositive');
    expect(val('0')).toBe('ERR:nonpositive');
    expect(val('+5')).toBe('ERR:syntax');
    expect(val('1..2')).toBe('ERR:syntax');
    expect(val('abc')).toBe('ERR:syntax');
    expect(val('0.123456789')).toBe('ERR:syntax');
  });

  it('formats minor units and API numbers exactly', () => {
    expect(minorToString(17500000n, 2)).toBe('175000');
    expect(minorToString(123456n, 2)).toBe('1234.56');
    expect(minorToString(5n, 2)).toBe('0.05');
    expect(toApiNumber('175000')).toBe(175000);
    expect(toApiNumber('1234.56')).toBe(1234.56);
  });
});

describe('keypad state machine', () => {
  it('types 150000 + 25000 and "=" gives 175000', () => {
    expect(type('150000+25000')).toBe('150000+25000');
    expect(type('150000+25000=')).toBe('175000');
  });

  it('digits, delete and clear', () => {
    expect(type('123<')).toBe('12');
    expect(type('123C')).toBe('');
    expect(type('<<<')).toBe('');
  });

  it('no leading zeros and a single decimal point per number', () => {
    expect(type('007')).toBe('7');
    expect(type('0.5')).toBe('0.5');
    expect(type('..')).toBe('0.');
    expect(type('1.5.2')).toBe('1.52');
    expect(type('1.5+.5')).toBe('1.5+0.5');
  });

  it('operators: none first, replaced when repeated, dangling decimal point is completed', () => {
    expect(type('+')).toBe('');
    expect(type('5+')).toBe('5+');
    expect(type('5+-')).toBe('5−');
    expect(type('5.+')).toBe('5.0+');
  });

  it('"=" keeps the expression when it is not a valid positive amount', () => {
    expect(type('5/0=')).toBe('5÷0');
    expect(type('5-9=')).toBe('5−9');
  });

  it('keeps chaining after "=": 100+50= then ×2=', () => {
    expect(type('100+50=*2=')).toBe('300');
  });

  it('formats for display with grouping and spaced operators', () => {
    expect(formatExpression('150000+25000.5')).toBe('150 000 + 25 000,5');
    expect(formatExpression('1234567×2')).toBe('1 234 567 × 2');
  });
});

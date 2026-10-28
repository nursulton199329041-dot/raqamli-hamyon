import { ALL_KEYS, LANGS, translate } from '@/i18n';
import { fmtMoney, parseAmount } from '@/lib/money';
import { compareSemver, storeStatus, parseSemver } from '@/updates/version';
import { MIGRATIONS } from '@/offline/migrations';

describe('parseAmount', () => {
  it('accepts spaces and comma decimals', () => {
    expect(parseAmount('1 500 000,50')).toBe(1500000.5);
    expect(parseAmount('12.5')).toBe(12.5);
  });
  it('rejects empty, zero, negative, garbage', () => {
    for (const bad of ['', '0', '-5', 'abc', '1.2.3']) expect(parseAmount(bad)).toBeNull();
  });
});

describe('fmtMoney', () => {
  it('groups thousands and keeps sign', () => {
    expect(fmtMoney(1500000, 'UZS')).toBe('1\u202F500\u202F000 UZS');
    expect(fmtMoney(-250.5)).toBe('−250,50'); // uz: decimal comma
  });
  it('compacts large values', () => {
    expect(fmtMoney(2500000, undefined, true)).toBe('2,5 mln');
  });
});

describe('i18n', () => {
  it('has a non-empty value for every key in every language', () => {
    for (const lang of LANGS) for (const k of ALL_KEYS) expect(translate(lang, k).length).toBeGreaterThan(0);
  });
  it('interpolates arguments', () => {
    expect(translate('en', 'sync_pending', { n: 3 })).toBe('3 operations waiting');
  });
});

describe('semver / store policy', () => {
  it('parses and compares', () => {
    expect(parseSemver('v1.2.3-beta.1')).toEqual([1, 2, 3]);
    expect(compareSemver('1.2.0', '1.10.0')).toBe(-1);
    expect(compareSemver('2.0.0', '2.0.0')).toBe(0);
  });
  it('classifies store status', () => {
    const policy = { minVersion: '1.2.0', latestVersion: '1.4.0' };
    expect(storeStatus('1.1.9', policy)).toBe('required');
    expect(storeStatus('1.3.0', policy)).toBe('optional');
    expect(storeStatus('1.4.0', policy)).toBe('ok');
  });
});

describe('sqlite migrations', () => {
  it('are additive only (never drop or rewrite user data)', () => {
    for (const step of MIGRATIONS) for (const sql of step) {
      expect(sql).not.toMatch(/\bDROP\s+|DELETE\s+FROM|TRUNCATE|\bUPDATE\s+\w+\s+SET/i);
      expect(sql).toMatch(/^\s*(CREATE TABLE IF NOT EXISTS|CREATE (UNIQUE )?INDEX IF NOT EXISTS|CREATE VIEW IF NOT EXISTS|ALTER TABLE .* ADD COLUMN)/i);
    }
  });
});
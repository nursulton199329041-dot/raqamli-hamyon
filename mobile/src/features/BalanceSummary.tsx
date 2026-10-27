import { LinearGradient } from 'expo-linear-gradient';
import { Text, View, useWindowDimensions } from 'react-native';
import type { Summary, Wallet } from '@/api/types';
import { GlassCard, Tap } from '@/design/Glass';
import { Glyph } from '@/design/Icon';
import { Skeleton } from '@/design/States';
import { Ink, usePalette, useT } from '@/design/theme';
import { radii, space, type } from '@/design/tokens';
import { fitMoney, fmtMoney } from '@/lib/money';

type Line = { currency: string; total: number };

/** Wallet balances summed per currency (amounts are display values from the backend ledger snapshot). */
export function balanceByCurrency(wallets: Wallet[]): Line[] {
  const m = new Map<string, number>();
  for (const w of wallets) m.set(w.currency, (m.get(w.currency) ?? 0) + w.balance);
  return [...m].map(([currency, total]) => ({ currency, total }));
}

const fmt = (lines: Line[], signed = false) =>
  lines.length === 0 ? '0' : lines.map((l) => `${signed && l.total > 0 ? '+' : ''}${fmtMoney(l.total, l.currency)}`).join(' · ');

/** KPI cells are narrow: one line per currency, compacted when long. */
const fitLines = (lines: Line[], signed = false) =>
  lines.length === 0 ? ['0'] : lines.map((l) => `${signed && l.total > 0 ? '+' : ''}${fitMoney(l.total, l.currency)}`);

/**
 * Top "hero" card: total balance (all active wallets) and, for the selected period, income / expense / net change.
 * Period figures come from `/api/analytics/summary` — the backend owns the arithmetic (reversals excluded).
 */
export function BalanceSummary({ wallets, summary, loading, periodLabel, onPeriod, primary }: {
  wallets: Wallet[]; summary?: Summary; loading: boolean; periodLabel: string; onPeriod(): void;
  /** user's default currency: shown first and largest */
  primary?: string;
}) {
  const p = usePalette();
  const t = useT();
  const balance = balanceByCurrency(wallets).sort((a, b) => Number(b.currency === primary) - Number(a.currency === primary));
  const totals = summary?.totals ?? [];
  const income = totals.map((x) => ({ currency: x.currency, total: x.income }));
  const expense = totals.map((x) => ({ currency: x.currency, total: x.expense }));
  const net = totals.map((x) => ({ currency: x.currency, total: x.netFlow }));
  const netColor = net.some((x) => x.total < 0) ? Ink.expense : net.some((x) => x.total > 0) ? Ink.income : p.text;
  const stacked = useWindowDimensions().width < 420;

  return (
    <GlassCard radius={28} padding={0} testID="balance-summary">
      <LinearGradient
        pointerEvents="none"
        colors={p.dark ? ['rgba(77,141,255,0.30)', 'rgba(124,108,255,0.10)', 'rgba(0,0,0,0)'] : ['rgba(31,107,255,0.14)', 'rgba(124,108,255,0.06)', 'rgba(255,255,255,0)']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
      />
      <View style={{ padding: space.lg, gap: space.md }}>
        <View style={{ gap: space.xs }}>
          <Text style={[type.caption, { color: p.textSecondary, textTransform: 'uppercase' }]}>{t('balance')}</Text>
          {loading && balance.length === 0 ? <Skeleton width="70%" height={32} /> : (
            // one line per currency (never mixed into one wrapped string); the user's default currency leads, large
            <View testID="summary-balance" accessible accessibilityRole="summary" accessibilityLabel={fmt(balance)}>
              {(balance.length ? balance : [{ currency: primary ?? '', total: 0 }]).map((b, i) => (
                <Text key={b.currency} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}
                  style={[i === 0 ? type.display : type.title, { color: b.total < 0 ? Ink.expense : i === 0 ? p.text : p.textSecondary }]}>
                  {fmtMoney(b.total, b.currency)}
                </Text>
              ))}
            </View>
          )}
        </View>
        <Tap testID="period-button" label={periodLabel} onPress={onPeriod} containerStyle={{ alignSelf: 'flex-start' }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.md, minHeight: 34, borderRadius: radii.pill, backgroundColor: p.glassFillStrong, borderWidth: 1, borderColor: p.glassBorder }}>
          <Glyph name="calendar" color={p.textSecondary} size={14} />
          <Text numberOfLines={1} style={[type.footnote, { color: p.text, fontWeight: '700' }]}>{periodLabel}</Text>
          <Glyph name="chevronDown" color={p.textSecondary} size={12} />
        </Tap>
        {/* three cells side by side need ~120px each; narrower phones get one full-width row per metric instead */}
        <View testID="summary-metrics" style={{ flexDirection: stacked ? 'column' : 'row', gap: space.sm }}>
          <Metric stacked={stacked} icon="arrowIn" color={Ink.income} label={t('income')} value={fitLines(income)} loading={loading && !summary} testID="summary-income" />
          <Metric stacked={stacked} icon="arrowOut" color={Ink.expense} label={t('expense')} value={fitLines(expense)} loading={loading && !summary} testID="summary-expense" />
          <Metric stacked={stacked} icon="swap" color={netColor} label={t('net_change')} value={fitLines(net, true)} loading={loading && !summary} testID="summary-net" />
        </View>
      </View>
    </GlassCard>
  );
}

function Metric({ icon, color, label, value, loading, testID, stacked }: {
  icon: string; color: string; label: string; value: string[]; loading: boolean; testID: string; stacked: boolean;
}) {
  const p = usePalette();
  const badge = (
    <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: `${color}2E` }}>
      <Glyph name={icon} color={color} size={13} />
    </View>
  );
  const values = loading ? <Skeleton width={stacked ? 90 : '80%'} height={14} /> : (
    <View testID={testID} style={stacked ? { alignItems: 'flex-end' } : undefined}>
      {value.map((v) => (
        <Text key={v} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={[type.amount, { color }]}>{v}</Text>
      ))}
    </View>
  );
  const box = { padding: space.sm, borderRadius: 16, backgroundColor: p.glassFill, borderWidth: 1, borderColor: p.glassBorder } as const;
  if (stacked) {
    return (
      <View accessible accessibilityLabel={`${label}: ${value.join(', ')}`} style={[box, { flexDirection: 'row', alignItems: 'center', gap: space.sm }]}>
        {badge}
        <Text numberOfLines={1} style={[type.footnote, { flex: 1, color: p.textSecondary }]}>{label}</Text>
        {values}
      </View>
    );
  }
  return (
    <View accessible accessibilityLabel={`${label}: ${value.join(', ')}`} style={[box, { flex: 1, gap: space.xs }]}>
      {badge}
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[type.caption, { color: p.textSecondary }]}>{label}</Text>
      {values}
    </View>
  );
}

import { useState } from 'react';
import { ScrollView, Text, View, type LayoutChangeEvent } from 'react-native';
import { ApiError } from '@/api/client';
import type { BreakdownRow } from '@/api/types';
import { Chip, ErrorText, Segmented } from '@/design/Controls';
import { GlassCard } from '@/design/Glass';
import { Grid } from '@/design/Grid';
import { Glyph } from '@/design/Icon';
import { useScreenLayout } from '@/design/layout';
import { EmptyState, LoadingState } from '@/design/States';
import { Bars, ChartBox, Donut, LegendDot, SLICE_COLORS } from '@/design/charts';
import { Ink, usePalette, useT } from '@/design/theme';
import { radii, space, type } from '@/design/tokens';
import { fmtMoney } from '@/lib/money';
import { exportReport } from '@/lib/exporter';
import { useBreakdown, useBudgets, useSeries, useSummary, type Period } from '@/state/data';
import { useSettings } from '@/state/settings';

type By = 'category' | 'wallet' | 'project';
type Gran = 'day' | 'week' | 'month';

/**
 * Analytics. Every figure comes from the backend analytics endpoints (summary, breakdown, timeseries, budgets).
 * Layout: mobile = one column; tablet = 2-column grids; desktop = 3 KPI columns and breakdown + trend side by side.
 */
export function Analytics() {
  const t = useT();
  const p = usePalette();
  const L = useScreenLayout();
  const lang = useSettings((s) => s.lang);
  const [period, setPeriod] = useState<Period>('month');
  const [by, setBy] = useState<By>('category');
  const [gran, setGran] = useState<Gran>('day');
  const [err, setErr] = useState<string | null>(null);
  const summary = useSummary(period);
  const breakdown = useBreakdown(by, period);
  const series = useSeries(gran, period);
  const budgets = useBudgets();

  const totals = summary.data?.totals ?? [];
  const currencies = [...new Set((breakdown.data ?? []).map((r) => r.currency))].sort();
  const seriesCurrencies = [...new Set((series.data ?? []).map((r) => r.currency))];
  const side = L.bp !== 'mobile';

  const doExport = async (format: 'xlsx' | 'pdf' | 'csv') => {
    setErr(null);
    try {
      await exportReport(format, lang, period);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    }
  };

  return (
    <ScrollView testID="analytics-scroll" contentContainerStyle={{ paddingHorizontal: L.gutter, paddingTop: space.lg, paddingBottom: L.bottomSpace + space.lg, gap: space.lg }}>
      {/* header: title + export */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
        <Text accessibilityRole="header" style={[type.title, { flex: 1, minWidth: 140, color: p.text }]}>{t('analytics')}</Text>
        <View style={{ flexDirection: 'row', gap: space.xs }}>
          {(['xlsx', 'pdf', 'csv'] as const).map((f) => (
            <Chip key={f} icon={f === 'xlsx' ? 'share' : undefined} label={f === 'xlsx' ? 'Excel' : f.toUpperCase()} selected={false} onPress={() => void doExport(f)} />
          ))}
        </View>
      </View>
      <View style={{ maxWidth: side ? 460 : undefined }}>
        <Segmented<Period> value={period} onChange={setPeriod}
          options={(['week', 'month', 'year', 'all'] as Period[]).map((x) => ({ value: x, label: t(x) }))} />
      </View>
      <ErrorText>{err}</ErrorText>

      {/* KPIs: income / expense / net per currency */}
      {summary.isLoading ? <GlassCard><LoadingState rows={1} columns={3} /></GlassCard> : null}
      {!summary.isLoading && totals.length === 0 ? (
        <GlassCard><EmptyState icon="chart" title={t('no_data')} /></GlassCard>
      ) : null}
      <Grid columns={Math.min(L.cardColumns, Math.max(1, totals.length))}>
        {totals.map((tt) => (
          <GlassCard key={tt.currency} testID={`kpi-${tt.currency}`} radius={radii.xl}>
            <Text style={[type.caption, { color: p.textSecondary, textTransform: 'uppercase' }]}>{tt.currency}</Text>
            <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
              <Kpi label={t('income')} value={fmtMoney(tt.income, undefined, true)} color={Ink.income} icon="arrowIn" />
              <Kpi label={t('expense')} value={fmtMoney(tt.expense, undefined, true)} color={Ink.expense} icon="arrowOut" />
              <Kpi label={t('net_flow')} value={fmtMoney(tt.netFlow, undefined, true)} color={tt.netFlow >= 0 ? Ink.income : Ink.expense} icon="swap" />
            </View>
          </GlassCard>
        ))}
      </Grid>

      <Grid columns={side ? 2 : 1}>
        {/* breakdown by category / wallet / project */}
        <GlassCard radius={radii.xl} testID="breakdown-card">
          <Text style={[type.headline, { color: p.text, marginBottom: space.sm }]}>{t('expense')}</Text>
          <Segmented<By> value={by} onChange={setBy}
            options={[{ value: 'category', label: t('category') }, { value: 'wallet', label: t('wallet') }, { value: 'project', label: t('project') }]} />
          <View style={{ gap: space.lg, marginTop: space.md }}>
            {breakdown.isLoading ? <LoadingState rows={1} columns={2} /> : null}
            {!breakdown.isLoading && currencies.length === 0 ? <EmptyState icon="chart" title={t('no_data')} /> : null}
            {currencies.map((cur) => (
              <BreakdownBlock key={cur} currency={cur} rows={(breakdown.data ?? []).filter((r) => r.currency === cur)} />
            ))}
          </View>
        </GlassCard>

        {/* trend */}
        <GlassCard radius={radii.xl} testID="trend-card">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap', marginBottom: space.sm }}>
            <Text style={[type.headline, { color: p.text, flex: 1, minWidth: 100 }]}>{t('trend')}</Text>
            <View style={{ width: 210, maxWidth: '100%' }}>
              <Segmented<Gran> value={gran} onChange={setGran}
                options={[{ value: 'day', label: t('day') }, { value: 'week', label: t('week') }, { value: 'month', label: t('month') }]} />
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: space.md, marginBottom: space.sm }}>
            <LegendDot color={Ink.income} label={t('income')} />
            <LegendDot color={Ink.expense} label={t('expense')} />
          </View>
          {series.isLoading ? <LoadingState rows={1} columns={4} /> : null}
          {!series.isLoading && seriesCurrencies.length === 0 ? <EmptyState icon="chart" title={t('no_data')} /> : null}
          <View style={{ gap: space.md }}>
            {seriesCurrencies.map((cur) => (
              <View key={cur} style={{ gap: space.xs }}>
                <Text style={[type.caption, { color: p.textSecondary }]}>{cur}</Text>
                <ChartBox height={side ? 220 : 180} testID={`bars-${cur}`}>
                  {(w) => <Bars points={(series.data ?? []).filter((s) => s.currency === cur)} width={w} height={side ? 220 : 180} />}
                </ChartBox>
              </View>
            ))}
          </View>
        </GlassCard>
      </Grid>

      {(budgets.data ?? []).length > 0 && <Text style={[type.headline, { color: p.text }]}>{t('budgets')}</Text>}
      <Grid columns={L.cardColumns}>
        {(budgets.data ?? []).map((b) => (
          <GlassCard key={b.categoryId} tint={b.exceeded ? Ink.expense : undefined} radius={radii.lg}>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Text numberOfLines={1} style={[type.callout, { flex: 1, color: p.text }]}>{b.name}</Text>
              <Text style={[type.callout, { color: b.exceeded ? Ink.expense : p.textSecondary }]}>{b.exceeded ? t('exceeded') : `${b.percent.toFixed(0)}%`}</Text>
            </View>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: p.glassFillStrong, marginTop: space.sm, overflow: 'hidden' }}>
              <View style={{ width: `${Math.min(100, b.percent)}%`, height: 8, backgroundColor: b.exceeded ? Ink.expense : b.percent >= 80 ? Ink.debt : Ink.income }} />
            </View>
            <Text style={[type.caption, { color: p.textSecondary, marginTop: space.xs }]}>
              {fmtMoney(b.spent, b.currency)} / {fmtMoney(b.limit, b.currency)}
            </Text>
          </GlassCard>
        ))}
      </Grid>
    </ScrollView>
  );
}

function Kpi({ label, value, color, icon }: { label: string; value: string; color: string; icon: string }) {
  const p = usePalette();
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={{ flex: 1, minWidth: 0, gap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Glyph name={icon} color={color} size={13} />
        <Text numberOfLines={1} style={[type.caption, { color: p.textSecondary, flexShrink: 1 }]}>{label}</Text>
      </View>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[type.amount, { color, fontSize: 16 }]}>{value}</Text>
    </View>
  );
}

/**
 * Donut + legend for one currency. The donut is sized from the block's measured width: side by side with the legend
 * when there is room (>= 380px), stacked and centred otherwise.
 */
function BreakdownBlock({ currency, rows }: { currency: string; rows: BreakdownRow[] }) {
  const p = usePalette();
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => {
    const next = Math.floor(e.nativeEvent.layout.width);
    if (next !== w) setW(next);
  };
  const wide = w >= 380;
  const size = Math.round(Math.max(110, Math.min(wide ? 180 : 200, (wide ? w * 0.4 : w * 0.6))));
  const total = rows.reduce((s, r) => s + r.total, 0);
  const shown = rows.slice(0, 7);
  const rest = rows.slice(7);
  const legend: { name: string; percent: number; total: number; color: string }[] = [
    ...shown.map((r, i) => ({ name: r.name, percent: r.percent, total: r.total, color: SLICE_COLORS[i % SLICE_COLORS.length]! })),
    ...(rest.length > 0 ? [{
      name: '…', percent: rest.reduce((s, r) => s + r.percent, 0), total: rest.reduce((s, r) => s + r.total, 0), color: SLICE_COLORS[7]!,
    }] : []),
  ];
  return (
    <View testID={`breakdown-${currency}`} onLayout={onLayout} style={{ flexDirection: wide ? 'row' : 'column', alignItems: 'center', gap: space.lg }}>
      {w > 0 ? (
        <Donut size={size} percents={legend.map((l) => l.percent)} center={(
          <View style={{ alignItems: 'center' }}>
            <Text style={[type.caption, { color: p.textSecondary }]}>{currency}</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={[type.amount, { color: p.text, fontSize: 15 }]}>{fmtMoney(total, undefined, true)}</Text>
          </View>
        )} />
      ) : null}
      <View style={{ flex: wide ? 1 : undefined, alignSelf: 'stretch', gap: space.sm }}>
        {legend.map((l, i) => (
          <View key={`${l.name}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: l.color }} />
            <Text numberOfLines={1} style={[type.footnote, { flex: 1, color: p.text }]}>{l.name}</Text>
            <Text numberOfLines={1} style={[type.footnote, { color: p.textSecondary, fontVariant: ['tabular-nums'] }]}>{fmtMoney(l.total, undefined, true)}</Text>
            <Text style={[type.footnote, { width: 40, textAlign: 'right', color: p.text, fontWeight: '700' }]}>{l.percent.toFixed(0)}%</Text>
          </View>
        ))}
      </View>
    </View>
  );
}


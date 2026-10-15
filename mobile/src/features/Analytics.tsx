import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { ApiError } from '@/api/client';
import { Chip, ErrorText, Segmented } from '@/design/Controls';
import { GlassCard, Tap } from '@/design/Glass';
import { Glyph } from '@/design/Icon';
import { Bars, Donut, SLICE_COLORS } from '@/design/charts';
import { Ink, usePalette, useT } from '@/design/theme';
import { fmtMoney } from '@/lib/money';
import { exportReport } from '@/lib/exporter';
import { useBreakdown, useBudgets, useSeries, useSummary, type Period } from '@/state/data';
import { useSettings } from '@/state/settings';

export function Analytics() {
  const t = useT();
  const p = usePalette();
  const lang = useSettings((s) => s.lang);
  const [period, setPeriod] = useState<Period>('month');
  const [by, setBy] = useState<'category' | 'wallet' | 'project'>('category');
  const [gran, setGran] = useState<'day' | 'week' | 'month'>('day');
  const [err, setErr] = useState<string | null>(null);
  const summary = useSummary(period);
  const breakdown = useBreakdown(by, period);
  const series = useSeries(gran, period);
  const budgets = useBudgets();

  const currencies = [...new Set((breakdown.data ?? []).map((r) => r.currency))].sort();
  const seriesCurrencies = [...new Set((series.data ?? []).map((r) => r.currency))];

  const doExport = async (format: 'xlsx' | 'pdf' | 'csv') => {
    setErr(null);
    try {
      await exportReport(format, lang, period);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 140, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ flex: 1, color: p.text, fontSize: 24, fontWeight: '800' }}>{t('analytics')}</Text>
        <Tap label={t('export')} onPress={() => void doExport('xlsx')}><Glyph name="share" color={p.accent} size={26} /></Tap>
      </View>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        {(['week', 'month', 'year', 'all'] as Period[]).map((x) => <Chip key={x} label={t(x)} selected={period === x} onPress={() => setPeriod(x)} />)}
      </View>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {(['xlsx', 'pdf', 'csv'] as const).map((f) => (
          <Chip key={f} label={f === 'xlsx' ? 'Excel' : f.toUpperCase()} selected={false} onPress={() => void doExport(f)} />
        ))}
      </View>
      <ErrorText>{err}</ErrorText>

      {(summary.data?.totals ?? []).map((tt) => (
        <GlassCard key={tt.currency}>
          <Text style={{ color: p.textSecondary, fontWeight: '700' }}>{tt.currency}</Text>
          <View style={{ flexDirection: 'row', marginTop: 6 }}>
            <KV k={t('income')} v={fmtMoney(tt.income, undefined, true)} c={Ink.income} />
            <KV k={t('expense')} v={fmtMoney(tt.expense, undefined, true)} c={Ink.expense} />
            <KV k={t('net_flow')} v={fmtMoney(tt.netFlow, undefined, true)} c={tt.netFlow >= 0 ? Ink.income : Ink.expense} />
          </View>
        </GlassCard>
      ))}

      <Segmented<'category' | 'wallet' | 'project'> value={by} onChange={setBy}
        options={[{ value: 'category', label: t('category') }, { value: 'wallet', label: t('wallet') }, { value: 'project', label: t('project') }]} />

      {currencies.map((cur) => {
        const rows = (breakdown.data ?? []).filter((r) => r.currency === cur);
        return (
          <GlassCard key={cur}>
            <Text style={{ color: p.text, fontWeight: '800' }}>{t('expense')} · {cur}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 10 }}>
              <Donut percents={rows.map((r) => r.percent)} />
              <View style={{ flex: 1, gap: 6 }}>
                {rows.slice(0, 6).map((r, i) => (
                  <View key={`${r.id}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: SLICE_COLORS[i % SLICE_COLORS.length] }} />
                    <Text numberOfLines={1} style={{ flex: 1, color: p.text }}>{r.name}</Text>
                    <Text style={{ color: p.textSecondary }}>{r.percent.toFixed(0)}%</Text>
                  </View>
                ))}
              </View>
            </View>
          </GlassCard>
        );
      })}

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: p.text, fontWeight: '800', fontSize: 17 }}>{t('trend')}</Text>
        <View style={{ width: 200 }}>
          <Segmented<'day' | 'week' | 'month'> value={gran} onChange={setGran}
            options={[{ value: 'day', label: t('day') }, { value: 'week', label: t('week') }, { value: 'month', label: t('month') }]} />
        </View>
      </View>
      {seriesCurrencies.map((cur) => (
        <GlassCard key={cur}>
          <Text style={{ color: p.textSecondary, fontWeight: '700' }}>{cur}</Text>
          <View style={{ marginTop: 8, alignItems: 'center' }}>
            <Bars points={(series.data ?? []).filter((s) => s.currency === cur)} width={300} />
          </View>
        </GlassCard>
      ))}

      {(budgets.data ?? []).length > 0 && <Text style={{ color: p.text, fontWeight: '800', fontSize: 17 }}>{t('budgets')}</Text>}
      {(budgets.data ?? []).map((b) => (
        <GlassCard key={b.categoryId} tint={b.exceeded ? Ink.expense : undefined}>
          <View style={{ flexDirection: 'row' }}>
            <Text style={{ flex: 1, color: p.text, fontWeight: '700' }}>{b.name}</Text>
            {b.exceeded && <Text style={{ color: Ink.expense, fontWeight: '700' }}>{t('exceeded')}</Text>}
          </View>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.14)', marginTop: 8, overflow: 'hidden' }}>
            <View style={{ width: `${Math.min(100, b.percent)}%`, height: 8, backgroundColor: b.exceeded ? Ink.expense : Ink.income }} />
          </View>
          <Text style={{ color: p.textSecondary, fontSize: 12, marginTop: 4 }}>
            {fmtMoney(b.spent, b.currency)} / {fmtMoney(b.limit, b.currency)}
          </Text>
        </GlassCard>
      ))}
    </ScrollView>
  );
}

function KV({ k, v, c }: { k: string; v: string; c: string }) {
  const p = usePalette();
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: p.textSecondary, fontSize: 12 }}>{k}</Text>
      <Text numberOfLines={1} style={{ color: c, fontWeight: '800' }}>{v}</Text>
    </View>
  );
}

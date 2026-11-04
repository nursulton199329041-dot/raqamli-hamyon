import { useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View, type LayoutChangeEvent } from 'react-native';
import { ApiError } from '@/api/client';
import type { BreakdownRow, CurrencyTotals, SeriesPoint } from '@/api/types';
import { Chip, ErrorText, Segmented, Wrap } from '@/design/Controls';
import { Tap } from '@/design/Glass';
import { Grid } from '@/design/Grid';
import { Glyph } from '@/design/Icon';
import { useScreenLayout } from '@/design/layout';
import { EmptyState, LoadingState } from '@/design/States';
import { Bars, ChartBox, Donut, LegendDot, LineChart, SLICE_COLORS, SignedBars, type Tip } from '@/design/charts';
import { Ink, usePalette, useT } from '@/design/theme';
import { radii, space, type } from '@/design/tokens';
import type { Lang } from '@/i18n';
import { monthName, monthShort } from '@/lib/dates';
import { exportReport, type ExportFormat } from '@/lib/exporter';
import { fmtMoney } from '@/lib/money';
import { activeFilterCount, resolveRange, toQuery, type Granularity, type ReportKind } from '@/lib/reportFilter';
import { useBudgets, useCatalog } from '@/state/data';
import {
  useReportBalance, useReportBreakdown, useReportSeries, useReportSummary, useReportTransactions, useReportWallets, useReports,
} from '@/state/reports';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import { CategoryGroups } from './CategoryGroups';
import { FilterButton } from '../FilterSection';
import { FilterSheet, KIND_LABEL, KindTabs, Panel, PeriodBar, StatGrid, TxList, type Stat } from './ReportControls';

/** Server period key (client calendar: 2026, 2026-10, 2026-10-27) -> [year, month0, day]. */
function parts(period: string): [number, number, number] {
  const [y, m, d] = period.split('-').map(Number);
  return [y ?? 1970, (m ?? 1) - 1, d ?? 1];
}

/** Axis label: "5 okt", "okt", "2026". */
export function axisLabel(lang: Lang, period: string, g: Granularity): string {
  const [y, m, d] = parts(period);
  if (g === 'year') return String(y);
  if (g === 'month') return monthShort(lang, m);
  return `${d} ${monthShort(lang, m)}`;
}

/** Tooltip title: "5 oktabr 2026", "oktabr 2026", "2026". */
export function pointTitle(lang: Lang, period: string, g: Granularity): string {
  const [y, m, d] = parts(period);
  if (g === 'year') return String(y);
  if (g === 'month') return `${monthName(lang, m, true)} ${y}`;
  return `${d} ${monthName(lang, m)} ${y}`;
}

/** Days of the period that have already happened (an average over a month that is half over uses half the days). */
function elapsedDays(from: Date, to: Date, now = new Date()): number {
  const end = now < to ? now : to;
  if (end < from) return 1;
  return Math.max(1, Math.floor((new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime() - from.getTime()) / 86_400_000) + 1);
}

export function Reports() {
  const t = useT();
  const p = usePalette();
  const L = useScreenLayout();
  const lang = useSettings((s) => s.lang);
  const cat = useCatalog();
  const user = useSession((s) => s.user);
  const filter = useReports((s) => s.filter);
  const set = useReports((s) => s.set);
  const [sheet, setSheet] = useState<null | 'filters' | 'custom'>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Currencies are never mixed: a wallet filter fixes the currency, otherwise the chosen one (default currency first).
  const currencies = [...new Set(cat.wallets.map((w) => w.currency))]
    .sort((a, b) => Number(b === user?.defaultCurrency) - Number(a === user?.defaultCurrency) || a.localeCompare(b));
  const walletCur = cat.wallet(filter.walletId)?.currency;
  const currency = walletCur ?? (filter.currency && currencies.includes(filter.currency) ? filter.currency : currencies[0]);
  const f = { ...filter, currency };
  const q = toQuery(f);
  const range = resolveRange(f);
  const g = range.granularity;
  const kind = f.kind;

  const summary = useReportSummary(q);
  const series = useReportSeries(q, g, ['income', 'expense', 'compare', 'net'].includes(kind));
  const balance = useReportBalance(q, g, kind === 'balance');
  const byCategory = useReportBreakdown(q, 'category', 2, kind === 'expense' || kind === 'compare');
  const bySource = useReportBreakdown(q, 'source', 1, kind === 'income');
  const [by, setBy] = useState<'category' | 'wallet' | 'project' | 'source'>('category');
  const distribution = useReportBreakdown(q, by, by === 'source' ? 1 : 2, kind === 'categories');
  const wallets = useReportWallets(q, kind === 'wallets');
  const txType = kind === 'income' ? 1 : kind === 'expense' ? 2 : undefined;
  const txs = useReportTransactions(q, txType, kind !== 'expense');
  const budgets = useBudgets();

  const tot: CurrencyTotals | undefined = summary.data?.totals.find((x) => x.currency === currency);
  const money = (v: number) => fmtMoney(v, currency);
  const days = elapsedDays(range.from, range.to);
  const pts: SeriesPoint[] = (series.data ?? []).filter((x) => x.currency === currency);
  const topRow = (rows?: BreakdownRow[]) => rows?.filter((r) => r.currency === currency)[0];

  const doExport = async (format: ExportFormat) => {
    setErr(null);
    setNote(null);
    setBusy(true);
    try {
      const name = await exportReport(format, lang, {
        ...q, type: kind === 'income' ? 1 : kind === 'expense' ? 2 : undefined, granularity: g,
      });
      setNote(t('exported', { name }));
    } catch (e) {
      setErr(e instanceof ApiError && e.isNetwork ? t('net_error') : t('download_failed'));
    } finally {
      setBusy(false);
    }
  };

  const tipPair = (i: number): Tip => {
    const x = pts[i];
    return {
      title: x ? pointTitle(lang, x.period, g) : '',
      lines: x ? [
        { label: t('income'), value: money(x.income), color: Ink.income },
        { label: t('expense'), value: money(x.expense), color: Ink.expense },
        { label: t('net_flow'), value: money(x.income - x.expense), color: x.income >= x.expense ? Ink.income : Ink.expense },
      ] : [],
    };
  };

  // ---------------------------------------------------------------- statistics per report
  const stats: Stat[] = [];
  const loadingStats = summary.isLoading;
  const income = tot?.income ?? 0;
  const expense = tot?.expense ?? 0;
  const net = income - expense;
  const netColor = net > 0 ? Ink.income : net < 0 ? Ink.expense : undefined;
  if (kind === 'income') {
    const top = topRow(bySource.data);
    stats.push(
      { key: 'income', label: t('total_income'), value: money(income), color: Ink.income },
      { key: 'avg-income', label: t('avg_daily_income'), value: money(income / days) },
      { key: 'top-source', label: t('top_source'), value: top ? top.name : '—', hint: top ? `${money(top.total)} · ${top.percent.toFixed(0)}%` : undefined },
    );
  } else if (kind === 'expense') {
    const top = topRow(byCategory.data);
    stats.push(
      { key: 'expense', label: t('total_expense'), value: money(expense), color: Ink.expense },
      { key: 'avg-expense', label: t('avg_daily_expense'), value: money(expense / days) },
      { key: 'top-category', label: t('top_category'), value: top ? top.name : '—', hint: top ? `${money(top.total)} · ${top.percent.toFixed(0)}%` : undefined },
    );
  } else if (kind === 'compare' || kind === 'net') {
    stats.push(
      { key: 'income', label: t('total_income'), value: money(income), color: Ink.income },
      { key: 'expense', label: t('total_expense'), value: money(expense), color: Ink.expense },
      { key: 'net', label: t('net_change'), value: `${net > 0 ? '+' : ''}${money(net)}`, color: netColor },
      { key: 'savings', label: t('savings_rate'), value: income > 0 ? `${((net / income) * 100).toFixed(0)}%` : '—' },
    );
    if (kind === 'compare') {
      stats.push(
        { key: 'avg-income', label: t('avg_daily_income'), value: money(income / days) },
        { key: 'avg-expense', label: t('avg_daily_expense'), value: money(expense / days) },
      );
      const top = topRow(byCategory.data);
      if (top) stats.push({ key: 'top-category', label: t('top_category'), value: top.name, hint: money(top.total) });
    }
  } else if (kind === 'balance') {
    const b = balance.data?.currencies.find((x) => x.currency === currency);
    const vals = b?.points.map((x) => x.balance) ?? [];
    stats.push(
      { key: 'opening', label: t('opening_balance'), value: b ? money(b.opening) : '—' },
      { key: 'closing', label: t('closing_balance'), value: b ? money(b.closing) : '—' },
      { key: 'change', label: t('change'), value: b ? `${b.closing - b.opening > 0 ? '+' : ''}${money(b.closing - b.opening)}` : '—',
        color: b ? (b.closing > b.opening ? Ink.income : b.closing < b.opening ? Ink.expense : undefined) : undefined },
      { key: 'min', label: t('min_balance'), value: vals.length ? money(Math.min(...vals)) : '—' },
      { key: 'max', label: t('max_balance'), value: vals.length ? money(Math.max(...vals)) : '—' },
    );
  } else if (kind === 'wallets') {
    const list = (wallets.data ?? []).filter((w) => w.currency === currency);
    const o = list.reduce((s, w) => s + w.opening, 0);
    const c = list.reduce((s, w) => s + w.closing, 0);
    stats.push(
      { key: 'opening', label: t('opening_balance'), value: money(o) },
      { key: 'closing', label: t('closing_balance'), value: money(c) },
      { key: 'change', label: t('change'), value: `${c - o > 0 ? '+' : ''}${money(c - o)}`, color: c > o ? Ink.income : c < o ? Ink.expense : undefined },
    );
  } else if (kind === 'debts') {
    const pos = summary.data?.debts.find((d) => d.currency === currency);
    stats.push(
      { key: 'i-owe', label: t('i_owe'), value: money(pos?.iOwe ?? 0), color: Ink.debt },
      { key: 'owed', label: t('owed_to_me'), value: money(pos?.owedToMe ?? 0), color: Ink.transfer },
      { key: 'borrowed', label: t('debts_taken'), value: money(tot?.borrowed ?? 0) },
      { key: 'lent', label: t('debts_given'), value: money(tot?.lent ?? 0) },
      { key: 'repaid', label: t('repaid'), value: money(tot?.debtRepaid ?? 0) },
      { key: 'collected', label: t('collected'), value: money(tot?.debtCollected ?? 0) },
    );
  }

  const chartH = L.bp === 'mobile' ? 200 : 240;
  const filters = activeFilterCount(filter);
  const named = [
    filter.walletId && { k: 'walletId' as const, label: cat.wallet(filter.walletId)?.name },
    filter.sourceId && { k: 'sourceId' as const, label: cat.source(filter.sourceId)?.name },
    filter.categoryId && { k: 'categoryId' as const, label: cat.category(filter.categoryId)?.name },
    filter.subCategoryId && { k: 'subCategoryId' as const, label: cat.category(filter.subCategoryId)?.name },
    filter.projectId && { k: 'projectId' as const, label: cat.project(filter.projectId)?.name },
  ].filter((x): x is { k: 'walletId' | 'sourceId' | 'categoryId' | 'subCategoryId' | 'projectId'; label: string | undefined } => !!x);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView testID="reports-scroll" contentContainerStyle={{ paddingHorizontal: L.gutter, paddingTop: space.lg, paddingBottom: L.bottomSpace + space.lg, gap: space.md }}>
        {/* title + filter, as in History */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 42 }}>
          <Text accessibilityRole="header" style={{ color: p.text, fontSize: 17, fontWeight: '700' }}>{t('reports')}</Text>
          <View style={{ position: 'absolute', right: 0 }}>
            <FilterButton testID="open-filters" count={filters} onPress={() => setSheet('filters')} />
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: space.sm, flexWrap: 'wrap' }}>
          {busy ? <ActivityIndicator color={p.accent} /> : null}
          <Tap testID="export-xlsx" label={t('export_excel')} onPress={() => void doExport('xlsx')} disabled={busy}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, minHeight: 38, borderRadius: radii.pill, backgroundColor: Ink.income }}>
            <Glyph name="share" color="#fff" size={16} />
            <Text style={[type.callout, { color: '#fff', fontWeight: '800' }]}>{t('export_excel')}</Text>
          </Tap>
          <Chip label="PDF" selected={false} onPress={() => void doExport('pdf')} />
          <Chip label="CSV" selected={false} onPress={() => void doExport('csv')} />
        </View>
        {note ? <Text testID="export-note" style={[type.footnote, { color: Ink.income }]}>{note}</Text> : null}
        <ErrorText>{err}</ErrorText>

        <KindTabs value={kind} onChange={(k: ReportKind) => set({ kind: k })} />
        <PeriodBar onCustom={() => setSheet('custom')} />

        {/* currency (charts never mix currencies) + filters */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
          {currencies.length > 1 && !walletCur ? currencies.map((c) => (
            <Chip key={c} label={c} selected={c === currency} onPress={() => set({ currency: c })} />
          )) : currency ? <Chip label={currency} selected onPress={() => undefined} /> : null}
        </View>
        {named.length > 0 ? (
          <Wrap>
            {named.map((n) => (
              <Tap key={n.k} testID={`clear-${n.k}`} label={`${n.label ?? ''} ✕`} onPress={() => set({ [n.k]: undefined })}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.sm, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: `${p.accent}29` }}>
                <Text numberOfLines={1} style={[type.footnote, { color: p.text, maxWidth: 180 }]}>{n.label}</Text>
                <Glyph name="close" color={p.textSecondary} size={12} />
              </Tap>
            ))}
          </Wrap>
        ) : null}
        {currencies.length > 1 ? <Text style={[type.caption, { color: p.textSecondary }]}>{t('currency_note')}</Text> : null}

        <StatGrid items={stats} loading={loadingStats} />

        {/* charts */}
        {kind === 'income' || kind === 'expense' || kind === 'compare' || kind === 'net' ? (
          <Panel testID="chart-panel" title={t(KIND_LABEL[kind])}
            right={kind === 'compare' ? (
              <View style={{ flexDirection: 'row', gap: space.md }}>
                <LegendDot color={Ink.income} label={t('income')} />
                <LegendDot color={Ink.expense} label={t('expense')} />
              </View>
            ) : null}>
            {series.isLoading ? <LoadingState rows={1} columns={4} /> : pts.length === 0 || pts.every((x) => x.income === 0 && x.expense === 0) ? (
              <EmptyState icon="chart" title={t('no_data')} />
            ) : (
              <ChartBox height={chartH} testID="main-chart">
                {(w) => kind === 'compare' ? (
                  <Bars testID="chart-touch" width={w} height={chartH} tip={tipPair}
                    points={pts.map((x) => ({ label: axisLabel(lang, x.period, g), income: x.income, expense: x.expense }))} />
                ) : (
                  <SignedBars testID="chart-touch" width={w} height={chartH} tip={tipPair}
                    tone={kind === 'income' ? Ink.income : kind === 'expense' ? Ink.expense : undefined}
                    points={pts.map((x) => ({
                      label: axisLabel(lang, x.period, g),
                      value: kind === 'income' ? x.income : kind === 'expense' ? x.expense : x.income - x.expense,
                    }))} />
                )}
              </ChartBox>
            )}
            {kind === 'compare' || kind === 'net' ? <Text style={[type.caption, { color: p.textSecondary, marginTop: space.sm }]}>{t('transfer_note')}</Text> : null}
          </Panel>
        ) : null}

        {kind === 'net' && pts.length > 1 ? (
          <Panel title={`${t('net_flow')} · Σ`}>
            <ChartBox height={chartH}>
              {(w) => {
                let run = 0;
                const cum = pts.map((x) => ({ label: axisLabel(lang, x.period, g), value: (run += x.income - x.expense) }));
                return (
                  <LineChart testID="cum-touch" width={w} height={chartH} points={cum} color={run >= 0 ? Ink.income : Ink.expense}
                    tip={(i) => ({ title: pointTitle(lang, pts[i]?.period ?? '', g), lines: [{ label: 'Σ', value: money(cum[i]?.value ?? 0), color: p.accent }] })} />
                );
              }}
            </ChartBox>
          </Panel>
        ) : null}

        {kind === 'balance' ? (
          <Panel testID="chart-panel" title={t('r_balance')}>
            {balance.isLoading ? <LoadingState rows={1} columns={4} /> : (() => {
              const b = balance.data?.currencies.find((x) => x.currency === currency);
              const bg = (balance.data?.granularity as Granularity | undefined) ?? g;
              if (!b || b.points.length === 0) return <EmptyState icon="chart" title={t('no_data')} />;
              return (
                <ChartBox height={chartH} testID="main-chart">
                  {(w) => (
                    <LineChart testID="chart-touch" width={w} height={chartH}
                      color={b.closing < 0 ? Ink.expense : p.accent}
                      points={b.points.map((x) => ({ label: axisLabel(lang, x.period, bg), value: x.balance }))}
                      tip={(i) => ({ title: pointTitle(lang, b.points[i]?.period ?? '', bg), lines: [{ label: t('balance'), value: money(b.points[i]?.balance ?? 0), color: p.accent }] })} />
                  )}
                </ChartBox>
              );
            })()}
          </Panel>
        ) : null}

        {kind === 'income' ? (
          <Panel title={`${t('breakdown_by')} · ${t('income_source')}`}>
            <Distribution rows={(bySource.data ?? []).filter((r) => r.currency === currency)} loading={bySource.isLoading} currency={currency ?? ''} />
          </Panel>
        ) : null}
        {kind === 'expense' ? (
          <Panel title={`${t('breakdown_by')} · ${t('category')}`}>
            <Distribution rows={(byCategory.data ?? []).filter((r) => r.currency === currency)} loading={byCategory.isLoading} currency={currency ?? ''}
              onPick={(r) => (r.id && !filter.categoryId && cat.childrenOf(r.id).length > 0 ? set({ categoryId: r.id }) : undefined)} />
          </Panel>
        ) : null}

        {kind === 'categories' ? (
          <Panel title={t('breakdown_by')}>
            <Segmented<typeof by> value={by} onChange={setBy}
              options={[
                { value: 'category', label: filter.categoryId ? t('sub_categories') : t('category') },
                { value: 'source', label: t('source') }, { value: 'wallet', label: t('wallet') }, { value: 'project', label: t('project') },
              ]} />
            <View style={{ marginTop: space.md }}>
              <Distribution rows={(distribution.data ?? []).filter((r) => r.currency === currency)} loading={distribution.isLoading} currency={currency ?? ''}
                onPick={(r) => (by === 'category' && r.id && !filter.categoryId && cat.childrenOf(r.id).length > 0 ? set({ categoryId: r.id }) : undefined)} />
            </View>
            {filter.categoryId ? (
              <Tap label={t('all_categories')} onPress={() => set({ categoryId: undefined })} style={{ marginTop: space.sm }}>
                <Text style={[type.callout, { color: p.accent }]}>← {t('all_categories')}</Text>
              </Tap>
            ) : null}
          </Panel>
        ) : null}

        {kind === 'wallets' ? (
          <Panel title={t('r_wallets')}>
            {wallets.isLoading ? <LoadingState rows={1} columns={2} /> : (
              <Grid columns={L.cardColumns === 1 ? 1 : 2} gap={space.sm}>
                {(wallets.data ?? []).filter((w) => w.currency === currency).map((w) => {
                  const ch = w.closing - w.opening;
                  const wl = cat.wallet(w.walletId);
                  return (
                    <View key={w.walletId} testID={`rw-${w.walletId}`} style={{ padding: space.md, borderRadius: radii.lg, backgroundColor: p.glassFill, borderWidth: 1, borderColor: p.glassBorder, gap: 4 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: wl?.color ?? p.accent }} />
                        <Text numberOfLines={1} style={[type.callout, { flex: 1, color: p.text }]}>{w.name}</Text>
                        <Text style={[type.callout, { color: ch > 0 ? Ink.income : ch < 0 ? Ink.expense : p.textSecondary }]}>{ch > 0 ? '+' : ''}{money(ch)}</Text>
                      </View>
                      <Text style={[type.caption, { color: p.textSecondary }]}>{money(w.opening)} → {money(w.closing)}</Text>
                    </View>
                  );
                })}
              </Grid>
            )}
          </Panel>
        ) : null}

        {kind === 'debts' ? (
          <Panel title={t('open_debts')}>
            <Text style={[type.caption, { color: p.textSecondary, marginBottom: space.sm }]}>{t('debt_note')}</Text>
            {cat.debts.filter((d) => d.status === 0 && d.currency === currency).length === 0 ? <EmptyState icon="handshake" title={t('no_data')} /> : null}
            {cat.debts.filter((d) => d.status === 0 && d.currency === currency).map((d) => {
              const paid = d.principal === 0 ? 0 : Math.min(1, Math.max(0, 1 - d.outstanding / d.principal));
              return (
                <View key={d.id} testID={`rdebt-${d.id}`} style={{ paddingVertical: space.sm, borderTopWidth: 1, borderTopColor: p.glassBorder, gap: 4 }}>
                  <View style={{ flexDirection: 'row', gap: space.sm }}>
                    <Text numberOfLines={1} style={[type.callout, { flex: 1, color: p.text }]}>{cat.person(d.personId)?.name ?? '?'}</Text>
                    <Text style={[type.caption, { color: p.textSecondary }]}>{d.direction === 0 ? t('borrowed') : t('lent')}</Text>
                  </View>
                  <View style={{ height: 6, borderRadius: 3, backgroundColor: p.glassFillStrong, overflow: 'hidden' }}>
                    <View style={{ width: `${paid * 100}%`, height: 6, backgroundColor: Ink.debt }} />
                  </View>
                  <Text style={[type.caption, { color: p.textSecondary }]}>{t('outstanding')}: {money(d.outstanding)} / {money(d.principal)}</Text>
                </View>
              );
            })}
          </Panel>
        ) : null}

        {kind === 'expense' && (budgets.data ?? []).length > 0 ? (
          <Panel title={t('budgets')}>
            {(budgets.data ?? []).map((b) => (
              <View key={b.categoryId} style={{ paddingVertical: space.xs, gap: 4 }}>
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  <Text numberOfLines={1} style={[type.callout, { flex: 1, color: p.text }]}>{b.name}</Text>
                  <Text style={[type.callout, { color: b.exceeded ? Ink.expense : p.textSecondary }]}>{b.exceeded ? t('exceeded') : `${b.percent.toFixed(0)}%`}</Text>
                </View>
                <View style={{ height: 6, borderRadius: 3, backgroundColor: p.glassFillStrong, overflow: 'hidden' }}>
                  <View style={{ width: `${Math.min(100, b.percent)}%`, height: 6, backgroundColor: b.exceeded ? Ink.expense : b.percent >= 80 ? Ink.debt : Ink.income }} />
                </View>
                <Text style={[type.caption, { color: p.textSecondary }]}>{fmtMoney(b.spent, b.currency)} / {fmtMoney(b.limit, b.currency)}</Text>
              </View>
            ))}
          </Panel>
        ) : null}

        {kind === 'expense' ? (
          // expenses: each category once (sub-categories inside their parent), opened to show its operations
          <Panel testID="ops-by-category" title={`${t('operations')} · ${t('by_category')}`}
            right={tot ? <Text style={[type.caption, { color: p.textSecondary }]}>{money(tot.expense)}</Text> : null}>
            <CategoryGroups rows={byCategory.data ?? []} loading={byCategory.isLoading} currency={currency ?? ''} q={q} />
          </Panel>
        ) : (
          <Panel title={t('operations')} right={txs.data ? <Text style={[type.caption, { color: p.textSecondary }]}>{txs.data.total}</Text> : null}>
            <TxList items={txs.data?.items ?? []} loading={txs.isLoading} />
          </Panel>
        )}
      </ScrollView>

      <FilterSheet key={sheet ?? 'closed'} visible={sheet !== null} customFirst={sheet === 'custom'} onClose={() => setSheet(null)} />
    </View>
  );
}

/**
 * Donut + legend for one currency, sized from the measured width (side by side from 380px, stacked below).
 * Tapping a legend row highlights its slice; `onPick` lets the caller drill down (category -> sub-categories).
 */
function Distribution({ rows, loading, currency, onPick }: { rows: BreakdownRow[]; loading: boolean; currency: string; onPick?(r: BreakdownRow): void }) {
  const p = usePalette();
  const t = useT();
  const [w, setW] = useState(0);
  const [hi, setHi] = useState<number | null>(null);
  if (loading && rows.length === 0) return <LoadingState rows={1} columns={2} />;
  if (rows.length === 0) return <EmptyState icon="chart" title={t('no_data')} />;
  const wide = w >= 380;
  const size = Math.round(Math.max(120, Math.min(wide ? 190 : 210, wide ? w * 0.4 : w * 0.62)));
  const total = rows.reduce((s, r) => s + r.total, 0);
  const shown = rows.slice(0, 7);
  const rest = rows.slice(7);
  const legend = [
    ...shown.map((r, i) => ({ row: r as BreakdownRow | null, name: r.name, percent: r.percent, total: r.total, color: SLICE_COLORS[i % SLICE_COLORS.length]! })),
    ...(rest.length ? [{ row: null, name: t('more'), percent: rest.reduce((s, r) => s + r.percent, 0), total: rest.reduce((s, r) => s + r.total, 0), color: SLICE_COLORS[7]! }] : []),
  ];
  const focus = hi !== null ? legend[hi] : undefined;
  return (
    <View testID={`distribution-${currency}`} onLayout={(e: LayoutChangeEvent) => setW(Math.floor(e.nativeEvent.layout.width))}
      style={{ flexDirection: wide ? 'row' : 'column', alignItems: 'center', gap: space.lg }}>
      {w > 0 ? (
        <Donut size={size} highlight={hi} percents={legend.map((l) => l.percent)} center={(
          <View style={{ alignItems: 'center', paddingHorizontal: 6 }}>
            <Text numberOfLines={1} style={[type.caption, { color: p.textSecondary }]}>{focus ? focus.name : currency}</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={[type.amount, { color: p.text, fontSize: 15 }]}>
              {fmtMoney(focus ? focus.total : total, undefined, true)}
            </Text>
            {focus ? <Text style={[type.caption, { color: p.textSecondary }]}>{focus.percent.toFixed(1)}%</Text> : null}
          </View>
        )} />
      ) : null}
      <View style={{ flex: wide ? 1 : undefined, alignSelf: 'stretch' }}>
        {legend.map((l, i) => (
          <Tap key={`${l.name}-${i}`} testID={`legend-${i}`} label={l.name} haptic={false}
            onPress={() => {
              setHi(hi === i ? null : i);
              if (l.row && onPick) onPick(l.row);
            }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 36, borderRadius: radii.sm, paddingHorizontal: 4, backgroundColor: hi === i ? `${l.color}24` : 'transparent' }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: l.color }} />
              <Text numberOfLines={1} style={[type.footnote, { flex: 1, color: p.text }]}>{l.name}</Text>
              <Text numberOfLines={1} style={[type.footnote, { color: p.textSecondary, fontVariant: ['tabular-nums'] }]}>{fmtMoney(l.total, undefined, true)}</Text>
              <Text style={[type.footnote, { width: 44, textAlign: 'right', color: p.text, fontWeight: '700' }]}>{l.percent.toFixed(0)}%</Text>
            </View>
          </Tap>
        ))}
      </View>
    </View>
  );
}


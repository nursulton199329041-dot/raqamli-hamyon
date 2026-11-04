import { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { ApiError } from '@/api/client';
import { TxType } from '@/api/types';
import { Button, ErrorText, Field, Label, Segmented } from '@/design/Controls';
import { Tap } from '@/design/Glass';
import { Glyph } from '@/design/Icon';
import { Sheet } from '@/design/Sheet';
import { Ink, usePalette, useT } from '@/design/theme';
import { radii, space, type } from '@/design/tokens';
import type { I18nKey } from '@/i18n';
import { exportReport, type ExportFormat } from '@/lib/exporter';
import { EXPORT_PERIODS, exportRange, rangeText, tzOffset, type ExportPeriod } from '@/lib/reportFilter';
import { useCatalog } from '@/state/data';
import { useSettings } from '@/state/settings';
import { FilterHeader, FilterSection } from './FilterSection';

const PERIOD_LABEL: Record<ExportPeriod, I18nKey> = {
  month: 'e_this_month', lastMonth: 'e_last_month', year: 'e_this_year', lastYear: 'e_last_year', all: 'e_all_time', custom: 'e_custom',
};
const TYPES: [number | undefined, I18nKey][] = [
  [undefined, 'all'], [TxType.Expense, 'expense'], [TxType.Income, 'income'], [TxType.Transfer, 'transfer'], [TxType.DebtLend, 'lent'], [TxType.DebtBorrow, 'borrowed'],
];

function Choice({ testID, title, hint, on, first, onPress }: { testID: string; title: string; hint?: string; on: boolean; first?: boolean; onPress(): void }) {
  const p = usePalette();
  return (
    <Tap testID={testID} label={title} haptic={false} onPress={onPress}>
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingVertical: 8, paddingHorizontal: space.md, borderTopWidth: first ? 0 : 1, borderTopColor: p.glassBorder }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: p.text, fontSize: 16, fontWeight: '600' }}>{title}</Text>
          {hint ? <Text style={{ color: p.textSecondary, fontSize: 13, marginTop: 2 }}>{hint}</Text> : null}
        </View>
        {on ? <Glyph name="check" color={p.accent} size={20} /> : null}
      </View>
    </Tap>
  );
}

/** Downloads a report file from the server: choose the period, the operation type and, if needed, a wallet or category. */
export function ExportSheet({ visible, onClose }: { visible: boolean; onClose(): void }) {
  return visible ? <Body onClose={onClose} /> : null;
}

function Body({ onClose }: { onClose(): void }) {
  const t = useT();
  const p = usePalette();
  const lang = useSettings((s) => s.lang);
  const cat = useCatalog();
  const [period, setPeriod] = useState<ExportPeriod>('month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [txType, setTxType] = useState<number | undefined>();
  const [format, setFormat] = useState<ExportFormat>('xlsx');
  const [filterOpen, setFilterOpen] = useState(false);
  const [sourceId, setSourceId] = useState<string | undefined>();
  const [walletId, setWalletId] = useState<string | undefined>();
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [projectId, setProjectId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const chosen = [
    cat.source(sourceId)?.name, cat.wallet(walletId)?.name, cat.category(categoryId)?.name, cat.project(projectId)?.name,
  ].filter(Boolean).join(', ');

  const run = async () => {
    const range = exportRange(period, new Date(), from, to);
    if (!range) return setError(t('date_invalid'));
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      const name = await exportReport(format, lang, {
        from: range.from?.toISOString(), to: range.to?.toISOString(), tz: tzOffset(), granularity: range.granularity,
        type: txType, walletId, sourceId, categoryId, projectId,
      });
      setDone(t('exported', { name }));
    } catch (e) {
      setError(e instanceof ApiError && e.isNetwork ? t('net_error') : t('download_failed'));
    } finally {
      setBusy(false);
    }
  };

  const box = { borderRadius: radii.lg, backgroundColor: p.glassFill, borderWidth: 1, borderColor: p.glassBorder, overflow: 'hidden' as const };
  return (
    <Sheet visible onClose={onClose} full footer={(
      <View>
        <ErrorText>{error}</ErrorText>
        {done ? <Text testID="export-note" style={[type.footnote, { color: Ink.income, marginBottom: 6 }]}>{done}</Text> : null}
        <Button testID="export-run" title={t('export_run')} busy={busy} onPress={() => void run()} />
      </View>
    )}>
      <FilterHeaderTitle onClose={onClose} />
      <Label>{t('period')}</Label>
      <View style={box}>
        {EXPORT_PERIODS.map((x, i) => {
          const r = x === 'custom' || x === 'all' ? null : exportRange(x, new Date());
          return <Choice key={x} testID={`export-period-${x}`} first={i === 0} title={t(PERIOD_LABEL[x])} hint={r ? rangeText(r) : undefined} on={period === x} onPress={() => setPeriod(x)} />;
        })}
      </View>
      {period === 'custom' ? (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <View style={{ flex: 1 }}><Field testID="export-from" label={t('date_from')} value={from} onChangeText={setFrom} autoCapitalize="none" placeholder="2026-11-01" /></View>
          <View style={{ flex: 1 }}><Field testID="export-to" label={t('date_to')} value={to} onChangeText={setTo} autoCapitalize="none" placeholder="2026-11-30" /></View>
        </View>
      ) : null}

      <Label>{t('op_types')}</Label>
      <View style={box}>
        {TYPES.map(([v, key], i) => <Choice key={key} testID={`export-type-${key}`} first={i === 0} title={t(key)} on={txType === v} onPress={() => setTxType(v)} />)}
      </View>

      <Label>{t('wallets_and_categories')}</Label>
      <View style={box}>
        <Tap testID="export-filter" label={t('filter')} haptic={false} onPress={() => setFilterOpen((x) => !x)}>
          <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingVertical: 8, paddingHorizontal: space.md }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: p.text, fontSize: 16, fontWeight: '600' }}>{t('filter')}</Text>
              <Text numberOfLines={2} style={{ color: p.textSecondary, fontSize: 13, marginTop: 2 }}>{chosen || t('all')}</Text>
            </View>
            <Glyph name={filterOpen ? 'chevronDown' : 'chevronRight'} color={p.textSecondary} size={18} />
          </View>
        </Tap>
      </View>
      {filterOpen ? (
        <>
          <FilterSection id="source" title={t('income_sources')} items={cat.sources} selected={sourceId} onChange={setSourceId} />
          <FilterSection id="wallet" title={t('wallets')} items={cat.wallets} selected={walletId} onChange={setWalletId} />
          <FilterSection id="category" title={t('expense_categories')} items={cat.topCategories} selected={categoryId} onChange={setCategoryId} />
          <FilterSection id="project" title={t('projects')} items={cat.projects} selected={projectId} onChange={setProjectId} />
        </>
      ) : null}

      <Label>{t('file_format')}</Label>
      <Segmented<ExportFormat> value={format} onChange={setFormat} options={[{ value: 'xlsx', label: 'Excel' }, { value: 'pdf', label: 'PDF' }, { value: 'csv', label: 'CSV' }]} />
      {busy ? <ActivityIndicator style={{ marginTop: space.sm }} color={p.accent} /> : null}
    </Sheet>
  );
}

function FilterHeaderTitle({ onClose }: { onClose(): void }) {
  const t = useT();
  return <FilterHeader title={t('export_data')} onClose={onClose} />;
}

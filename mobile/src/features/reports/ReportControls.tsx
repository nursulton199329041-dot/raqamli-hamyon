import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ScrollView, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { TxType, type Tx } from '@/api/types';
import { Button, Chip, ErrorText, Field, Label, Segmented, Wrap } from '@/design/Controls';
import { GlassCard, Tap } from '@/design/Glass';
import { Grid } from '@/design/Grid';
import { CircleBadge, Glyph } from '@/design/Icon';
import { useScreenLayout } from '@/design/layout';
import { Sheet } from '@/design/Sheet';
import { FilterHeader, FilterSection } from '../FilterSection';
import { Skeleton } from '@/design/States';
import { usePalette, useT } from '@/design/theme';
import { useMotionOff } from '@/design/look';
import { motion, radii, space, type } from '@/design/tokens';
import type { I18nKey } from '@/i18n';
import { spent } from '@/lib/categoryGroups';
import { longDay } from '@/lib/dates';
import { fmtMoney } from '@/lib/money';
import { TX_TYPE_LABEL, flowSign, txColor } from '@/lib/txMeta';
import { REPORT_KINDS, dayString, parseDay, rangeLabel, resolveRange, shiftAnchor, type RangePreset, type ReportKind } from '@/lib/reportFilter';
import { useCatalog } from '@/state/data';
import { useReports } from '@/state/reports';
import { useSettings } from '@/state/settings';

export const KIND_LABEL: Record<ReportKind, I18nKey> = {
  income: 'r_income', expense: 'r_expense', compare: 'r_compare', net: 'r_net',
  balance: 'r_balance', wallets: 'r_wallets', categories: 'r_categories', debts: 'r_debts',
};

/**
 * Report types as horizontally scrolling segments. A glass pill slides (spring) under the selected one; it is scrolled
 * into view so a choice near the edge is never half hidden.
 */
export function KindTabs({ value, onChange }: { value: ReportKind; onChange(k: ReportKind): void }) {
  const p = usePalette();
  const t = useT();
  const reduced = useMotionOff();
  const layouts = useRef(new Map<ReportKind, { x: number; w: number }>());
  const scroll = useRef<ScrollView>(null);
  const x = useSharedValue(0);
  const w = useSharedValue(0);
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }], width: w.get() }));

  const moveTo = useCallback((k: ReportKind) => {
    const l = layouts.current.get(k);
    if (!l) return;
    // first placement is instant (no slide in from the left edge); later changes spring to the new segment
    const instant = reduced || w.get() === 0;
    x.set(instant ? l.x : withSpring(l.x, motion.release));
    w.set(instant ? l.w : withSpring(l.w, motion.release));
    scroll.current?.scrollTo({ x: Math.max(0, l.x - 24), animated: !instant });
  }, [reduced, x, w]);
  useEffect(() => moveTo(value), [value, moveTo]);

  return (
    <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} testID="report-kinds"
      contentContainerStyle={{ paddingVertical: 2 }}>
      <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: space.xs }}>
        <Animated.View pointerEvents="none" style={[{
          position: 'absolute', top: 0, bottom: 0, left: 0, borderRadius: radii.pill, backgroundColor: p.accent,
        }, pill]} />
        {REPORT_KINDS.map((k) => {
          const on = k === value;
          return (
            <View key={k} onLayout={(e: LayoutChangeEvent) => {
              layouts.current.set(k, { x: e.nativeEvent.layout.x, w: e.nativeEvent.layout.width });
              if (k === value) moveTo(k);
            }}>
              <Tap testID={`kind-${k}`} label={t(KIND_LABEL[k])} onPress={() => onChange(k)}
                style={{ paddingHorizontal: space.md, minHeight: 38, justifyContent: 'center', borderRadius: radii.pill, borderWidth: 1, borderColor: on ? 'transparent' : p.glassBorder }}>
                <Text accessibilityState={{ selected: on }} numberOfLines={1}
                  style={[type.callout, { color: on ? '#fff' : p.text, fontWeight: on ? '800' : '600' }]}>{t(KIND_LABEL[k])}</Text>
              </Tap>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const PRESETS: RangePreset[] = ['day', 'week', 'month', 'year', 'custom'];
const PRESET_LABEL: Record<RangePreset, I18nKey> = { day: 'p_day', week: 'p_week', month: 'p_month', year: 'p_year', custom: 'p_custom' };

/** Day / week / month / year / custom + previous / next period. */
export function PeriodBar({ onCustom }: { onCustom(): void }) {
  const t = useT();
  const p = usePalette();
  const lang = useSettings((s) => s.lang);
  const filter = useReports((s) => s.filter);
  const set = useReports((s) => s.set);
  const stepper = filter.preset !== 'custom';
  return (
    <View style={{ gap: space.sm }}>
      <Segmented<RangePreset> value={filter.preset}
        onChange={(v) => (v === 'custom' ? onCustom() : set({ preset: v }))}
        options={PRESETS.map((x) => ({ value: x, label: t(PRESET_LABEL[x]) }))} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        {stepper ? (
          <Tap testID="prev-range" label={t('prev_period')} onPress={() => set({ anchor: shiftAnchor(filter, -1) })} style={navBtn(p)}>
            <Glyph name="chevronLeft" color={p.accent} size={20} />
          </Tap>
        ) : null}
        <Tap testID="range-label" label={rangeLabel(lang, filter)} onPress={filter.preset === 'custom' ? onCustom : undefined} containerStyle={{ flex: 1 }}>
          <Text numberOfLines={1} style={[type.headline, { color: p.text, textAlign: 'center' }]}>{rangeLabel(lang, filter)}</Text>
        </Tap>
        {stepper ? (
          <Tap testID="next-range" label={t('next_period')} onPress={() => set({ anchor: shiftAnchor(filter, 1) })} style={navBtn(p)}>
            <Glyph name="chevronRight" color={p.accent} size={20} />
          </Tap>
        ) : null}
      </View>
    </View>
  );
}

const navBtn = (p: ReturnType<typeof usePalette>) => ({
  width: 40, height: 40, borderRadius: 20, alignItems: 'center' as const, justifyContent: 'center' as const,
  backgroundColor: p.glassFill, borderWidth: 1, borderColor: p.glassBorder,
});

/**
 * Wallet, income source, category -> sub-category, project and a custom date range, all in one sheet.
 * Currency is chosen outside (always visible) because charts never mix currencies.
 */
export function FilterSheet({ visible, onClose, currencies, currency }: { visible: boolean; onClose(): void; currencies: string[]; currency?: string }) {
  const t = useT();
  const p = usePalette();
  const cat = useCatalog();
  const filter = useReports((s) => s.filter);
  const set = useReports((s) => s.set);
  const clear = useReports((s) => s.clearFilters);
  const r = resolveRange(filter);
  const [from, setFrom] = useState(filter.customFrom ?? dayString(r.from));
  const [to, setTo] = useState(filter.customTo ?? dayString(r.to));
  const [err, setErr] = useState<string | null>(null);
  const subs = cat.childrenOf(filter.categoryId);
  const [showDates, setShowDates] = useState(filter.preset === 'custom');
  const walletCurrency = cat.wallet(filter.walletId)?.currency;

  const applyDates = () => {
    if (!parseDay(from) || !parseDay(to)) return setErr(t('date_invalid'));
    setErr(null);
    set({ preset: 'custom', customFrom: from, customTo: to });
    onClose();
  };
  const dates = (
    <View key="dates">
      <Label>{t('p_custom')}</Label>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <View style={{ flex: 1 }}><Field testID="custom-from" label={t('date_from')} value={from} onChangeText={setFrom} autoCapitalize="none" /></View>
        <View style={{ flex: 1 }}><Field testID="custom-to" label={t('date_to')} value={to} onChangeText={setTo} autoCapitalize="none" /></View>
      </View>
      <ErrorText>{err}</ErrorText>
      <Button testID="apply-dates" title={t('apply')} variant="tonal" onPress={applyDates} />
    </View>
  );
  const chips = (
    <View key="chips">
      <FilterSection id="source" title={t('income_sources')} items={cat.sources} selected={filter.sourceId} onChange={(id) => set({ sourceId: id })} />
      <FilterSection id="wallet" title={t('wallets')} items={cat.wallets} selected={filter.walletId}
        onChange={(id) => set({ walletId: id, ...(id ? { currency: cat.wallet(id)?.currency } : {}) })} />
      <FilterSection id="category" title={t('expense_categories')} items={cat.topCategories} selected={filter.categoryId} onChange={(id) => set({ categoryId: id })} />
      <FilterSection id="sub" title={t('sub_category')} items={subs} selected={filter.subCategoryId} onChange={(id) => set({ subCategoryId: id })} />
      <FilterSection id="project" title={t('projects')} items={cat.projects} selected={filter.projectId} onChange={(id) => set({ projectId: id })} />
    </View>
  );
  return (
    <Sheet visible={visible} onClose={onClose} full
      footer={(
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <View style={{ flex: 1 }}><Button testID="reset-filters" title={t('reset_filters')} variant="tonal" onPress={clear} style={{ marginTop: 0 }} /></View>
          <View style={{ flex: 1 }}><Button testID="close-filters" title={t('close')} onPress={onClose} style={{ marginTop: 0 }} /></View>
        </View>
      )}>
      <FilterHeader onClose={onClose} />
      {/* what the Reports page shows: its type, period and currency (charts never mix currencies) */}
      <Label>{t('report_type')}</Label>
      <KindTabs value={filter.kind} onChange={(k) => set({ kind: k })} />
      <Label>{t('period')}</Label>
      <PeriodBar onCustom={() => setShowDates(true)} />
      {showDates ? dates : null}
      {currencies.length > 1 && !walletCurrency ? (
        <>
          <Label>{t('currency')}</Label>
          <Wrap>{currencies.map((c) => <Chip key={c} label={c} selected={c === currency} onPress={() => set({ currency: c })} />)}</Wrap>
          <Text style={[type.caption, { color: p.textSecondary, marginTop: space.xs }]}>{t('currency_note')}</Text>
        </>
      ) : null}
      {chips}
    </Sheet>
  );
}

export interface Stat { key: string; label: string; value: string; color?: string; hint?: string }

/** Statistic tiles: 2 per row on phones, 4 on wider screens; values are full figures (they wrap, never cut). */
export function StatGrid({ items, loading }: { items: Stat[]; loading?: boolean }) {
  const p = usePalette();
  const L = useScreenLayout();
  return (
    <Grid columns={L.bp === 'mobile' ? 2 : 4} gap={space.sm}>
      {items.map((s) => (
        <GlassCard key={s.key} testID={`stat-${s.key}`} radius={radii.lg} padding={space.md} style={{ minHeight: 84 }}>
          <Text numberOfLines={2} style={[type.caption, { color: p.textSecondary }]}>{s.label}</Text>
          {loading ? <Skeleton width="70%" height={18} style={{ marginTop: space.xs }} /> : (
            <Text testID={`stat-${s.key}-value`} style={[type.amount, { fontSize: 17, marginTop: space.xs, color: s.color ?? p.text }]}>{s.value}</Text>
          )}
          {s.hint ? <Text numberOfLines={2} style={[type.caption, { color: p.textSecondary, marginTop: 2 }]}>{s.hint}</Text> : null}
        </GlassCard>
      ))}
    </Grid>
  );
}

/** Card with a title row; used for every chart block. */
export function Panel({ title, right, children, testID }: { title: string; right?: ReactNode; children: ReactNode; testID?: string }) {
  const p = usePalette();
  return (
    <GlassCard radius={radii.xl} testID={testID}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.sm, flexWrap: 'wrap' }}>
        <Text style={[type.headline, { color: p.text, flex: 1, minWidth: 120 }]}>{title}</Text>
        {right}
      </View>
      {children}
    </GlassCard>
  );
}

/** The operations behind the report (same filter): newest first. */
export function TxList({ items, loading }: { items: Tx[]; loading: boolean }) {
  const t = useT();
  const p = usePalette();
  const lang = useSettings((s) => s.lang);
  const cat = useCatalog();
  if (loading && items.length === 0) return <Skeleton height={48} />;
  if (items.length === 0) return <Text style={[type.footnote, { color: p.textSecondary, textAlign: 'center', paddingVertical: space.md }]}>{t('no_ops')}</Text>;
  return (
    <View testID="report-ops">
      {items.map((tx) => {
        const c = cat.category(tx.categoryId);
        const parent = c?.parentId ? cat.category(c.parentId) : undefined;
        const s = cat.source(tx.incomeSourceId);
        const title = tx.type === TxType.Transfer ? `${cat.wallet(tx.walletId)?.name ?? '?'} → ${cat.wallet(tx.toWalletId)?.name ?? '?'}`
          : c ? (parent ? `${parent.name} / ${c.name}` : c.name) : (s?.name ?? cat.person(tx.personId)?.name ?? t(TX_TYPE_LABEL[tx.type]));
        const sign = flowSign(tx.type);
        const color = txColor(tx.type);
        // a cross-currency transfer also shows what arrived (the report may be filtered by the receiving currency)
        const received = tx.type === TxType.Expense && spent(tx).currency !== tx.currency ? fmtMoney(tx.amount, tx.currency)
          : tx.toAmount != null && tx.toCurrency && tx.toCurrency !== tx.currency ? `→ ${fmtMoney(tx.toAmount, tx.toCurrency)}` : null;
        return (
          <View key={tx.id} testID={`rtx-${tx.id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, borderTopWidth: 1, borderTopColor: p.glassBorder }}>
            <CircleBadge name={c?.icon ?? s?.icon ?? (tx.type === TxType.Transfer ? 'swap' : 'debt')} color={c?.color ?? s?.color ?? color} size={34} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={[type.callout, { color: p.text }]}>{title}</Text>
              <Text numberOfLines={1} style={[type.caption, { color: p.textSecondary }]}>
                {longDay(lang, tx.occurredAt)}{tx.memo ? ` · ${tx.memo}` : ''}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text numberOfLines={1} style={[type.callout, { color, fontVariant: ['tabular-nums'] }]}>
                {sign > 0 ? '+' : sign < 0 ? '−' : ''}{fmtMoney(spent(tx).amount, spent(tx).currency)}
              </Text>
              {received ? <Text numberOfLines={1} style={[type.caption, { color: p.textSecondary }]}>{received}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}


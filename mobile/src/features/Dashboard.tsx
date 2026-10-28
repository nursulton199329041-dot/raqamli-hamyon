import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, RefreshControl, Text, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '@/api/client';
import type { BreakdownRow, Category, IncomeSource, Wallet } from '@/api/types';
import { Chip, Wrap } from '@/design/Controls';
import { GlassCard, Tap } from '@/design/Glass';
import { CircleBadge, Glyph } from '@/design/Icon';
import { CONTENT_MAX, SIDEBAR_W, useScreenLayout } from '@/design/layout';
import { useLook } from '@/design/look';
import { Sheet } from '@/design/Sheet';
import { EmptyState, ErrorState, LoadingState } from '@/design/States';
import { Ink, usePalette, useT, type Palette } from '@/design/theme';
import { motion, radii, space, type } from '@/design/tokens';
import { DragRow, DropZone, Draggable, useDrag, type DragPayload } from '@/dnd/DragDrop';
import type { Lang } from '@/i18n';
import { monthShort } from '@/lib/dates';
import { fitMoney, fmtMoney } from '@/lib/money';
import { useBreakdown, useCatalog, useSnapshot, type Period } from '@/state/data';
import { useQueue } from '@/state/queue';
import { api } from '@/state/runtime';
import { useSession } from '@/state/session';
import { useSettings, type HomeSection } from '@/state/settings';
import { useUi, type OpKind } from '@/state/ui';
import { expenseGrid } from './expenseGrid';
import { UpdateBanner } from './UpdateBanner';

type Amounts = { currency: string; total: number }[];

/** id -> per-currency totals, from the backend breakdown (the single ledger source of truth). */
function amountsById(rows: BreakdownRow[] | undefined) {
  const m = new Map<string, Amounts>();
  for (const r of rows ?? []) {
    if (!r.id) continue;
    const list = m.get(r.id) ?? [];
    list.push({ currency: r.currency, total: r.total });
    m.set(r.id, list);
  }
  return m;
}

function sumAmounts(...lists: (Amounts | undefined)[]): Amounts {
  const acc = new Map<string, number>();
  for (const l of lists) for (const x of l ?? []) acc.set(x.currency, (acc.get(x.currency) ?? 0) + x.total);
  return [...acc].map(([currency, total]) => ({ currency, total }));
}

/** Section header total; several currencies share one line, so each is compacted when long. */
const fmtAmounts = (a: Amounts) => (a.length === 0 ? '0'
  : a.map((x) => (a.length > 1 ? fitMoney(x.total, x.currency) : fmtMoney(x.total, x.currency))).join(' · '));

/** "01 OKT. – 31 DEK." label for the period chip. */
export function periodLabel(lang: Lang, period: Period, t: (k: 'all') => string, now = new Date()): string {
  const f = (d: Date) => `${String(d.getDate()).padStart(2, '0')} ${monthShort(lang, d.getMonth()).toUpperCase()}.`;
  switch (period) {
    case 'week': {
      const dow = (now.getDay() + 6) % 7;
      const a = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
      return `${f(a)} – ${f(new Date(a.getFullYear(), a.getMonth(), a.getDate() + 6))}`;
    }
    case 'month': return `${f(new Date(now.getFullYear(), now.getMonth(), 1))} – ${f(new Date(now.getFullYear(), now.getMonth() + 1, 0))}`;
    case 'year': return `${f(new Date(now.getFullYear(), 0, 1))} – ${f(new Date(now.getFullYear(), 11, 31))}`;
    default: return t('all');
  }
}

const headerButton = (p: Palette) => ({
  width: 40, height: 40, borderRadius: 20, alignItems: 'center' as const, justifyContent: 'center' as const,
  backgroundColor: p.glassFill, borderWidth: 1, borderColor: p.glassBorder,
});

const SECTION_COLOR: Record<HomeSection, string> = { income: Ink.income, wallets: Ink.transfer, expense: Ink.expense };

/**
 * Home: exactly three sections — income sources and wallets as horizontal rows, expense categories as a wrapping grid —
 * of round, coloured, animated icons. Order, visibility and grid rows come from Appearance; drag & drop works across
 * them (rows auto-scroll sideways at their ends, the page scrolls vertically at the screen edges).
 */
export function Dashboard() {
  const t = useT();
  const p = usePalette();
  const L = useScreenLayout();
  const look = useLook();
  const lang = useSettings((s) => s.lang);
  const order = useSettings((s) => s.appearance.sectionOrder);
  const hidden = useSettings((s) => s.appearance.hiddenSections);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const cat = useCatalog();
  const snap = useSnapshot();
  const user = useSession((s) => s.user);
  const [period, setPeriod] = useState<Period>('month');
  const [periodMenu, setPeriodMenu] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const incomeBy = amountsById(useBreakdown('source', period, 1).data);
  const expenseBy = amountsById(useBreakdown('category', period, 2).data);
  const { dragging, registerScroller } = useDrag();
  const openForm = useUi((s) => s.openForm);
  const openOp = useUi((s) => s.openOp);
  const queue = useQueue();
  const [actionsFor, setActionsFor] = useState<Wallet | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Vertical auto-scroll plumbing for the drag provider (the page).
  const scrollRef = useRef<ScrollView>(null);
  const wrapRef = useRef<View>(null);
  const offset = useRef(0);
  const maxOffset = useRef(0);
  const viewH = useRef(0);
  useEffect(
    () =>
      registerScroller({
        ref: wrapRef,
        getOffset: () => offset.current,
        getMax: () => maxOffset.current,
        scrollTo: (y) => {
          offset.current = y;
          scrollRef.current?.scrollTo({ y, animated: false });
        },
      }),
    [registerScroller],
  );
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    // While a drag auto-scrolls, the offset we last COMMANDED is the truth: native scroll events arrive late.
    if (!dragging) offset.current = e.nativeEvent.contentOffset.y;
  };

  const byCurrency = new Map<string, number>();
  for (const w of cat.activeWallets) byCurrency.set(w.currency, (byCurrency.get(w.currency) ?? 0) + w.balance);
  const walletTotals: Amounts = [...byCurrency].map(([currency, total]) => ({ currency, total }));
  const incomeTotals = sumAmounts(...cat.sources.map((s) => incomeBy.get(s.id)));
  const expenseTotals = sumAmounts(...[...cat.categories].map((c) => expenseBy.get(c.id)));

  const status = !queue.online ? t('offline') : queue.syncing ? t('syncing')
    : queue.pending.length > 0 ? t('sync_pending', { n: queue.pending.length }) : t('synced');
  const statusColor = !queue.online || queue.pending.length > 0 ? Ink.debt : Ink.income;

  const quick: { kind: OpKind; label: string; color: string }[] = [
    { kind: 'income', label: t('income'), color: Ink.income },
    { kind: 'expense', label: t('expense'), color: Ink.expense },
    { kind: 'transfer', label: t('transfer'), color: Ink.transfer },
    { kind: 'debt', label: t('debt'), color: Ink.debt },
  ];

  const archive = async (w: Wallet) => {
    setActionError(null);
    if (w.balance !== 0) return setActionError(t('archive_nonzero'));
    try {
      await api.patch(`/api/wallets/${w.id}`, { isArchived: true });
      setActionsFor(null);
      await qc.invalidateQueries();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : String(e));
    }
  };

  const sync = () => {
    void useQueue.getState().flush();
    void qc.invalidateQueries();
  };
  const toggle = (k: string) => setCollapsed((c) => ({ ...c, [k]: !c[k] }));
  const loading = !cat.loaded && snap.isLoading;

  const sections: Record<HomeSection, ReactNode> = {
    income: (
      <Section key="income" kind="income" title={t('income_sources')} total={fmtAmounts(incomeTotals)} totalColor={Ink.income}
        collapsed={!!collapsed.income} onToggle={() => toggle('income')} testID="section-income">
        {loading ? <LoadingState rows={1} columns={4} /> : (
          <HRow id="income">
            {cat.sources.map((s) => <SourceTile key={s.id} source={s} amounts={incomeBy.get(s.id)} />)}
            <AddTile label={t('new_source')} onPress={() => openForm('source')} />
          </HRow>
        )}
      </Section>
    ),
    wallets: (
      <Section key="wallets" kind="wallets" title={t('wallets')} total={fmtAmounts(walletTotals)}
        totalColor={walletTotals.some((x) => x.total < 0) ? Ink.expense : undefined}
        collapsed={!!collapsed.wallets} onToggle={() => toggle('wallets')} testID="section-wallets">
        {loading ? <LoadingState rows={1} columns={4} /> : cat.loaded && cat.activeWallets.length === 0 ? (
          <EmptyState testID="wallets-empty" icon="wallet" title={t('empty_wallets')} action={t('create_wallet')} onAction={() => openForm('wallet')} />
        ) : (
          <HRow id="wallets">
            {cat.activeWallets.map((w) => <WalletTile key={w.id} wallet={w} onActions={() => { setActionError(null); setActionsFor(w); }} />)}
            <AddTile label={t('new_wallet')} onPress={() => openForm('wallet')} />
          </HRow>
        )}
      </Section>
    ),
    expense: (
      <Section key="expense" kind="expense" title={t('expense_categories')} total={fmtAmounts(expenseTotals)} totalColor={Ink.expense}
        collapsed={!!collapsed.expense} onToggle={() => toggle('expense')} testID="section-expense">
        {loading ? <LoadingState rows={1} columns={4} /> : (
          <ExpenseGrid count={cat.topCategories.length + 1}>
            {cat.topCategories.map((c) => (
              <CategoryTile key={c.id} category={c}
                amounts={sumAmounts(expenseBy.get(c.id), ...cat.childrenOf(c.id).map((ch) => expenseBy.get(ch.id)))} />
            ))}
            <AddTile label={t('new_category')} onPress={() => openForm('category')} />
          </ExpenseGrid>
        )}
      </Section>
    ),
  };

  return (
    <>
      <View ref={wrapRef} testID="dash-wrap" collapsable={false} style={{ flex: 1 }}
        onLayout={(e) => { viewH.current = e.nativeEvent.layout.height; }}>
        <ScrollView
          ref={scrollRef}
          testID="dash-scroll"
          scrollEnabled={!dragging}
          scrollEventThrottle={16}
          onScroll={onScroll}
          onContentSizeChange={(_w, h) => { maxOffset.current = Math.max(0, h - viewH.current); }}
          contentContainerStyle={{ paddingHorizontal: L.gutter, paddingTop: space.sm, paddingBottom: L.bottomSpace + Math.max(insets.bottom, 8), gap: space.md }}
          refreshControl={<RefreshControl refreshing={snap.isFetching} onRefresh={() => void snap.refetch()} tintColor={p.accent} />}
        >
          <UpdateBanner />

          {/* compact header: profile | name + sync state | period | sync | settings */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Tap label={user?.displayName ?? 'account'} onPress={() => router.push('/settings')}
              style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: `${p.accent}29`, borderWidth: 1, borderColor: `${p.accent}66` }}>
              <Text style={[type.headline, { color: p.accent }]}>{(user?.displayName ?? '?').slice(0, 1).toUpperCase()}</Text>
            </Tap>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={[type.headline, { color: p.text, fontSize: 17 * look.fontScale }]}>{t('app')}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
                <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: statusColor }} />
                <Text testID="sync-status" numberOfLines={1} style={[type.caption, { color: p.textSecondary, flexShrink: 1 }]}>{status}</Text>
              </View>
            </View>
            <Tap testID="sync-button" label={t('sync_now')} onPress={sync} style={headerButton(p)}>
              {snap.isFetching || queue.syncing ? <ActivityIndicator size="small" color={p.textSecondary} /> : <Glyph name="sync" color={p.text} size={18} />}
            </Tap>
            <Tap label={t('settings')} onPress={() => router.push('/settings')} style={headerButton(p)}>
              <Glyph name="settings" color={p.text} size={18} />
            </Tap>
          </View>
          <Tap testID="period-button" label={periodLabel(lang, period, () => t('all'))} onPress={() => setPeriodMenu(true)} containerStyle={{ alignSelf: 'flex-start' }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.md, minHeight: 34, borderRadius: radii.pill, backgroundColor: p.glassFill, borderWidth: 1, borderColor: p.glassBorder }}>
            <Glyph name="calendar" color={p.textSecondary} size={14} />
            <Text numberOfLines={1} style={[type.footnote, { color: p.text, fontWeight: '700' }]}>{periodLabel(lang, period, () => t('all'))}</Text>
            <Glyph name="chevronDown" color={p.textSecondary} size={12} />
          </Tap>

          {snap.isError && !cat.loaded ? (
            <GlassCard radius={radii.lg} padding={space.sm}>
              <ErrorState testID="dash-error" title={t('dash_load_error')} message={snap.error instanceof Error ? snap.error.message : undefined}
                retry={t('retry')} onRetry={() => void snap.refetch()} />
            </GlassCard>
          ) : null}

          {order.filter((s) => !hidden.includes(s)).map((s) => sections[s])}
        </ScrollView>
      </View>

      <Sheet visible={periodMenu} onClose={() => setPeriodMenu(false)}>
        <View style={{ gap: 8 }}>
          {(['week', 'month', 'year', 'all'] as Period[]).map((x) => (
            <Chip key={x} label={`${t(x)} · ${periodLabel(lang, x, () => t('all'))}`} selected={period === x} onPress={() => { setPeriod(x); setPeriodMenu(false); }} />
          ))}
        </View>
      </Sheet>

      {/* Tap alternative to drag & drop (also used by assistive technologies). */}
      <Sheet visible={actionsFor !== null} onClose={() => setActionsFor(null)}>
        {actionsFor && (
          <View style={{ gap: 4 }}>
            <Text style={{ color: p.text, fontWeight: '800', fontSize: 18 }}>
              {actionsFor.name} · {fmtMoney(actionsFor.balance, actionsFor.currency)}
            </Text>
            <Wrap>
              {quick.map((q) => (
                <Chip key={q.kind} label={q.label} color={q.color} selected={false}
                  onPress={() => { const id = actionsFor.id; setActionsFor(null); openOp({ kind: q.kind, walletId: id }); }} />
              ))}
            </Wrap>
            <Wrap>
              <Chip label={t('edit')} selected={false}
                onPress={() => { const id = actionsFor.id; setActionsFor(null); openForm('wallet', id); }} />
              <Chip label={t('archive')} selected={false} color={Ink.expense} onPress={() => void archive(actionsFor)} />
            </Wrap>
            {actionError && <Text style={{ color: Ink.expense }}>{actionError}</Text>}
          </View>
        )}
      </Sheet>
    </>
  );
}

/** A home block: title + period total (tap collapses), then one horizontal row of icons. */
function Section({ kind, title, total, totalColor, collapsed, onToggle, children, testID }: {
  kind: HomeSection; title: string; total: string; totalColor?: string; collapsed: boolean; onToggle(): void; children: ReactNode; testID: string;
}) {
  const p = usePalette();
  const look = useLook();
  return (
    <GlassCard radius={radii.xl} padding={space.md} tint={look.tintSections ? SECTION_COLOR[kind] : undefined}>
      <Tap testID={`${testID}-header`} label={title} onPress={onToggle} haptic={false}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 30, paddingBottom: collapsed ? 0 : space.sm }}>
          <Text accessibilityRole="header" numberOfLines={1} style={[type.headline, { color: p.text, flexShrink: 1, fontSize: 17 * look.fontScale }]}>{title}</Text>
          <Text testID={`${testID}-total`} numberOfLines={1}
            style={[type.callout, { flex: 1, textAlign: 'right', color: totalColor ?? p.textSecondary, fontVariant: ['tabular-nums'] }]}>{total}</Text>
          <View style={{ transform: [{ rotate: collapsed ? '-90deg' : '0deg' }] }}><Glyph name="chevronDown" color={p.textSecondary} size={14} /></View>
        </View>
      </Tap>
      {!collapsed ? children : null}
    </GlassCard>
  );
}

/**
 * One horizontally scrolling row. It registers itself with the drag engine (zones inside know their row through
 * `DragRow`), so a drop zone's x follows the row's scroll and a finger resting at the row's end scrolls it.
 * Native scrolling is locked while a drag is running; the engine drives the scroll then.
 */
function HRow({ id, children }: { id: string; children: ReactNode }) {
  const { dragging, registerScroller } = useDrag();
  const ref = useRef<ScrollView>(null);
  const wrap = useRef<View>(null);
  const offset = useRef(0);
  const max = useRef(0);
  const viewW = useRef(0);
  useEffect(
    () => registerScroller({
      id, axis: 'x', ref: wrap,
      getOffset: () => offset.current,
      getMax: () => max.current,
      scrollTo: (x) => {
        offset.current = x;
        ref.current?.scrollTo({ x, animated: false });
      },
    }),
    [id, registerScroller],
  );
  return (
    <DragRow.Provider value={id}>
      <View ref={wrap} testID={`row-${id}`} collapsable={false} onLayout={(e: LayoutChangeEvent) => { viewW.current = e.nativeEvent.layout.width; }}
        style={{ marginHorizontal: -space.md }}>
        <ScrollView
          ref={ref}
          horizontal
          testID={`row-scroll-${id}`}
          scrollEnabled={!dragging}
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => { if (!dragging) offset.current = e.nativeEvent.contentOffset.x; }}
          onContentSizeChange={(w) => { max.current = Math.max(0, w - viewW.current); }}
          contentContainerStyle={{ paddingHorizontal: space.md - space.xs, gap: space.xs }}
        >
          {children}
        </ScrollView>
      </View>
    </DragRow.Provider>
  );
}

/** Tile width / icon size forced by the expense grid; rows use the Appearance sizes. */
const TileSize = createContext<{ w: number; icon: number } | null>(null);

/**
 * Expense categories: a wrapping grid inside the page, never a sideways scroller. Its zones live in the page's
 * vertical scroller only, so dragging a wallet to the screen's bottom edge scrolls the page to reach lower rows.
 */
function ExpenseGrid({ count, children }: { count: number; children: ReactNode }) {
  const look = useLook();
  const L = useScreenLayout();
  const rows = useSettings((s) => s.appearance.expenseRows);
  const [width, setWidth] = useState(0);
  // until the grid is measured: page width minus gutters and the card's padding (sidebar / content cap on wide screens)
  const estimate = Math.min(L.width - (L.sidebar ? SIDEBAR_W : 0), CONTENT_MAX[L.bp]) - 2 * L.gutter - 2 * space.md;
  const g = expenseGrid(count, width || estimate, rows, look.iconPx, space.xs);
  return (
    <TileSize.Provider value={{ w: g.tileW, icon: g.iconPx }}>
      <View testID="grid-expense" onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.xs, rowGap: space.sm }}>
        {children}
      </View>
    </TileSize.Provider>
  );
}

/**
 * Round icon that reacts to the user only: grows and glows while a valid drag hovers it, pulses once when a drop lands
 * on it (`dropped` changes). Never loops; with animations off it only changes its ring colour.
 */
function LiveBadge({ name, color, active, rejected, valid, dropped, depth }: {
  name: string; color: string; active?: boolean; rejected?: boolean; valid?: boolean; dropped?: number; depth?: boolean;
}) {
  const p = usePalette();
  const look = useLook();
  const scale = useSharedValue(1);
  useEffect(() => {
    if (look.motionOff) return;
    scale.set(withSpring(active ? 1.12 : 1, motion.release));
  }, [active, look.motionOff, scale]);
  useEffect(() => {
    if (!dropped || look.motionOff) return;
    scale.set(withSequence(withTiming(1.2, { duration: 120 }), withSpring(1, motion.release)));
  }, [dropped, look.motionOff, scale]);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  const ring = active ? p.accent : rejected ? Ink.expense : valid ? `${p.accent}99` : undefined;
  const size = useContext(TileSize)?.icon ?? look.iconPx;
  return (
    <Animated.View style={[anim, active && !look.motionOff ? {
      shadowColor: p.accent, shadowOpacity: 0.7, shadowRadius: 14, shadowOffset: { width: 0, height: 0 }, elevation: 8, borderRadius: size,
    } : null]}>
      <CircleBadge name={name} color={color} size={size} ring={ring} depth={depth} />
    </Animated.View>
  );
}

/** Tile layout shared by the three rows: icon, name (2 lines max) and the amount under it. */
function Tile({ icon, children, testID }: { icon: ReactNode; children: ReactNode; testID?: string }) {
  const look = useLook();
  const forced = useContext(TileSize);
  return (
    <View testID={testID} style={{ width: forced?.w ?? Math.max(80, look.iconPx + 30), alignItems: 'center', gap: space.xs, paddingVertical: space.xs }}>
      {icon}
      {children}
    </View>
  );
}

function TileText({ name, amounts, amountColor }: { name: string; amounts?: Amounts; amountColor: string }) {
  const p = usePalette();
  const look = useLook();
  return (
    <>
      <Text numberOfLines={2} style={[type.caption, { color: p.text, textAlign: 'center', fontWeight: '600', minHeight: 30 * look.fontScale, fontSize: 11.5 * look.fontScale }]}>{name}</Text>
      {(amounts && amounts.length ? amounts : [{ currency: '', total: 0 }]).map((x) => {
        // exact amount up to "1 000 000 UZS" (slightly smaller when long); larger ones are compacted instead of cut off
        const s = x.currency ? fitMoney(x.total, x.currency, 13) : '0';
        return (
          <Text key={x.currency} numberOfLines={1}
            style={[type.amount, { fontSize: (s.length > 11 ? 10.5 : 12) * look.fontScale, color: x.total < 0 ? Ink.expense : amountColor, textAlign: 'center', maxWidth: '100%' }]}>
            {s}
          </Text>
        );
      })}
    </>
  );
}

function AddTile({ label, onPress }: { label: string; onPress(): void }) {
  const p = usePalette();
  const look = useLook();
  const px = useContext(TileSize)?.icon ?? look.iconPx;
  const r = look.iconShape === 'squircle' ? px * 0.3 : px / 2;
  return (
    <Tap label={label} onPress={onPress}>
      <Tile icon={(
        <View style={{ width: px, height: px, borderRadius: r, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderStyle: 'dashed', borderColor: `${p.accent}88` }}>
          <Glyph name="plus" color={p.accent} size={px * 0.42} />
        </View>
      )}>
        <Text numberOfLines={2} style={[type.caption, { color: p.textSecondary, textAlign: 'center', minHeight: 30 * look.fontScale, fontSize: 11.5 * look.fontScale }]}>{label}</Text>
      </Tile>
    </Tap>
  );
}

function SourceTile({ source, amounts }: { source: IncomeSource; amounts?: Amounts }) {
  const p = usePalette();
  const look = useLook();
  const openOp = useUi((s) => s.openOp);
  return (
    <Draggable payload={{ kind: 'source', id: source.id }} onTap={() => openOp({ kind: 'income', sourceId: source.id })}
      ghost={<FloatingIcon name={source.icon} color={source.color} size={look.iconPx} />}>
      <Tile icon={<LiveBadge name={source.icon} color={source.color} />}>
        <TileText name={source.name} amounts={amounts} amountColor={p.text} />
      </Tile>
    </Draggable>
  );
}

function WalletTile({ wallet, onActions }: { wallet: Wallet; onActions(): void }) {
  const p = usePalette();
  const look = useLook();
  const openOp = useUi((s) => s.openOp);
  const accepts = (pl: DragPayload) => (pl.kind === 'wallet' && pl.id !== wallet.id) || pl.kind === 'source';
  const onDrop = (pl: DragPayload) => {
    // wallet -> wallet = transfer form; source -> wallet = income form. No money moves until confirmation.
    if (pl.kind === 'wallet') openOp({ kind: 'transfer', walletId: pl.id, toWalletId: wallet.id });
    else openOp({ kind: 'income', walletId: wallet.id, sourceId: pl.id });
  };
  return (
    <DropZone id={`wallet:${wallet.id}`} accepts={accepts} onDrop={onDrop}>
      {({ active, rejected, valid, dropped }) => (
        <Draggable payload={{ kind: 'wallet', id: wallet.id }} onTap={onActions}
          ghost={<FloatingIcon name={wallet.icon} color={wallet.color} size={look.iconPx} depth />}>
          <View accessible accessibilityLabel={`${wallet.name} ${fmtMoney(wallet.balance, wallet.currency)}`}
            accessibilityActions={[{ name: 'activate', label: 'Actions' }]} onAccessibilityAction={onActions}>
            <Tile icon={<LiveBadge name={wallet.icon} color={wallet.color} active={active} rejected={rejected} valid={valid} dropped={dropped} depth />}>
              <TileText name={wallet.name} amounts={[{ currency: wallet.currency, total: wallet.balance }]} amountColor={p.text} />
            </Tile>
          </View>
        </Draggable>
      )}
    </DropZone>
  );
}

function CategoryTile({ category, amounts }: { category: Category; amounts?: Amounts }) {
  const p = usePalette();
  const openOp = useUi((s) => s.openOp);
  return (
    <DropZone id={`cat:${category.id}`} accepts={(pl) => pl.kind === 'wallet'}
      onDrop={(pl) => openOp({ kind: 'expense', walletId: pl.id, categoryId: category.id })}>
      {({ active, rejected, valid, dropped }) => (
        <Tap label={category.name} onPress={() => openOp({ kind: 'expense', categoryId: category.id })}>
          <Tile icon={<LiveBadge name={category.icon} color={category.color} active={active} rejected={rejected} valid={valid} dropped={dropped} />}>
            <TileText name={category.name} amounts={amounts} amountColor={p.text} />
          </Tile>
        </Tap>
      )}
    </DropZone>
  );
}

/** The icon that floats under the finger while dragging (the provider adds lift scale and the float shadow). */
function FloatingIcon({ name, color, size, depth }: { name: string; color: string; size: number; depth?: boolean }) {
  const p = usePalette();
  return (
    <View style={{ alignItems: 'center' }}>
      <CircleBadge name={name} color={color} size={size + 8} ring={p.accent} depth={depth} />
    </View>
  );
}

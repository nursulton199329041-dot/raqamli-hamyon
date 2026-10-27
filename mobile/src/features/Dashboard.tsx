import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, RefreshControl, Text, View, type NativeScrollEvent, type NativeSyntheticEvent, type ViewStyle } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '@/api/client';
import type { BreakdownRow, Category, IncomeSource, Wallet } from '@/api/types';
import { Chip, Wrap } from '@/design/Controls';
import { GlassCard, Tap } from '@/design/Glass';
import { CircleBadge, Glyph } from '@/design/Icon';
import { Sheet } from '@/design/Sheet';
import { EmptyState, ErrorState, LoadingState } from '@/design/States';
import { Ink, usePalette, useT, type Palette } from '@/design/theme';
import { HIT, iconSize, radii, space, type } from '@/design/tokens';
import { DropZone, Draggable, useDrag, type DragPayload } from '@/dnd/DragDrop';
import type { Lang } from '@/i18n';
import { monthShort } from '@/lib/dates';
import { fmtMoney } from '@/lib/money';
import { useBreakdown, useBudgets, useCatalog, useSnapshot, useSummary, type Period } from '@/state/data';
import { useQueue } from '@/state/queue';
import { api } from '@/state/runtime';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import { useUi, type OpKind } from '@/state/ui';
import { BalanceSummary } from './BalanceSummary';
import { UpdateBanner } from './UpdateBanner';

const headerButton = (p: Palette): ViewStyle => ({
  width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
  backgroundColor: p.glassFill, borderWidth: 1, borderColor: p.glassBorder,
});

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

const fmtAmounts = (a: Amounts) => (a.length === 0 ? '0' : a.map((x) => fmtMoney(x.total, x.currency)).join(' · '));

/** "01 OKT. – 31 DEK." label for the period chip (same idea as the reference app's date selector). */
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

export function Dashboard() {
  const t = useT();
  const p = usePalette();
  const lang = useSettings((s) => s.lang);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const cat = useCatalog();
  const snap = useSnapshot();
  const user = useSession((s) => s.user);
  const [period, setPeriod] = useState<Period>('month');
  const [periodMenu, setPeriodMenu] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const budgets = useBudgets();
  const summary = useSummary(period);
  const incomeBy = amountsById(useBreakdown('source', period, 1).data);
  const expenseBy = amountsById(useBreakdown('category', period, 2).data);
  const { dragging, registerScroller } = useDrag();
  const openOp = useUi((s) => s.openOp);
  const openForm = useUi((s) => s.openForm);
  const queue = useQueue();
  const [actionsFor, setActionsFor] = useState<Wallet | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Auto-scroll plumbing for the drag provider.
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
    // While a drag auto-scrolls, the offset we last COMMANDED is the truth: native scroll events arrive late and a stale one
    // would pull the position backwards (the page then stalls or jitters and drop zones drift).
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
          contentContainerStyle={{ paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: 96 + Math.max(insets.bottom, 8), gap: space.md }}
          refreshControl={<RefreshControl refreshing={snap.isFetching} onRefresh={() => void snap.refetch()} tintColor={p.accent} />}
        >
          <UpdateBanner />

          {/* header: account | app name + sync state | sync | settings */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.xs }}>
            <Tap label={user?.displayName ?? 'account'} onPress={() => router.push('/settings')}
              style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: `${p.accent}29`, borderWidth: 1, borderColor: `${p.accent}66` }}>
              <Text style={[type.headline, { color: p.accent }]}>{(user?.displayName ?? '?').slice(0, 1).toUpperCase()}</Text>
            </Tap>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={[type.headline, { color: p.text }]}>{t('app')}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
                <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: statusColor }} />
                <Text testID="sync-status" numberOfLines={1} style={[type.caption, { color: p.textSecondary, flexShrink: 1 }]}>{status}</Text>
              </View>
            </View>
            <Tap testID="sync-button" label={t('sync_now')} onPress={sync} style={headerButton(p)}>
              {snap.isFetching || queue.syncing ? <ActivityIndicator size="small" color={p.textSecondary} /> : <Glyph name="sync" color={p.text} size={iconSize.md} />}
            </Tap>
            <Tap label={t('settings')} onPress={() => router.push('/settings')} style={headerButton(p)}>
              <Glyph name="settings" color={p.text} size={iconSize.md} />
            </Tap>
          </View>

          <BalanceSummary wallets={cat.activeWallets} primary={user?.defaultCurrency} summary={summary.data} loading={summary.isLoading || !cat.loaded}
            periodLabel={periodLabel(lang, period, () => t('all'))} onPeriod={() => setPeriodMenu(true)} />

          {snap.isError && !cat.loaded ? (
            <GlassCard radius={radii.lg} padding={space.sm}>
              <ErrorState testID="dash-error" title={t('dash_load_error')} message={snap.error instanceof Error ? snap.error.message : undefined}
                retry={t('retry')} onRetry={() => void snap.refetch()} />
            </GlassCard>
          ) : null}

          {/* 1. INCOME SOURCES */}
          <Section title={t('income_sources')} total={fmtAmounts(incomeTotals)} totalColor={Ink.income} collapsed={!!collapsed.income} onToggle={() => toggle('income')} testID="section-income">
            {!cat.loaded && snap.isLoading ? <LoadingState rows={1} columns={4} /> : null}
            {cat.sources.map((s) => <SourceTile key={s.id} source={s} amounts={incomeBy.get(s.id)} />)}
            <AddTile cell={CELL4} label={t('new_source')} onPress={() => openForm('source')} />
          </Section>

          {/* 2. WALLETS — balance is always under the name */}
          <Section title={t('wallets')} total={fmtAmounts(walletTotals)} totalColor={walletTotals.some((x) => x.total < 0) ? Ink.expense : undefined}
            collapsed={!!collapsed.wallets} onToggle={() => toggle('wallets')} testID="section-wallets">
            {!cat.loaded && snap.isLoading ? <LoadingState rows={1} columns={2} /> : null}
            {cat.loaded && cat.activeWallets.length === 0 ? (
              <EmptyState testID="wallets-empty" icon="wallet" title={t('empty_wallets')} action={t('create_wallet')} onAction={() => openForm('wallet')} />
            ) : null}
            {cat.activeWallets.map((w) => <WalletTile key={w.id} wallet={w} onActions={() => { setActionError(null); setActionsFor(w); }} />)}
            {cat.activeWallets.length > 0 ? <AddTile cell={CELL2} wide label={t('new_wallet')} onPress={() => openForm('wallet')} /> : null}
          </Section>

          {/* 3. EXPENSE CATEGORIES */}
          <Section title={t('expense_categories')} total={fmtAmounts(expenseTotals)} totalColor={Ink.expense}
            collapsed={!!collapsed.expense} onToggle={() => toggle('expense')} testID="section-expense">
            {!cat.loaded && snap.isLoading ? <LoadingState rows={1} columns={3} /> : null}
            {cat.topCategories.map((c) => (
              <CategoryTile key={c.id} category={c}
                amounts={sumAmounts(expenseBy.get(c.id), ...cat.childrenOf(c.id).map((ch) => expenseBy.get(ch.id)))} />
            ))}
            <AddTile cell={CELL3} label={t('new_category')} onPress={() => openForm('category')} />
          </Section>

          {(budgets.data ?? []).filter((b) => b.exceeded || b.percent >= 80).map((b) => (
            <GlassCard key={b.categoryId} tint={b.exceeded ? Ink.expense : Ink.debt} padding={10}>
              <Text style={{ color: p.text, fontWeight: '700', fontSize: 12 }}>
                {b.name}: {b.percent.toFixed(0)}% — {fmtMoney(b.spent, b.currency)} / {fmtMoney(b.limit, b.currency)}
              </Text>
            </GlassCard>
          ))}

          <Text style={{ color: p.textSecondary, fontSize: 11, textAlign: 'center' }}>{t('drag_hint')}</Text>
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

/** A dashboard block: header with title + period total, then a wrapping grid (sources 5 / wallets 2 / categories 3 columns). */
function Section({ title, total, totalColor, collapsed, onToggle, children, testID }: {
  title: string; total: string; totalColor?: string; collapsed: boolean; onToggle(): void; children: ReactNode; testID: string;
}) {
  const p = usePalette();
  return (
    <GlassCard radius={radii.xl} padding={space.md}>
      <Tap testID={`${testID}-header`} label={title} onPress={onToggle} haptic={false}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 32, paddingBottom: collapsed ? 0 : space.sm }}>
          <Text accessibilityRole="header" numberOfLines={1} style={[type.headline, { color: p.text, flexShrink: 1 }]}>{title}</Text>
          <Text testID={`${testID}-total`} adjustsFontSizeToFit minimumFontScale={0.6} numberOfLines={1}
            style={[type.callout, { flex: 1, textAlign: 'right', color: totalColor ?? p.textSecondary, fontVariant: ['tabular-nums'] }]}>{total}</Text>
          <View style={{ transform: [{ rotate: collapsed ? '-90deg' : '0deg' }] }}><Glyph name="chevronDown" color={p.textSecondary} size={iconSize.sm} /></View>
        </View>
      </Tap>
      {!collapsed ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: space.md, marginHorizontal: -space.xs }}>{children}</View> : null}
    </GlassCard>
  );
}

function AmountLines({ amounts, color, base = 12.5 }: { amounts?: Amounts; color: string; base?: number }) {
  if (!amounts || amounts.length === 0) return <Text numberOfLines={1} style={{ color, fontSize: base, fontWeight: '800' }}>0</Text>;
  return (
    <>
      {amounts.map((x) => {
        const txt = fmtMoney(x.total, x.currency);
        // long figures shrink (adjustsFontSizeToFit is native-only), like the reference app
        const size = txt.length > 14 ? base - 3 : txt.length > 12 ? base - 2 : txt.length > 10 ? base - 1 : base;
        return (
          <Text key={x.currency} adjustsFontSizeToFit minimumFontScale={0.6} numberOfLines={1}
            style={{ color: x.total < 0 ? Ink.expense : color, fontSize: size, fontWeight: '800', maxWidth: '100%' }}>
            {txt}
          </Text>
        );
      })}
    </>
  );
}

/**
 * One visual system for all three sections. Compact (sources 5 / categories 3 per row): name above, round icon, amount below.
 * Wide (wallets, 2 per row): glass pill with the icon on the left and name + balance on the right. Names wrap to two
 * lines instead of being cut off.
 */
function Tile({ name, icon, color, amounts, amountColor, ring, grow, wide }: {
  name: string; icon: string; color: string; amounts?: Amounts; amountColor: string; ring?: string; grow?: boolean; wide?: boolean;
}) {
  const p = usePalette();
  const scale = { transform: [{ scale: grow ? 1.06 : 1 }] };
  if (wide) {
    return (
      <View style={[{
        flexDirection: 'row', alignItems: 'center', gap: space.sm, width: '100%', minHeight: 68, paddingVertical: space.sm, paddingHorizontal: space.sm,
        borderRadius: radii.lg, borderWidth: ring ? 1.5 : 1, borderColor: ring ?? p.glassBorder, backgroundColor: p.glassFillStrong,
      }, scale]}>
        <CircleBadge name={icon} color={color} size={iconSize.badge - 4} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text numberOfLines={2} style={[type.footnote, { color: p.textSecondary }]}>{name}</Text>
          <AmountLines amounts={amounts} color={amountColor} base={15} />
        </View>
      </View>
    );
  }
  return (
    <View style={[{ alignItems: 'center', gap: space.xs, width: '100%' }, scale]}>
      <CircleBadge name={icon} color={color} size={iconSize.badge} ring={ring} />
      <Text numberOfLines={2} style={[type.caption, { color: p.text, maxWidth: '100%', textAlign: 'center', minHeight: 30, fontWeight: '600' }]}>{name}</Text>
      <AmountLines amounts={amounts} color={amountColor} />
    </View>
  );
}

const CELL4 = { width: '25%' as const, paddingHorizontal: space.xs };
const CELL3 = { width: '33.3333%' as const, paddingHorizontal: space.xs };
const CELL2 = { width: '50%' as const, paddingHorizontal: space.xs };

function AddTile({ label, onPress, cell, wide }: { label: string; onPress(): void; cell: ViewStyle; wide?: boolean }) {
  const p = usePalette();
  return (
    <View style={cell}>
      <Tap label={label} onPress={onPress}>
        {wide ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 68, padding: space.sm, borderRadius: radii.lg, borderWidth: 1, borderStyle: 'dashed', borderColor: p.textSecondary + '55' }}>
            <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: p.glassFill }}>
              <Glyph name="plus" color={p.accent} size={iconSize.md} />
            </View>
            <Text numberOfLines={2} style={[type.footnote, { flex: 1, color: p.textSecondary }]}>{label}</Text>
          </View>
        ) : (
          <View style={{ alignItems: 'center', gap: space.xs }}>
            <View style={{ width: iconSize.badge, height: iconSize.badge, borderRadius: iconSize.badge / 2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: p.textSecondary + '55' }}>
              <Glyph name="plus" color={p.accent} size={iconSize.md} />
            </View>
            <Text numberOfLines={2} style={[type.caption, { color: p.textSecondary, maxWidth: '100%', textAlign: 'center', minHeight: HIT - 18 }]}>{label}</Text>
          </View>
        )}
      </Tap>
    </View>
  );
}

function WalletTile({ wallet, onActions }: { wallet: Wallet; onActions(): void }) {
  const p = usePalette();
  const openOp = useUi((s) => s.openOp);
  const accepts = (pl: DragPayload) => (pl.kind === 'wallet' && pl.id !== wallet.id) || pl.kind === 'source';
  const onDrop = (pl: DragPayload) => {
    // wallet -> wallet = transfer form; source -> wallet = income form. No money moves until confirmation.
    if (pl.kind === 'wallet') openOp({ kind: 'transfer', walletId: pl.id, toWalletId: wallet.id });
    else openOp({ kind: 'income', walletId: wallet.id, sourceId: pl.id });
  };
  return (
    <View style={CELL2}>
      <DropZone id={`wallet:${wallet.id}`} accepts={accepts} onDrop={onDrop}>
        {({ active, rejected, valid }) => (
          <Draggable payload={{ kind: 'wallet', id: wallet.id }} onTap={onActions}
            ghost={<View style={{ alignItems: 'center' }}><CircleBadge name={wallet.icon} color={wallet.color} size={62} ring={p.accent} /></View>}>
            <View
              accessible
              accessibilityLabel={`${wallet.name} ${fmtMoney(wallet.balance, wallet.currency)}`}
              accessibilityActions={[{ name: 'activate', label: 'Actions' }]}
              onAccessibilityAction={onActions}
            >
              <Tile wide name={wallet.name} icon={wallet.icon} color={wallet.color} grow={active}
                ring={active ? p.accent : rejected ? Ink.expense : valid ? `${p.accent}99` : undefined}
                amounts={[{ currency: wallet.currency, total: wallet.balance }]} amountColor={p.text} />
            </View>
          </Draggable>
        )}
      </DropZone>
    </View>
  );
}

function CategoryTile({ category, amounts }: { category: Category; amounts?: Amounts }) {
  const p = usePalette();
  const openOp = useUi((s) => s.openOp);
  return (
    <View style={CELL3}>
      <DropZone
        id={`cat:${category.id}`}
        accepts={(pl) => pl.kind === 'wallet'}
        onDrop={(pl) => openOp({ kind: 'expense', walletId: pl.id, categoryId: category.id })}
      >
        {({ active, rejected, valid }) => (
          <Tap label={category.name} onPress={() => openOp({ kind: 'expense', categoryId: category.id })}>
            <Tile name={category.name} icon={category.icon} color={category.color} amounts={amounts} amountColor={p.text} grow={active}
              ring={active ? p.accent : rejected ? Ink.expense : valid ? `${p.accent}99` : undefined} />
          </Tap>
        )}
      </DropZone>
    </View>
  );
}

function SourceTile({ source, amounts }: { source: IncomeSource; amounts?: Amounts }) {
  const p = usePalette();
  const openOp = useUi((s) => s.openOp);
  return (
    <View style={CELL4}>
      <Draggable payload={{ kind: 'source', id: source.id }} onTap={() => openOp({ kind: 'income', sourceId: source.id })}
        ghost={<View style={{ alignItems: 'center' }}><CircleBadge name={source.icon} color={source.color} size={62} ring={p.accent} /></View>}>
        <Tile name={source.name} icon={source.icon} color={source.color} amounts={amounts} amountColor={p.text} />
      </Draggable>
    </View>
  );
}

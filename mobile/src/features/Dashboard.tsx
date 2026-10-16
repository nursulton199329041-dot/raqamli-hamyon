import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { ApiError } from '@/api/client';
import type { BreakdownRow, Category, IncomeSource, Wallet } from '@/api/types';
import { Chip, Wrap } from '@/design/Controls';
import { GlassCard, Tap } from '@/design/Glass';
import { Glyph, IconBadge } from '@/design/Icon';
import { Sheet } from '@/design/Sheet';
import { Ink, usePalette, useT } from '@/design/theme';
import { DropZone, Draggable, useDrag, type DragPayload } from '@/dnd/DragDrop';
import { fmtMoney } from '@/lib/money';
import { useBreakdown, useBudgets, useCatalog, useSnapshot, type Period } from '@/state/data';
import { useQueue } from '@/state/queue';
import { api } from '@/state/runtime';
import { useSession } from '@/state/session';
import { useUi, type OpKind } from '@/state/ui';
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

function AmountText({ items, color }: { items?: Amounts; color: string }) {
  const p = usePalette();
  if (!items || items.length === 0) {
    return <Text numberOfLines={1} style={{ color: p.textSecondary, fontSize: 11 }}>0</Text>;
  }
  return (
    <>
      {items.map((x) => (
        <Text key={x.currency} adjustsFontSizeToFit minimumFontScale={0.7} numberOfLines={1}
          style={{ color, fontSize: 11, fontWeight: '800' }}>
          {fmtMoney(x.total, x.currency)}
        </Text>
      ))}
    </>
  );
}

export function Dashboard() {
  const t = useT();
  const p = usePalette();
  const router = useRouter();
  const qc = useQueryClient();
  const cat = useCatalog();
  const snap = useSnapshot();
  const user = useSession((s) => s.user);
  const [period, setPeriod] = useState<Period>('month');
  const budgets = useBudgets();
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
    offset.current = e.nativeEvent.contentOffset.y;
  };

  const byCurrency = new Map<string, number>();
  for (const w of cat.activeWallets) byCurrency.set(w.currency, (byCurrency.get(w.currency) ?? 0) + w.balance);

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
          contentContainerStyle={{ padding: 14, paddingBottom: 96, gap: 10 }}
          refreshControl={<RefreshControl refreshing={snap.isFetching} onRefresh={() => void snap.refetch()} tintColor={p.accent} />}
        >
          <UpdateBanner />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: `${p.accent}4D`, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: p.text, fontWeight: '800', fontSize: 16 }}>{(user?.displayName ?? '?').slice(0, 1).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ color: p.text, fontWeight: '800', fontSize: 15 }}>{user?.displayName}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: statusColor }} />
                <Text numberOfLines={1} style={{ color: p.textSecondary, fontSize: 11 }}>{status}</Text>
              </View>
            </View>
            <Tap label={t('settings')} onPress={() => router.push('/settings')}><Glyph name="settings" color={p.textSecondary} size={24} /></Tap>
          </View>

          <View style={{ flexDirection: 'row', gap: 6 }}>
            {(['week', 'month', 'year', 'all'] as Period[]).map((x) => (
              <Chip key={x} label={t(x)} selected={period === x} onPress={() => setPeriod(x)} />
            ))}
          </View>

          {/* 1. INCOME SOURCES */}
          <SectionTitle title={t('income_sources')} onAdd={() => openForm('source')} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} scrollEnabled={!dragging} contentContainerStyle={{ gap: 8 }}>
            {cat.sources.map((s) => <SourceTile key={s.id} source={s} amounts={incomeBy.get(s.id)} />)}
            <AddTile label={t('new_source')} onPress={() => openForm('source')} width={84} />
          </ScrollView>

          {/* 2. WALLETS */}
          <SectionTitle title={t('wallets')} onAdd={() => openForm('wallet')} />
          {cat.loaded && cat.activeWallets.length === 0 && (
            <GlassCard padding={14}>
              <Text style={{ color: p.textSecondary }}>{t('empty_wallets')}</Text>
              <View style={{ marginTop: 8 }}>
                <Chip label={t('new_wallet')} selected color={p.accent} onPress={() => openForm('wallet')} />
              </View>
            </GlassCard>
          )}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {cat.activeWallets.map((w) => (
              <View key={w.id} style={{ width: '48.5%' }}>
                <WalletTile wallet={w} onActions={() => { setActionError(null); setActionsFor(w); }} />
              </View>
            ))}
            {cat.activeWallets.length > 0 && (
              <View style={{ width: '48.5%' }}><AddTile label={t('new_wallet')} onPress={() => openForm('wallet')} wide /></View>
            )}
          </View>
          {byCurrency.size > 0 && (
            <Text numberOfLines={2} style={{ color: p.textSecondary, fontSize: 12 }}>
              {t('balance')}: {[...byCurrency.entries()].map(([c, b]) => fmtMoney(b, c)).join(' · ')}
            </Text>
          )}

          {/* 3. EXPENSE CATEGORIES */}
          <SectionTitle title={t('expense_categories')} onAdd={() => openForm('category')} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {cat.categories.map((c) => (
              <View key={c.id} style={{ width: '31.8%' }}>
                <CategoryTile category={c} amounts={expenseBy.get(c.id)} />
              </View>
            ))}
            <View style={{ width: '31.8%' }}><AddTile label={t('new_category')} onPress={() => openForm('category')} /></View>
          </View>

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

function AddTile({ label, onPress, width, wide }: { label: string; onPress(): void; width?: number; wide?: boolean }) {
  const p = usePalette();
  return (
    <Tap label={label} onPress={onPress}>
      <View style={{
        width, minHeight: wide ? 48 : 74, borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: `${p.accent}88`,
        alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 6,
      }}>
        <Glyph name="plus" color={p.accent} size={20} />
        <Text numberOfLines={1} style={{ color: p.accent, fontSize: 10, fontWeight: '700' }}>{label}</Text>
      </View>
    </Tap>
  );
}

function SectionTitle({ title, onAdd }: { title: string; onAdd(): void }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
      <Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: '800' }}>{title}</Text>
      <Tap label={title} onPress={onAdd}><Glyph name="plus" color={p.accent} size={22} /></Tap>
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
  const body = (
    <GlassCard tint={wallet.color} padding={8} radius={16}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <IconBadge name={wallet.icon} color={wallet.color} size={30} />
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ color: p.text, fontWeight: '700', fontSize: 12 }}>{wallet.name}</Text>
          <Text adjustsFontSizeToFit minimumFontScale={0.7} numberOfLines={1}
            style={{ color: wallet.balance < 0 ? Ink.expense : p.text, fontWeight: '800', fontSize: 13 }}>
            {fmtMoney(wallet.balance, wallet.currency)}
          </Text>
        </View>
      </View>
    </GlassCard>
  );
  return (
    <DropZone id={`wallet:${wallet.id}`} accepts={accepts} onDrop={onDrop}>
      {({ active, rejected, valid }) => (
        <Draggable payload={{ kind: 'wallet', id: wallet.id }} onTap={onActions}
          ghost={<GlassCard tint={wallet.color} padding={10}><Text style={{ color: p.text, fontWeight: '800' }}>{wallet.name}</Text></GlassCard>}>
          <View
            accessible
            accessibilityLabel={`${wallet.name} ${fmtMoney(wallet.balance, wallet.currency)}`}
            accessibilityActions={[{ name: 'activate', label: 'Actions' }]}
            onAccessibilityAction={onActions}
            style={{
              borderRadius: 18, borderWidth: 2,
              borderColor: active ? p.accent : rejected ? Ink.expense : valid ? `${p.accent}66` : 'transparent',
              transform: [{ scale: active ? 1.03 : 1 }],
            }}
          >
            {body}
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
    <DropZone
      id={`cat:${category.id}`}
      accepts={(pl) => pl.kind === 'wallet'}
      onDrop={(pl) => openOp({ kind: 'expense', walletId: pl.id, categoryId: category.id })}
    >
      {({ active, rejected, valid }) => (
        <Tap label={category.name} onPress={() => openOp({ kind: 'expense', categoryId: category.id })}>
          <View style={{
            borderRadius: 18, borderWidth: 2,
            borderColor: active ? p.accent : rejected ? Ink.expense : valid ? `${p.accent}66` : 'transparent',
            transform: [{ scale: active ? 1.04 : 1 }],
          }}>
            <GlassCard tint={category.color} radius={16} padding={6} style={{ alignItems: 'center' }}>
              <View style={{ alignItems: 'center', gap: 2, width: '100%' }}>
                <IconBadge name={category.icon} color={category.color} size={30} />
                <Text numberOfLines={1} style={{ color: p.text, fontSize: 11, fontWeight: '600' }}>{category.name}</Text>
                <AmountText items={amounts} color={Ink.expense} />
              </View>
            </GlassCard>
          </View>
        </Tap>
      )}
    </DropZone>
  );
}

function SourceTile({ source, amounts }: { source: IncomeSource; amounts?: Amounts }) {
  const p = usePalette();
  const openOp = useUi((s) => s.openOp);
  const tile = (
    <GlassCard tint={source.color} radius={16} padding={6} style={{ width: 92, alignItems: 'center' }}>
      <View style={{ alignItems: 'center', gap: 2, width: '100%' }}>
        <IconBadge name={source.icon} color={source.color} size={30} />
        <Text numberOfLines={1} style={{ color: p.text, fontSize: 11, fontWeight: '600' }}>{source.name}</Text>
        <AmountText items={amounts} color={Ink.income} />
      </View>
    </GlassCard>
  );
  return (
    <Draggable payload={{ kind: 'source', id: source.id }} onTap={() => openOp({ kind: 'income', sourceId: source.id })} ghost={tile}>
      {tile}
    </Draggable>
  );
}

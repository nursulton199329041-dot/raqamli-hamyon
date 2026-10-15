import { useRouter } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import type { Category, IncomeSource, Wallet } from '@/api/types';
import { Chip, Wrap } from '@/design/Controls';
import { GlassCard, Tap } from '@/design/Glass';
import { Glyph, IconBadge } from '@/design/Icon';
import { Sheet } from '@/design/Sheet';
import { Ink, usePalette, useT } from '@/design/theme';
import { DropZone, Draggable, useDrag, type DragPayload } from '@/dnd/DragDrop';
import { fmtMoney } from '@/lib/money';
import { useBudgets, useCatalog, useSnapshot, useSummary, type Period } from '@/state/data';
import { useQueue } from '@/state/queue';
import { useSession } from '@/state/session';
import { useUi, type OpKind } from '@/state/ui';
import { UpdateBanner } from './UpdateBanner';

export function Dashboard() {
  const t = useT();
  const p = usePalette();
  const router = useRouter();
  const cat = useCatalog();
  const snap = useSnapshot();
  const user = useSession((s) => s.user);
  const [period, setPeriod] = useState<Period>('month');
  const summary = useSummary(period);
  const budgets = useBudgets();
  const { dragging } = useDrag();
  const openOp = useUi((s) => s.openOp);
  const openForm = useUi((s) => s.openForm);
  const queue = useQueue();
  const [actionsFor, setActionsFor] = useState<Wallet | null>(null);

  const byCurrency = new Map<string, number>();
  for (const w of cat.activeWallets) byCurrency.set(w.currency, (byCurrency.get(w.currency) ?? 0) + w.balance);
  const totals = new Map((summary.data?.totals ?? []).map((x) => [x.currency, x]));
  const debts = new Map((summary.data?.debts ?? []).map((x) => [x.currency, x]));

  const status = !queue.online ? t('offline') : queue.syncing ? t('syncing')
    : queue.pending.length > 0 ? t('sync_pending', { n: queue.pending.length }) : t('synced');
  const statusColor = !queue.online || queue.pending.length > 0 ? Ink.debt : Ink.income;

  const quick: { kind: OpKind; label: string; icon: string; color: string }[] = [
    { kind: 'income', label: t('income'), icon: 'arrowIn', color: Ink.income },
    { kind: 'expense', label: t('expense'), icon: 'arrowOut', color: Ink.expense },
    { kind: 'transfer', label: t('transfer'), icon: 'swap', color: Ink.transfer },
    { kind: 'debt', label: t('debt'), icon: 'handshake', color: Ink.debt },
  ];

  return (
    <>
      <ScrollView
        scrollEnabled={!dragging}
        contentContainerStyle={{ padding: 16, paddingBottom: 140, gap: 14 }}
        refreshControl={<RefreshControl refreshing={snap.isFetching} onRefresh={() => void snap.refetch()} tintColor={p.accent} />}
      >
        <UpdateBanner />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: `${p.accent}4D`, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: p.text, fontWeight: '800', fontSize: 18 }}>{(user?.displayName ?? '?').slice(0, 1).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ color: p.text, fontWeight: '800', fontSize: 17 }}>{user?.displayName}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: statusColor }} />
              <Text numberOfLines={1} style={{ color: p.textSecondary, fontSize: 12 }}>{status}</Text>
            </View>
          </View>
          <Tap label={t('settings')} onPress={() => router.push('/settings')}><Glyph name="settings" color={p.textSecondary} size={26} /></Tap>
        </View>

        <View style={{ flexDirection: 'row', gap: 6 }}>
          {(['week', 'month', 'year', 'all'] as Period[]).map((x) => (
            <Chip key={x} label={t(x)} selected={period === x} onPress={() => setPeriod(x)} />
          ))}
        </View>

        <GlassCard radius={28} padding={20}>
          <Text style={{ color: p.textSecondary, fontWeight: '600' }}>{t('balance')}</Text>
          {byCurrency.size === 0 && <Text style={{ color: p.text, fontSize: 34, fontWeight: '800' }}>0</Text>}
          {[...byCurrency.entries()].map(([cur, bal]) => (
            <View key={cur} style={{ marginTop: 6 }}>
              <Text adjustsFontSizeToFit numberOfLines={1} style={{ color: p.text, fontSize: 34, fontWeight: '800' }}>{fmtMoney(bal, cur)}</Text>
              <View style={{ flexDirection: 'row', marginTop: 8 }}>
                <Stat label={t('income')} value={fmtMoney(totals.get(cur)?.income ?? 0, undefined, true)} color={Ink.income} />
                <Stat label={t('expense')} value={fmtMoney(totals.get(cur)?.expense ?? 0, undefined, true)} color={Ink.expense} />
                <Stat label={t('i_owe')} value={fmtMoney(debts.get(cur)?.iOwe ?? 0, undefined, true)} color={Ink.debt} />
              </View>
            </View>
          ))}
        </GlassCard>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          {quick.map((q) => (
            <Tap key={q.kind} label={q.label} style={{ flex: 1 }} onPress={() => openOp({ kind: q.kind })}>
              <GlassCard radius={20} tint={q.color} padding={12} style={{ alignItems: 'center' }}>
                <View style={{ alignItems: 'center', gap: 4 }}>
                  <Glyph name={q.icon} color={q.color} size={24} />
                  <Text numberOfLines={1} style={{ color: p.text, fontWeight: '700', fontSize: 12 }}>{q.label}</Text>
                </View>
              </GlassCard>
            </Tap>
          ))}
        </View>

        <SectionTitle title={t('income_sources')} onAdd={() => openForm('source')} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} scrollEnabled={!dragging} contentContainerStyle={{ gap: 10 }}>
          {cat.sources.map((s) => <SourceTile key={s.id} source={s} />)}
        </ScrollView>

        <SectionTitle title={t('wallets')} onAdd={() => openForm('wallet')} />
        {cat.loaded && cat.activeWallets.length === 0 && (
          <GlassCard><Text style={{ color: p.textSecondary }}>{t('empty_wallets')}</Text></GlassCard>
        )}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {cat.activeWallets.map((w) => (
            <View key={w.id} style={{ width: '48%', flexGrow: 1 }}>
              <WalletTile wallet={w} onActions={() => setActionsFor(w)} />
            </View>
          ))}
        </View>

        <SectionTitle title={t('expense_categories')} onAdd={() => openForm('category')} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {cat.categories.map((c) => (
            <View key={c.id} style={{ width: '31%', flexGrow: 1 }}>
              <CategoryTile category={c} />
            </View>
          ))}
        </View>

        {(budgets.data ?? []).filter((b) => b.exceeded || b.percent >= 80).map((b) => (
          <GlassCard key={b.categoryId} tint={b.exceeded ? Ink.expense : Ink.debt}>
            <Text style={{ color: p.text, fontWeight: '700' }}>{b.name}: {b.percent.toFixed(0)}% — {fmtMoney(b.spent, b.currency)} / {fmtMoney(b.limit, b.currency)}</Text>
          </GlassCard>
        ))}

        <Text style={{ color: p.textSecondary, fontSize: 12, textAlign: 'center' }}>{t('drag_hint')}</Text>
      </ScrollView>

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
          </View>
        )}
      </Sheet>
    </>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  const p = usePalette();
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: p.textSecondary, fontSize: 11 }}>{label}</Text>
      <Text numberOfLines={1} style={{ color, fontWeight: '800' }}>{value}</Text>
    </View>
  );
}

function SectionTitle({ title, onAdd }: { title: string; onAdd(): void }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
      <Text accessibilityRole="header" style={{ color: p.text, fontSize: 17, fontWeight: '800' }}>{title}</Text>
      <Tap label={title} onPress={onAdd}><Glyph name="plus" color={p.accent} size={26} /></Tap>
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
    <GlassCard tint={wallet.color} padding={14} radius={22}>
      <IconBadge name={wallet.icon} color={wallet.color} size={40} />
      <Text numberOfLines={1} style={{ color: p.text, fontWeight: '700', marginTop: 10 }}>{wallet.name}</Text>
      <Text adjustsFontSizeToFit numberOfLines={1} style={{ color: wallet.balance < 0 ? Ink.expense : p.text, fontWeight: '800', fontSize: 16 }}>
        {fmtMoney(wallet.balance, wallet.currency)}
      </Text>
    </GlassCard>
  );
  return (
    <DropZone id={`wallet:${wallet.id}`} accepts={accepts} onDrop={onDrop}>
      {({ active, rejected, valid }) => (
        <Draggable payload={{ kind: 'wallet', id: wallet.id }} onTap={onActions}
          ghost={<GlassCard tint={wallet.color} padding={12}><Text style={{ color: p.text, fontWeight: '800' }}>{wallet.name}</Text></GlassCard>}>
          <View
            accessible
            accessibilityLabel={`${wallet.name} ${fmtMoney(wallet.balance, wallet.currency)}`}
            accessibilityActions={[{ name: 'activate', label: 'Actions' }]}
            onAccessibilityAction={onActions}
            style={{
              borderRadius: 22, borderWidth: 2,
              borderColor: active ? p.accent : rejected ? Ink.expense : valid ? `${p.accent}66` : 'transparent',
              transform: [{ scale: active ? 1.04 : 1 }],
            }}
          >
            {body}
          </View>
        </Draggable>
      )}
    </DropZone>
  );
}

function CategoryTile({ category }: { category: Category }) {
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
            borderRadius: 20, borderWidth: 2,
            borderColor: active ? p.accent : rejected ? Ink.expense : valid ? `${p.accent}66` : 'transparent',
            transform: [{ scale: active ? 1.05 : 1 }],
          }}>
            <GlassCard tint={category.color} radius={18} padding={10} style={{ alignItems: 'center' }}>
              <View style={{ alignItems: 'center', gap: 6 }}>
                <IconBadge name={category.icon} color={category.color} size={38} />
                <Text numberOfLines={2} style={{ color: p.text, fontSize: 12, fontWeight: '600', textAlign: 'center' }}>{category.name}</Text>
              </View>
            </GlassCard>
          </View>
        </Tap>
      )}
    </DropZone>
  );
}

function SourceTile({ source }: { source: IncomeSource }) {
  const p = usePalette();
  const openOp = useUi((s) => s.openOp);
  const tile = (
    <GlassCard tint={source.color} radius={20} padding={10} style={{ width: 96, alignItems: 'center' }}>
      <View style={{ alignItems: 'center', gap: 6 }}>
        <IconBadge name={source.icon} color={source.color} size={36} />
        <Text numberOfLines={1} style={{ color: p.text, fontSize: 12, fontWeight: '600' }}>{source.name}</Text>
      </View>
    </GlassCard>
  );
  return (
    <Draggable payload={{ kind: 'source', id: source.id }} onTap={() => openOp({ kind: 'income', sourceId: source.id })} ghost={tile}>
      {tile}
    </Draggable>
  );
}

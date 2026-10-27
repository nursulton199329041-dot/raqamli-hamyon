import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Text, TextInput, View } from 'react-native';
import { ApiError } from '@/api/client';
import { TxType, type Tx, type TxTypeValue } from '@/api/types';
import { Button, Chip, Label, Wrap } from '@/design/Controls';
import { GlassCard, Tap } from '@/design/Glass';
import { CircleBadge, Glyph } from '@/design/Icon';
import { Sheet } from '@/design/Sheet';
import { useScreenLayout } from '@/design/layout';
import { Ink, usePalette, useT } from '@/design/theme';
import { dayKey, fmtDateTime, fmtMoney } from '@/lib/money';
import { addMonths, longDay, monthName, monthRange } from '@/lib/dates';
import { useCatalog, useSummaryRange, useTransactions } from '@/state/data';
import { useQueue } from '@/state/queue';
import { api } from '@/state/runtime';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';

function txColor(t: TxTypeValue): string {
  switch (t) {
    case TxType.Income: case TxType.Opening: case TxType.Adjustment: return Ink.income;
    case TxType.Expense: return Ink.expense;
    case TxType.Transfer: return Ink.transfer;
    case TxType.Reversal: return '#94A3B8';
    default: return Ink.debt;
  }
}

/** +1 inflow, -1 outflow, 0 neutral (transfers move money between own wallets). */
function flowSign(ty: TxTypeValue): number {
  switch (ty) {
    case TxType.Income: case TxType.DebtBorrow: case TxType.DebtCollection: case TxType.Opening: return 1;
    case TxType.Expense: case TxType.DebtLend: case TxType.DebtRepayment: return -1;
    default: return 0;
  }
}

const isLive = (tx: Tx) => !tx.reversedById && tx.type !== TxType.Reversal;

export function History() {
  const t = useT();
  const p = usePalette();
  const L = useScreenLayout();
  const lang = useSettings((s) => s.lang);
  const cat = useCatalog();
  const user = useSession((s) => s.user);
  const pending = useQueue((s) => s.pending);
  const dismiss = useQueue((s) => s.dismiss);
  const openOp = useUi((s) => s.openOp);
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');
  const [type, setType] = useState<number | undefined>();
  const [walletId, setWalletId] = useState<string | undefined>();
  const [filterOpen, setFilterOpen] = useState(false);
  const [detail, setDetail] = useState<Tx | null>(null);
  const [anchor, setAnchor] = useState(() => new Date());
  const range = useMemo(() => monthRange(anchor), [anchor]);
  const list = useTransactions({ q: applied || undefined, type, walletId, from: range.from, to: range.to });
  const summary = useSummaryRange(range.from, range.to);

  const label = (ty: TxTypeValue) => ({
    [TxType.Income]: t('income'), [TxType.Expense]: t('expense'), [TxType.Transfer]: t('transfer'),
    [TxType.DebtBorrow]: t('borrowed'), [TxType.DebtLend]: t('lent'), [TxType.DebtRepayment]: t('repay'),
    [TxType.DebtCollection]: t('repay'), [TxType.Opening]: t('initial_balance'), [TxType.Adjustment]: t('adjust'),
    [TxType.Reversal]: t('reversed'),
  } as Record<number, string>)[ty] ?? '';

  const rows = useMemo(() => {
    const out: ({ kind: 'h'; key: string; iso: string; total: string } | { kind: 't'; key: string; tx: Tx })[] = [];
    const items = list.data ?? [];
    const dayTotals = new Map<string, Map<string, number>>();
    for (const tx of items) {
      if (!isLive(tx)) continue;
      const k = dayKey(tx.occurredAt);
      const m = dayTotals.get(k) ?? new Map<string, number>();
      // opening balances are not "money that came in today": keep them out of the day total (like the header totals)
      const sign = tx.type === TxType.Opening ? 0 : flowSign(tx.type);
      m.set(tx.currency, (m.get(tx.currency) ?? 0) + sign * tx.amount);
      dayTotals.set(k, m);
    }
    let last = '';
    for (const tx of items) {
      const k = dayKey(tx.occurredAt);
      if (k !== last) {
        last = k;
        const m = dayTotals.get(k);
        const total = m && m.size > 0 ? [...m].map(([c, v]) => fmtMoney(v, c)).join(' · ') : fmtMoney(0, user?.defaultCurrency ?? 'UZS');
        out.push({ kind: 'h', key: `h${k}`, iso: tx.occurredAt, total });
      }
      out.push({ kind: 't', key: tx.id, tx });
    }
    return out;
  }, [list.data, user?.defaultCurrency]);

  const types: [number | undefined, string][] = [
    [undefined, t('all')], [TxType.Income, t('income')], [TxType.Expense, t('expense')], [TxType.Transfer, t('transfer')],
    [TxType.DebtBorrow, t('borrowed')], [TxType.DebtLend, t('lent')],
  ];

  const totals = summary.data?.totals ?? [];
  const main = totals.find((x) => x.currency === (user?.defaultCurrency ?? 'UZS')) ?? totals[0];
  const money = (v: number | undefined, c: string) => fmtMoney(v ?? 0, c);

  const open = (tx: Tx) => {
    const kind = tx.type === TxType.Income ? 'income' : tx.type === TxType.Expense ? 'expense' : tx.type === TxType.Transfer ? 'transfer' : null;
    if (kind && !tx.reversedById) openOp({ kind, edit: tx });
    else setDetail(tx);
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
          <Text accessibilityRole="header" style={{ color: p.text, fontSize: 17, fontWeight: '700' }}>{t('history')}</Text>
          <View style={{ position: 'absolute', right: 0 }}>
            <Tap testID="filter-button" label={t('filter')} onPress={() => setFilterOpen(true)}
              style={{ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: p.glassFill, borderWidth: 1, borderColor: p.glassBorder }}>
              <Glyph name="filter" color={type !== undefined || walletId ? p.accent : p.text} size={20} />
            </Tap>
          </View>
        </View>
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 18, paddingHorizontal: 12, marginTop: 10,
          backgroundColor: p.glassFill, borderWidth: 1, borderColor: p.glassBorder,
        }}>
          <Glyph name="search" color={p.textSecondary} size={20} />
          <TextInput
            value={q} onChangeText={setQ} onSubmitEditing={() => setApplied(q.trim())} returnKeyType="search"
            placeholder={t('search')} placeholderTextColor={p.textSecondary} accessibilityLabel={t('search')}
            style={{ flex: 1, color: p.text, paddingVertical: 11, fontSize: 16 }}
          />
        </View>
      </View>

      <FlatList
        testID="history-list"
        data={rows}
        keyExtractor={(r) => r.key}
        contentContainerStyle={{ paddingBottom: L.bottomSpace + 64 }}
        onRefresh={() => void list.refetch()}
        refreshing={list.isRefetching}
        ListHeaderComponent={
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 14 }}>
              <Tap testID="prev-period" label="‹" onPress={() => setAnchor((a) => addMonths(a, -1))} style={{ padding: 8 }}><Glyph name="chevronLeft" color={p.accent} size={22} /></Tap>
              <Text testID="period-label" style={{ color: p.text, fontSize: 16, fontWeight: '600' }}>{monthName(lang, anchor.getMonth())} {anchor.getFullYear()}</Text>
              <Tap testID="next-period" label="›" onPress={() => setAnchor((a) => addMonths(a, 1))} style={{ padding: 8 }}><Glyph name="chevronRight" color={p.accent} size={22} /></Tap>
            </View>
            <View style={{ alignItems: 'center', paddingVertical: 10 }}>
              <Text style={{ color: p.textSecondary, fontSize: 12 }}>{t('saldo')}</Text>
              <Text testID="saldo" adjustsFontSizeToFit minimumFontScale={0.5} numberOfLines={1}
                style={{ color: p.text, fontSize: 40, fontWeight: '800', paddingHorizontal: 16 }}>
                {main ? money(main.netFlow, main.currency) : money(0, user?.defaultCurrency ?? 'UZS')}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16 }}>
              <GlassCard radius={18} padding={12} style={{ flex: 1 }}>
                <Text style={{ color: p.textSecondary, fontSize: 12 }}>{t('inflow')}</Text>
                <Text testID="inflow" adjustsFontSizeToFit minimumFontScale={0.6} numberOfLines={1} style={{ color: Ink.income, fontSize: 18, fontWeight: '800' }}>
                  {main ? money(main.income, main.currency) : money(0, user?.defaultCurrency ?? 'UZS')}
                </Text>
              </GlassCard>
              <GlassCard radius={18} padding={12} style={{ flex: 1 }}>
                <Text style={{ color: p.textSecondary, fontSize: 12 }}>{t('outflow')}</Text>
                <Text testID="outflow" adjustsFontSizeToFit minimumFontScale={0.6} numberOfLines={1} style={{ color: Ink.expense, fontSize: 18, fontWeight: '800' }}>
                  {main ? money(main.expense, main.currency) : money(0, user?.defaultCurrency ?? 'UZS')}
                </Text>
              </GlassCard>
            </View>
            {totals.filter((x) => x !== main).map((x) => (
              <Text key={x.currency} style={{ color: p.textSecondary, fontSize: 12, paddingHorizontal: 18, paddingTop: 4 }}>
                {x.currency}: +{money(x.income, x.currency)} / −{money(x.expense, x.currency)}
              </Text>
            ))}
            {pending.map((op) => (
              <View key={op.clientOperationId} style={{ paddingHorizontal: 16, paddingTop: 10 }}>
                <GlassCard tint={Ink.debt} padding={12}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Glyph name="clock" color={Ink.debt} size={22} />
                    <Text style={{ flex: 1, color: op.error ? Ink.expense : p.text }}>
                      {t('pending')}: {op.kind} · {String(op.payload.amount ?? '')}{op.error ? `\n${op.error}` : ''}
                    </Text>
                    {op.error ? <Tap label={t('delete')} onPress={() => void dismiss(op.clientOperationId)}><Glyph name="close" color={p.text} size={20} /></Tap> : null}
                  </View>
                </GlassCard>
              </View>
            ))}
            <Text style={{ color: p.text, fontSize: 17, fontWeight: '800', paddingHorizontal: 16, paddingTop: 18, paddingBottom: 8 }}>{t('ops_list')}</Text>
            {list.isLoading ? <ActivityIndicator style={{ marginTop: 20 }} color={p.accent} /> : null}
          </View>
        }
        ListEmptyComponent={!list.isLoading ? <Text style={{ color: p.textSecondary, textAlign: 'center', marginTop: 40 }}>{t('empty_history')}</Text> : null}
        renderItem={({ item }) => {
          if (item.kind === 'h') {
            return (
              <View testID={`day-${item.key}`} style={{
                flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10,
                backgroundColor: p.glassFill, borderTopWidth: 1, borderTopColor: p.glassBorder,
              }}>
                <Text style={{ color: p.text, fontSize: 14 }}>{longDay(lang, item.iso)}</Text>
                <Text style={{ color: p.text, fontSize: 14, fontWeight: '600' }}>{item.total}</Text>
              </View>
            );
          }
          const tx = item.tx;
          const c = cat.category(tx.categoryId);
          const parent = c?.parentId ? cat.category(c.parentId) : undefined;
          const s = cat.source(tx.incomeSourceId);
          const w = cat.wallet(tx.walletId);
          const to = cat.wallet(tx.toWalletId);
          const title = tx.type === TxType.Transfer ? t('transfer')
            : c ? (parent ? `${parent.name} / ${c.name}` : c.name)
              : (s?.name ?? cat.person(tx.personId)?.name ?? label(tx.type));
          const walletLine = tx.type === TxType.Transfer ? `${w?.name ?? '?'} → ${to?.name ?? '?'}` : (w?.name ?? '');
          const sign = flowSign(tx.type) < 0 ? '−' : flowSign(tx.type) > 0 ? '+' : '';
          const color = txColor(tx.type);
          const struck = tx.reversedById || tx.type === TxType.Reversal ? { textDecorationLine: 'line-through' as const, opacity: 0.55 } : null;
          const icon = c?.icon ?? s?.icon ?? (tx.type === TxType.Transfer ? 'swap' : 'debt');
          return (
            <Tap testID={`tx-${tx.id}`} label={`${title} ${fmtMoney(tx.amount, tx.currency)}`} onPress={() => open(tx)}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 }}>
                <CircleBadge name={icon} color={c?.color ?? s?.color ?? color} size={38} />
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={[{ color: p.text, fontWeight: '700', fontSize: 15 }, struck]}>{title}</Text>
                  <Text numberOfLines={1} style={[{ color: p.textSecondary, fontSize: 13 }, struck]}>{walletLine}</Text>
                  {tx.memo || tx.reversedById ? (
                    <Text numberOfLines={1} style={{ color: p.textSecondary, fontSize: 11, opacity: 0.8 }}>
                      {[tx.memo, tx.reversedById ? t('reversed') : null].filter(Boolean).join(' · ')}
                    </Text>
                  ) : null}
                </View>
                <View style={{ alignItems: 'flex-end', maxWidth: 150 }}>
                  <Text numberOfLines={1} style={[{ color: tx.type === TxType.Transfer ? p.text : color, fontWeight: '700', fontSize: 15 }, struck]}>
                    {sign}{fmtMoney(tx.amount, tx.currency)}
                  </Text>
                  {tx.type === TxType.Transfer && tx.toAmount && tx.toCurrency && tx.toCurrency !== tx.currency ? (
                    <Text numberOfLines={1} style={{ color: p.textSecondary, fontSize: 12 }}>{fmtMoney(tx.toAmount, tx.toCurrency)}</Text>
                  ) : null}
                </View>
              </View>
            </Tap>
          );
        }}
      />

      {/* above the floating tab bar on phones/tablets; the desktop sidebar leaves the bottom free */}
      <View pointerEvents="box-none" style={{ position: 'absolute', right: 18, bottom: L.sidebar ? 24 : 100 }}>
        <Tap testID="fab-add" label={t('expense')} onPress={() => openOp({ kind: 'expense' })}
          style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: p.accent, alignItems: 'center', justifyContent: 'center', elevation: 6 }}>
          <Glyph name="plus" color="#fff" size={28} />
        </Tap>
      </View>

      <Sheet visible={filterOpen} onClose={() => setFilterOpen(false)}>
        <Label>{t('type')}</Label>
        <Wrap>{types.map(([v, l]) => <Chip key={l} label={l} selected={type === v} onPress={() => setType(v)} />)}</Wrap>
        <Label>{t('wallets')}</Label>
        <Wrap>
          <Chip label={t('all')} selected={!walletId} onPress={() => setWalletId(undefined)} />
          {cat.activeWallets.map((w) => (
            <Chip key={w.id} label={w.name} color={w.color} selected={walletId === w.id} onPress={() => setWalletId(walletId === w.id ? undefined : w.id)} />
          ))}
        </Wrap>
        <Button title={t('confirm')} onPress={() => setFilterOpen(false)} />
      </Sheet>
      <DetailSheet tx={detail} onClose={() => setDetail(null)} label={label} />
    </View>
  );
}

/** Read-only details for operations the form cannot edit (debts, reversed entries) with the reversal action. */
function DetailSheet({ tx, onClose, label }: { tx: Tx | null; onClose(): void; label(t: TxTypeValue): string }) {
  const t = useT();
  const p = usePalette();
  const cat = useCatalog();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const rows: [string, string | null | undefined][] = tx ? [
    [t('date'), fmtDateTime(tx.occurredAt)],
    [t('wallet'), cat.wallet(tx.walletId)?.name],
    [t('to_wallet'), cat.wallet(tx.toWalletId)?.name],
    [t('to_amount'), tx.toAmount ? fmtMoney(tx.toAmount, tx.toCurrency ?? undefined) : null],
    [t('category'), cat.category(tx.categoryId)?.name],
    [t('source'), cat.source(tx.incomeSourceId)?.name],
    [t('person'), cat.person(tx.personId)?.name],
    [t('project'), cat.project(tx.projectId)?.name],
    [t('reason'), tx.reason],
    [t('memo'), tx.memo],
  ] : [];

  const canReverse = tx && !tx.reversedById && tx.type !== TxType.Reversal && tx.type !== TxType.Opening;
  return (
    <Sheet visible={tx !== null} onClose={onClose}>
      {tx && (
        <View>
          <Text style={{ color: p.text, fontSize: 20, fontWeight: '800' }}>{label(tx.type)} · {fmtMoney(tx.amount, tx.currency)}</Text>
          <Label>{t('details')}</Label>
          {rows.filter(([, v]) => !!v).map(([k, v]) => (
            <View key={k} style={{ flexDirection: 'row', paddingVertical: 4 }}>
              <Text style={{ width: 120, color: p.textSecondary }}>{k}</Text>
              <Text style={{ flex: 1, color: p.text }}>{v}</Text>
            </View>
          ))}
          {tx.reversedById && <Text style={{ color: Ink.debt, marginTop: 8 }}>{t('reversed')}</Text>}
          {err && <Text style={{ color: Ink.expense, marginTop: 8 }}>{err}</Text>}
          {canReverse && (
            <Button title={t('reverse')} variant="danger" busy={busy} onPress={async () => {
              setBusy(true);
              setErr(null);
              try {
                await api.post(`/api/transactions/${tx.id}/reverse`, {});
                await qc.invalidateQueries();
                onClose();
              } catch (e) {
                setErr(e instanceof ApiError ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }} />
          )}
        </View>
      )}
    </Sheet>
  );
}

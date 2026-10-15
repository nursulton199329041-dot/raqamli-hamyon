import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Text, TextInput, View } from 'react-native';
import { ApiError } from '@/api/client';
import { TxType, type Tx, type TxTypeValue } from '@/api/types';
import { Button, Chip, Label } from '@/design/Controls';
import { GlassCard, Tap } from '@/design/Glass';
import { Glyph, IconBadge } from '@/design/Icon';
import { Sheet } from '@/design/Sheet';
import { Ink, usePalette, useT } from '@/design/theme';
import { dayKey, fmtDate, fmtDateTime, fmtMoney } from '@/lib/money';
import { useCatalog, useTransactions } from '@/state/data';
import { useQueue } from '@/state/queue';
import { api } from '@/state/runtime';

function txColor(t: TxTypeValue): string {
  switch (t) {
    case TxType.Income: case TxType.Opening: case TxType.Adjustment: return Ink.income;
    case TxType.Expense: return Ink.expense;
    case TxType.Transfer: return Ink.transfer;
    case TxType.Reversal: return '#94A3B8';
    default: return Ink.debt;
  }
}

export function History() {
  const t = useT();
  const p = usePalette();
  const cat = useCatalog();
  const pending = useQueue((s) => s.pending);
  const dismiss = useQueue((s) => s.dismiss);
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');
  const [type, setType] = useState<number | undefined>();
  const [walletId, setWalletId] = useState<string | undefined>();
  const [detail, setDetail] = useState<Tx | null>(null);
  const list = useTransactions({ q: applied || undefined, type, walletId });

  const label = (ty: TxTypeValue) => ({
    [TxType.Income]: t('income'), [TxType.Expense]: t('expense'), [TxType.Transfer]: t('transfer'),
    [TxType.DebtBorrow]: t('borrowed'), [TxType.DebtLend]: t('lent'), [TxType.DebtRepayment]: t('repay'),
    [TxType.DebtCollection]: t('repay'), [TxType.Opening]: t('initial_balance'), [TxType.Adjustment]: t('adjust'),
    [TxType.Reversal]: t('reversed'),
  } as Record<number, string>)[ty] ?? '';

  const rows = useMemo(() => {
    const out: ({ kind: 'h'; key: string; title: string } | { kind: 't'; key: string; tx: Tx })[] = [];
    let last = '';
    for (const tx of list.data ?? []) {
      const k = dayKey(tx.occurredAt);
      if (k !== last) { last = k; out.push({ kind: 'h', key: `h${k}`, title: fmtDate(tx.occurredAt) }); }
      out.push({ kind: 't', key: tx.id, tx });
    }
    return out;
  }, [list.data]);

  const types: [number | undefined, string][] = [
    [undefined, t('all')], [TxType.Income, t('income')], [TxType.Expense, t('expense')], [TxType.Transfer, t('transfer')],
    [TxType.DebtBorrow, t('borrowed')], [TxType.DebtLend, t('lent')],
  ];

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 16, paddingHorizontal: 12,
          backgroundColor: p.glassFill, borderWidth: 1, borderColor: p.glassBorder,
        }}>
          <Glyph name="search" color={p.textSecondary} size={20} />
          <TextInput
            value={q} onChangeText={setQ} onSubmitEditing={() => setApplied(q.trim())} returnKeyType="search"
            placeholder={t('search')} placeholderTextColor={p.textSecondary}
            style={{ flex: 1, color: p.text, paddingVertical: 12, fontSize: 16 }}
          />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {types.map(([v, l]) => <Chip key={l} label={l} selected={type === v} onPress={() => setType(v)} />)}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
          {cat.activeWallets.map((w) => (
            <Chip key={w.id} label={w.name} color={w.color} selected={walletId === w.id} onPress={() => setWalletId(walletId === w.id ? undefined : w.id)} />
          ))}
        </View>
      </View>

      {list.isLoading && <ActivityIndicator style={{ marginTop: 20 }} color={p.accent} />}
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        contentContainerStyle={{ padding: 16, paddingBottom: 140, gap: 8 }}
        onRefresh={() => void list.refetch()}
        refreshing={list.isRefetching}
        ListHeaderComponent={
          <View style={{ gap: 8 }}>
            {pending.map((op) => (
              <GlassCard key={op.clientOperationId} tint={Ink.debt} padding={12}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Glyph name="clock" color={Ink.debt} size={22} />
                  <Text style={{ flex: 1, color: op.error ? Ink.expense : p.text }}>
                    {t('pending')}: {op.kind} · {String(op.payload.amount ?? '')}{op.error ? `\n${op.error}` : ''}
                  </Text>
                  {op.error ? <Tap label={t('delete')} onPress={() => void dismiss(op.clientOperationId)}><Glyph name="close" color={p.text} size={20} /></Tap> : null}
                </View>
              </GlassCard>
            ))}
          </View>
        }
        ListEmptyComponent={!list.isLoading ? <Text style={{ color: p.textSecondary, textAlign: 'center', marginTop: 50 }}>{t('empty_history')}</Text> : null}
        renderItem={({ item }) => {
          if (item.kind === 'h') return <Text style={{ color: p.textSecondary, fontWeight: '700', marginTop: 10 }}>{item.title}</Text>;
          const tx = item.tx;
          const c = cat.category(tx.categoryId);
          const s = cat.source(tx.incomeSourceId);
          const w = cat.wallet(tx.walletId);
          const to = cat.wallet(tx.toWalletId);
          const title = tx.type === TxType.Transfer ? `${w?.name ?? '?'} → ${to?.name ?? '?'}`
            : (c?.name ?? s?.name ?? cat.person(tx.personId)?.name ?? label(tx.type));
          const neg = tx.type === TxType.Expense || tx.type === TxType.DebtLend || tx.type === TxType.DebtRepayment;
          const sign = neg ? '−' : tx.type === TxType.Transfer ? '' : '+';
          const color = txColor(tx.type);
          const struck = tx.reversedById ? { textDecorationLine: 'line-through' as const } : null;
          return (
            <Tap label={title} onPress={() => setDetail(tx)}>
              <GlassCard radius={20} padding={12}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <IconBadge name={c?.icon ?? s?.icon ?? (tx.type === TxType.Transfer ? 'wallet' : 'debt')} color={c?.color ?? color} size={42} />
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={[{ color: p.text, fontWeight: '700' }, struck]}>{title}</Text>
                    <Text numberOfLines={1} style={{ color: p.textSecondary, fontSize: 12 }}>
                      {[w?.name, tx.memo, tx.reversedById ? t('reversed') : null].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <Text numberOfLines={1} style={[{ color, fontWeight: '800', maxWidth: 130 }, struck]}>{sign}{fmtMoney(tx.amount, tx.currency)}</Text>
                </View>
              </GlassCard>
            </Tap>
          );
        }}
      />
      <DetailSheet tx={detail} onClose={() => setDetail(null)} label={label} />
    </View>
  );
}

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

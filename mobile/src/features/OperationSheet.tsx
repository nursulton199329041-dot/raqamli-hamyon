import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { ApiError } from '@/api/client';
import type { Wallet } from '@/api/types';
import { fmtDateTime, fmtMoney, parseAmount } from '@/lib/money';
import { Button, Chip, ErrorText, Field, Label, Wrap } from '@/design/Controls';
import { Tap } from '@/design/Glass';
import { Glyph, IconBadge } from '@/design/Icon';
import { Sheet } from '@/design/Sheet';
import { Ink, usePalette, useT } from '@/design/theme';
import { useCatalog } from '@/state/data';
import { useQueue } from '@/state/queue';
import { api } from '@/state/runtime';
import { useUi, type OpKind, type OpPrefill } from '@/state/ui';
import { WalletPicker } from './WalletPicker';

const TABS: { kind: OpKind; key: 'income' | 'expense' | 'transfer' | 'debt'; color: string }[] = [
  { kind: 'income', key: 'income', color: Ink.income },
  { kind: 'expense', key: 'expense', color: Ink.expense },
  { kind: 'transfer', key: 'transfer', color: Ink.transfer },
  { kind: 'debt', key: 'debt', color: Ink.debt },
];

/** Global form. Opened by quick actions, tile taps and drag&drop; nothing is sent before "Tasdiqlash". */
export function OperationSheet() {
  const op = useUi((s) => s.op);
  const nonce = useUi((s) => s.opNonce);
  const close = useUi((s) => s.closeOp);
  // Keep the last form mounted (hidden) while the sheet slides out; every open bumps `nonce` => a fresh form.
  const last = useUi((s) => s.lastOp);
  if (!last) return null;
  return <OperationForm key={nonce} prefill={last} visible={op !== null} onDone={close} />;
}

type Page = 'form' | 'from' | 'to';

/** Tappable summary of the chosen wallet; opens the wallet picker page. */
export function WalletRow({ label, wallet, onPress }: { label: string; wallet?: Wallet; onPress(): void }) {
  const t = useT();
  const p = usePalette();
  return (
    <View>
      <Label>{label}</Label>
      <Tap label={`${label}: ${wallet?.name ?? t('select_wallet')}`} onPress={onPress} style={{
        flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, borderWidth: 1.5,
        borderColor: wallet ? `${wallet.color}AA` : p.glassBorder, backgroundColor: wallet ? `${wallet.color}22` : p.glassFill,
      }}>
        {wallet ? <IconBadge name={wallet.icon} color={wallet.color} size={36} /> : <Glyph name="wallet" color={p.textSecondary} size={28} />}
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ color: p.text, fontWeight: '800', fontSize: 15 }}>{wallet?.name ?? t('select_wallet')}</Text>
          {wallet ? <Text style={{ color: p.textSecondary, fontSize: 12 }}>{wallet.currency} · {fmtMoney(wallet.balance, wallet.currency)}</Text> : null}
        </View>
        <Text style={{ color: p.textSecondary, fontSize: 22 }}>›</Text>
      </Tap>
    </View>
  );
}

function OperationForm({ prefill, visible, onDone }: { prefill: OpPrefill; visible: boolean; onDone(): void }) {
  const t = useT();
  const p = usePalette();
  const cat = useCatalog();
  const submit = useQueue((s) => s.submit);
  const qc = useQueryClient();

  const [kind, setKind] = useState<OpKind>(prefill.kind);
  const [page, setPage] = useState<Page>('form');
  const [pickedWallet, setWalletId] = useState<string | undefined>(prefill.walletId);
  const [toWalletId, setToWalletId] = useState<string | undefined>(prefill.toWalletId);
  const [categoryId, setCategoryId] = useState<string | undefined>(prefill.categoryId);
  const [sourceId, setSourceId] = useState<string | undefined>(prefill.sourceId);
  const [projectId, setProjectId] = useState<string | undefined>(prefill.projectId);
  const [amount, setAmount] = useState('');
  const [toAmount, setToAmount] = useState('');
  const [rate, setRate] = useState('');
  const [memo, setMemo] = useState('');
  const [reason, setReason] = useState('');
  const [person, setPerson] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [borrowed, setBorrowed] = useState(true);
  const [dueDays, setDueDays] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [when] = useState(() => new Date());

  const wallets = cat.activeWallets;
  const walletId = pickedWallet ?? wallets[0]?.id;

  const from = cat.wallet(walletId);
  const to = cat.wallet(toWalletId);
  const cross = kind === 'transfer' && !!from && !!to && from.currency !== to.currency;
  const accent = TABS.find((x) => x.kind === kind)!.color;

  const walletLabel = kind === 'income' ? t('receiving_wallet')
    : kind === 'expense' ? t('pay_from_wallet')
      : kind === 'transfer' ? t('from_wallet')
        : borrowed ? t('receiving_wallet') : t('pay_from_wallet');

  const onSubmit = async () => {
    if (busy) return;
    const value = parseAmount(amount);
    if (value === null) return setError(t('amount_invalid'));
    if (!walletId || !from) return setError(t('select_wallet'));
    const occurredAt = when.toISOString();
    let note = memo.trim();
    let personId: string | null = null;
    setBusy(true);
    setError(null);
    try {
      const who = counterparty.trim();
      if (who && (kind === 'income' || kind === 'expense')) {
        const known = cat.people.find((x) => x.name.toLowerCase() === who.toLowerCase());
        if (known) personId = known.id;
        else {
          try {
            personId = (await api.post<{ id: string }>('/api/people', { name: who })).id;
            void qc.invalidateQueries({ queryKey: ['snapshot'] });
          } catch (e) {
            if (e instanceof ApiError && !e.isNetwork) return setError(e.message);
            // offline: keep the name with the operation instead of losing it
            note = `${kind === 'expense' ? t('payee') : t('payer')}: ${who}${note ? ` — ${note}` : ''}`;
          }
        }
      }
      const base = { memo: note || null, occurredAt, projectId: projectId ?? null };
      let res;
      switch (kind) {
        case 'income':
          res = await submit('income', { walletId, amount: value, incomeSourceId: sourceId ?? null, personId, reason: reason.trim() || null, ...base });
          break;
        case 'expense':
          if (!categoryId) return setError(t('select_category'));
          res = await submit('expense', { walletId, amount: value, categoryId, personId, ...base });
          break;
        case 'transfer':
          if (!toWalletId) return setError(t('select_wallet'));
          if (toWalletId === walletId) return setError(t('same_wallet'));
          res = await submit('transfer', {
            fromWalletId: walletId, toWalletId, amount: value,
            toAmount: parseAmount(toAmount), fxRate: parseAmount(rate), ...base,
          });
          break;
        case 'debt': {
          if (!person.trim()) return setError(t('person'));
          const due = dueDays === null ? null : new Date(Date.now() + dueDays * 86400000).toISOString();
          res = await submit('debt', {
            direction: borrowed ? 0 : 1, personName: person.trim(), walletId, amount: value, dueDate: due,
            reason: reason.trim() || null, ...base,
          });
          break;
        }
      }
      if (!res.ok) {
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return setError(res.message);
      }
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const pickFrom = (id: string) => {
    setWalletId(id);
    if (toWalletId === id) setToWalletId(undefined);
    setError(null);
    setPage('form');
  };
  const pickTo = (id: string) => {
    setToWalletId(id);
    setError(null);
    setPage('form');
  };

  const footer = page === 'form' ? (
    <View>
      <ErrorText>{error}</ErrorText>
      <Button title={t('confirm')} color={accent} busy={busy} onPress={() => void onSubmit()} />
    </View>
  ) : undefined;

  return (
    <Sheet visible={visible} onClose={() => (page === 'form' ? onDone() : setPage('form'))} full footer={footer}>
      {page === 'from' && (
        <WalletPicker title={walletLabel} selectedId={walletId} excludeId={kind === 'transfer' ? toWalletId : undefined}
          onSelect={pickFrom} onBack={() => setPage('form')} />
      )}
      {page === 'to' && (
        <WalletPicker title={t('to_wallet')} selectedId={toWalletId} excludeId={walletId} onSelect={pickTo} onBack={() => setPage('form')} />
      )}
      {page === 'form' && (
        <View>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {TABS.map((x) => {
              const on = x.kind === kind;
              return (
                <View key={x.kind} style={{ flex: 1 }}>
                  <Chip label={t(x.key)} selected={on} color={x.color} onPress={() => setKind(x.kind)} />
                </View>
              );
            })}
          </View>

          <Field
            label={`${t('amount')}${from ? ` (${from.currency})` : ''}`}
            value={amount}
            onChangeText={(v) => { setAmount(v); setError(null); }}
            keyboardType="decimal-pad"
            // Android: the keyboard would cover the form on open; the user taps the field instead.
            autoFocus={Platform.OS !== 'android'}
            style={{ fontSize: 32, fontWeight: '800', textAlign: 'center', color: accent }}
          />
          {from ? (
            <Text style={{ color: p.textSecondary, fontSize: 12, textAlign: 'center', marginTop: 4 }}>
              {t('currency_of_wallet')}: {from.currency}
            </Text>
          ) : null}

          {kind === 'debt' && (
            <>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                <Chip label={t('borrowed')} selected={borrowed} color={Ink.debt} onPress={() => setBorrowed(true)} />
                <Chip label={t('lent')} selected={!borrowed} color={Ink.debt} onPress={() => setBorrowed(false)} />
              </View>
              <Field label={t('person')} value={person} onChangeText={setPerson} />
            </>
          )}

          <WalletRow label={walletLabel} wallet={from} onPress={() => setPage('from')} />

          {kind === 'transfer' && (
            <>
              <WalletRow label={t('to_wallet')} wallet={to} onPress={() => setPage('to')} />
              {cross && from && to && (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Field label={`${t('rate')} (${from.currency}→${to.currency})`} value={rate} onChangeText={setRate} keyboardType="decimal-pad" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field label={`${t('to_amount')} (${to.currency})`} value={toAmount} onChangeText={setToAmount} keyboardType="decimal-pad" />
                  </View>
                </View>
              )}
            </>
          )}

          {kind === 'expense' && (
            <>
              <Label>{t('category')}</Label>
              <Wrap>
                {cat.categories.map((c) => (
                  <Chip key={c.id} label={c.name} icon={c.icon} color={c.color} selected={categoryId === c.id} onPress={() => { setCategoryId(c.id); setError(null); }} />
                ))}
              </Wrap>
            </>
          )}

          {kind === 'income' && (
            <>
              <Label>{t('income_source')}</Label>
              <Wrap>
                {cat.sources.map((c) => (
                  <Chip key={c.id} label={c.name} icon={c.icon} color={c.color} selected={sourceId === c.id} onPress={() => setSourceId(sourceId === c.id ? undefined : c.id)} />
                ))}
              </Wrap>
            </>
          )}

          {(kind === 'income' || kind === 'expense') && (
            <Field label={kind === 'expense' ? t('payee') : t('payer')} value={counterparty} onChangeText={setCounterparty} maxLength={120} />
          )}

          {(kind === 'income' || kind === 'debt') && <Field label={t('reason')} value={reason} onChangeText={setReason} />}

          {cat.projects.length > 0 && (
            <>
              <Label>{t('project')}</Label>
              <Wrap>
                <Chip label="—" selected={!projectId} onPress={() => setProjectId(undefined)} />
                {cat.projects.map((pr) => (
                  <Chip key={pr.id} label={pr.name} icon={pr.icon} color={pr.color} selected={projectId === pr.id} onPress={() => setProjectId(pr.id)} />
                ))}
              </Wrap>
            </>
          )}

          {kind === 'debt' && (
            <>
              <Label>{t('due')}</Label>
              <Wrap>
                {[null, 7, 14, 30, 90].map((d) => (
                  <Chip key={String(d)} label={d === null ? '—' : `${d}`} selected={dueDays === d} onPress={() => setDueDays(d)} />
                ))}
              </Wrap>
            </>
          )}

          <Field label={t('memo')} value={memo} onChangeText={setMemo} maxLength={1000} />
          <Text style={{ color: p.textSecondary, marginTop: 8 }}>{t('date')}: {fmtDateTime(when)}</Text>
        </View>
      )}
    </Sheet>
  );
}

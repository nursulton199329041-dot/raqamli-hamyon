import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { ApiError } from '@/api/client';
import { fmtDateTime, fmtMoney, parseAmount } from '@/lib/money';
import { Button, Chip, ErrorText, Field, Label, Wrap } from '@/design/Controls';
import { Sheet } from '@/design/Sheet';
import { Ink, usePalette, useT } from '@/design/theme';
import { useCatalog } from '@/state/data';
import { useQueue } from '@/state/queue';
import { api } from '@/state/runtime';
import { useUi, type OpKind } from '@/state/ui';

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
  return (
    <Sheet visible={op !== null} onClose={close} full>
      {op ? <OperationForm key={nonce} onDone={close} /> : null}
    </Sheet>
  );
}

function OperationForm({ onDone }: { onDone(): void }) {
  const t = useT();
  const p = usePalette();
  const cat = useCatalog();
  const prefill = useUi((s) => s.op)!;
  const submit = useQueue((s) => s.submit);
  const qc = useQueryClient();

  const [kind, setKind] = useState<OpKind>(prefill.kind);
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
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [when] = useState(() => new Date());

  const wallets = cat.activeWallets;
  const walletId = pickedWallet ?? wallets[0]?.id;

  const from = cat.wallet(walletId);
  const to = cat.wallet(toWalletId);
  const cross = kind === 'transfer' && !!from && !!to && from.currency !== to.currency;
  const accent = TABS.find((x) => x.kind === kind)!.color;

  const onSubmit = async () => {
    const value = parseAmount(amount);
    if (value === null) return setError(`${t('amount')}?`);
    if (!walletId) return setError(t('select_wallet'));
    const occurredAt = when.toISOString();
    let note = memo.trim();
    let personId: string | null = null;
    setBusy(true);
    setError(null);
    const who = counterparty.trim();
    if (who && (kind === 'income' || kind === 'expense')) {
      const known = cat.people.find((x) => x.name.toLowerCase() === who.toLowerCase());
      if (known) personId = known.id;
      else {
        try {
          personId = (await api.post<{ id: string }>('/api/people', { name: who })).id;
          void qc.invalidateQueries({ queryKey: ['snapshot'] });
        } catch (e) {
          if (e instanceof ApiError && !e.isNetwork) { setBusy(false); return setError(e.message); }
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
        if (!categoryId) { setBusy(false); return setError(t('select_category')); }
        res = await submit('expense', { walletId, amount: value, categoryId, personId, ...base });
        break;
      case 'transfer':
        if (!toWalletId) { setBusy(false); return setError(t('to_wallet')); }
        if (toWalletId === walletId) { setBusy(false); return setError(t('same_wallet')); }
        res = await submit('transfer', {
          fromWalletId: walletId, toWalletId, amount: value,
          toAmount: parseAmount(toAmount), fxRate: parseAmount(rate), ...base,
        });
        break;
      case 'debt': {
        if (!person.trim()) { setBusy(false); return setError(t('person')); }
        const due = dueDays === null ? null : new Date(Date.now() + dueDays * 86400000).toISOString();
        res = await submit('debt', {
          direction: borrowed ? 0 : 1, personName: person.trim(), walletId, amount: value, dueDate: due,
          reason: reason.trim() || null, ...base,
        });
        break;
      }
    }
    setBusy(false);
    if (!res.ok) {
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return setError(res.message);
    }
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onDone();
  };

  return (
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
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        autoFocus
        style={{ fontSize: 32, fontWeight: '800', textAlign: 'center', color: accent }}
      />

      {kind === 'debt' && (
        <>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <Chip label={t('borrowed')} selected={borrowed} color={Ink.debt} onPress={() => setBorrowed(true)} />
            <Chip label={t('lent')} selected={!borrowed} color={Ink.debt} onPress={() => setBorrowed(false)} />
          </View>
          <Field label={t('person')} value={person} onChangeText={setPerson} />
        </>
      )}

      <Label>{kind === 'transfer' ? t('from_wallet') : t('wallet')}</Label>
      <Wrap>
        {wallets.map((w) => (
          <Chip key={w.id} label={`${w.name} · ${fmtMoney(w.balance, w.currency, true)}`} icon={w.icon}
            color={w.color} selected={walletId === w.id} onPress={() => setWalletId(w.id)} />
        ))}
      </Wrap>

      {kind === 'transfer' && (
        <>
          <Label>{t('to_wallet')}</Label>
          <Wrap>
            {wallets.filter((w) => w.id !== walletId).map((w) => (
              <Chip key={w.id} label={`${w.name} · ${fmtMoney(w.balance, w.currency, true)}`} icon={w.icon}
                color={w.color} selected={toWalletId === w.id} onPress={() => setToWalletId(w.id)} />
            ))}
          </Wrap>
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
              <Chip key={c.id} label={c.name} icon={c.icon} color={c.color} selected={categoryId === c.id} onPress={() => setCategoryId(c.id)} />
            ))}
          </Wrap>
        </>
      )}

      {kind === 'income' && (
        <>
          <Label>{t('source')}</Label>
          <Wrap>
            {cat.sources.map((c) => (
              <Chip key={c.id} label={c.name} icon={c.icon} color={c.color} selected={sourceId === c.id} onPress={() => setSourceId(c.id)} />
            ))}
          </Wrap>
        </>
      )}

      {(kind === 'income' || kind === 'expense') && (
        <Field label={kind === 'expense' ? t('payee') : t('payer')} value={counterparty} onChangeText={setCounterparty} maxLength={120} />
      )}

      <View style={{ marginTop: 10 }}>
        <Chip label={t('more')} selected={more} onPress={() => setMore((m) => !m)} />
      </View>

      {more && (
        <>
          <Label>{t('project')}</Label>
          <Wrap>
            <Chip label="—" selected={!projectId} onPress={() => setProjectId(undefined)} />
            {cat.projects.map((pr) => (
              <Chip key={pr.id} label={pr.name} icon={pr.icon} color={pr.color} selected={projectId === pr.id} onPress={() => setProjectId(pr.id)} />
            ))}
          </Wrap>
          {(kind === 'income' || kind === 'debt') && <Field label={t('reason')} value={reason} onChangeText={setReason} />}
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
        </>
      )}

      <ErrorText>{error}</ErrorText>
      <Button title={t('confirm')} color={accent} busy={busy} onPress={onSubmit} />
    </View>
  );
}

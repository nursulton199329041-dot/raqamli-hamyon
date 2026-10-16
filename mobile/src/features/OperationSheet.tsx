import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Keyboard, Platform, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { ApiError } from '@/api/client';
import { TxType, type Category, type Tx } from '@/api/types';
import { evaluate, formatExpression, hasOperator, pressKey, toApiNumber, type Key } from '@/lib/calc';
import { confirmDialog } from '@/lib/confirm';
import { lastDays, monthShort, occurredAtFor, sameDay, startOfDay, weekdayName } from '@/lib/dates';
import { fmtMoney } from '@/lib/money';
import { Button, Chip, ErrorText, Field } from '@/design/Controls';
import { Tap } from '@/design/Glass';
import { CircleBadge, Glyph } from '@/design/Icon';
import { Keypad } from '@/design/Keypad';
import { Sheet } from '@/design/Sheet';
import { Ink, usePalette, useT } from '@/design/theme';
import { useCatalog, useSnapshot } from '@/state/data';
import { useQueue } from '@/state/queue';
import { api } from '@/state/runtime';
import { useSettings } from '@/state/settings';
import { useUi, type OpKind, type OpPrefill } from '@/state/ui';
import { ItemPicker } from './ItemPicker';
import { WalletPicker } from './WalletPicker';

const TABS: { kind: OpKind; key: 'income' | 'expense' | 'transfer' | 'debt'; color: string }[] = [
  { kind: 'income', key: 'income', color: Ink.income },
  { kind: 'expense', key: 'expense', color: Ink.expense },
  { kind: 'transfer', key: 'transfer', color: Ink.transfer },
  { kind: 'debt', key: 'debt', color: Ink.debt },
];

const DECIMALS = 2;

/** Global operation form (income / expense / transfer / debt). Opened by tiles, drag&drop and history; nothing is sent before "Save". */
export function OperationSheet() {
  const op = useUi((s) => s.op);
  const nonce = useUi((s) => s.opNonce);
  const close = useUi((s) => s.closeOp);
  // Keep the last form mounted (hidden) while the sheet slides out; every open bumps `nonce` => a fresh form.
  const last = useUi((s) => s.lastOp);
  if (!last) return null;
  return <OperationForm key={nonce} prefill={last} visible={op !== null} onDone={close} />;
}

type Page = 'form' | 'from' | 'to' | 'category' | 'source';

function kindOfTx(tx: Tx): OpKind | null {
  if (tx.type === TxType.Income) return 'income';
  if (tx.type === TxType.Expense) return 'expense';
  if (tx.type === TxType.Transfer) return 'transfer';
  return null;
}

/** One side of the "from >> to" strip: caption, name, round icon, balance. */
export function Endpoint({ caption, name, icon, color, note, onPress, testID }: {
  caption: string; name?: string; icon?: string; color?: string; note?: string; onPress(): void; testID?: string;
}) {
  const p = usePalette();
  return (
    <Tap label={`${caption}: ${name ?? '—'}`} onPress={onPress} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
      <View testID={testID} style={{ alignItems: 'center', gap: 4, width: '100%' }}>
        <Text numberOfLines={1} style={{ color: p.textSecondary, fontSize: 12 }}>{caption}</Text>
        <Text numberOfLines={1} style={{ color: p.text, fontWeight: '700', fontSize: 15, maxWidth: '100%' }}>{name ?? '—'}</Text>
        <CircleBadge name={icon ?? 'other'} color={color ?? '#64748B'} size={62} />
        <Text numberOfLines={1} style={{ color: p.textSecondary, fontSize: 12, minHeight: 16 }}>{note ?? ' '}</Text>
      </View>
    </Tap>
  );
}

function AmountBlock({ caption, expr, currency, active, onPress, accent, testID, dim }: {
  caption: string; expr: string; currency?: string; active: boolean; onPress(): void; accent: string; testID: string; dim?: boolean;
}) {
  const p = usePalette();
  const r = evaluate(expr, DECIMALS);
  const shown = r.ok ? formatExpression(r.value) : (expr ? formatExpression(expr.replace(/[+−×÷]+$/, '')) || '0' : '0');
  return (
    <Tap label={caption} onPress={onPress} haptic={false} containerStyle={{ flex: 1 }}>
      <View style={{ alignItems: 'center', borderBottomWidth: active ? 2 : 0, borderBottomColor: accent, paddingBottom: 2 }}>
        <Text style={{ color: p.textSecondary, fontSize: 13 }}>{caption}</Text>
        <Text testID={testID} adjustsFontSizeToFit minimumFontScale={0.5} numberOfLines={1}
          style={{ color: dim ? p.textSecondary : p.text, fontSize: 38, fontWeight: '800', maxWidth: '100%' }}>
          {shown}{currency ? <Text style={{ fontSize: 22 }}>{` ${currency}`}</Text> : null}
        </Text>
        <Text numberOfLines={1} style={{ color: p.textSecondary, fontSize: 12, minHeight: 16 }}>
          {hasOperator(expr) ? formatExpression(expr) : ' '}
        </Text>
      </View>
    </Tap>
  );
}

function DateStrip({ value, onChange }: { value: Date; onChange(d: Date): void }) {
  const t = useT();
  const p = usePalette();
  const lang = useSettings((s) => s.lang);
  const ref = useRef<ScrollView>(null);
  const today = new Date();
  const [days] = useState(() => {
    const back = Math.round((startOfDay(today).getTime() - startOfDay(value).getTime()) / 86400000);
    return lastDays(Math.max(30, back + 1), today);
  });
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14, marginBottom: 6 }}>
        <Glyph name="calendar" color={p.accent} size={16} />
        <Text style={{ color: p.accent, fontSize: 13, fontWeight: '600' }}>{t('date')}</Text>
      </View>
      <ScrollView ref={ref} horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => ref.current?.scrollToEnd({ animated: false })} contentContainerStyle={{ gap: 8 }}>
        {days.map((d) => {
          const on = sameDay(d, value);
          const isToday = sameDay(d, today);
          const isYesterday = sameDay(d, new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1));
          return (
            <Tap key={d.getTime()} label={`${d.getDate()} ${monthShort(lang, d.getMonth())}`} onPress={() => onChange(d)} style={{
              width: 84, paddingVertical: 8, borderRadius: 12, alignItems: 'center', borderWidth: on ? 2 : 1,
              borderColor: on ? p.accent : p.glassBorder, backgroundColor: on ? `${p.accent}22` : p.glassFill,
            }}>
              <Text style={{ color: p.text, fontSize: 20, fontWeight: '700' }}>{d.getDate()}</Text>
              <Text style={{ color: p.text, fontSize: 11 }}>{monthShort(lang, d.getMonth())}</Text>
              <Text numberOfLines={1} style={{ color: isToday || isYesterday ? p.accent : p.textSecondary, fontSize: 10 }}>
                {isToday ? t('today') : isYesterday ? t('yesterday') : weekdayName(lang, d.getDay()).slice(0, 10)}
              </Text>
            </Tap>
          );
        })}
      </ScrollView>
    </View>
  );
}

function OperationForm({ prefill, visible, onDone }: { prefill: OpPrefill; visible: boolean; onDone(): void }) {
  const t = useT();
  const p = usePalette();
  const cat = useCatalog();
  const snap = useSnapshot();
  const apiUrl = useSettings((s) => s.apiUrl);
  const submit = useQueue((s) => s.submit);
  const online = useQueue((s) => s.online);
  const qc = useQueryClient();
  const editing = prefill.edit ?? null;

  const initialKind: OpKind = (editing && kindOfTx(editing)) || prefill.kind;
  // when editing, the form starts from the stored operation, not from a drag/tap prefill
  const init: Pick<OpPrefill, 'walletId' | 'toWalletId' | 'categoryId' | 'sourceId' | 'projectId'> = editing ? {
    walletId: editing.walletId ?? undefined, toWalletId: editing.toWalletId ?? undefined, categoryId: editing.categoryId ?? undefined,
    sourceId: editing.incomeSourceId ?? undefined, projectId: editing.projectId ?? undefined,
  } : prefill;
  const [kind, setKind] = useState<OpKind>(initialKind);
  const [typeMenu, setTypeMenu] = useState(false);
  const [page, setPage] = useState<Page>('form');
  const [pickedWallet, setWalletId] = useState<string | undefined>(init.walletId);
  const [toWalletId, setToWalletId] = useState<string | undefined>(init.toWalletId);
  const catOf = (id?: string) => (id ? cat.category(id) : undefined);
  const [topCategory, setTopCategory] = useState<string | undefined>(() => {
    const c = catOf(init.categoryId);
    return c?.parentId ?? init.categoryId;
  });
  const [subId, setSubId] = useState<string | undefined>(() => (catOf(init.categoryId)?.parentId ? init.categoryId : undefined));
  const [sourceId, setSourceId] = useState<string | undefined>(init.sourceId);
  const [projectId, setProjectId] = useState<string | undefined>(init.projectId);
  const [expr, setExpr] = useState(editing ? String(editing.amount) : '');
  const [toExpr, setToExpr] = useState(editing?.toAmount ? String(editing.toAmount) : '');
  const [toTouched, setToTouched] = useState(!!editing?.toAmount);
  const [active, setActive] = useState<'amount' | 'toAmount'>('amount');
  const [keypadOpen, setKeypadOpen] = useState(true);
  const [memo, setMemo] = useState(editing?.memo ?? '');
  const [reason, setReason] = useState(editing?.reason ?? '');
  const [person, setPerson] = useState('');
  const [counterparty, setCounterparty] = useState(() => (editing?.personId ? cat.person(editing.personId)?.name ?? '' : ''));
  const [borrowed, setBorrowed] = useState(true);
  const [date, setDate] = useState<Date>(() => (editing ? new Date(editing.occurredAt) : new Date()));
  const [addAnother, setAddAnother] = useState(false);
  const [addingSub, setAddingSub] = useState(false);
  const [subName, setSubName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const lock = useRef(false); // synchronous guard: a double tap can never send two requests

  const wallets = cat.activeWallets;
  const walletId = pickedWallet ?? wallets[0]?.id;
  const from = cat.wallet(walletId);
  const to = cat.wallet(toWalletId);
  const cross = kind === 'transfer' && !!from && !!to && from.currency !== to.currency;
  const accent = TABS.find((x) => x.kind === kind)!.color;
  const source = cat.source(sourceId);
  const top = cat.category(topCategory);
  const children = cat.childrenOf(topCategory);
  const sub = cat.category(subId);

  // Last used rate for this currency pair (from history) pre-fills the received amount of a cross-currency transfer.
  const knownRate = useMemo(() => {
    if (!cross || !from || !to) return null;
    const tx = cat.transactions.find((x) => x.type === TxType.Transfer && !!x.fxRate && x.currency === from.currency && x.toCurrency === to.currency);
    return tx?.fxRate ?? null;
  }, [cross, from, to, cat.transactions]);

  // Until the user types the received amount it follows mount x last used rate (derived, not stored).
  const autoTo = useMemo(() => {
    if (!cross || toTouched || !knownRate) return null;
    const a = evaluate(expr, DECIMALS);
    if (!a.ok) return '';
    const r = evaluate(`×`, DECIMALS);
    return r.ok ? r.value : '';
  }, [cross, toTouched, knownRate, expr]);
  const toShown = autoTo ?? toExpr;

  const onKey = (k: Key) => {
    setError(null);
    if (active === 'toAmount' && cross) {
      setToTouched(true);
      setToExpr(pressKey(toShown, k, DECIMALS));
    } else setExpr((e) => pressKey(e, k, DECIMALS));
  };

  const pickFrom = (id: string) => {
    setWalletId(id);
    if (toWalletId === id) setToWalletId(undefined);
    setError(null);
    setPage('form');
  };

  const addSub = async () => {
    const name = subName.trim();
    if (!name || !top) return;
    try {
      const created = await api.post<Category>('/api/categories', { name, icon: top.icon, color: top.color, parentId: top.id });
      await qc.invalidateQueries({ queryKey: ['snapshot'] });
      setSubId(created.id);
      setSubName('');
      setAddingSub(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  const reverse = () => {
    if (!editing) return;
    confirmDialog(t('delete_op_title'), t('delete_op_msg'), t('reverse'), t('cancel'), () => {
      void (async () => {
        try {
          await api.post(`/api/transactions/${editing.id}/reverse`, {});
          await qc.invalidateQueries();
          onDone();
        } catch (e) {
          setError(e instanceof ApiError ? e.message : String(e));
        }
      })();
    });
  };

  const resetForNext = () => {
    setExpr('');
    setToExpr('');
    setToTouched(false);
    setMemo('');
    setReason('');
    setCounterparty('');
    setPerson('');
    setActive('amount');
    setKeypadOpen(true);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const onSubmit = async () => {
    if (lock.current) return;
    const calc = evaluate(expr, DECIMALS);
    if (!calc.ok) return setError(t('amount_invalid'));
    const value = toApiNumber(calc.value);
    if (!walletId || !from) return setError(t('select_wallet'));
    if (kind === 'expense' && !(subId ?? topCategory)) return setError(t('select_category'));
    if (kind === 'transfer') {
      if (!toWalletId) return setError(t('select_wallet'));
      if (toWalletId === walletId) return setError(t('same_wallet'));
    }
    if (kind === 'debt' && !person.trim()) return setError(t('person'));
    let toAmountValue: number | null = null;
    if (cross) {
      const r2 = evaluate(toShown, DECIMALS);
      if (!r2.ok) return setError(t('amount_invalid'));
      toAmountValue = toApiNumber(r2.value);
    }
    const spends = kind === 'expense' || kind === 'transfer' || (kind === 'debt' && !borrowed);
    if (spends && !editing && online && !from.allowOverdraft && value > from.balance) return setError(t('insufficient'));

    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const occurredAt = occurredAtFor(date);
      let note = memo.trim();
      let personId: string | null = null;
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
            note = `${kind === 'expense' ? t('payee') : t('payer')}: ${who}${note ? ` — ${note}` : ''}`; // offline: keep the name
          }
        }
      }
      const base = { memo: note || null, occurredAt, projectId: projectId ?? null };

      if (editing) {
        // correction = reversal + new entry on the server (ledger history is never rewritten); needs a connection
        const body = kind === 'income'
          ? { walletId, amount: value, incomeSourceId: sourceId ?? null, personId, reason: reason.trim() || null, ...base }
          : kind === 'expense'
            ? { walletId, amount: value, categoryId: subId ?? topCategory, personId, ...base }
            : { fromWalletId: walletId, toWalletId, amount: value, toAmount: toAmountValue, fxRate: null, ...base };
        await api.put(`/api/transactions/${editing.id}/${kind}`, body);
        await qc.invalidateQueries();
        onDone();
        return;
      }

      let res;
      switch (kind) {
        case 'income':
          res = await submit('income', { walletId, amount: value, incomeSourceId: sourceId ?? null, personId, reason: reason.trim() || null, ...base });
          break;
        case 'expense':
          res = await submit('expense', { walletId, amount: value, categoryId: subId ?? topCategory, personId, ...base });
          break;
        case 'transfer':
          res = await submit('transfer', { fromWalletId: walletId, toWalletId, amount: value, toAmount: toAmountValue, fxRate: null, ...base });
          break;
        case 'debt':
          res = await submit('debt', {
            direction: borrowed ? 0 : 1, personName: person.trim(), walletId, amount: value, dueDate: null, reason: reason.trim() || null, ...base,
          });
          break;
      }
      if (!res.ok) {
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return setError(res.message);
      }
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (addAnother) resetForNext();
      else onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  const walletNote = (w?: { balance: number; currency: string }) => (w ? fmtMoney(w.balance, w.currency) : undefined);
  const openKeypad = (which: 'amount' | 'toAmount') => {
    Keyboard.dismiss();
    setActive(which);
    setKeypadOpen(true);
  };

  const footer = page === 'form' ? (
    <View>
      <ErrorText>{error}</ErrorText>
      {saved ? <Text style={{ color: Ink.income, textAlign: 'center', fontWeight: '700' }}>✓ {t('saved')}</Text> : null}
      <Button testID="save-button" title={t('save')} color={accent} busy={busy} onPress={() => void onSubmit()} style={{ marginTop: 6, minHeight: 50 }} />
      {keypadOpen ? <View style={{ marginHorizontal: -20, marginTop: 10, marginBottom: -16 }}><Keypad onKey={onKey} onClose={() => setKeypadOpen(false)} /></View> : null}
    </View>
  ) : undefined;

  const back = () => { setPage('form'); };
  let body: ReactNode;
  if (page === 'from') {
    body = <WalletPicker title={kind === 'expense' || kind === 'transfer' || (kind === 'debt' && !borrowed) ? t('pay_from_wallet') : t('receiving_wallet')}
      selectedId={walletId} excludeId={kind === 'transfer' ? toWalletId : undefined} onSelect={pickFrom} onBack={back} />;
  } else if (page === 'to') {
    body = <WalletPicker title={t('receiving_wallet')} selectedId={toWalletId} excludeId={walletId}
      onSelect={(id) => { setToWalletId(id); setError(null); setPage('form'); }} onBack={back} />;
  } else if (page === 'category') {
    body = <ItemPicker title={t('select_category')} selectedId={topCategory} items={cat.topCategories}
      onSelect={(id) => { setTopCategory(id); setSubId(undefined); setError(null); setPage('form'); }} onBack={back} />;
  } else if (page === 'source') {
    body = <ItemPicker title={t('pick_source')} selectedId={sourceId} items={cat.sources} allowNone
      onSelect={(id) => { setSourceId(id); setPage('form'); }} onBack={back} />;
  } else {
    const leftIsWallet = kind === 'expense' || kind === 'transfer' || (kind === 'debt' && !borrowed);
    body = (
      <View>
        {typeMenu && !editing ? (
          <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8 }}>
            {TABS.map((x) => (
              <View key={x.kind} style={{ flex: 1 }}>
                <Chip label={t(x.key)} selected={x.kind === kind} color={x.color} onPress={() => { setKind(x.kind); setTypeMenu(false); setError(null); }} />
              </View>
            ))}
          </View>
        ) : null}

        {!cat.loaded && snap.isError ? (
          <Tap testID="load-error" label={t('retry')} onPress={() => void snap.refetch()} style={{ padding: 10, borderRadius: 14, backgroundColor: `22`, marginBottom: 8 }}>
            <Text style={{ color: Ink.expense, fontWeight: '800' }}>{t('picker_failed')}</Text>
            <Text style={{ color: p.textSecondary, fontSize: 12 }}>{t('picker_failed_hint', { url: apiUrl })}</Text>
          </Tap>
        ) : null}

        <View style={{ flexDirection: 'row', gap: 16 }}>
          <AmountBlock caption={t('amount')} expr={expr} currency={from?.currency} accent={accent} testID="amount-display"
            active={active === 'amount' && keypadOpen} onPress={() => openKeypad('amount')} dim={cross && active === 'toAmount'} />
          {cross ? (
            <AmountBlock caption={t('amount')} expr={toShown} currency={to?.currency} accent={accent} testID="amount-to-display"
              active={active === 'toAmount' && keypadOpen} onPress={() => openKeypad('toAmount')} dim={active === 'amount'} />
          ) : null}
        </View>
        {cross && from && to ? (
          <Text testID="rate-line" style={{ color: p.textSecondary, fontSize: 12, textAlign: 'center', marginTop: 2 }}>
            {t('rate_hint')}: 1 {from.currency} = {(() => {
              const a = evaluate(expr, DECIMALS);
              const b = evaluate(toShown, DECIMALS);
              if (a.ok && b.ok) {
                const r = evaluate(`${b.value}÷${a.value}`, 6);
                return r.ok ? `${formatExpression(r.value)} ${to.currency}` : '—';
              }
              return knownRate ? `${formatExpression(String(knownRate))} ${to.currency}` : '—';
            })()}
          </Text>
        ) : null}

        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
          {leftIsWallet ? (
            <Endpoint testID="from-endpoint" caption={t('wallet')} name={from?.name} icon={from?.icon} color={from?.color} note={walletNote(from)} onPress={() => setPage('from')} />
          ) : kind === 'income' ? (
            <Endpoint testID="source-endpoint" caption={t('income_source')} name={source?.name ?? '—'} icon={source?.icon ?? 'other'} color={source?.color} onPress={() => setPage('source')} />
          ) : (
            <Endpoint caption={t('lender')} name={person.trim() || '—'} icon="user" color={Ink.debt} onPress={() => undefined} />
          )}
          <View style={{ paddingHorizontal: 4, marginTop: 18 }}><Glyph name="forward" color={p.textSecondary} size={26} /></View>
          {kind === 'expense' ? (
            <Endpoint testID="category-endpoint" caption={t('category')} name={top?.name ?? t('select_category')} icon={top?.icon ?? 'tag'} color={top?.color}
              onPress={() => setPage('category')} />
          ) : kind === 'transfer' ? (
            <Endpoint testID="to-endpoint" caption={t('wallet')} name={to?.name ?? t('select_wallet')} icon={to?.icon ?? 'wallet'} color={to?.color} note={walletNote(to)}
              onPress={() => setPage('to')} />
          ) : kind === 'debt' && !borrowed ? (
            <Endpoint caption={t('borrower')} name={person.trim() || '—'} icon="user" color={Ink.debt} onPress={() => undefined} />
          ) : (
            <Endpoint testID="to-endpoint" caption={t('wallet')} name={from?.name ?? t('select_wallet')} icon={from?.icon ?? 'wallet'} color={from?.color} note={walletNote(from)}
              onPress={() => setPage('from')} />
          )}
        </View>

        {kind === 'debt' ? (
          <View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <Chip label={t('borrowed')} selected={borrowed} color={Ink.debt} onPress={() => setBorrowed(true)} />
              <Chip label={t('lent')} selected={!borrowed} color={Ink.debt} onPress={() => setBorrowed(false)} />
            </View>
            <Field label={t('person')} value={person} onChangeText={setPerson} onFocus={() => setKeypadOpen(false)} />
          </View>
        ) : null}

        {kind === 'expense' && top ? (
          <View>
            <Text style={{ color: p.textSecondary, fontSize: 13, marginTop: 14, marginBottom: 6 }}>{t('subcategory')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8 }}>
              <SubChip label={t('no_sub')} glyph="?" on={!subId} onPress={() => setSubId(undefined)} />
              {children.map((c) => <SubChip key={c.id} label={c.name} glyph={c.name.slice(0, 1).toUpperCase()} on={subId === c.id} onPress={() => setSubId(c.id)} />)}
              <SubChip label={t('add')} glyph="+" on={addingSub} onPress={() => setAddingSub((v) => !v)} />
            </ScrollView>
            {addingSub ? (
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
                <View style={{ flex: 1 }}>
                  <Field label={t('sub_name')} value={subName} onChangeText={setSubName} maxLength={80} onFocus={() => setKeypadOpen(false)} onSubmitEditing={() => void addSub()} />
                </View>
                <Button title={t('save')} variant="tonal" onPress={() => void addSub()} style={{ minHeight: 48, paddingHorizontal: 14, marginTop: 0 }} />
              </View>
            ) : null}
            {sub ? <Text style={{ color: p.textSecondary, fontSize: 11, marginTop: 4 }}>{top.name} / {sub.name}</Text> : null}
          </View>
        ) : null}

        <DateStrip value={date} onChange={setDate} />

        {kind === 'income' || kind === 'expense' ? (
          <Field label={kind === 'expense' ? t('payee') : t('payer')} value={counterparty} onChangeText={setCounterparty} maxLength={120} onFocus={() => setKeypadOpen(false)} />
        ) : null}
        {kind === 'income' || kind === 'debt' ? <Field label={t('reason')} value={reason} onChangeText={setReason} onFocus={() => setKeypadOpen(false)} /> : null}

        {cat.projects.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8, marginTop: 12 }}>
            <Chip label={`${t('project')}: —`} selected={!projectId} onPress={() => setProjectId(undefined)} />
            {cat.projects.map((pr) => <Chip key={pr.id} label={pr.name} icon={pr.icon} color={pr.color} selected={projectId === pr.id} onPress={() => setProjectId(pr.id)} />)}
          </ScrollView>
        ) : null}

        <Text style={{ color: p.textSecondary, fontSize: 13, marginTop: 14, marginBottom: 4 }}>{t('memo')}</Text>
        <TextInput
          testID="memo-input"
          accessibilityLabel={t('memo')}
          value={memo}
          onChangeText={setMemo}
          onFocus={() => setKeypadOpen(false)}
          maxLength={1000}
          placeholderTextColor={p.textSecondary}
          style={{ borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: p.text, backgroundColor: p.glassFill, borderWidth: 1, borderColor: p.glassBorder }}
        />

        {!editing ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 }}>
            <Switch testID="add-another" value={addAnother} onValueChange={setAddAnother} />
            <Text style={{ color: p.text, flex: 1 }}>{t('add_another')}</Text>
          </View>
        ) : null}
      </View>
    );
  }

  const header = page === 'form' ? (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
      {editing && !editing.reversedById ? (
        <Tap testID="trash" label={t('reverse')} onPress={reverse} style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: p.glassFill }}>
          <Glyph name="trash" color={Ink.expense} size={20} />
        </Tap>
      ) : <View style={{ width: 40 }} />}
      <Tap testID="type-menu" label={editing ? t('edit_operation') : t(TABS.find((x) => x.kind === kind)!.key)} onPress={() => { if (!editing) setTypeMenu((v) => !v); }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8, paddingHorizontal: 12 }}>
        <Text style={{ color: p.text, fontSize: 17, fontWeight: '700' }}>{editing ? t(TABS.find((x) => x.kind === kind)!.key) : t(TABS.find((x) => x.kind === kind)!.key)}</Text>
        {!editing ? <Glyph name="chevronDown" color={p.textSecondary} size={16} /> : null}
      </Tap>
      <Tap testID="close-op" label={t('cancel')} onPress={onDone} style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: p.glassFill }}>
        <Glyph name="close" color={p.text} size={20} />
      </Tap>
    </View>
  ) : null;

  return (
    <Sheet visible={visible} onClose={() => (page === 'form' ? onDone() : setPage('form'))} full footer={footer}>
      {header}
      {body}
    </Sheet>
  );
}

function SubChip({ label, glyph, on, onPress }: { label: string; glyph: string; on: boolean; onPress(): void }) {
  const p = usePalette();
  return (
    <Tap label={label} onPress={onPress} style={{
      minWidth: 70, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12, alignItems: 'center', borderWidth: on ? 2 : 1,
      borderColor: on ? p.accent : p.glassBorder, backgroundColor: on ? `${p.accent}22` : p.glassFill,
    }}>
      <Text style={{ color: p.textSecondary, fontSize: 18 }}>{glyph}</Text>
      <Text numberOfLines={1} style={{ color: p.text, fontSize: 11, maxWidth: 90 }}>{label}</Text>
    </Tap>
  );
}

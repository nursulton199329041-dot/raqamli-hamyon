import { useState } from 'react';
import { Text, View } from 'react-native';
import { ApiError } from '@/api/client';
import { Button, ErrorText, Field } from '@/design/Controls';
import { Sheet } from '@/design/Sheet';
import { usePalette, useT } from '@/design/theme';
import { space, type } from '@/design/tokens';
import { fmtMoney, newKey } from '@/lib/money';
import { useCatalog } from '@/state/data';
import { useQueue } from '@/state/queue';
import { api, queryClient } from '@/state/runtime';
import { FilterHeader } from './FilterSection';

/** Typed balance -> number; null when it is not a number. */
export function parseBalance(text: string): number | null {
  const clean = text.replace(/\s/g, '').replace(',', '.');
  return /^-?\d+(\.\d{1,2})?$/.test(clean) ? Number(clean) : null;
}

/**
 * "Missed some operations": type what each wallet really holds. The server books the difference as a correction entry,
 * so the history stays whole and the change shows in it.
 */
export function BalanceSheet({ visible, onClose }: { visible: boolean; onClose(): void }) {
  return visible ? <Body onClose={onClose} /> : null;
}

function Body({ onClose }: { onClose(): void }) {
  const t = useT();
  const p = usePalette();
  const cat = useCatalog();
  const pending = useQueue((s) => s.pending.length);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (busy) return;
    // a balance set now would be moved again by operations still waiting to be sent
    if (pending > 0) return setError(t('adjust_busy'));
    const changes: { id: string; value: number }[] = [];
    for (const w of cat.activeWallets) {
      const text = typed[w.id];
      if (text === undefined || text.trim() === '') continue;
      const value = parseBalance(text);
      if (value === null) return setError(`${w.name}: ${t('amount_invalid')}`);
      if (value !== w.balance) changes.push({ id: w.id, value });
    }
    if (changes.length === 0) return onClose();
    setError(null);
    setBusy(true);
    try {
      for (const c of changes) await api.post(`/api/wallets/${c.id}/adjust`, { newBalance: c.value, memo: t('adjust_memo') }, newKey('adjust'));
      await queryClient.invalidateQueries();
      onClose();
    } catch (e) {
      // what was already corrected stays corrected: refresh so the list shows it
      await queryClient.invalidateQueries();
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible onClose={onClose} full footer={<Button testID="balance-save" title={t('save')} busy={busy} onPress={() => void save()} />}>
      <View testID="balance-sheet" style={{ gap: space.sm }}>
        <FilterHeader title={t('adjust_title')} onClose={onClose} />
        <Text style={[type.footnote, { color: p.textSecondary }]}>{t('adjust_hint')}</Text>
        {cat.activeWallets.map((w) => (
          <Field key={w.id} testID={`balance-${w.id}`} label={`${w.name} (${w.currency})`} value={typed[w.id] ?? ''}
            placeholder={fmtMoney(w.balance, w.currency)} keyboardType="numbers-and-punctuation"
            onChangeText={(x) => setTyped((old) => ({ ...old, [w.id]: x }))} />
        ))}
        <ErrorText>{error}</ErrorText>
      </View>
    </Sheet>
  );
}

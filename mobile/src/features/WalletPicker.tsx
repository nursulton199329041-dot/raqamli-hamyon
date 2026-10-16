import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import type { Wallet } from '@/api/types';
import { Button } from '@/design/Controls';
import { Tap } from '@/design/Glass';
import { Glyph, IconBadge } from '@/design/Icon';
import { Ink, usePalette, useT } from '@/design/theme';
import { fmtMoney } from '@/lib/money';
import { useCatalog, useSnapshot } from '@/state/data';
import { WalletForm } from './FormSheets';

/**
 * Wallet chooser shown INSIDE the operation sheet (a page swap, not a second Modal), so it can never end up
 * underneath another window. Lists the user's active wallets from the backend snapshot (refetched on open) with
 * icon, name, currency and current balance. With no wallet it offers to create one and returns the new wallet.
 */
export function WalletPicker({ title, selectedId, excludeId, onSelect, onBack }: {
  title: string; selectedId?: string; excludeId?: string; onSelect(walletId: string): void; onBack(): void;
}) {
  const t = useT();
  const p = usePalette();
  const cat = useCatalog();
  const snap = useSnapshot();
  const [creating, setCreating] = useState(false);
  const { refetch } = snap;

  // Always show fresh balances/wallets: pull from the backend whenever the picker opens.
  useEffect(() => {
    void refetch();
  }, [refetch]);

  const wallets = cat.activeWallets.filter((w) => w.id !== excludeId);

  if (creating) {
    return (
      <View>
        <BackRow label={t('back')} onPress={() => setCreating(false)} />
        <WalletForm walletId={null} done={() => setCreating(false)} onCreated={(w: Wallet) => onSelect(w.id)} />
      </View>
    );
  }

  return (
    <View>
      <BackRow label={t('back')} title={title} onPress={onBack} />
      {snap.isFetching && wallets.length === 0 ? <ActivityIndicator color={p.accent} style={{ marginVertical: 16 }} /> : null}
      {snap.isError && wallets.length === 0 ? (
        <View>
          <Text style={{ color: Ink.expense, marginTop: 8 }}>{snap.error instanceof Error ? snap.error.message : String(snap.error)}</Text>
          <Button title={t('retry')} variant="tonal" onPress={() => void refetch()} />
        </View>
      ) : null}
      {cat.loaded && wallets.length === 0 && !snap.isError ? (
        <Text style={{ color: p.textSecondary, marginVertical: 12 }}>{t('no_wallets_pick')}</Text>
      ) : null}
      <View style={{ gap: 8, marginTop: 8 }}>
        {wallets.map((w) => {
          const on = w.id === selectedId;
          return (
            <Tap key={w.id} label={`${w.name} ${fmtMoney(w.balance, w.currency)}`} onPress={() => onSelect(w.id)} style={{
              flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 18, borderWidth: on ? 2 : 1,
              borderColor: on ? w.color : p.glassBorder, backgroundColor: on ? `${w.color}2E` : p.glassFill,
            }}>
              <IconBadge name={w.icon} color={w.color} size={40} />
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: p.text, fontWeight: '800', fontSize: 15 }}>{w.name}</Text>
                <Text style={{ color: p.textSecondary, fontSize: 12 }}>{w.currency}</Text>
              </View>
              <Text numberOfLines={1} style={{ color: w.balance < 0 ? Ink.expense : p.text, fontWeight: '800', fontSize: 14, maxWidth: 140 }}>
                {fmtMoney(w.balance, w.currency)}
              </Text>
              {on ? <Glyph name="check" color={w.color} size={20} /> : null}
            </Tap>
          );
        })}
      </View>
      <Button title={t('create_wallet')} variant="tonal" onPress={() => setCreating(true)} />
    </View>
  );
}

function BackRow({ label, title, onPress }: { label: string; title?: string; onPress(): void }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 }}>
      <Tap label={label} onPress={onPress} style={{ paddingVertical: 6, paddingRight: 10 }}>
        <Text style={{ color: p.accent, fontSize: 16, fontWeight: '700' }}>{`‹ ${label}`}</Text>
      </Tap>
      {title ? <Text numberOfLines={1} style={{ flex: 1, color: p.text, fontSize: 18, fontWeight: '800' }}>{title}</Text> : null}
    </View>
  );
}

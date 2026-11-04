import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { ApiError } from '@/api/client';
import { Button, Chip, ErrorText, Field, Label, Wrap } from '@/design/Controls';
import { Tap } from '@/design/Glass';
import { Glyph } from '@/design/Icon';
import { Sheet } from '@/design/Sheet';
import { ErrorState, Skeleton } from '@/design/States';
import { usePalette, useT, type Palette } from '@/design/theme';
import { radii, space, type } from '@/design/tokens';
import { createProfile, selectProfile, useProfiles } from '@/state/profiles';

const CURRENCIES = ['UZS', 'USD', 'EUR', 'RUB', 'KZT'];

const roundButton = (p: Palette) => ({
  width: 40, height: 40, borderRadius: 20, alignItems: 'center' as const, justifyContent: 'center' as const,
  backgroundColor: p.glassFill, borderWidth: 1, borderColor: p.glassBorder,
});

/**
 * Opened from the home avatar: the account's profiles to switch between. An account with only its automatic first
 * profile has nothing to switch to, so it goes straight to the new-profile form.
 */
export function ProfilesSheet({ visible, onClose }: { visible: boolean; onClose(): void }) {
  const t = useT();
  const profiles = useProfiles();
  const [adding, setAdding] = useState(false);
  const [showList, setShowList] = useState(false);
  const form = adding || (!!profiles.data && profiles.data.items.length <= 1 && !showList);
  const close = () => {
    setAdding(false);
    setShowList(false);
    onClose();
  };
  const toList = () => {
    setAdding(false);
    setShowList(true);
  };
  // the add button sits outside the scrolling list, so it stays on screen however long the list is or if it fails to load
  const footer = visible && !form ? <Button testID="profiles-add" title={`+ ${t('new_profile')}`} onPress={() => setAdding(true)} /> : undefined;
  return (
    <Sheet visible={visible} onClose={close} footer={footer}>
      {visible ? <Body key={form ? 'form' : 'list'} form={form} onClose={close} onList={toList} /> : null}
    </Sheet>
  );
}

/** Mounted only while the sheet is open, so every opening starts clean. */
function Body({ form, onClose, onList }: { form: boolean; onClose(): void; onList(): void }) {
  const t = useT();
  const p = usePalette();
  const router = useRouter();
  const profiles = useProfiles();
  const { refetch } = profiles;
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('UZS');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const items = profiles.data?.items ?? [];
  const currentId = profiles.data?.currentId ?? null;

  const message = (e: unknown) => (e instanceof ApiError && e.code === 'profile.busy' ? t('profile_busy') : e instanceof Error ? e.message : String(e));

  const open = async (id: string) => {
    if (switching) return;
    if (id === currentId) return onClose();
    setError(null);
    setSwitching(id);
    try {
      await selectProfile(id);
      onClose();
    } catch (e) {
      setError(message(e));
    } finally {
      setSwitching(null);
    }
  };

  const create = async () => {
    const clean = name.trim();
    if (!clean || busy) return;
    setError(null);
    setBusy(true);
    try {
      await createProfile(clean, currency);
      onList();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View testID="profiles-sheet" style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Tap testID="profiles-settings" label={t('settings')} style={roundButton(p)} onPress={() => { onClose(); router.push('/settings'); }}>
          <Glyph name="settings" color={p.text} size={18} />
        </Tap>
        <Text numberOfLines={1} style={[type.headline, { flex: 1, color: p.text, textAlign: 'center' }]}>{form ? t('new_profile') : t('profiles')}</Text>
        <Tap testID="profiles-close" label={t('close')} style={roundButton(p)} onPress={onClose}>
          <Glyph name="close" color={p.text} size={18} />
        </Tap>
      </View>

      {profiles.isLoading && !form ? <Skeleton height={48} /> : null}
      {profiles.isError && !profiles.data && !form ? (
        <ErrorState testID="profiles-error" title={t('dash_load_error')} message={profiles.error instanceof Error ? profiles.error.message : undefined}
          retry={t('retry')} onRetry={() => void refetch()} />
      ) : null}

      {form ? (
        <View testID="profile-form" style={{ gap: space.sm }}>
          <Field label={t('name')} value={name} onChangeText={setName} maxLength={60} />
          <Label>{t('currency')}</Label>
          <Wrap>{CURRENCIES.map((c) => <Chip key={c} label={c} selected={currency === c} onPress={() => setCurrency(c)} />)}</Wrap>
          {error ? <ErrorText>{error}</ErrorText> : null}
          <Button title={t('save')} busy={busy} disabled={!name.trim()} onPress={() => void create()} />
          {items.length > 0 ? (
            <Tap testID="profiles-show-list" label={t('profiles')} haptic={false} containerStyle={{ alignSelf: 'center' }} style={{ paddingVertical: space.sm, paddingHorizontal: space.md }}
              onPress={onList}>
              <Text style={[type.footnote, { color: p.accent, fontWeight: '700' }]}>{t('profiles')} ({items.length})</Text>
            </Tap>
          ) : null}
        </View>
      ) : profiles.data ? (
        <>
          <View style={{ borderRadius: radii.lg, backgroundColor: p.glassFill, borderWidth: 1, borderColor: p.glassBorder, overflow: 'hidden' }}>
            {items.map((x, i) => (
              <Tap key={x.id} testID={`profile-${x.id}`} label={x.name} haptic={false} onPress={() => void open(x.id)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 52, paddingHorizontal: space.md, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: p.glassBorder }}>
                <Text numberOfLines={1} style={[type.callout, { flex: 1, color: p.text }]}>{x.name}</Text>
                {switching === x.id ? <ActivityIndicator size="small" color={p.textSecondary} />
                  : x.id === currentId ? <Glyph name="check" color={p.accent} size={20} /> : null}
              </Tap>
            ))}
          </View>
          {error ? <ErrorText>{error}</ErrorText> : null}
        </>
      ) : null}
    </View>
  );
}

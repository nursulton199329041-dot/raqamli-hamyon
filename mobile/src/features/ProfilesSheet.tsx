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
import { createProfile, removeProfile, renameProfile, selectProfile, useProfiles, type ProfileRow } from '@/state/profiles';

const CURRENCIES = ['UZS', 'USD', 'EUR', 'RUB', 'KZT'];

const roundButton = (p: Palette) => ({
  width: 40, height: 40, borderRadius: 20, alignItems: 'center' as const, justifyContent: 'center' as const,
  backgroundColor: p.glassFill, borderWidth: 1, borderColor: p.glassBorder,
});

function useMessage() {
  const t = useT();
  return (e: unknown) => {
    if (e instanceof ApiError && e.code === 'profile.busy') return t('profile_busy');
    if (e instanceof ApiError && e.code === 'profile.last_active') return t('profile_last');
    return e instanceof Error ? e.message : String(e);
  };
}

/**
 * The account's profiles: tap one to work in it, the pencil renames or deletes it, the button below adds a new one. An
 * account with only its automatic first profile has nothing to switch to, so it goes straight to the new-profile form.
 */
export function ProfilesSheet({ visible, onClose }: { visible: boolean; onClose(): void }) {
  const t = useT();
  const profiles = useProfiles();
  const [adding, setAdding] = useState(false);
  const [showList, setShowList] = useState(false);
  const [editing, setEditing] = useState<ProfileRow | null>(null);
  const form = adding || (!!profiles.data && profiles.data.items.length <= 1 && !showList);
  const close = () => {
    setAdding(false);
    setShowList(false);
    setEditing(null);
    onClose();
  };
  const toList = () => {
    setAdding(false);
    setEditing(null);
    setShowList(true);
  };
  // the add button sits outside the scrolling list, so it stays on screen however long the list is or if it fails to load
  const footer = visible && !form && !editing ? <Button testID="profiles-add" title={`+ ${t('new_profile')}`} onPress={() => setAdding(true)} /> : undefined;
  return (
    <Sheet visible={visible} onClose={close} footer={footer}>
      {!visible ? null : editing ? <EditBody key={editing.id} profile={editing} onClose={close} onDone={toList} />
        : <Body key={form ? 'form' : 'list'} form={form} onClose={close} onList={toList} onEdit={setEditing} />}
    </Sheet>
  );
}

function Header({ title, onClose }: { title: string; onClose(): void }) {
  const t = useT();
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <View style={{ width: 40 }} />
      <Text numberOfLines={1} style={[type.headline, { flex: 1, color: p.text, textAlign: 'center' }]}>{title}</Text>
      <Tap testID="profiles-close" label={t('close')} style={roundButton(p)} onPress={onClose}>
        <Glyph name="close" color={p.text} size={18} />
      </Tap>
    </View>
  );
}

/** Rename, or delete after one more question. Deleting hides the profile; its records stay in the books. */
function EditBody({ profile, onClose, onDone }: { profile: ProfileRow; onClose(): void; onDone(): void }) {
  const t = useT();
  const p = usePalette();
  const message = useMessage();
  const [name, setName] = useState(profile.name);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await action();
      onDone();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View testID="profile-edit" style={{ gap: space.md }}>
      <Header title={t('edit_profile')} onClose={onClose} />
      {sure ? (
        <>
          <Text testID="profile-delete-warning" style={[type.callout, { color: p.text }]}>{t('profile_delete_confirm', { name: profile.name })}</Text>
          {error ? <ErrorText>{error}</ErrorText> : null}
          <Button testID="profile-delete-yes" title={t('delete')} variant="danger" busy={busy} onPress={() => void run(() => removeProfile(profile.id))} />
          <Button title={t('cancel')} variant="tonal" onPress={() => setSure(false)} />
        </>
      ) : (
        <>
          <Field label={t('name')} value={name} onChangeText={setName} maxLength={60} />
          {error ? <ErrorText>{error}</ErrorText> : null}
          <Button testID="profile-save" title={t('save')} busy={busy} disabled={!name.trim()} onPress={() => void run(() => renameProfile(profile.id, name.trim()))} />
          <Button testID="profile-delete" title={t('delete')} variant="danger" onPress={() => { setError(null); setSure(true); }} />
          <Button title={t('cancel')} variant="tonal" onPress={onDone} />
        </>
      )}
    </View>
  );
}

/** Mounted only while the sheet is open, so every opening starts clean. */
function Body({ form, onClose, onList, onEdit }: { form: boolean; onClose(): void; onList(): void; onEdit(p: ProfileRow): void }) {
  const t = useT();
  const p = usePalette();
  const message = useMessage();
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
      <Header title={form ? t('new_profile') : t('profiles')} onClose={onClose} />

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
              <View key={x.id} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: p.glassBorder }}>
                <Tap testID={`profile-${x.id}`} label={x.name} haptic={false} onPress={() => void open(x.id)} containerStyle={{ flex: 1, minWidth: 0 }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 52, paddingLeft: space.md }}>
                  <Text numberOfLines={1} style={[type.callout, { flex: 1, color: p.text }]}>{x.name}</Text>
                  {switching === x.id ? <ActivityIndicator size="small" color={p.textSecondary} />
                    : x.id === currentId ? <Glyph name="check" color={p.accent} size={20} /> : null}
                </Tap>
                <Tap testID={`profile-edit-${x.id}`} label={`${t('edit')}: ${x.name}`} haptic={false} onPress={() => onEdit(x)}
                  style={{ width: 48, height: 52, alignItems: 'center', justifyContent: 'center' }}>
                  <Glyph name="edit" color={p.textSecondary} size={18} />
                </Tap>
              </View>
            ))}
          </View>
          {error ? <ErrorText>{error}</ErrorText> : null}
        </>
      ) : null}
    </View>
  );
}

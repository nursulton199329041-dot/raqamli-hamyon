import { useState } from 'react';
import { Text, View } from 'react-native';
import { ApiError } from '@/api/client';
import { Button, ErrorText } from '@/design/Controls';
import { Sheet } from '@/design/Sheet';
import { usePalette, useT } from '@/design/theme';
import { space, type } from '@/design/tokens';
import { startOver, useProfiles, type StartOverScope } from '@/state/profiles';
import { FilterHeader } from './FilterSection';

/** "Delete data": everything or only the operations of the profile on screen, always after one more question. */
export function WipeSheet({ visible, onClose }: { visible: boolean; onClose(): void }) {
  return visible ? <Body onClose={onClose} /> : null;
}

function Body({ onClose }: { onClose(): void }) {
  const t = useT();
  const p = usePalette();
  const profiles = useProfiles().data;
  const name = profiles?.items.find((x) => x.id === profiles.currentId)?.name ?? '';
  const [scope, setScope] = useState<StartOverScope | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!scope || busy) return;
    setError(null);
    setBusy(true);
    try {
      await startOver(scope);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'profile.busy' ? t('profile_busy') : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible onClose={onClose}>
      <View testID="wipe-sheet" style={{ gap: space.md }}>
        <FilterHeader title={t('wipe_title')} onClose={onClose} />
        {scope ? (
          <>
            <Text testID="wipe-warning" style={[type.callout, { color: p.text }]}>
              {t(scope === 'all' ? 'wipe_all_confirm' : 'wipe_ops_confirm', { name })}
            </Text>
            <Text style={[type.footnote, { color: p.textSecondary }]}>{t('wipe_note')}</Text>
            <ErrorText>{error}</ErrorText>
            <Button testID="wipe-yes" title={t('wipe_yes')} variant="danger" busy={busy} onPress={() => void run()} />
            <Button title={t('cancel')} variant="tonal" onPress={() => { setError(null); setScope(null); }} />
          </>
        ) : (
          <>
            <Text style={[type.callout, { color: p.textSecondary }]}>{t('wipe_text', { name })}</Text>
            <Button testID="wipe-all" title={t('wipe_all')} variant="danger" onPress={() => setScope('all')} />
            <Button testID="wipe-ops" title={t('wipe_ops')} variant="danger" onPress={() => setScope('operations')} />
            <Button testID="wipe-cancel" title={t('cancel')} variant="tonal" onPress={onClose} />
          </>
        )}
      </View>
    </Sheet>
  );
}

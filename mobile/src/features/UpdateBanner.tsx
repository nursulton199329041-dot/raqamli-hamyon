import { Text, View } from 'react-native';
import { Button } from '@/design/Controls';
import { GlassCard } from '@/design/Glass';
import { Ink, usePalette, useT } from '@/design/theme';
import { useUpdates } from '@/updates/updates';

/** Non-blocking notices: downloaded OTA update ready, or a newer store version is available. */
export function UpdateBanner() {
  const t = useT();
  const p = usePalette();
  const { ready, store, apply, openStore } = useUpdates();
  if (!ready && store !== 'optional') return null;
  return (
    <GlassCard tint={Ink.transfer} padding={12}>
      <View style={{ gap: 2 }}>
        <Text style={{ color: p.text, fontWeight: '700' }}>{ready ? t('update_ready') : t('store_update')}</Text>
        <Button
          title={ready ? t('restart_now') : t('open_store')}
          variant="tonal"
          onPress={() => void (ready ? apply() : openStore())}
          style={{ marginTop: 8, minHeight: 44 }}
        />
      </View>
    </GlassCard>
  );
}

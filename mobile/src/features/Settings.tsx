import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Platform, ScrollView, Text, View } from 'react-native';
import { ApiError } from '@/api/client';
import { Button, Chip, Field, Label, Segmented, Wrap } from '@/design/Controls';
import { GlassCard } from '@/design/Glass';
import { Ink, usePalette, useT } from '@/design/theme';
import { LANGS } from '@/i18n';
import { getStorage, type UpdateLogEntry } from '@/offline/storage';
import { useQueue } from '@/state/queue';
import { api, queryClient } from '@/state/runtime';
import { useSession } from '@/state/session';
import { useSettings, type ThemeMode } from '@/state/settings';
import { runtimeInfo, useUpdates } from '@/updates/updates';

export function Settings() {
  const t = useT();
  const p = usePalette();
  const router = useRouter();
  const s = useSettings();
  const user = useSession((x) => x.user);
  const signOut = useSession((x) => x.signOut);
  const queue = useQueue();
  const upd = useUpdates();
  const [log, setLog] = useState<UpdateLogEntry[]>([]);
  const [url, setUrl] = useState(s.apiUrl);
  const info = runtimeInfo();

  useEffect(() => {
    void getStorage().then((st) => st.updateLog(20)).then(setLog).catch(() => undefined);
    void useUpdates.getState().loadNativeLog();
  }, [upd.checking, upd.ready]);

  const confirm = (title: string, msg: string, ok: () => void) => {
    if (Platform.OS === 'web') {
      if (window.confirm(`${title}\n${msg}`)) ok();
      return;
    }
    Alert.alert(title, msg, [{ text: t('cancel'), style: 'cancel' }, { text: t('delete'), style: 'destructive', onPress: ok }]);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60, gap: 12 }}>
      <Text style={{ color: p.text, fontSize: 24, fontWeight: '800' }}>{t('settings')}</Text>

      <GlassCard>
        <Text style={{ color: p.text, fontWeight: '800', fontSize: 17 }}>{user?.displayName}</Text>
        <Text style={{ color: p.textSecondary }}>{user?.email}</Text>
      </GlassCard>

      <GlassCard>
        <Label>{t('language')}</Label>
        <Segmented value={s.lang} onChange={(v) => void s.update({ lang: v })}
          options={LANGS.map((l) => ({ value: l, label: l === 'uz' ? 'O‘zbek' : l === 'ru' ? 'Русский' : 'English' }))} />
        <Label>{t('theme')}</Label>
        <Segmented<ThemeMode> value={s.themeMode} onChange={(v) => void s.update({ themeMode: v })}
          options={[{ value: 'dark', label: t('dark') }, { value: 'light', label: t('light') }, { value: 'system', label: t('system') }]} />
        <Label>{t('reduce_effects')}</Label>
        <Wrap>
          <Chip label={s.reduceEffects ? 'ON' : 'OFF'} selected={s.reduceEffects} onPress={() => void s.update({ reduceEffects: !s.reduceEffects })} />
        </Wrap>
      </GlassCard>

      <GlassCard>
        <Text style={{ color: p.text, fontWeight: '800' }}>{t('syncing')}</Text>
        <Text style={{ color: p.textSecondary, marginTop: 4 }}>
          {queue.online ? t('synced') : t('offline')}{queue.pending.length ? ` · ${t('sync_pending', { n: queue.pending.length })}` : ''}
        </Text>
        <Button title={t('retry')} variant="tonal" onPress={() => void queue.flush().then(() => queryClient.invalidateQueries())} />
        <Field label={t('api_url')} value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false}
          onSubmitEditing={() => void s.update({ apiUrl: url.trim() })} onBlur={() => void s.update({ apiUrl: url.trim() })} />
      </GlassCard>

      <GlassCard>
        <Text style={{ color: p.text, fontWeight: '800' }}>{t('dnd_diag')}</Text>
        <Button testID="open-dnd-test" title={t('dnd_diag')} variant="tonal" onPress={() => router.push('/dnd-test')} />
      </GlassCard>

      <GlassCard>
        <Text style={{ color: p.text, fontWeight: '800' }}>{t('updates')}</Text>
        <Text style={{ color: p.textSecondary, marginTop: 4 }}>
          {t('version')} {info.version} ({info.build}) · {info.channel} · runtime {info.runtimeVersion}
        </Text>
        <Label>{t('diagnostics')}</Label>
        {([
          ['updateId', info.updateId],
          ['channel', info.channel],
          ['runtimeVersion', info.runtimeVersion],
          ['isEnabled', String(info.otaEnabled)],
          ['isEmbeddedLaunch', String(info.embeddedLaunch)],
          ['isEmergencyLaunch', `${info.emergencyLaunch}${info.emergencyLaunch ? ` (${info.emergencyReason})` : ''}`],
          ['checkAutomatically', info.checkAutomatically],
          ['updateCreatedAt', info.updateCreatedAt],
          ['updates.url', info.updatesUrl],
          ['lastChecked', upd.lastChecked ?? '-'],
          ['lastResult', upd.lastResult ?? '-'],
          ['lastError', upd.lastError ?? '-'],
        ] as [string, string][]).map(([k, v]) => (
          <Text key={k} selectable style={{ color: k === 'lastError' && upd.lastError ? Ink.expense : p.textSecondary, fontSize: 12 }}>
            {k}: {v}
          </Text>
        ))}
        {upd.nativeLog.map((l, i) => (
          <Text key={i} selectable numberOfLines={3} style={{ color: p.textSecondary, fontSize: 11 }}>native: {l}</Text>
        ))}
        {upd.ready && <Text style={{ color: p.accent, marginTop: 6 }}>{t('update_ready')}</Text>}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button title={t('check_updates')} variant="tonal" busy={upd.checking} onPress={() => void upd.check('manual')} />
          </View>
          {upd.ready && (
            <View style={{ flex: 1 }}>
              <Button title={t('restart_now')} onPress={() => void upd.apply()} />
            </View>
          )}
        </View>
        {upd.store !== 'ok' && <Button title={t('open_store')} variant="tonal" onPress={() => void upd.openStore()} />}
        <Label>{t('update_history')}</Label>
        {log.length === 0 && <Text style={{ color: p.textSecondary }}>—</Text>}
        {log.map((e) => (
          <Text key={e.id} style={{ color: p.textSecondary, fontSize: 12 }} numberOfLines={2}>
            {e.at.slice(0, 16).replace('T', ' ')} · {e.kind} · {e.detail}
          </Text>
        ))}
      </GlassCard>

      <Button title={t('logout')} variant="tonal" onPress={() => {
        if (queue.pending.length > 0) {
          confirm(t('logout'), t('sync_pending', { n: queue.pending.length }), () => void signOut());
        } else void signOut();
      }} />
      <Button title={t('delete_account')} variant="danger" onPress={() =>
        confirm(t('delete_account'), t('delete_account_confirm'), () => {
          void (async () => {
            try {
              await api.del('/api/me');
              await signOut(false);
            } catch (e) {
              Alert.alert(e instanceof ApiError ? e.message : t('error_generic'));
            }
          })();
        })} />
    </ScrollView>
  );
}

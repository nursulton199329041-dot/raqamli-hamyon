import { useRouter } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Platform, ScrollView, Switch, Text, View } from 'react-native';
import { ApiError } from '@/api/client';
import { Button, Chip, Field, Label, Segmented } from '@/design/Controls';
import { GlassCard, Tap } from '@/design/Glass';
import { Glyph } from '@/design/Icon';
import { useScreenLayout } from '@/design/layout';
import { Sheet } from '@/design/Sheet';
import { Ink, usePalette, useT } from '@/design/theme';
import { LANGS, type Lang } from '@/i18n';
import { getStorage, type UpdateLogEntry } from '@/offline/storage';
import { useQueue } from '@/state/queue';
import { api, queryClient } from '@/state/runtime';
import { useSession } from '@/state/session';
import { useSettings, type ThemeMode } from '@/state/settings';
import { runtimeInfo, useUpdates } from '@/updates/updates';
import { AppearanceCard, PanelCard } from './AppearanceCard';
import { BalanceSheet } from './BalanceSheet';
import { STORE_BUILD } from '@/lib/storeBuild';
import { ConnectionCard } from './ConnectionCard';
import { ExportSheet } from './ExportSheet';
import { ProfilesSheet } from './ProfilesSheet';
import { WipeSheet } from './WipeSheet';

type Page = 'account' | 'appearance' | 'panel' | 'language' | 'server' | 'updates' | 'profiles' | 'export' | 'balance' | 'wipe';

const LANG_NAME: Record<Lang, string> = { uz: 'O‘zbek', ru: 'Русский', en: 'English' };

/** A rounded block of rows, one line between them. */
function Group({ children }: { children: ReactNode }) {
  return <GlassCard padding={0}><View>{children}</View></GlassCard>;
}

/** One settings line: title with an optional hint under it, an optional value and a chevron when it leads somewhere. */
function Row({ testID, title, hint, value, right, onPress, first }: {
  testID?: string; title: string; hint?: string; value?: string; right?: ReactNode; onPress?(): void; first?: boolean;
}) {
  const p = usePalette();
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingVertical: 10, paddingHorizontal: 16, borderTopWidth: first ? 0 : 1, borderTopColor: p.glassBorder }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: p.text, fontSize: 16, fontWeight: '600' }}>{title}</Text>
        {hint ? <Text numberOfLines={2} style={{ color: p.textSecondary, fontSize: 12, marginTop: 2 }}>{hint}</Text> : null}
      </View>
      {value ? <Text numberOfLines={1} style={{ color: p.textSecondary, fontSize: 15, maxWidth: '45%' }}>{value}</Text> : null}
      {right}
      {onPress ? <Glyph name="chevronRight" color={p.textSecondary} size={18} /> : null}
    </View>
  );
  return onPress ? <Tap testID={testID} label={title} haptic={false} onPress={onPress}>{body}</Tap> : <View testID={testID}>{body}</View>;
}

/** A section opened from the list: its title, a close button, then its content. */
function PageSheet({ title, visible, onClose, children }: { title: string; visible: boolean; onClose(): void; children: ReactNode }) {
  const t = useT();
  const p = usePalette();
  return (
    <Sheet visible={visible} onClose={onClose} full>
      {visible ? (
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 40 }}>
            <View style={{ width: 40 }} />
            <Text accessibilityRole="header" numberOfLines={1} style={{ flex: 1, textAlign: 'center', color: p.text, fontSize: 17, fontWeight: '700' }}>{title}</Text>
            <Tap testID="page-close" label={t('close')} onPress={onClose}
              style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: p.glassFill, borderWidth: 1, borderColor: p.glassBorder }}>
              <Glyph name="close" color={p.text} size={18} />
            </Tap>
          </View>
          {children}
        </View>
      ) : null}
    </Sheet>
  );
}

export function Settings() {
  const t = useT();
  const p = usePalette();
  const L = useScreenLayout();
  const router = useRouter();
  const s = useSettings();
  const user = useSession((x) => x.user);
  const signOut = useSession((x) => x.signOut);
  const guest = useSession((x) => x.status === 'guest');
  const setLinking = useSession((x) => x.setLinking);
  const queue = useQueue();
  const upd = useUpdates();
  const [log, setLog] = useState<UpdateLogEntry[]>([]);
  const [url, setUrl] = useState(s.apiUrl);
  const [page, setPage] = useState<Page | null>(null);
  const info = runtimeInfo();
  const close = () => setPage(null);

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

  const themeName = s.themeMode === 'dark' ? t('dark') : s.themeMode === 'light' ? t('light') : t('system');
  const syncState = `${queue.online ? t('synced') : t('offline')}${queue.pending.length ? ` · ${t('sync_pending', { n: queue.pending.length })}` : ''}`;

  return (
    <ScrollView testID="settings-scroll" contentContainerStyle={{ padding: 16, paddingBottom: L.bottomSpace + 16, gap: 14 }}>
      <Text accessibilityRole="header" style={{ color: p.text, fontSize: 28, fontWeight: '800' }}>{t('settings')}</Text>

      <Group>
        {guest ? (
          <>
            <Row first title={t('guest_title')} hint={t('guest_hint')} />
            {STORE_BUILD ? null : <Row testID="link-account" title={t('link_account')} onPress={() => setLinking(true)} />}
          </>
        ) : (
          <Row first testID="open-account" title={`${t('my_account')}: ${user?.email ?? ''}`} hint={syncState} onPress={() => setPage('account')} />
        )}
        <Row testID="open-profiles" title={t('profiles')} hint={t('profiles_hint')} onPress={() => setPage('profiles')} />
        <Row testID="main-currency" title={t('main_currency')} hint={t('main_currency_name')} value="so‘m" />
        <Row testID="debts-row" title={t('debts')} hint={t('debts_hint')}
          right={<Switch accessibilityLabel={t('debts')} value={s.appearance.showDebts} onValueChange={(v) => void s.setAppearance({ showDebts: v })} />} />
        <Row testID="open-panel" title={t('panel_settings')} onPress={() => setPage('panel')} />
        {/* the file and the correction are made by the server: an account without one has nothing to ask */}
        {guest ? null : <Row testID="open-export" title={t('export_data')} hint={t('export_hint')} onPress={() => setPage('export')} />}
        {guest ? null : <Row testID="open-balance" title={t('adjust_title')} hint={t('adjust_hint')} onPress={() => setPage('balance')} />}
        <Row testID="open-wipe" title={t('wipe_row')} hint={t('wipe_hint')} onPress={() => setPage('wipe')} />
      </Group>

      <Group>
        <Row first testID="open-language" title={t('language')} value={LANG_NAME[s.lang]} onPress={() => setPage('language')} />
        <Row testID="open-appearance" title={t('theme')} hint={themeName} onPress={() => setPage('appearance')} />
      </Group>

      <Group>
        {/* projects left the main navigation; their data, screens and APIs are unchanged */}
        <Row first testID="open-projects" title={t('projects')} onPress={() => router.push('/projects')} />
        {STORE_BUILD ? null : <Row testID="open-server" title={t('conn_title')} hint={syncState} onPress={() => setPage('server')} />}
        <Row testID="open-updates" title={t('updates')} hint={upd.ready ? t('update_ready') : undefined} value={info.version} onPress={() => setPage('updates')} />
        {/* developer tool: not shipped in release builds */}
        {__DEV__ ? <Row testID="open-dnd-test" title={t('dnd_diag')} onPress={() => router.push('/dnd-test')} /> : null}
      </Group>

      <Text style={{ color: p.textSecondary, fontSize: 13, paddingHorizontal: 16 }}>{t('version')}: {info.version} ({info.build})</Text>

      <ProfilesSheet visible={page === 'profiles'} onClose={close} />
      <ExportSheet visible={page === 'export'} onClose={close} />
      <WipeSheet visible={page === 'wipe'} onClose={close} />
      <BalanceSheet visible={page === 'balance'} onClose={close} />

      <PageSheet title={t('panel_settings')} visible={page === 'panel'} onClose={close}>
        <PanelCard />
      </PageSheet>

      <PageSheet title={t('my_account')} visible={page === 'account'} onClose={close}>
        <GlassCard>
          <Text style={{ color: p.text, fontWeight: '800', fontSize: 17 }}>{user?.displayName}</Text>
          <Text style={{ color: p.textSecondary }}>{user?.email}</Text>
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
      </PageSheet>

      {/* everything about how the app looks lives in one place */}
      <PageSheet title={t('theme')} visible={page === 'appearance'} onClose={close}>
        <GlassCard>
          <Label>{t('theme')}</Label>
          <Segmented<ThemeMode> value={s.themeMode} onChange={(v) => void s.update({ themeMode: v })}
            options={[{ value: 'dark', label: t('dark') }, { value: 'light', label: t('light') }, { value: 'system', label: t('system') }]} />
        </GlassCard>
        <AppearanceCard />
      </PageSheet>

      <PageSheet title={t('language')} visible={page === 'language'} onClose={close}>
        <Group>
          {LANGS.map((l, i) => (
            <Tap key={l} testID={`lang-${l}`} label={LANG_NAME[l]} haptic={false} onPress={() => { void s.update({ lang: l }); close(); }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: 16, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: p.glassBorder }}>
                <Text style={{ flex: 1, color: p.text, fontSize: 16, fontWeight: '600' }}>{LANG_NAME[l]}</Text>
                {s.lang === l ? <Glyph name="check" color={p.accent} size={20} /> : null}
              </View>
            </Tap>
          ))}
        </Group>
      </PageSheet>

      <PageSheet title={t('conn_title')} visible={page === 'server'} onClose={close}>
        <ConnectionCard />
        <GlassCard>
          <Text style={{ color: p.text, fontWeight: '800' }}>{t('syncing')}</Text>
          <Text style={{ color: p.textSecondary, marginTop: 4 }}>{syncState}</Text>
          <Button title={t('retry')} variant="tonal" onPress={() => void queue.flush().then(() => queryClient.invalidateQueries())} />
          {Platform.OS !== 'web' && !guest && (
            <>
              <Label>{t('offline_first')}</Label>
              <Text style={{ color: p.textSecondary }}>{t('offline_first_hint')}</Text>
              <View style={{ flexDirection: 'row' }}>
                <Chip label={s.localFirst ? t('on') : t('off')} selected={s.localFirst}
                  onPress={() => void s.update({ localFirst: !s.localFirst }).then(() => queryClient.invalidateQueries())} />
              </View>
            </>
          )}
          <Field label={t('api_url')} value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false}
            onSubmitEditing={() => void s.update({ apiUrl: url.trim() })} onBlur={() => void s.update({ apiUrl: url.trim() })} />
        </GlassCard>
      </PageSheet>

      <PageSheet title={t('updates')} visible={page === 'updates'} onClose={close}>
        <GlassCard>
          <Text style={{ color: p.textSecondary }}>
            {t('version')} {info.version} ({info.build}) · {info.channel} · runtime {info.runtimeVersion}
          </Text>
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
          <Label>{t('update_history')}</Label>
          {log.length === 0 && <Text style={{ color: p.textSecondary }}>—</Text>}
          {log.map((e) => (
            <Text key={e.id} style={{ color: p.textSecondary, fontSize: 12 }} numberOfLines={2}>
              {e.at.slice(0, 16).replace('T', ' ')} · {e.kind} · {e.detail}
            </Text>
          ))}
        </GlassCard>
      </PageSheet>
    </ScrollView>
  );
}

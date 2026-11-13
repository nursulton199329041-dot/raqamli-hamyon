import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { ApiError } from '@/api/client';
import { Button, Chip, ErrorText, Field } from '@/design/Controls';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GlassCard, Tap } from '@/design/Glass';
import { Glyph } from '@/design/Icon';
import { usePalette, useT } from '@/design/theme';
import { LANGS } from '@/i18n';
import { useSession } from '@/state/session';
import { isLocalUrl } from '@/lib/serverUrl';
import { STORE_BUILD } from '@/lib/storeBuild';
import { space, type } from '@/design/tokens';
import { useSettings } from '@/state/settings';
import { ConnectionCard } from './ConnectionCard';
import { DndDiagnostics } from './DndDiagnostics';

export function Auth() {
  const t = useT();
  const p = usePalette();
  const { lang, apiUrl, update } = useSettings();
  const [server, setServer] = useState(apiUrl);
  const [showServer, setShowServer] = useState(false);
  const localOnPhone = Platform.OS !== 'web' && isLocalUrl(apiUrl);
  const { login, register, startGuest, linking, setLinking } = useSession();
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diag, setDiag] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) return setError(`${t('email')} / ${t('password')}`);
    setBusy(true);
    setError(null);
    try {
      if (server.trim() !== apiUrl) await update({ apiUrl: server.trim() });
      if (isRegister) await register(email.trim(), password, name.trim() || email.trim());
      else await login(email.trim(), password);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('error_generic'));
    } finally {
      setBusy(false);
    }
  };

  if (STORE_BUILD) {
    // store build: no server and no sign-in, only a welcome and the local account
    return (
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: space.xxl, gap: space.lg }}>
          <View style={{ width: 96, height: 96, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: p.glassFillStrong, borderWidth: 1, borderColor: p.glassBorder }}>
            <Glyph name="wallet" color={p.accent} size={52} />
          </View>
          <Text style={[type.label, { color: p.textSecondary }]}>{t('app')}</Text>
          <Text style={{ color: p.text, fontSize: 30, fontWeight: '700', textAlign: 'center', letterSpacing: -0.6 }}>{t('store_tagline')}</Text>
          <Text style={{ color: p.textSecondary, textAlign: 'center', fontSize: 15 }}>{t('store_private')}</Text>
        </View>
        <View style={{ padding: space.xl, gap: space.lg, maxWidth: 440, width: '100%', alignSelf: 'center' }}>
          <Tap testID="store-start" label={t('store_start')} onPress={() => void startGuest()}
            style={{ height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: p.accent }}>
            <Text style={[type.label, { color: p.onAccent, fontSize: 15, fontWeight: '700' }]}>{t('store_start')}</Text>
          </Tap>
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: space.sm }}>
            {LANGS.map((l) => <Chip key={l} label={l.toUpperCase()} selected={lang === l} onPress={() => void update({ lang: l })} />)}
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (__DEV__ && diag) {
    // works without any server or account: only tests gestures and drop zones
    return (
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: 16, paddingTop: 8, alignItems: 'flex-start' }}>
          <Tap testID="diag-close" label={t('close')} onPress={() => setDiag(false)}><Glyph name="close" color={p.text} size={26} /></Tap>
        </View>
        <Text style={{ color: p.textSecondary, paddingHorizontal: 16 }}>{t('dnd_no_server')}</Text>
        <DndDiagnostics />
      </SafeAreaView>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20 }} keyboardShouldPersistTaps="handled">
        <GlassCard radius={30} padding={24} style={{ maxWidth: 440, width: '100%', alignSelf: 'center' }}>
          <View style={{ alignItems: 'center', gap: 8 }}>
            <Glyph name="wallet" color={p.accent} size={52} />
            <Text style={{ color: p.text, fontSize: 26, fontWeight: '800' }}>{t('app')}</Text>
          </View>
          {linking && <Text testID="link-notice" style={{ color: p.textSecondary, marginTop: 10 }}>{t('link_notice')}</Text>}
          {isRegister && <Field label={t('name')} value={name} onChangeText={setName} />}
          <Field label={t('email')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
          <Field label={t('password')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" onSubmitEditing={submit} />
          {(showServer || localOnPhone) && (
            <>
              <Field label={t('api_url')} value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
              {localOnPhone && <Text style={{ color: p.textSecondary, marginTop: 6 }}>{t('server_local_warn')}</Text>}
            </>
          )}
          <ErrorText>{error}</ErrorText>
          <Button title={t(isRegister ? 'register' : 'login')} busy={busy} onPress={submit} />
          <Button title={t(isRegister ? 'login' : 'register')} variant="tonal" onPress={() => setIsRegister((v) => !v)} />
          {!showServer && !localOnPhone && <Button title={t('api_url')} variant="tonal" onPress={() => setShowServer(true)} />}
          {Platform.OS !== 'web' && !linking && (
            <View style={{ marginTop: 14, gap: 6 }}>
              <Button testID="guest-start" title={t('guest_start')} variant="tonal" onPress={() => void startGuest()} />
              <Text style={{ color: p.textSecondary, fontSize: 12 }}>{t('guest_start_hint')}</Text>
            </View>
          )}
          {linking && <Button testID="link-back" title={t('back')} variant="tonal" onPress={() => setLinking(false)} />}
          <View style={{ marginTop: 14 }}><ConnectionCard /></View>
          {__DEV__ && <Button testID="open-diag" title={t('dnd_diag')} variant="tonal" onPress={() => setDiag(true)} />}
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 16 }}>
            {LANGS.map((l) => <Chip key={l} label={l.toUpperCase()} selected={lang === l} onPress={() => void update({ lang: l })} />)}
          </View>
        </GlassCard>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

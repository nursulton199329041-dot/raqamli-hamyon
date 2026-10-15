import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { ApiError } from '@/api/client';
import { Button, Chip, ErrorText, Field } from '@/design/Controls';
import { GlassCard } from '@/design/Glass';
import { Glyph } from '@/design/Icon';
import { usePalette, useT } from '@/design/theme';
import { LANGS } from '@/i18n';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';

export function Auth() {
  const t = useT();
  const p = usePalette();
  const { lang, update } = useSettings();
  const { login, register } = useSession();
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!email.trim() || !password) return setError(`${t('email')} / ${t('password')}`);
    setBusy(true);
    setError(null);
    try {
      if (isRegister) await register(email.trim(), password, name.trim() || email.trim());
      else await login(email.trim(), password);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('error_generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20 }} keyboardShouldPersistTaps="handled">
        <GlassCard radius={30} padding={24} style={{ maxWidth: 440, width: '100%', alignSelf: 'center' }}>
          <View style={{ alignItems: 'center', gap: 8 }}>
            <Glyph name="wallet" color={p.accent} size={52} />
            <Text style={{ color: p.text, fontSize: 26, fontWeight: '800' }}>{t('app')}</Text>
          </View>
          {isRegister && <Field label={t('name')} value={name} onChangeText={setName} />}
          <Field label={t('email')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
          <Field label={t('password')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" onSubmitEditing={submit} />
          <ErrorText>{error}</ErrorText>
          <Button title={t(isRegister ? 'register' : 'login')} busy={busy} onPress={submit} />
          <Button title={t(isRegister ? 'login' : 'register')} variant="tonal" onPress={() => setIsRegister((v) => !v)} />
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 16 }}>
            {LANGS.map((l) => <Chip key={l} label={l.toUpperCase()} selected={lang === l} onPress={() => void update({ lang: l })} />)}
          </View>
        </GlassCard>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

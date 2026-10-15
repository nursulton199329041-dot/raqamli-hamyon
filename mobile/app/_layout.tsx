import { QueryClientProvider } from '@tanstack/react-query';
import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, AppState, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Button } from '@/design/Controls';
import { GlassBackground } from '@/design/Glass';
import { usePalette, useT } from '@/design/theme';
import { DragProvider } from '@/dnd/DragDrop';
import { Auth } from '@/features/Auth';
import { FormSheets } from '@/features/FormSheets';
import { OperationSheet } from '@/features/OperationSheet';
import { useQueue } from '@/state/queue';
import { queryClient } from '@/state/runtime';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import { useUpdates } from '@/updates/updates';

function Bootstrap() {
  const hydrated = useSettings((s) => s.hydrated);
  const status = useSession((s) => s.status);
  const p = usePalette();
  const t = useT();
  const { store, apiIncompatible, openStore } = useUpdates();

  useEffect(() => {
    void (async () => {
      await useSettings.getState().hydrate();
      await useQueue.getState().hydrate();
      await useSession.getState().restore();
      void useUpdates.getState().check('launch');
      void useUpdates.getState().checkPolicy();
    })();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') {
        void useUpdates.getState().check('foreground');
        void useUpdates.getState().checkPolicy();
        void useQueue.getState().flush();
      }
    });
    // Retry the offline queue periodically while signed in.
    const timer = setInterval(() => {
      if (useSession.getState().status === 'signedIn') void useQueue.getState().flush();
    }, 30_000);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, []);

  if (!hydrated || status === 'loading') {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={p.accent} size="large" /></View>;
  }
  if (store === 'required' || apiIncompatible) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 }}>
        <Text style={{ color: p.text, fontSize: 20, fontWeight: '800', textAlign: 'center' }}>{t('store_update_required')}</Text>
        <Button title={t('open_store')} onPress={() => void openStore()} />
      </View>
    );
  }
  if (status === 'signedOut') return <Auth />;
  return (
    <>
      <ThemeProvider value={{ ...DefaultTheme, colors: { ...DefaultTheme.colors, background: 'transparent', card: 'transparent' } }}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' }, animation: 'fade' }} />
      </ThemeProvider>
      <OperationSheet />
      <FormSheets />
    </>
  );
}

function Themed() {
  const p = usePalette();
  return (
    <GlassBackground>
      <StatusBar style={p.dark ? 'light' : 'dark'} />
      <Bootstrap />
    </GlassBackground>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <DragProvider>
            <Themed />
          </DragProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
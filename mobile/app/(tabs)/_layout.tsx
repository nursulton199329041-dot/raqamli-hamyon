import { Tabs } from 'expo-router';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassCard, Tap } from '@/design/Glass';
import { Glyph } from '@/design/Icon';
import { usePalette, useT } from '@/design/theme';

const ITEMS = [
  { name: 'index', icon: 'wallet', key: 'home' },
  { name: 'history', icon: 'history', key: 'history' },
  { name: 'analytics', icon: 'chart', key: 'analytics' },
  { name: 'projects', icon: 'project', key: 'projects' },
  { name: 'debts', icon: 'handshake', key: 'debts' },
] as const;

/** Floating glass tab bar – the same component and metrics on iOS, Android and Web. */
interface BarProps {
  state: { index: number };
  navigation: { navigate(name: string): void };
}

function FloatingBar({ state, navigation }: BarProps) {
  const p = usePalette();
  const t = useT();
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 10, right: 10, bottom: Math.max(insets.bottom, 8) }}>
      <GlassCard radius={24} padding={4}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {ITEMS.map((it, i) => {
            const on = state.index === i;
            return (
              <Tap key={it.name} label={t(it.key)} containerStyle={{ flex: 1 }} onPress={() => navigation.navigate(it.name)}>
                <View style={{
                  alignItems: 'center', justifyContent: 'center', minHeight: 48, paddingVertical: 6, paddingHorizontal: 2, borderRadius: 18,
                  backgroundColor: on ? `${p.accent}38` : 'transparent',
                }}>
                  <Glyph name={it.icon} color={on ? p.accent : p.textSecondary} size={20} />
                  <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}
                    style={{ fontSize: 10, color: on ? p.accent : p.textSecondary, marginTop: 1, maxWidth: '100%' }}>{t(it.key)}</Text>
                </View>
              </Tap>
            );
          })}
        </View>
      </GlassCard>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs tabBar={(props) => <FloatingBar {...props} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: 'transparent' } }}>
      {ITEMS.map((it) => <Tabs.Screen key={it.name} name={it.name} />)}
    </Tabs>
  );
}
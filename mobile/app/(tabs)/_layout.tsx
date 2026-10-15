import { Tabs } from 'expo-router';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassCard, Tap } from '@/design/Glass';
import { Glyph } from '@/design/Icon';
import { usePalette, useT } from '@/design/theme';
import { useUi } from '@/state/ui';

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
  const openOp = useUi((s) => s.openOp);
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 12, right: 12, bottom: Math.max(insets.bottom, 10) }}>
      <GlassCard radius={30} padding={6}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {ITEMS.map((it, i) => {
            const on = state.index === i;
            return (
              <Tap key={it.name} label={t(it.key)} style={{ flex: 1 }} onPress={() => navigation.navigate(it.name)}>
                <View style={{
                  alignItems: 'center', paddingVertical: 8, borderRadius: 22,
                  backgroundColor: on ? `${p.accent}38` : 'transparent',
                }}>
                  <Glyph name={it.icon} color={on ? p.accent : p.textSecondary} size={22} />
                  <Text numberOfLines={1} style={{ fontSize: 10, color: on ? p.accent : p.textSecondary, marginTop: 2 }}>{t(it.key)}</Text>
                </View>
              </Tap>
            );
          })}
          <Tap label="+" onPress={() => openOp({ kind: 'expense' })} style={{ paddingHorizontal: 10 }}>
            <Glyph name="plus" color={p.accent} size={30} />
          </Tap>
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
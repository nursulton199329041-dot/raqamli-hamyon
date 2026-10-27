import { Tabs } from 'expo-router';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassCard, Tap } from '@/design/Glass';
import { Glyph } from '@/design/Icon';
import { usePalette, useT } from '@/design/theme';
import { elevation, iconSize, radii, space, type } from '@/design/tokens';

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
    <View pointerEvents="box-none" style={{ position: 'absolute', left: space.md, right: space.md, bottom: Math.max(insets.bottom, space.sm) }}>
      <GlassCard radius={radii.xl} padding={space.xs} style={elevation.float}>
        <View accessibilityRole="tablist" style={{ flexDirection: 'row', alignItems: 'center' }}>
          {ITEMS.map((it, i) => {
            const on = state.index === i;
            return (
              <Tap key={it.name} label={t(it.key)} containerStyle={{ flex: 1 }} onPress={() => { if (!on) navigation.navigate(it.name); }}>
                <View accessibilityState={{ selected: on }} style={{
                  alignItems: 'center', justifyContent: 'center', minHeight: 54, paddingVertical: space.xs, paddingHorizontal: space.xxs, borderRadius: radii.lg,
                  backgroundColor: on ? `${p.accent}2E` : 'transparent',
                }}>
                  <Glyph name={it.icon} color={on ? p.accent : p.textSecondary} size={iconSize.lg - 2} />
                  <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}
                    style={[type.caption, { color: on ? p.accent : p.textSecondary, marginTop: 2, maxWidth: '100%', fontWeight: on ? '700' : '600' }]}>{t(it.key)}</Text>
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
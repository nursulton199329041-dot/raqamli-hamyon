import { LinearGradient } from 'expo-linear-gradient';
import { Tabs } from 'expo-router';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassCard, Tap } from '@/design/Glass';
import { Glyph } from '@/design/Icon';
import { SIDEBAR_W, useScreenLayout } from '@/design/layout';
import { MAIN_TABS, SECONDARY_ROUTES } from '@/design/navItems';
import { usePalette, useT } from '@/design/theme';
import { elevation, iconSize, radii, space, type } from '@/design/tokens';

const ITEMS = MAIN_TABS;
const SECONDARY = SECONDARY_ROUTES;

interface BarProps {
  state: { index: number; routes: { name: string }[] };
  navigation: { navigate(name: string): void };
}

/** Route of the visible screen (indexes include hidden routes, so match by name). */
const activeName = (s: BarProps['state']) => s.routes[s.index]?.name;

/** Mobile / tablet: floating glass tab bar over the content (capped and centred on tablets). */
function FloatingBar({ state, navigation }: BarProps) {
  const p = usePalette();
  const t = useT();
  const insets = useSafeAreaInsets();
  // iOS-style: separate round glass buttons; the active tab grows into a solid honey-gold pill with a mono label.
  const H = 60;
  return (
    <>
    {/* bottom fade so scrolled content sinks into the background behind the buttons */}
    <LinearGradient pointerEvents="none" colors={[`${p.bgBottom}00`, `${p.bgBottom}E6`, p.bgBottom]} locations={[0, 0.55, 1]}
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: H + Math.max(insets.bottom, space.sm) + space.xxl * 2 }} />
    <View pointerEvents="box-none" style={{ position: 'absolute', left: space.lg, right: space.lg, bottom: Math.max(insets.bottom, space.sm), alignItems: 'center' }}>
      <View accessibilityRole="tablist" style={[elevation.float, { flexDirection: 'row', alignItems: 'center', gap: space.sm, width: '100%', maxWidth: 560 }]}>
        {ITEMS.map((it) => {
          const on = activeName(state) === it.name;
          return (
            <Tap key={it.name} testID={`tab-${it.name}`} label={t(it.key)} containerStyle={on ? { flex: 1 } : undefined} onPress={() => { if (!on) navigation.navigate(it.name); }}>
              {on ? (
                <View accessibilityState={{ selected: true }} style={{
                  height: H, borderRadius: H / 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm,
                  paddingHorizontal: space.lg, backgroundColor: p.accent,
                }}>
                  <Glyph name={it.icon} color={p.onAccent} size={iconSize.md} />
                  <Text numberOfLines={1} style={[type.label, { color: p.onAccent, fontSize: 13, fontWeight: '700', flexShrink: 1 }]}>{t(it.key)}</Text>
                </View>
              ) : (
                <GlassCard radius={H / 2} padding={0} style={{ width: H, height: H, backgroundColor: p.dark ? 'rgba(22,10,12,0.82)' : 'rgba(255,255,255,0.85)' }} innerStyle={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <View accessibilityState={{ selected: false }}>
                    <Glyph name={it.icon} color={p.text} size={iconSize.lg} />
                  </View>
                </GlassCard>
              )}
            </Tap>
          );
        })}
      </View>
    </View>
    </>
  );
}

/** Desktop: a fixed glass sidebar on the left; it takes its own column, so it never covers content or charts. */
function Sidebar({ state, navigation }: BarProps) {
  const p = usePalette();
  const t = useT();
  return (
    <View testID="sidebar" style={{ width: SIDEBAR_W, padding: space.lg, paddingRight: 0 }}>
      <GlassCard radius={radii.xl} padding={space.md} style={{ flex: 1 }} innerStyle={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.xs, paddingVertical: space.md }}>
          <View style={{ width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: `${p.accent}2E` }}>
            <Glyph name="wallet" color={p.accent} size={iconSize.md} />
          </View>
          {/* "Цифровой кошелёк" is longer than "Raqamli Hamyon": two lines, never cut */}
          <Text numberOfLines={2} style={[type.headline, { color: p.text, flexShrink: 1 }]}>{t('app')}</Text>
        </View>
        <View accessibilityRole="tablist" style={{ gap: space.xs, marginTop: space.sm }}>
          {ITEMS.map((it) => {
            const on = activeName(state) === it.name;
            return (
              <Tap key={it.name} label={t(it.key)} onPress={() => { if (!on) navigation.navigate(it.name); }}>
                <View accessibilityState={{ selected: on }} style={{
                  flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 46, paddingHorizontal: space.md, borderRadius: radii.md,
                  backgroundColor: on ? `${p.accent}2E` : 'transparent',
                }}>
                  <Glyph name={it.icon} color={on ? p.accent : p.textSecondary} size={iconSize.md} />
                  <Text numberOfLines={1} style={[type.callout, { color: on ? p.accent : p.text, fontWeight: on ? '700' : '600' }]}>{t(it.key)}</Text>
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
  const { sidebar } = useScreenLayout();
  return (
    <Tabs
      tabBar={(props) => (sidebar ? <Sidebar {...props} /> : <FloatingBar {...props} />)}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: 'transparent' }, tabBarPosition: sidebar ? 'left' : 'bottom' }}
    >
      {ITEMS.map((it) => <Tabs.Screen key={it.name} name={it.name} />)}
      {SECONDARY.map((name) => <Tabs.Screen key={name} name={name} options={{ href: null }} />)}
    </Tabs>
  );
}

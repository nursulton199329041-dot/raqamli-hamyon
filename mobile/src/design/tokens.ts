import * as Haptics from 'expo-haptics';
import { Platform, type TextStyle } from 'react-native';
import { useReducedMotion, withSpring, withTiming, type WithSpringConfig } from 'react-native-reanimated';

/**
 * Design tokens shared by every screen. Sizes are dp; colours live in `theme.ts` (palette + semantic `Ink`).
 * Rule of thumb: never type a raw font size, gap or radius in a screen — pick the nearest token.
 */

/** 4-pt spacing scale. */
export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;

export const radii = { sm: 12, md: 16, lg: 22, xl: 28, pill: 999 } as const;

/** System monospace face for the uppercase "terminal" labels (section titles, eyebrows, chips). */
export const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' });

/** Text roles. Smallest readable size is 11 (captions); body copy never goes below 13. */
export const type = {
  /** big centred balance on the home screen */
  hero: { fontSize: 44, fontWeight: '700', letterSpacing: -1.2, fontVariant: ['tabular-nums'] },
  /** uppercase monospace eyebrow: "KARTALAR BALANSI" */
  label: { fontSize: 12.5, fontWeight: '500', letterSpacing: 1.1, textTransform: 'uppercase', fontFamily: MONO },
  display: { fontSize: 32, fontWeight: '800', letterSpacing: -0.6 },
  title: { fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  headline: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
  body: { fontSize: 15, fontWeight: '500' },
  callout: { fontSize: 14, fontWeight: '600' },
  footnote: { fontSize: 13, fontWeight: '500' },
  caption: { fontSize: 11.5, fontWeight: '600', letterSpacing: 0.2 },
  amount: { fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
} as const satisfies Record<string, TextStyle>;

export const iconSize = { sm: 16, md: 20, lg: 24, badge: 48, badgeLg: 56 } as const;

/** Minimum touch target (Apple HIG 44, Material 48). */
export const HIT = 48;

/** Elevation steps; shadows are only drawn on surfaces that float (cards over background, tab bar, drag ghost). */
export const elevation = {
  flat: { shadowOpacity: 0, elevation: 0 },
  card: { shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  float: { shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 22, shadowOffset: { width: 0, height: 12 }, elevation: 10 },
} as const;

/** Motion: short, physical, explanatory. */
export const motion = {
  fast: 140,
  base: 220,
  slow: 320,
  press: { damping: 18, stiffness: 340, mass: 0.6 } satisfies WithSpringConfig,
  release: { damping: 14, stiffness: 260 } satisfies WithSpringConfig,
  lift: { damping: 14, stiffness: 220 } satisfies WithSpringConfig,
} as const;

/** Spring that collapses to a short fade-length timing when the OS asks for reduced motion. */
export function spring(to: number, cfg: WithSpringConfig, reduced: boolean) {
  'worklet';
  return reduced ? withTiming(to, { duration: 1 }) : withSpring(to, cfg);
}

export { useReducedMotion };

/** Haptic patterns, one name per meaning. No-ops on web. */
export const haptic = {
  tick() {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  },
  lift() {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  },
  success() {
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  },
  warning() {
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  },
};

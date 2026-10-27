import { useReducedMotion } from 'react-native-reanimated';
import { useSettings, type Appearance, type Size3, type UiStyle } from '@/state/settings';

/**
 * Derived visual parameters of the Appearance settings, read by the shared components (glass cards, badges, tab bar,
 * home tiles) so a preset changes the whole app consistently instead of screen by screen.
 */
export interface Look {
  style: UiStyle;
  /** multiplier for corner radii */
  radiusScale: number;
  /** home tile / badge diameter */
  iconPx: number;
  iconShape: Appearance['iconShape'];
  /** multiplier for text sizes on the home screen, tab bar and section titles */
  fontScale: number;
  /** backdrop blur on glass surfaces (false = flat translucent fill) */
  glass: boolean;
  blurIntensity: number;
  /** badge fill: soft two-tone gradient, flat colour, or vivid gradient */
  badge: 'soft' | 'flat' | 'vivid';
  /** colourful preset tints each home section with its own colour */
  tintSections: boolean;
  /** user switched animations off, or the OS asks for reduced motion */
  motionOff: boolean;
}

const RADIUS: Record<Size3, number> = { s: 0.6, m: 1, l: 1.3 };
const ICON: Record<Size3, number> = { s: 44, m: 52, l: 62 };
const FONT: Record<Size3, number> = { s: 0.92, m: 1, l: 1.12 };

export function lookOf(a: Appearance, reduceEffects: boolean, reducedMotion: boolean): Look {
  const flatStyle = a.uiStyle === 'office' || a.uiStyle === 'minimal';
  return {
    style: a.uiStyle,
    radiusScale: RADIUS[a.radius] * (a.uiStyle === 'office' ? 0.55 : 1),
    iconPx: ICON[a.iconSize],
    iconShape: a.iconShape,
    fontScale: FONT[a.fontScale],
    glass: !reduceEffects && !flatStyle,
    blurIntensity: a.uiStyle === 'super' ? 70 : 40,
    badge: flatStyle ? 'flat' : a.uiStyle === 'colorful' ? 'vivid' : 'soft',
    tintSections: a.uiStyle === 'colorful',
    motionOff: reducedMotion || !a.animations,
  };
}

export function useLook(): Look {
  const a = useSettings((s) => s.appearance);
  const reduceEffects = useSettings((s) => s.reduceEffects);
  return lookOf(a, reduceEffects, useReducedMotion());
}

/** Animations off when the user disabled them or the OS asks for reduced motion. */
export function useMotionOff(): boolean {
  const animations = useSettings((s) => s.appearance.animations);
  return useReducedMotion() || !animations;
}

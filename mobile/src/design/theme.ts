import { useColorScheme } from 'react-native';
import { translate, type I18nKey } from '@/i18n';
import { useSettings, type UiStyle } from '@/state/settings';

export interface Palette {
  dark: boolean;
  bgTop: string; bgBottom: string;
  glassFill: string; glassFillStrong: string; glassBorder: string;
  text: string; textSecondary: string; accent: string;
  /** readable text / icon colour on a solid accent fill (dark on light accents like gold, white on deep ones) */
  onAccent: string;
  orbA: string; orbB: string; overlay: string;
  blurTint: 'dark' | 'light';
}

/**
 * Garnet noir: near-black warm base with a deep garnet glow on top and an amber glow below (orbA / orbB), smoked
 * warm glass, honey-gold accent for the primary action. Inspired by premium iOS banking apps.
 */
export const darkPalette: Palette = {
  dark: true,
  bgTop: '#2B0D12', bgBottom: '#0A0607',
  glassFill: 'rgba(255,236,228,0.07)', glassFillStrong: 'rgba(255,236,228,0.13)', glassBorder: 'rgba(255,236,228,0.10)',
  text: '#FBF5F2', textSecondary: '#BFAEA9', accent: '#F2C14E', onAccent: '#1A0B0D',
  orbA: '#8E1F2E', orbB: '#B4561C', overlay: 'rgba(8,3,4,0.66)', blurTint: 'dark',
};

/** Warm ivory, white glass layers, hairline warm-grey borders, garnet accent. */
export const lightPalette: Palette = {
  dark: false,
  bgTop: '#FBF4F1', bgBottom: '#EEDFD9',
  glassFill: 'rgba(255,255,255,0.70)', glassFillStrong: 'rgba(255,255,255,0.92)', glassBorder: 'rgba(60,20,24,0.08)',
  text: '#1C0C0E', textSecondary: '#6E5A58', accent: '#9E1C33', onAccent: '#FFFFFF',
  orbA: '#F2B8C0', orbB: '#F6D3A8', overlay: 'rgba(28,12,14,0.32)', blurTint: 'light',
};

/** Semantic finance colours – identical on iOS and Android. */
export const Ink = {
  income: '#1FCB8B',
  expense: '#FF6B6B',
  transfer: '#7C6CFF',
  debt: '#F5A524',
} as const;

/** Surface adjustments per Appearance style (accent override is applied on top). */
/** Dark ink on light accents (gold, champagne, silver), white on deep ones — WCAG relative luminance. */
export function onAccentOf(hex: string): string {
  const ch = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * ch(1) + 0.7152 * ch(3) + 0.0722 * ch(5);
  return lum > 0.36 ? '#1A0B0D' : '#FFFFFF';
}

function styled(base: Palette, style: UiStyle, accent: string | null): Palette {
  const p = { ...base, accent: accent ?? base.accent, onAccent: accent ? onAccentOf(accent) : base.onAccent };
  switch (style) {
    case 'super': // denser, brighter glass
      return { ...p, glassFill: base.dark ? 'rgba(255,255,255,0.11)' : 'rgba(255,255,255,0.80)', glassBorder: base.dark ? 'rgba(255,255,255,0.24)' : 'rgba(15,23,42,0.10)' };
    case 'office': // solid, clearly bordered panels
      return { ...p, glassFill: base.dark ? '#1E0F12' : '#FFFFFF', glassFillStrong: base.dark ? '#2A1418' : '#F7EFEC', glassBorder: base.dark ? 'rgba(255,255,255,0.16)' : 'rgba(15,23,42,0.16)' };
    case 'minimal': // almost no surfaces: content on the background
      return { ...p, glassFill: base.dark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.45)', glassBorder: base.dark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)' };
    default:
      return p;
  }
}

export function usePalette(): Palette {
  const mode = useSettings((s) => s.themeMode);
  const style = useSettings((s) => s.appearance.uiStyle);
  const accent = useSettings((s) => s.appearance.accent);
  const system = useColorScheme();
  const dark = mode === 'dark' || (mode === 'system' && system !== 'light');
  return styled(dark ? darkPalette : lightPalette, style, accent);
}

export function useT() {
  const lang = useSettings((s) => s.lang);
  return (key: I18nKey, args?: Record<string, string | number>) => translate(lang, key, args);
}

export const radius = { sm: 12, md: 18, lg: 24, xl: 30 } as const;

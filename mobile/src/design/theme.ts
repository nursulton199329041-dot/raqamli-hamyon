import { useColorScheme } from 'react-native';
import { translate, type I18nKey } from '@/i18n';
import { useSettings } from '@/state/settings';

export interface Palette {
  dark: boolean;
  bgTop: string; bgBottom: string;
  glassFill: string; glassFillStrong: string; glassBorder: string;
  text: string; textSecondary: string; accent: string;
  orbA: string; orbB: string; overlay: string;
  blurTint: 'dark' | 'light';
}

export const darkPalette: Palette = {
  dark: true,
  bgTop: '#050B1A', bgBottom: '#0B1B3A',
  glassFill: 'rgba(255,255,255,0.09)', glassFillStrong: 'rgba(255,255,255,0.16)', glassBorder: 'rgba(255,255,255,0.20)',
  text: '#F4F7FF', textSecondary: '#A9B6D3', accent: '#6EA8FF',
  orbA: '#2F6BFF', orbB: '#8FA8D6', overlay: 'rgba(0,0,0,0.55)', blurTint: 'dark',
};

export const lightPalette: Palette = {
  dark: false,
  bgTop: '#F4F6FB', bgBottom: '#DCE4F2',
  glassFill: 'rgba(255,255,255,0.62)', glassFillStrong: 'rgba(255,255,255,0.85)', glassBorder: 'rgba(255,255,255,0.9)',
  text: '#0E1630', textSecondary: '#55627D', accent: '#2563EB',
  orbA: '#9DB8FF', orbB: '#BFD0EE', overlay: 'rgba(14,22,48,0.35)', blurTint: 'light',
};

/** Semantic finance colours – identical on iOS and Android. */
export const Ink = {
  income: '#22C55E',
  expense: '#FF6B6B',
  transfer: '#3B82F6',
  debt: '#F59E0B',
} as const;

export function usePalette(): Palette {
  const mode = useSettings((s) => s.themeMode);
  const system = useColorScheme();
  const dark = mode === 'dark' || (mode === 'system' && system !== 'light');
  return dark ? darkPalette : lightPalette;
}

export function useT() {
  const lang = useSettings((s) => s.lang);
  return (key: I18nKey, args?: Record<string, string | number>) => translate(lang, key, args);
}

export const radius = { sm: 12, md: 18, lg: 24, xl: 30 } as const;

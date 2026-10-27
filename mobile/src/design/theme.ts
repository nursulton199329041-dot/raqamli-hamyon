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

/** Midnight navy base, blue-violet second layer, electric-blue accent. */
export const darkPalette: Palette = {
  dark: true,
  bgTop: '#060A18', bgBottom: '#141A3D',
  glassFill: 'rgba(255,255,255,0.075)', glassFillStrong: 'rgba(255,255,255,0.14)', glassBorder: 'rgba(255,255,255,0.14)',
  text: '#F5F7FF', textSecondary: '#A3AECB', accent: '#4D8DFF',
  orbA: '#2E5BFF', orbB: '#7B5CFF', overlay: 'rgba(2,4,12,0.6)', blurTint: 'dark',
};

/** Premium off-white, white glass layers, hairline grey borders, high text contrast. */
export const lightPalette: Palette = {
  dark: false,
  bgTop: '#F7F8FC', bgBottom: '#E6EAF5',
  glassFill: 'rgba(255,255,255,0.72)', glassFillStrong: 'rgba(255,255,255,0.92)', glassBorder: 'rgba(15,23,42,0.08)',
  text: '#0B1220', textSecondary: '#5A6478', accent: '#1F6BFF',
  orbA: '#B9CCFF', orbB: '#D7CCFF', overlay: 'rgba(11,18,32,0.32)', blurTint: 'light',
};

/** Semantic finance colours – identical on iOS and Android. */
export const Ink = {
  income: '#1FCB8B',
  expense: '#FF6B6B',
  transfer: '#7C6CFF',
  debt: '#F5A524',
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

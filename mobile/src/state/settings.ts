import { create } from 'zustand';
import type { Lang } from '@/i18n';
import { setErrorLang } from '@/api/errors';
import { setNumberLang } from '@/lib/money';
import { getStorage } from '@/offline/storage';
import { api, DEFAULT_API_URL } from './runtime';

export type ThemeMode = 'dark' | 'light' | 'system';

/** Visual style presets (Appearance). */
export type UiStyle = 'liquid' | 'super' | 'office' | 'minimal' | 'colorful';
export type IconShape = 'circle' | 'squircle';
export type Size3 = 's' | 'm' | 'l';
/** The three home sections, in display order. */
export type HomeSection = 'income' | 'wallets' | 'expense';

export interface Appearance {
  uiStyle: UiStyle;
  iconShape: IconShape;
  iconSize: Size3;
  /** accent colour override (#RRGGBB); null = the theme's own accent */
  accent: string | null;
  fontScale: Size3;
  radius: Size3;
  /** user-facing switch for motion (OS "reduce motion" is honoured as well) */
  animations: boolean;
  sectionOrder: HomeSection[];
  hiddenSections: HomeSection[];
}

export const HOME_SECTIONS: HomeSection[] = ['income', 'wallets', 'expense'];

export const DEFAULT_APPEARANCE: Appearance = {
  uiStyle: 'liquid', iconShape: 'circle', iconSize: 'm', accent: null, fontScale: 'm', radius: 'm', animations: true,
  sectionOrder: [...HOME_SECTIONS], hiddenSections: [],
};

const STYLES: UiStyle[] = ['liquid', 'super', 'office', 'minimal', 'colorful'];
const SIZES: Size3[] = ['s', 'm', 'l'];

/** Stored appearance may come from an older app version or be hand-edited: keep only known values. */
export function sanitizeAppearance(a: Partial<Appearance> | undefined): Appearance {
  const d = DEFAULT_APPEARANCE;
  const order = (a?.sectionOrder ?? []).filter((x): x is HomeSection => HOME_SECTIONS.includes(x));
  const complete = [...new Set([...order, ...HOME_SECTIONS])];
  return {
    uiStyle: STYLES.includes(a?.uiStyle as UiStyle) ? a!.uiStyle! : d.uiStyle,
    iconShape: a?.iconShape === 'squircle' ? 'squircle' : 'circle',
    iconSize: SIZES.includes(a?.iconSize as Size3) ? a!.iconSize! : d.iconSize,
    accent: typeof a?.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(a.accent) ? a.accent : null,
    fontScale: SIZES.includes(a?.fontScale as Size3) ? a!.fontScale! : d.fontScale,
    radius: SIZES.includes(a?.radius as Size3) ? a!.radius! : d.radius,
    animations: a?.animations !== false,
    sectionOrder: complete,
    hiddenSections: (a?.hiddenSections ?? []).filter((x): x is HomeSection => HOME_SECTIONS.includes(x)),
  };
}

type Persisted = 'lang' | 'themeMode' | 'reduceEffects' | 'apiUrl' | 'appearance';

interface SettingsState {
  lang: Lang;
  themeMode: ThemeMode;
  /** glass effect off (no blur): the "Glass" switch in Appearance */
  reduceEffects: boolean;
  apiUrl: string;
  appearance: Appearance;
  hydrated: boolean;
  hydrate(): Promise<void>;
  update(patch: Partial<Pick<SettingsState, Persisted>>): Promise<void>;
  /** merge a partial appearance change and persist it */
  setAppearance(patch: Partial<Appearance>): Promise<void>;
}

export const useSettings = create<SettingsState>((set, get) => ({
  lang: 'uz',
  themeMode: 'dark',
  reduceEffects: false,
  apiUrl: DEFAULT_API_URL,
  appearance: DEFAULT_APPEARANCE,
  hydrated: false,
  async hydrate() {
    try {
      const s = await getStorage();
      const raw = await s.get('setting:app');
      if (raw) {
        const j = JSON.parse(raw) as Partial<SettingsState>;
        set({
          lang: j.lang ?? 'uz',
          themeMode: j.themeMode ?? 'dark',
          reduceEffects: j.reduceEffects ?? false,
          apiUrl: j.apiUrl || DEFAULT_API_URL,
          appearance: sanitizeAppearance(j.appearance),
        });
      }
    } catch {
      /* defaults */
    }
    api.baseUrl = get().apiUrl;
    set({ hydrated: true });
  },
  async update(patch) {
    set(patch);
    if (patch.apiUrl) api.baseUrl = patch.apiUrl.replace(/\/+$/, '');
    const { lang, themeMode, reduceEffects, apiUrl, appearance } = get();
    try {
      await (await getStorage()).set('setting:app', JSON.stringify({ lang, themeMode, reduceEffects, apiUrl, appearance }));
    } catch {
      /* non-fatal */
    }
  },
  setAppearance(patch) {
    return get().update({ appearance: sanitizeAppearance({ ...get().appearance, ...patch }) });
  },
}));

// Number / money formatting and error texts follow the app language (also when tests or restore set the store directly).
setNumberLang(useSettings.getState().lang);
setErrorLang(useSettings.getState().lang);
useSettings.subscribe((s, prev) => {
  if (s.lang !== prev.lang) {
    setNumberLang(s.lang);
    setErrorLang(s.lang);
  }
});

import { create } from 'zustand';
import type { Lang } from '@/i18n';
import { setErrorLang } from '@/api/errors';
import { setNumberLang } from '@/lib/money';
import { getStorage } from '@/offline/storage';
import { api, DEFAULT_API_URL } from './runtime';

export type ThemeMode = 'dark' | 'light' | 'system';

interface SettingsState {
  lang: Lang;
  themeMode: ThemeMode;
  reduceEffects: boolean;
  apiUrl: string;
  hydrated: boolean;
  hydrate(): Promise<void>;
  update(patch: Partial<Pick<SettingsState, 'lang' | 'themeMode' | 'reduceEffects' | 'apiUrl'>>): Promise<void>;
}

export const useSettings = create<SettingsState>((set, get) => ({
  lang: 'uz',
  themeMode: 'dark',
  reduceEffects: false,
  apiUrl: DEFAULT_API_URL,
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
    const { lang, themeMode, reduceEffects, apiUrl } = get();
    try {
      await (await getStorage()).set('setting:app', JSON.stringify({ lang, themeMode, reduceEffects, apiUrl }));
    } catch {
      /* non-fatal */
    }
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

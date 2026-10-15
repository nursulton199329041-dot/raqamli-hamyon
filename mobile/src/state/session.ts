import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { ApiError, type Tokens } from '@/api/client';
import type { AuthResponse, UserProfile } from '@/api/types';
import { getStorage } from '@/offline/storage';
import { api, queryClient } from './runtime';
import { useSettings } from './settings';

const TOKEN_KEY = 'hamyon.tokens';

async function saveTokens(t: Tokens | null): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      if (t) sessionStorage.setItem(TOKEN_KEY, JSON.stringify(t));
      else sessionStorage.removeItem(TOKEN_KEY);
      return;
    }
    if (t) await SecureStore.setItemAsync(TOKEN_KEY, JSON.stringify(t));
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    /* keystore unavailable: session just won't persist */
  }
}

async function loadTokens(): Promise<Tokens | null> {
  try {
    const raw = Platform.OS === 'web' ? sessionStorage.getItem(TOKEN_KEY) : await SecureStore.getItemAsync(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as Tokens) : null;
  } catch {
    return null;
  }
}

type Status = 'loading' | 'signedOut' | 'signedIn';

interface SessionState {
  status: Status;
  user: UserProfile | null;
  restore(): Promise<void>;
  login(email: string, password: string): Promise<void>;
  register(email: string, password: string, name: string): Promise<void>;
  signOut(remote?: boolean, wipe?: boolean): Promise<void>;
}

async function adopt(res: AuthResponse): Promise<UserProfile> {
  api.setTokens({ access: res.accessToken, refresh: res.refreshToken });
  await saveTokens({ access: res.accessToken, refresh: res.refreshToken });
  try {
    await (await getStorage()).set('profile', JSON.stringify(res.user));
  } catch {
    /* cache only */
  }
  return res.user;
}

export const useSession = create<SessionState>((set, get) => ({
  status: 'loading',
  user: null,

  async restore() {
    api.onTokens = (t) => void saveTokens(t);
    api.onExpired = () => void get().signOut(false, false);
    const t = await loadTokens();
    if (!t) return set({ status: 'signedOut', user: null });
    api.setTokens(t);
    try {
      const me = await api.get<UserProfile>('/api/me');
      set({ status: 'signedIn', user: me });
    } catch (e) {
      if (e instanceof ApiError && e.isNetwork) {
        // Offline start: keep the session and show cached data.
        const cached = await (await getStorage()).get('profile');
        if (cached) return set({ status: 'signedIn', user: JSON.parse(cached) as UserProfile });
      }
      api.setTokens(null);
      set({ status: 'signedOut', user: null });
    }
  },

  async login(email, password) {
    const res = await api.post<AuthResponse>('/api/auth/login', { email, password });
    set({ status: 'signedIn', user: await adopt(res) });
  },

  async register(email, password, name) {
    const locale = useSettings.getState().lang;
    const res = await api.post<AuthResponse>('/api/auth/register', { email, password, displayName: name, locale });
    set({ status: 'signedIn', user: await adopt(res) });
  },

  async signOut(remote = true, wipe = true) {
    const t = api.getTokens();
    if (remote && t) {
      try {
        await api.post('/api/auth/logout', { refreshToken: t.refresh });
      } catch {
        /* best effort */
      }
    }
    api.setTokens(null);
    await saveTokens(null);
    // An expired session keeps the offline queue (never lose unsent money operations); explicit sign-out wipes it
    // so one account's pending operations can't leak into another.
    if (wipe) await (await getStorage()).clearUserData();
    queryClient.clear();
    set({ status: 'signedOut', user: null });
  },
}));

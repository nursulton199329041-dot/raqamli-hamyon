import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { ApiError, type Tokens } from '@/api/client';
import type { AuthResponse, UserProfile } from '@/api/types';
import { CURRENT_PROFILE_KEY, resetLocalBook } from '@/local/bridge';
import { LocalLedger } from '@/local/ledger';
import { openLocalDb } from '@/offline/sqlite';
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

/** 'guest': the device's own book without any account ("start with a local account"); no server needed. */
type Status = 'loading' | 'signedOut' | 'signedIn' | 'guest';

const GUEST_KEY = 'guest';

interface SessionState {
  status: Status;
  user: UserProfile | null;
  restore(): Promise<void>;
  login(email: string, password: string): Promise<void>;
  register(email: string, password: string, name: string): Promise<void>;
  signOut(remote?: boolean, wipe?: boolean): Promise<void>;
  /** start (or come back to) the device's own book with no account */
  startGuest(): Promise<void>;
  /** a guest asked to sign in / register: the sign-in screen is shown, the guest book stays as it is */
  linking: boolean;
  setLinking(v: boolean): void;
}

/**
 * After a sign-in from guest mode: the guest book becomes this account's book. Its profiles are created on the server
 * with the same ids (empty, no default catalog) and the device's outbox uploads everything into them. A guest book with
 * nothing entered is dropped instead. Runs before the session switches, so a failure leaves the guest mode untouched.
 */
async function linkGuest(user: UserProfile): Promise<void> {
  if (Platform.OS === 'web') return;
  const ledger = new LocalLedger(await openLocalDb());
  const g = await ledger.guestBook();
  if (!g || (await ledger.dropEmptyGuest())) return;
  for (const p of g.profiles)
    await api.post('/api/profiles', { id: p.id, name: p.name, baseCurrency: p.baseCurrency, color: p.color, icon: p.icon, seedDefaults: false });
  await ledger.linkGuest(user);
  const first = g.profiles[0];
  if (first) await (await openLocalDb()).run('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)', CURRENT_PROFILE_KEY, first.id);
  // the guest's data now lives only in the local book: keep using it
  await useSettings.getState().update({ localFirst: true });
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

/** Signs in with the response of /login, /register or /google; a guest book on the device is linked first. */
async function enter(res: AuthResponse, set: (s: Partial<SessionState>) => void) {
  const user = await adopt(res);
  const wasGuest = await (await getStorage()).get(GUEST_KEY);
  if (wasGuest) {
    try {
      await linkGuest(user);
    } catch (e) {
      api.setTokens(null);
      await saveTokens(null);
      throw e;
    }
    await (await getStorage()).set(GUEST_KEY, '');
  }
  resetLocalBook();
  set({ status: 'signedIn', user, linking: false });
}

export const useSession = create<SessionState>((set, get) => ({
  status: 'loading',
  user: null,
  linking: false,

  setLinking(v) {
    set({ linking: v });
  },

  async startGuest() {
    await (await getStorage()).set(GUEST_KEY, '1');
    resetLocalBook();
    queryClient.clear();
    set({ status: 'guest', user: null, linking: false });
  },

  async restore() {
    api.onTokens = (t) => void saveTokens(t);
    // a guest has no session to expire (server calls without a token just fail)
    api.onExpired = () => {
      if (get().status === 'signedIn') void get().signOut(false, false);
    };
    const t = await loadTokens();
    if (!t) {
      const guest = Platform.OS !== 'web' && (await (await getStorage()).get(GUEST_KEY));
      return set({ status: guest ? 'guest' : 'signedOut', user: null });
    }
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
    await enter(await api.post<AuthResponse>('/api/auth/login', { email, password }), set);
  },

  async register(email, password, name) {
    const locale = useSettings.getState().lang;
    await enter(await api.post<AuthResponse>('/api/auth/register', { email, password, displayName: name, locale }), set);
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
    resetLocalBook();
    set({ status: 'signedOut', user: null, linking: false });
  },
}));

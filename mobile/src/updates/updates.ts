import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';
import { create } from 'zustand';
import type { ClientPolicy } from '@/api/types';
import { getStorage } from '@/offline/storage';
import { api } from '@/state/runtime';
import { useQueue } from '@/state/queue';
import { useUi } from '@/state/ui';
import { storeStatus, SUPPORTED_API_VERSION, type StoreStatus } from './version';

interface UpdateState {
  checking: boolean;
  /** an OTA bundle was downloaded and will be used on the next launch */
  ready: boolean;
  lastChecked: string | null;
  store: StoreStatus;
  policy: ClientPolicy | null;
  apiIncompatible: boolean;
  check(reason?: string): Promise<void>;
  checkPolicy(): Promise<void>;
  apply(): Promise<boolean>;
  openStore(): Promise<void>;
}

const MIN_INTERVAL_MS = 30 * 60 * 1000;
let lastAt = 0;

export function currentVersion(): string {
  return Application.nativeApplicationVersion ?? (Constants.expoConfig?.version ?? '0.0.0');
}

async function log(kind: string, detail: string) {
  try {
    await (await getStorage()).logUpdate(kind, detail);
  } catch {
    /* logging must never break the app */
  }
}

export const useUpdates = create<UpdateState>((set, get) => ({
  checking: false,
  ready: false,
  lastChecked: null,
  store: 'ok',
  policy: null,
  apiIncompatible: false,

  /**
   * OTA flow: check → download in background → keep as "ready". The new bundle only becomes active on the next
   * cold start (or an explicit, user-confirmed restart when no money form is open), so a financial operation is
   * never interrupted. Corrupt/crashing updates are rolled back to the embedded bundle by expo-updates itself.
   */
  async check(reason = 'manual') {
    if (get().checking) return;
    const now = Date.now();
    if (reason !== 'manual' && now - lastAt < MIN_INTERVAL_MS) return;
    lastAt = now;
    if (__DEV__ || !Updates.isEnabled) {
      set({ lastChecked: new Date().toISOString() });
      return;
    }
    set({ checking: true });
    try {
      const res = await Updates.checkForUpdateAsync();
      if (res.isAvailable) {
        await log('ota-found', `reason=${reason} channel=${Updates.channel ?? '-'} runtime=${Updates.runtimeVersion ?? '-'}`);
        const fetched = await Updates.fetchUpdateAsync();
        if (fetched.isNew) {
          set({ ready: true });
          await log('ota-downloaded', `id=${fetched.manifest && 'id' in fetched.manifest ? String(fetched.manifest.id) : '?'}`);
        }
      } else {
        await log('ota-none', `reason=${reason} current=${Updates.updateId ?? 'embedded'}`);
      }
    } catch (e) {
      await log('ota-error', e instanceof Error ? e.message : String(e));
    } finally {
      set({ checking: false, lastChecked: new Date().toISOString() });
    }
  },

  async checkPolicy() {
    try {
      const policy = await api.get<ClientPolicy>('/api/meta/client-policy');
      set({
        policy,
        // Web has no store build: only native binaries are gated by the minimum-version policy.
        store: Platform.OS === 'web' ? 'ok' : storeStatus(currentVersion(), policy),
        apiIncompatible: policy.apiVersion > SUPPORTED_API_VERSION,
      });
    } catch {
      /* offline: keep previous */
    }
  },

  async apply() {
    if (!get().ready) return false;
    // Safe-moment guard: never restart under an open money form or while the offline queue is syncing.
    if (useUi.getState().busy() || useQueue.getState().syncing) return false;
    await log('ota-apply', `from=${Updates.updateId ?? 'embedded'}`);
    await Updates.reloadAsync();
    return true;
  },

  async openStore() {
    const urls = (Constants.expoConfig?.extra as { storeUrls?: { ios?: string; android?: string } } | undefined)?.storeUrls;
    const url = Platform.OS === 'ios' ? urls?.ios : urls?.android;
    if (url) await Linking.openURL(url);
  },
}));

/** Diagnostics for the settings screen. */
export function runtimeInfo() {
  return {
    version: currentVersion(),
    build: Application.nativeBuildVersion ?? '-',
    channel: Updates.channel ?? '-',
    runtimeVersion: Updates.runtimeVersion ?? '-',
    updateId: Updates.updateId ?? 'embedded',
    emergencyLaunch: Updates.isEmergencyLaunch,
    otaEnabled: Updates.isEnabled,
  };
}

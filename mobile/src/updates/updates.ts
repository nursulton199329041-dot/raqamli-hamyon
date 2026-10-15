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
  /** outcome of the last check/apply, shown in settings diagnostics */
  lastResult: string | null;
  lastError: string | null;
  nativeLog: string[];
  loadNativeLog(): Promise<void>;
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
  lastResult: null,
  lastError: null,
  nativeLog: [],

  async loadNativeLog() {
    try {
      if (!Updates.isEnabled) return;
      const rows = await Updates.readLogEntriesAsync(24 * 3600 * 1000);
      set({ nativeLog: rows.slice(-8).map((r) => `${r.level} ${r.code}: ${r.message}`) });
    } catch (e) {
      set({ nativeLog: [`log read failed: ${e instanceof Error ? e.message : String(e)}`] });
    }
  },

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
      const why = __DEV__ ? 'development build: OTA is off' : `expo-updates disabled in this build${Updates.emergencyLaunchReason ? ` (${Updates.emergencyLaunchReason})` : ''}`;
      set({ lastChecked: new Date().toISOString(), lastResult: why });
      return;
    }
    set({ checking: true, lastError: null });
    try {
      const res = await Updates.checkForUpdateAsync();
      if (res.isAvailable) {
        await log('ota-found', `reason=${reason} channel=${Updates.channel ?? '-'} runtime=${Updates.runtimeVersion ?? '-'}`);
        const fetched = await Updates.fetchUpdateAsync();
        if (fetched.isNew) {
          const id = fetched.manifest && 'id' in fetched.manifest ? String(fetched.manifest.id) : '?';
          set({ ready: true, lastResult: `downloaded ${id}; restart to apply` });
          await log('ota-downloaded', `id=${id}`);
        } else {
          set({ lastResult: 'server update already installed (nothing new to download)' });
        }
      } else {
        const why = 'reason' in res ? String(res.reason) : 'unknown';
        set({ lastResult: `no update: ${why}` });
        await log('ota-none', `reason=${reason} why=${why} current=${Updates.updateId ?? 'embedded'}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ lastError: msg });
      await log('ota-error', msg);
    } finally {
      void get().loadNativeLog();
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
    if (useUi.getState().busy() || useQueue.getState().syncing) {
      set({ lastResult: 'restart postponed: a form is open or the queue is syncing' });
      return false;
    }
    await log('ota-apply', `from=${Updates.updateId ?? 'embedded'}`);
    try {
      await Updates.reloadAsync();
      return true;
    } catch (e) {
      set({ lastError: e instanceof Error ? e.message : String(e) });
      return false;
    }
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
    emergencyReason: Updates.emergencyLaunchReason ?? '-',
    embeddedLaunch: Updates.isEmbeddedLaunch,
    otaEnabled: Updates.isEnabled,
    checkAutomatically: Updates.checkAutomatically ?? '-',
    updateCreatedAt: Updates.createdAt ? Updates.createdAt.toISOString() : '-',
    updatesUrl: (Constants.expoConfig?.updates as { url?: string } | undefined)?.url ?? '-',
  };
}

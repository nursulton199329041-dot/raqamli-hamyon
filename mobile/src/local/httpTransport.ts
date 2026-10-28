import type { ApiClient } from '@/api/client';
import type { PushOp, PushResult, RemotePull, SyncTransport } from './sync';

/** The sync engine over the app's API client (token refresh included). Each call is scoped to one server profile. */
export function httpTransport(api: ApiClient): SyncTransport {
  const headers = (profileId: string) => ({ 'X-Profile-Id': profileId });
  return {
    async push(profileId: string, operations: PushOp[]) {
      const r = await api.request<{ results: PushResult[] }>('POST', '/api/sync/push', { body: { operations }, headers: headers(profileId) });
      return r.results;
    },
    pull: (profileId: string, since: string | null) =>
      api.request<RemotePull>('GET', '/api/sync/pull', { q: { since }, headers: headers(profileId) }),
  };
}

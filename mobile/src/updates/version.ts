/** Semantic version helpers (major.minor.patch, pre-release tags ignored). */
export function parseSemver(v: string): [number, number, number] {
  const core = v.trim().replace(/^v/i, '').split(/[-+]/)[0] ?? '';
  const [a, b, c] = core.split('.').map((x) => Number.parseInt(x, 10));
  return [Number.isFinite(a) ? a! : 0, Number.isFinite(b) ? b! : 0, Number.isFinite(c) ? c! : 0];
}

export function compareSemver(a: string, b: string): number {
  const x = parseSemver(a);
  const y = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    const d = x[i]! - y[i]!;
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export type StoreStatus = 'ok' | 'optional' | 'required';

/** `required` blocks the app (below minimum), `optional` shows a soft banner (below latest). */
export function storeStatus(current: string, policy: { minVersion: string; latestVersion: string }): StoreStatus {
  if (compareSemver(current, policy.minVersion) < 0) return 'required';
  if (compareSemver(current, policy.latestVersion) < 0) return 'optional';
  return 'ok';
}

/** Highest API contract version this client understands; the server's `apiVersion` must not exceed it. */
export const SUPPORTED_API_VERSION = 1;

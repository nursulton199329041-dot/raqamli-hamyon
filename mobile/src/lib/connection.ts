/**
 * Server reachability probe used by the connection diagnostics (login screen and Settings).
 *
 * React Native reports every transport failure as the same "Network request failed", so the failure kind is inferred from
 * how long the attempt lasted: a quick failure means refused / unroutable / cleartext blocked / bad host name, a long one
 * (until our own abort) means packets are being dropped: wrong IP, other Wi-Fi, or a firewall.
 */
export type ConnKind = 'ok' | 'http' | 'refused' | 'timeout' | 'invalid';

export interface ConnResult {
  kind: ConnKind;
  ok: boolean;
  /** the exact URL that was requested (open it in the phone's browser to compare) */
  url: string;
  ms: number;
  status?: number;
  apiVersion?: number;
}

export const PROBE_PATH = '/api/meta/client-policy';

export function probeUrl(base: string): string {
  return `${base.trim().replace(/\/+$/, '')}${PROBE_PATH}`;
}

export function isValidBaseUrl(base: string): boolean {
  return /^https?:\/\/[^\s/:]+(:\d{1,5})?(\/.*)?$/i.test(base.trim());
}

export async function checkConnection(
  base: string,
  timeoutMs = 6000,
  doFetch: typeof fetch = fetch,
): Promise<ConnResult> {
  const url = probeUrl(base);
  if (!isValidBaseUrl(base)) return { kind: 'invalid', ok: false, url, ms: 0 };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await doFetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    const ms = Date.now() - started;
    if (!res.ok) return { kind: 'http', ok: false, url, ms, status: res.status };
    let apiVersion: number | undefined;
    try {
      apiVersion = ((await res.json()) as { apiVersion?: number }).apiVersion;
    } catch {
      /* not JSON: still a live HTTP server */
    }
    return { kind: 'ok', ok: true, url, ms, status: res.status, apiVersion };
  } catch {
    const ms = Date.now() - started;
    return { kind: ms >= timeoutMs - 250 ? 'timeout' : 'refused', ok: false, url, ms };
  } finally {
    clearTimeout(timer);
  }
}

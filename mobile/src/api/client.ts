import type { AuthResponse } from './types';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
  get isNetwork(): boolean {
    return this.status === 0;
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

export interface Tokens { access: string; refresh: string }

/** Minimal typed REST client with transparent single-flight refresh-token rotation. */
export class ApiClient {
  private tokens: Tokens | null = null;
  private refreshing: Promise<boolean> | null = null;
  onTokens?: (t: Tokens | null) => void;
  onExpired?: () => void;

  constructor(public baseUrl: string) {}

  setTokens(t: Tokens | null) {
    this.tokens = t;
  }
  getTokens() {
    return this.tokens;
  }

  private url(path: string, q?: Query): string {
    const p = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
    const qs = q
      ? Object.entries(q)
          .filter(([, v]) => v !== undefined && v !== null && v !== '')
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join('&')
      : '';
    return `${this.baseUrl}${p}${qs ? `?${qs}` : ''}`;
  }

  private async raw(method: string, path: string, body?: unknown, q?: Query, idem?: string): Promise<Response> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.tokens) headers.Authorization = `Bearer ${this.tokens.access}`;
    if (idem) headers['Idempotency-Key'] = idem;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      return await fetch(this.url(path, q), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch {
      throw new ApiError(0, 'network', 'Server bilan aloqa yo‘q');
    } finally {
      clearTimeout(timer);
    }
  }

  private async refresh(): Promise<boolean> {
    if (!this.tokens) return false;
    if (!this.refreshing) {
      const refreshToken = this.tokens.refresh;
      this.refreshing = (async () => {
        try {
          const res = await fetch(this.url('/api/auth/refresh'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken }),
          });
          if (!res.ok) return false;
          const j = (await res.json()) as AuthResponse;
          this.tokens = { access: j.accessToken, refresh: j.refreshToken };
          this.onTokens?.(this.tokens);
          return true;
        } catch {
          return false;
        } finally {
          this.refreshing = null;
        }
      })();
    }
    return this.refreshing;
  }

  async request<T>(method: string, path: string, opts: { body?: unknown; q?: Query; idem?: string } = {}, retry = true): Promise<T> {
    const res = await this.raw(method, path, opts.body, opts.q, opts.idem);
    if (res.status === 401 && retry && this.tokens) {
      if (await this.refresh()) return this.request<T>(method, path, opts, false);
      this.tokens = null;
      this.onTokens?.(null);
      this.onExpired?.();
    }
    if (res.ok) {
      if (res.status === 204) return undefined as T;
      const text = await res.text();
      return (text ? JSON.parse(text) : undefined) as T;
    }
    let code = 'error';
    let message = `Xatolik (${res.status})`;
    try {
      const j = (await res.json()) as { code?: string; message?: string };
      code = j.code ?? code;
      message = j.message ?? message;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, code, message);
  }

  get = <T>(path: string, q?: Query) => this.request<T>('GET', path, { q });
  post = <T>(path: string, body?: unknown, idem?: string) => this.request<T>('POST', path, { body: body ?? {}, idem });
  patch = <T>(path: string, body: unknown) => this.request<T>('PATCH', path, { body });
  put = <T>(path: string, body: unknown) => this.request<T>('PUT', path, { body });
  del = <T>(path: string) => this.request<T>('DELETE', path);

  /** Authenticated binary download (exports). */
  async download(path: string, q?: Query): Promise<ArrayBuffer> {
    const res = await this.raw('GET', path, undefined, q);
    if (res.status === 401 && (await this.refresh())) return this.download(path, q);
    if (!res.ok) throw new ApiError(res.status, 'download', 'Yuklab bo‘lmadi');
    return res.arrayBuffer();
  }
}

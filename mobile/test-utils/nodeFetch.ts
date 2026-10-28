// eslint-disable-next-line @typescript-eslint/no-require-imports
const http = require('node:http') as typeof import('node:http');

/**
 * Minimal real-network fetch for end-to-end tests: jest-expo replaces the global fetch with a polyfill that cannot reach
 * a server, so tests that talk to a running API install this one (http only, enough for the ApiClient).
 */
export function nodeFetch(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: init.method ?? 'GET', headers: init.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        const status = res.statusCode ?? 0;
        resolve({
          status, ok: status >= 200 && status < 300,
          headers: { get: (k: string) => (res.headers[k.toLowerCase()] as string | undefined) ?? null },
          text: async () => body.toString('utf8'),
          json: async () => JSON.parse(body.toString('utf8')) as unknown,
          arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
        } as unknown as Response);
      });
    });
    req.on('error', reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

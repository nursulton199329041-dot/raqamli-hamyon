/** True for addresses a physical phone cannot reach (its own loopback / unset). */
export function isLocalUrl(url: string): boolean {
  return /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\]|10\.0\.2\.2)(:|\/|$)/i.test(url.trim());
}

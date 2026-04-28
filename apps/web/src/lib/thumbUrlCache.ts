// In-memory cache of presigned R2 download URLs, keyed by storage key.
//
// Signed URLs are valid for ~1 hour, so re-signing on every render or
// navigation is wasted work. We keep the URL around in module memory until
// it's close to expiring, then let callers re-sign. Module memory is enough
// for the "navigate back to a boat" case the photo grids care about — full
// page reloads will still hit the network, which is fine because that's also
// when auth state could change.

type CacheEntry = { url: string; expiresAt: number };

const cache = new Map<string, CacheEntry>();

// Re-sign a few minutes before the URL actually expires so we never hand an
// <img> tag a URL that dies mid-load.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export function getCachedThumbUrl(storageKey: string): string | null {
  const entry = cache.get(storageKey);
  if (!entry) return null;
  if (entry.expiresAt - Date.now() < REFRESH_MARGIN_MS) {
    cache.delete(storageKey);
    return null;
  }
  return entry.url;
}

export function cacheThumbUrls(
  urls: Record<string, string>,
  expiresInSeconds: number,
): void {
  const ttlMs = Math.max(0, expiresInSeconds) * 1000;
  const expiresAt = Date.now() + ttlMs;
  for (const [key, url] of Object.entries(urls)) {
    if (url) cache.set(key, { url, expiresAt });
  }
}

// Drop a key from the cache — call this when a photo is deleted so a future
// upload that happens to reuse the same key (vanishingly unlikely with our
// UUID-based keys, but cheap insurance) doesn't serve a stale URL.
export function invalidateThumbUrl(storageKey: string): void {
  cache.delete(storageKey);
}

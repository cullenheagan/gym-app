// Small helpers for keeping a copy of server data on this device, so the app still has
// something to show with no signal. Every call is safe if storage is blocked or full.

export function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeCache(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export const cacheKey = (userId: string, name: string) => `cache:${userId}:${name}`;

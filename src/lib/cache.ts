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

// On sign-out, remove the copies of this person's data kept on the phone (history, exercises,
// last-time sets, name and photo). Workouts still waiting to sync and an unfinished workout are
// kept, so nothing logged is lost; they belong to this account and only show after signing back in.
export function clearPersonalData(userId: string): void {
  try {
    const prefixes = [`cache:${userId}:`, `name:${userId}`, `avatar:${userId}`];
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && prefixes.some((p) => k.startsWith(p))) doomed.push(k);
    }
    for (const k of doomed) localStorage.removeItem(k);
  } catch {}
}

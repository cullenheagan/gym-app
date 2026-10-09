// Numbers and shortcuts for the Home screen.

import { normName } from "./history-filter";

export type HomeWorkout<P> = { name: string; startedAt: string; volumeKg: number; plan: P };
export type Template<P> = { key: string; label: string; count: number; plan: P };

// Monday 00:00 (local time) of the week containing `now`.
export function weekStart(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

export function weekTotals<P>(ws: HomeWorkout<P>[], now: number) {
  const start = weekStart(now);
  const mine = ws.filter((w) => Date.parse(w.startedAt) >= start);
  return { count: mine.length, volumeKg: mine.reduce((sum, w) => sum + w.volumeKg, 0) };
}

// One shortcut per workout name, built from the most recent time you did it.
// Newest-first input; most-done names come first, at most `max` shortcuts.
export function templates<P extends { exercises: unknown[] }>(ws: HomeWorkout<P>[], max = 6): Template<P>[] {
  const map = new Map<string, Template<P>>();
  for (const w of ws) {
    const key = normName(w.name);
    if (!key || w.plan.exercises.length === 0) continue;
    const cur = map.get(key);
    if (cur) cur.count += 1;
    else map.set(key, { key, label: w.name.trim(), count: 1, plan: w.plan });
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, max);
}

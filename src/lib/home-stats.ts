// Numbers and shortcuts for the Home screen.

import { normName } from "./history-filter";

import { type Kind } from "./kinds";

export type HomeWorkout<P> = { name: string; kind?: Kind; startedAt: string; volumeKg: number; activeMs?: number; plan: P };
export type Template<P> = { key: string; label: string; kind: Kind; count: number; plan: P };

// Monday 00:00 (local time) of the week containing `now`.
export function weekStart(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

// Monday 00:00 of the week `back` weeks before the week containing `now`.
export function weekStartBack(now: number, back: number): number {
  const d = new Date(weekStart(now));
  d.setDate(d.getDate() - 7 * back);
  return d.getTime();
}

// The workouts that started in the week beginning at `start` (a Monday), oldest first.
export function weekWorkouts<P>(ws: HomeWorkout<P>[], start: number): HomeWorkout<P>[] {
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return ws
    .filter((w) => {
      const t = Date.parse(w.startedAt);
      return t >= start && t < end.getTime();
    })
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
}

// Time, count and weight lifted per workout type for one week, longest first.
export function kindBreakdown<P>(mine: HomeWorkout<P>[]): { kind: Kind; count: number; ms: number; volumeKg: number }[] {
  const map = new Map<Kind, { kind: Kind; count: number; ms: number; volumeKg: number }>();
  for (const w of mine) {
    const kind: Kind = w.kind ?? "strength";
    const cur = map.get(kind) ?? { kind, count: 0, ms: 0, volumeKg: 0 };
    cur.count += 1;
    cur.ms += w.activeMs ?? 0;
    cur.volumeKg += w.volumeKg;
    map.set(kind, cur);
  }
  return [...map.values()].sort((a, b) => b.ms - a.ms || b.count - a.count);
}

// True when something was logged before the week beginning at `start`.
export function hasEarlier<P>(ws: HomeWorkout<P>[], start: number): boolean {
  return ws.some((w) => Date.parse(w.startedAt) < start);
}

export function weekTotals<P>(ws: HomeWorkout<P>[], now: number, back = 0) {
  const mine = weekWorkouts(ws, weekStartBack(now, back));
  return {
    count: mine.length,
    volumeKg: mine.reduce((sum, w) => sum + w.volumeKg, 0),
    activeMs: mine.reduce((sum, w) => sum + (w.activeMs ?? 0), 0),
  };
}

// One shortcut per workout name, built from the most recent time you did it.
// Newest-first input; most-done names come first, at most `max` shortcuts.
export function templates<P extends { exercises: unknown[] }>(ws: HomeWorkout<P>[], max = 6): Template<P>[] {
  const map = new Map<string, Template<P>>();
  for (const w of ws) {
    const kind: Kind = w.kind ?? "strength";
    const key = `${kind}:${normName(w.name)}`;
    if (!normName(w.name) || w.plan.exercises.length === 0) continue;
    const cur = map.get(key);
    if (cur) cur.count += 1;
    else map.set(key, { key, label: w.name.trim(), kind, count: 1, plan: w.plan });
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, max);
}

// The workout that usually comes next: look at what you did right after your most recent workout
// each time before, and pick the most common follow-up (at least twice; a tie goes to the more
// recent one). Newest-first input. Returns the shortcut for that workout, or null when there is no
// pattern yet.
export function nextInRotation<P extends { exercises: unknown[] }>(ws: HomeWorkout<P>[]): Template<P> | null {
  const keyOf = (w: HomeWorkout<P>) => `${w.kind ?? "strength"}:${normName(w.name)}`;
  const seq = [...ws].reverse().filter((w) => normName(w.name) && w.plan.exercises.length > 0); // oldest first
  if (seq.length < 3) return null;
  const last = keyOf(seq[seq.length - 1]);
  const next = new Map<string, { n: number; at: number }>();
  for (let i = 0; i < seq.length - 1; i++) {
    if (keyOf(seq[i]) !== last) continue;
    const k = keyOf(seq[i + 1]);
    const cur = next.get(k) ?? { n: 0, at: 0 };
    next.set(k, { n: cur.n + 1, at: i });
  }
  let best: string | null = null;
  for (const [k, v] of next) {
    if (v.n < 2) continue;
    const b = best ? next.get(best) : null;
    if (!b || v.n > b.n || (v.n === b.n && v.at > b.at)) best = k;
  }
  return best ? templates(ws, 999).find((t) => t.key === best) ?? null : null;
}

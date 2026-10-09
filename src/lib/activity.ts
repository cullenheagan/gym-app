// The workout calendar on Home: one square per day, brighter the longer you trained.

export type ActivityWorkout = { name: string; started_at: string; ended_at: string | null };

export type Day = {
  key: string; // "2026-10-09" in local time
  date: Date;
  minutes: number;
  workouts: { name: string; minutes: number }[];
  future: boolean;
};

const MAX_MIN_PER_WORKOUT = 240; // a workout left open all day should not light up the whole chart

export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function workoutMinutes(w: ActivityWorkout): number {
  const start = Date.parse(w.started_at);
  const end = w.ended_at ? Date.parse(w.ended_at) : NaN;
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.min(MAX_MIN_PER_WORKOUT, Math.max(0, Math.round((end - start) / 60000)));
}

// 0 = nothing, 1 to 4 = lighter to brighter.
export function level(minutes: number, count: number): 0 | 1 | 2 | 3 | 4 {
  if (count === 0) return 0;
  if (minutes < 20) return 1;
  if (minutes < 45) return 2;
  if (minutes < 75) return 3;
  return 4;
}

// `weeks` columns ending with the current week; each column runs Monday to Sunday.
export function buildDays(ws: ActivityWorkout[], now: number, weeks: number): Day[][] {
  const byDay = new Map<string, Day["workouts"]>();
  for (const w of ws) {
    const start = new Date(w.started_at);
    if (Number.isNaN(start.getTime())) continue;
    const k = dayKey(start);
    byDay.set(k, [...(byDay.get(k) ?? []), { name: w.name, minutes: workoutMinutes(w) }]);
  }
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const monday = new Date(today);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) - (weeks - 1) * 7);
  const cols: Day[][] = [];
  for (let c = 0; c < weeks; c++) {
    const col: Day[] = [];
    for (let r = 0; r < 7; r++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + c * 7 + r);
      const list = byDay.get(dayKey(d)) ?? [];
      col.push({
        key: dayKey(d),
        date: d,
        minutes: list.reduce((s, x) => s + x.minutes, 0),
        workouts: list,
        future: d.getTime() > today.getTime(),
      });
    }
    cols.push(col);
  }
  return cols;
}

// Current streak counts back from today (or from yesterday if you have not trained yet today).
export function streaks(ws: ActivityWorkout[], now: number): { current: number; longest: number } {
  const days = new Set<string>();
  for (const w of ws) {
    const d = new Date(w.started_at);
    if (!Number.isNaN(d.getTime())) days.add(dayKey(d));
  }
  const step = (d: Date, n: number) => {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  };
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  let cur = days.has(dayKey(today)) ? today : step(today, -1);
  let current = 0;
  while (days.has(dayKey(cur))) {
    current++;
    cur = step(cur, -1);
  }
  const sorted = [...days].sort();
  let longest = 0;
  let run = 0;
  let prev: Date | null = null;
  for (const k of sorted) {
    const [y, m, dd] = k.split("-").map(Number);
    const d = new Date(y, m - 1, dd);
    run = prev && dayKey(step(prev, 1)) === k ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  return { current, longest };
}

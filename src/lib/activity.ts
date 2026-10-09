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

// One calendar month as rows of seven days (Monday first). Days outside the month are null.
export function buildMonth(ws: ActivityWorkout[], year: number, month: number, now: number): (Day | null)[][] {
  const all = buildDaysBetween(ws, new Date(year, month, 1), new Date(year, month + 1, 0), now);
  const first = (new Date(year, month, 1).getDay() + 6) % 7; // 0 = Monday
  const cells: (Day | null)[] = [...Array(first).fill(null), ...all];
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (Day | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

function buildDaysBetween(ws: ActivityWorkout[], from: Date, to: Date, now: number): Day[] {
  const byDay = new Map<string, Day["workouts"]>();
  for (const w of ws) {
    const start = new Date(w.started_at);
    if (Number.isNaN(start.getTime())) continue;
    const k = dayKey(start);
    byDay.set(k, [...(byDay.get(k) ?? []), { name: w.name, minutes: workoutMinutes(w) }]);
  }
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const out: Day[] = [];
  for (let d = new Date(from); d.getTime() <= to.getTime(); d.setDate(d.getDate() + 1)) {
    const date = new Date(d);
    const list = byDay.get(dayKey(date)) ?? [];
    out.push({
      key: dayKey(date),
      date,
      minutes: list.reduce((sum, x) => sum + x.minutes, 0),
      workouts: list,
      future: date.getTime() > today.getTime(),
    });
  }
  return out;
}

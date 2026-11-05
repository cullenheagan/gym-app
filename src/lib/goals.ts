// My plan goals (HCI proposal F7): a weekly workout goal ("3 workouts a week") with progress for
// this week and a streak of weeks in a row the goal was met. Pure functions (no imports), so
// tests/goals.test.ts can run them with Node. Weeks run Monday to Sunday in local time.
//
// Editing a goal ends the old row and starts a new one, so each past week is judged by the goal
// that was active at that time, and nothing about past weeks is lost.

export type Goal = {
  id: string;
  target: number; // workouts per week, 1 to 7
  created_at: string;
  ended_at: string | null;
};

export type WeeklyProgress = {
  target: number;
  thisWeek: number;
  met: boolean;
  // Weeks in a row the goal was met, ending with this week if it is already met, else last week.
  streak: number;
  best: number;
};

// Local midnight on the Monday of the week containing d.
export function weekStart(d: Date): Date {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
  return s;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function activeGoal(goals: Goal[]): Goal | null {
  const open = goals.filter((g) => !g.ended_at);
  open.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return open[0] ?? null;
}

// The goal that applied to the week starting at `start`: the latest one created before that week
// ended and not ended before it started.
function goalForWeek(goals: Goal[], start: Date): Goal | null {
  const end = addDays(start, 7).getTime();
  let pick: Goal | null = null;
  for (const g of goals) {
    const made = new Date(g.created_at).getTime();
    const stopped = g.ended_at ? new Date(g.ended_at).getTime() : Infinity;
    if (made < end && stopped > start.getTime() && (!pick || g.created_at > pick.created_at)) pick = g;
  }
  return pick;
}

export function weeklyProgress(goals: Goal[], workoutStarts: string[], now: Date): WeeklyProgress | null {
  const current = activeGoal(goals);
  if (!current) return null;

  // Workouts per week, keyed by the week's Monday.
  const perWeek = new Map<number, number>();
  for (const s of workoutStarts) {
    const t = new Date(s);
    if (Number.isNaN(t.getTime())) continue;
    const k = weekStart(t).getTime();
    perWeek.set(k, (perWeek.get(k) ?? 0) + 1);
  }

  const thisStart = weekStart(now);
  const thisWeek = perWeek.get(thisStart.getTime()) ?? 0;
  const met = thisWeek >= current.target;

  const firstGoal = goals.reduce((m, g) => (g.created_at < m ? g.created_at : m), current.created_at);
  const firstWeek = weekStart(new Date(firstGoal)).getTime();

  // Walk back week by week from this week to the first week with a goal.
  const results: boolean[] = []; // newest first
  for (let start = thisStart; start.getTime() >= firstWeek; start = addDays(start, -7)) {
    const g = goalForWeek(goals, start);
    results.push(!!g && (perWeek.get(start.getTime()) ?? 0) >= g.target);
  }

  // This week only adds to the streak once it is met; an unfinished week doesn't break it.
  let streak = 0;
  for (let i = met ? 0 : 1; i < results.length && results[i]; i++) streak++;

  let best = 0;
  let run = 0;
  for (let i = results.length - 1; i >= 0; i--) {
    run = results[i] ? run + 1 : 0;
    best = Math.max(best, run);
  }

  return { target: current.target, thisWeek, met, streak, best: Math.max(best, streak) };
}

export const MAX_TARGET = 7;

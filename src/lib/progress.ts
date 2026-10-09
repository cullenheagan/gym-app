// Pure helpers for the Progress tab: turn raw logged sets into one point per session.

export type ProgressSet = {
  exerciseId: string;
  exerciseName: string;
  workoutId: string;
  startedAt: string; // ISO time of the workout
  gymName: string | null;
  kg: number | null;
  reps: number | null;
  setType: string | null;
};

export type Metric = "e1rm" | "top" | "volume";
export type Range = "1M" | "3M" | "6M" | "All";

export type Session = {
  workoutId: string;
  date: number; // ms
  gymName: string | null;
  value: Record<Metric, number>; // kg (volume in kg x reps)
  sets: { kg: number; reps: number }[];
};

export type ExerciseProgress = {
  exerciseId: string;
  name: string;
  gymNames: string[];
  sessions: Session[]; // oldest first
};

// Epley estimate of a one-rep max. One rep is the weight itself.
export function epley(kg: number, reps: number): number {
  return reps <= 1 ? kg : kg * (1 + reps / 30);
}

export function buildProgress(rows: ProgressSet[]): ExerciseProgress[] {
  const byEx = new Map<string, { name: string; sessions: Map<string, Session> }>();
  for (const r of rows) {
    if (r.setType === "warmup") continue;
    if (r.kg == null || r.reps == null || r.kg <= 0 || r.reps <= 0) continue;
    let ex = byEx.get(r.exerciseId);
    if (!ex) byEx.set(r.exerciseId, (ex = { name: r.exerciseName, sessions: new Map() }));
    let s = ex.sessions.get(r.workoutId);
    if (!s) {
      s = {
        workoutId: r.workoutId,
        date: new Date(r.startedAt).getTime(),
        gymName: r.gymName,
        value: { e1rm: 0, top: 0, volume: 0 },
        sets: [],
      };
      ex.sessions.set(r.workoutId, s);
    }
    s.sets.push({ kg: r.kg, reps: r.reps });
    s.value.e1rm = Math.max(s.value.e1rm, epley(r.kg, r.reps));
    s.value.top = Math.max(s.value.top, r.kg);
    s.value.volume += r.kg * r.reps;
  }
  const out: ExerciseProgress[] = [];
  for (const [exerciseId, ex] of byEx) {
    const sessions = [...ex.sessions.values()].sort((a, b) => a.date - b.date);
    const gymNames = [...new Set(sessions.map((s) => s.gymName).filter((g): g is string => !!g))];
    out.push({ exerciseId, name: ex.name, gymNames, sessions });
  }
  return out.sort((a, b) => b.sessions[b.sessions.length - 1].date - a.sessions[a.sessions.length - 1].date);
}

const DAY = 86400000;
export function rangeStart(range: Range, now: number): number {
  return range === "All" ? 0 : now - (range === "1M" ? 30 : range === "3M" ? 91 : 182) * DAY;
}

export function inRange(sessions: Session[], range: Range, now: number): Session[] {
  const start = rangeStart(range, now);
  return sessions.filter((s) => s.date >= start);
}

// Indexes of sessions that set a new best (strictly above everything before them), first session excluded.
export function prIndexes(sessions: Session[], metric: Metric): number[] {
  const out: number[] = [];
  let best = -Infinity;
  sessions.forEach((s, i) => {
    if (s.value[metric] > best) {
      if (i > 0) out.push(i);
      best = s.value[metric];
    }
  });
  return out;
}

export type Summary = { best: number; latest: number; change: number; sessions: number };
export function summarize(sessions: Session[], metric: Metric): Summary | null {
  if (sessions.length === 0) return null;
  const vals = sessions.map((s) => s.value[metric]);
  return {
    best: Math.max(...vals),
    latest: vals[vals.length - 1],
    change: vals[vals.length - 1] - vals[0],
    sessions: sessions.length,
  };
}

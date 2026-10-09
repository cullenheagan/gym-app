// Pure helpers for the Progress tab: turn raw logged sets into one point per session.

import { type Kind, distToDisplay, distUnit, kindOf, secToMin } from "./kinds";
import type { Unit } from "./units";

export type ProgressSet = {
  exerciseId: string;
  exerciseName: string;
  workoutId: string;
  startedAt: string; // ISO time of the workout
  gymName: string | null;
  kg: number | null;
  reps: number | null;
  setType: string | null;
  kind?: string | null;
  durationS?: number | null;
  distanceM?: number | null;
  rpe?: number | null;
};

export type Metric = "e1rm" | "top" | "volume" | "time" | "distance" | "pace" | "effort";
export type Range = "1M" | "3M" | "6M" | "All";

export type Session = {
  workoutId: string;
  date: number; // ms
  gymName: string | null;
  value: Record<Metric, number>; // kg (volume in kg x reps), seconds, meters, seconds per meter, effort 1-10
  sets: { kg: number; reps: number; durationS?: number; distanceM?: number }[];
};

export type ExerciseProgress = {
  exerciseId: string;
  name: string;
  kind: Kind;
  gymNames: string[];
  sessions: Session[]; // oldest first
};

// Epley estimate of a one-rep max. One rep is the weight itself.
export function epley(kg: number, reps: number): number {
  return reps <= 1 ? kg : kg * (1 + reps / 30);
}

const ZERO: Record<Metric, number> = { e1rm: 0, top: 0, volume: 0, time: 0, distance: 0, pace: 0, effort: 0 };

export function buildProgress(rows: ProgressSet[]): ExerciseProgress[] {
  const byEx = new Map<string, { name: string; kind: Kind; sessions: Map<string, Session>; effort: Map<string, number[]> }>();
  for (const r of rows) {
    if (r.setType === "warmup") continue;
    const kind = kindOf(r.kind);
    if (kind === "strength") {
      if (r.kg == null || r.reps == null || r.kg <= 0 || r.reps <= 0) continue;
    } else if (!((r.durationS ?? 0) > 0 || (r.distanceM ?? 0) > 0)) {
      continue;
    }
    let ex = byEx.get(r.exerciseId);
    if (!ex) byEx.set(r.exerciseId, (ex = { name: r.exerciseName, kind, sessions: new Map(), effort: new Map() }));
    let s = ex.sessions.get(r.workoutId);
    if (!s) {
      s = { workoutId: r.workoutId, date: new Date(r.startedAt).getTime(), gymName: r.gymName, value: { ...ZERO }, sets: [] };
      ex.sessions.set(r.workoutId, s);
    }
    if (kind === "strength") {
      s.sets.push({ kg: r.kg as number, reps: r.reps as number });
      s.value.e1rm = Math.max(s.value.e1rm, epley(r.kg as number, r.reps as number));
      s.value.top = Math.max(s.value.top, r.kg as number);
      s.value.volume += (r.kg as number) * (r.reps as number);
    } else {
      s.sets.push({ kg: 0, reps: r.reps ?? 0, durationS: r.durationS ?? 0, distanceM: r.distanceM ?? 0 });
      s.value.time += r.durationS ?? 0;
      s.value.distance += r.distanceM ?? 0;
      if (r.rpe != null) {
        const list = ex.effort.get(r.workoutId) ?? [];
        list.push(r.rpe);
        ex.effort.set(r.workoutId, list);
      }
    }
  }
  const out: ExerciseProgress[] = [];
  for (const [exerciseId, ex] of byEx) {
    const sessions = [...ex.sessions.values()].sort((a, b) => a.date - b.date);
    for (const s of sessions) {
      if (s.value.distance > 0 && s.value.time > 0) s.value.pace = s.value.time / s.value.distance;
      const ef = ex.effort.get(s.workoutId);
      if (ef && ef.length) s.value.effort = ef.reduce((a, b) => a + b, 0) / ef.length;
    }
    const gymNames = [...new Set(sessions.map((s) => s.gymName).filter((g): g is string => !!g))];
    out.push({ exerciseId, name: ex.name, kind: ex.kind, gymNames, sessions });
  }
  return out.sort((a, b) => b.sessions[b.sessions.length - 1].date - a.sessions[a.sessions.length - 1].date);
}

// Which metric a card or sparkline leads with for each kind of exercise.
export function primaryMetric(kind: Kind, sessions: Session[]): Metric {
  if (kind === "strength") return "e1rm";
  if (kind === "cardio" && sessions.some((s) => s.value.distance > 0)) return "distance";
  return "time";
}

// Lower is better only for pace (time per distance).
export const lowerIsBetter = (m: Metric) => m === "pace";

// A metric's value as shown to the person (lb or kg, miles or km, minutes, min per mile or km).
export function displayValue(v: number, m: Metric, unit: Unit, toWeight: (kg: number, u: Unit) => number): number {
  switch (m) {
    case "distance":
      return distToDisplay(v, unit);
    case "time":
      return secToMin(v);
    case "pace":
      return (v * (distUnit(unit) === "km" ? 1000 : 1609.344)) / 60; // minutes per km or mile
    case "effort":
      return Math.round(v * 10) / 10;
    default:
      return toWeight(v, unit);
  }
}

export function metricUnit(m: Metric, unit: Unit): string {
  switch (m) {
    case "distance":
      return distUnit(unit);
    case "time":
      return "min";
    case "pace":
      return `min/${distUnit(unit)}`;
    case "effort":
      return "/10";
    default:
      return unit;
  }
}

// "6:32" for a pace in minutes, otherwise a whole or one-decimal number.
export function fmtMetric(v: number, m: Metric): string {
  if (m === "pace") {
    const mins = Math.floor(v);
    const secs = Math.round((v - mins) * 60);
    return `${secs === 60 ? mins + 1 : mins}:${String(secs === 60 ? 0 : secs).padStart(2, "0")}`;
  }
  if (m === "distance" || m === "effort") return String(Math.round(v * 10) / 10);
  return Math.round(v).toLocaleString();
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
    const v = lowerIsBetter(metric) ? -s.value[metric] : s.value[metric];
    if (s.value[metric] > 0 && v > best) {
      if (i > 0) out.push(i);
      best = v;
    }
  });
  return out;
}

export type Summary = { best: number; latest: number; change: number; sessions: number };
export function summarize(sessions: Session[], metric: Metric): Summary | null {
  if (sessions.length === 0) return null;
  const vals = sessions.map((s) => s.value[metric]).filter((v) => v > 0 || !lowerIsBetter(metric));
  if (vals.length === 0) return null;
  return {
    best: lowerIsBetter(metric) ? Math.min(...vals) : Math.max(...vals),
    latest: vals[vals.length - 1],
    change: vals[vals.length - 1] - vals[0],
    sessions: sessions.length,
  };
}

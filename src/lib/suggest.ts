// Suggests what to lift next, from the sets of the last session for an exercise.
// Warm-up sets must be filtered out by the caller.

import { sideReps } from "./sides";

// repsR is the right side of a single-arm set; the weaker side counts toward the goal.
export type PastWorkingSet = { kg: number | null; reps: number | null; repsR?: number | null };
export type Suggestion = { kg: number; reps: number; hit: boolean; lastKg: number; lastReps: number[] };

const DEFAULT_GOAL = 8;

// stepKg: the smallest jump to offer (5 lb or 2.5 kg, in kg). Result is rounded to that step.
export function suggest(last: PastWorkingSet[], stepKg: number): Suggestion | null {
  const sets = last
    .map((s) => ({ kg: s.kg, reps: sideReps(s.reps, s.repsR) }))
    .filter((s): s is { kg: number; reps: number } => s.kg != null && s.reps != null && s.kg > 0 && s.reps > 0);
  if (sets.length === 0) return null;
  const top = Math.max(...sets.map((s) => s.kg));
  const atTop = sets.filter((s) => s.kg === top);
  const reps = atTop.map((s) => s.reps);
  // A fixed scheme like 5x5 sets its own goal; otherwise aim for 8.
  const goal = reps.every((r) => r === reps[0]) && reps[0] < DEFAULT_GOAL ? reps[0] : DEFAULT_GOAL;
  const hit = Math.min(...reps) >= goal;
  if (!hit) return { kg: top, reps: goal, hit, lastKg: top, lastReps: reps };
  let next = Math.round((top * 1.025) / stepKg) * stepKg;
  if (next <= top + 1e-9) next = top + stepKg;
  return { kg: Math.round(next * 1000) / 1000, reps: goal, hit, lastKg: top, lastReps: reps };
}

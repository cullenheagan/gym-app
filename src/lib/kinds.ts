// Workout types. A workout (and each exercise) has a kind, and the kind decides what a set records:
//   strength  weight x reps (weight optional for bodyweight)
//   cardio    time and distance
//   intervals time per round
//   sport     time and an effort rating (1-10)

import type { Unit } from "./units";

export type Kind = "strength" | "cardio" | "intervals" | "sport";

export const KINDS: { id: Kind; label: string; blurb: string }[] = [
  { id: "strength", label: "Strength", blurb: "Weights and bodyweight" },
  { id: "cardio", label: "Cardio", blurb: "Run, bike, row, swim" },
  { id: "intervals", label: "Intervals", blurb: "HIIT, planks, rounds" },
  { id: "sport", label: "Sport", blurb: "Games and classes" },
];

export const kindOf = (k: string | null | undefined): Kind =>
  k === "cardio" || k === "intervals" || k === "sport" ? k : "strength";

export const kindLabel = (k: Kind) => KINDS.find((x) => x.id === k)?.label ?? "Strength";

// Tap-to-add exercises for a new user, per kind (strength has the normal picker and library).
export const QUICK_ADD: Record<Kind, string[]> = {
  strength: [],
  cardio: ["Run", "Walk", "Bike", "Row", "Swim", "Elliptical", "Stair climber"],
  intervals: ["HIIT", "Plank", "Jump rope", "Circuit", "Burpees"],
  sport: ["Basketball", "Soccer", "Tennis", "Boxing", "Yoga", "Class"],
};

// Suggested workout names per kind.
export const NAME_DEFAULTS: Record<Kind, string[]> = {
  strength: ["Push Day", "Pull Day", "Leg Day", "Upper", "Lower", "Full Body", "Arms"],
  cardio: ["Run", "Bike Ride", "Swim", "Walk", "Cardio"],
  intervals: ["HIIT", "Circuit", "Core", "Tabata"],
  sport: ["Basketball", "Soccer", "Tennis", "Yoga", "Class"],
};

// Distance follows the weight unit toggle: lb -> miles, kg -> kilometers.
export const distUnit = (u: Unit) => (u === "kg" ? "km" : "mi");
const M_PER: Record<string, number> = { km: 1000, mi: 1609.344 };
export const distToDisplay = (m: number, u: Unit) => Math.round((m / M_PER[distUnit(u)]) * 100) / 100;
export const distFromDisplay = (v: number, u: Unit) => v * M_PER[distUnit(u)];

// Minutes are typed as a number ("32" or "32.5"); stored as whole seconds.
export const minToSec = (min: number) => Math.round(min * 60);
export const secToMin = (s: number) => Math.round((s / 60) * 100) / 100;

// "45 s", "32 min", "1 h 05 min".
export function fmtSeconds(s: number): string {
  if (s < 60) return `${Math.round(s)} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")} min`;
}

// Pace as "6:32 /mi" (time per distance unit), or null when it cannot be worked out.
export function fmtPace(seconds: number, meters: number, u: Unit): string | null {
  if (!(seconds > 0) || !(meters > 0)) return null;
  const per = seconds / (meters / M_PER[distUnit(u)]);
  const m = Math.floor(per / 60);
  const s = Math.round(per % 60);
  return `${s === 60 ? m + 1 : m}:${String(s === 60 ? 0 : s).padStart(2, "0")} /${distUnit(u)}`;
}

export type SetFacts = {
  kg: number | null;
  reps: number | null;
  durationS: number | null;
  distanceM: number | null;
  rpe: number | null;
};

// One-line description of a set for History and Previous: "135 x 8", "32 min · 5 mi", "45 s", "60 min · effort 7".
export function describeSet(kind: Kind, s: SetFacts, u: Unit, formatKg: (kg: number) => string): string {
  if (kind === "strength") return `${formatKg(s.kg ?? 0)} × ${s.reps ?? 0}`;
  const parts: string[] = [];
  if (s.durationS != null) parts.push(fmtSeconds(s.durationS));
  if (kind === "cardio" && s.distanceM != null) parts.push(`${distToDisplay(s.distanceM, u)} ${distUnit(u)}`);
  if (kind === "sport" && s.rpe != null) parts.push(`effort ${s.rpe}`);
  return parts.join(" · ") || "-";
}

// Suggested names for a new workout.

import { normName } from "./history-filter";

export const DEFAULT_NAMES = ["Push Day", "Pull Day", "Leg Day", "Upper", "Lower", "Full Body", "Arms"];

// Up to `pastMax` names you have used before (most used first, newest spelling), then the usual
// splits that are not already in the list. The default name "Workout" is never suggested.
export function workoutNameChips(past: { name: string }[], pastMax = 4): string[] {
  const counts = new Map<string, { label: string; n: number }>();
  for (const w of past) {
    const key = normName(w.name ?? "");
    if (!key || key === "workout") continue;
    const cur = counts.get(key);
    if (cur) cur.n += 1;
    else counts.set(key, { label: w.name.trim(), n: 1 });
  }
  const used = [...counts.values()].sort((a, b) => b.n - a.n).slice(0, pastMax).map((x) => x.label);
  const seen = new Set(used.map(normName));
  return [...used, ...DEFAULT_NAMES.filter((d) => !seen.has(normName(d)))];
}

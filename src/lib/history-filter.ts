// Filtering the workout history by gym and by workout type (the workout's name, like "Push Day").

export type FilterableWorkout = { name: string; gym_id: string | null; gymName?: string | null };
export type Option = { key: string; label: string; count: number };

export const NO_GYM = "none";

// "Push Day", "push day " and "PUSH DAY" are the same workout type.
export const normName = (s: string) => s.trim().toLowerCase();

// Newest workout first is expected, so the label uses the most recent spelling.
export function typeOptions(ws: FilterableWorkout[]): Option[] {
  const map = new Map<string, Option>();
  for (const w of ws) {
    const key = normName(w.name);
    if (!key) continue;
    const cur = map.get(key);
    if (cur) cur.count += 1;
    else map.set(key, { key, label: w.name.trim(), count: 1 });
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function gymOptions(ws: FilterableWorkout[]): Option[] {
  const map = new Map<string, Option>();
  for (const w of ws) {
    const key = w.gym_id ?? NO_GYM;
    const cur = map.get(key);
    if (cur) cur.count += 1;
    else map.set(key, { key, label: w.gym_id ? (w.gymName ?? "Unknown gym") : "No gym", count: 1 });
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function applyFilters<T extends FilterableWorkout>(ws: T[], gym: string, type: string): T[] {
  return ws.filter(
    (w) => (!gym || (w.gym_id ?? NO_GYM) === gym) && (!type || normName(w.name) === type),
  );
}

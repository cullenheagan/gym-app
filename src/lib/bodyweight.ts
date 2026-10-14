import type { SupabaseClient } from "@supabase/supabase-js";
import { cacheKey, readCache, writeCache } from "./cache";

// Bodyweight log: one weight per day, kept in kilograms.
export type WeightLog = { measured_on: string; weight_kg: number }; // measured_on is YYYY-MM-DD, your local day

// Oldest first. Falls back to the copy kept on this phone when there is no signal.
export async function loadWeights(db: SupabaseClient, userId: string): Promise<{ logs: WeightLog[]; saved: boolean }> {
  const ck = cacheKey(userId, "body-weights");
  const res = await db.from("body_weights").select("measured_on,weight_kg").order("measured_on", { ascending: false }).limit(730);
  if (res.error) {
    const copy = readCache<WeightLog[]>(ck);
    return { logs: copy ?? [], saved: !!copy };
  }
  const logs = ((res.data ?? []) as { measured_on: string; weight_kg: number | string }[])
    .map((r) => ({ measured_on: String(r.measured_on), weight_kg: Number(r.weight_kg) }))
    .reverse();
  writeCache(ck, logs);
  return { logs, saved: false };
}

export function cacheWeights(userId: string, logs: WeightLog[]): void {
  writeCache(cacheKey(userId, "body-weights"), logs);
}

// Saves (or replaces) the weight for a day.
export async function saveWeight(db: SupabaseClient, userId: string, date: string, kg: number): Promise<string | null> {
  const { error } = await db
    .from("body_weights")
    .upsert({ user_id: userId, measured_on: date, weight_kg: Math.round(kg * 100) / 100 }, { onConflict: "user_id,measured_on" });
  return error ? error.message : null;
}

export async function deleteWeight(db: SupabaseClient, userId: string, date: string): Promise<string | null> {
  const { error } = await db.from("body_weights").delete().eq("user_id", userId).eq("measured_on", date);
  return error ? error.message : null;
}

// Replace or add a day's weight in a list, keeping it oldest first.
export function withWeight(logs: WeightLog[], date: string, kg: number): WeightLog[] {
  const rest = logs.filter((l) => l.measured_on !== date);
  return [...rest, { measured_on: date, weight_kg: Math.round(kg * 100) / 100 }].sort((a, b) => a.measured_on.localeCompare(b.measured_on));
}

export const dayMs = (d: string): number => {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).getTime();
};

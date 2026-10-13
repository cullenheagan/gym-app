import type { SupabaseClient } from "@supabase/supabase-js";

const KG_TO_LB = 2.20462262;

type Cell = string | number | null | undefined;

// Spreadsheets run text that starts with = + - @ as a formula. Typed names could do that,
// so those cells get a leading apostrophe.
function text(v: string | null | undefined): string {
  if (v == null) return "";
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

export function csvCell(v: Cell): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsv(rows: Cell[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

type Row = {
  set_index: number;
  set_type: string | null;
  weight_kg: number | null;
  reps: number | null;
  duration_s?: number | null;
  distance_m?: number | null;
  rpe?: number | null;
  superset_id?: string | null;
  completed_at: string | null;
  workout: { name: string; kind?: string | null; started_at: string; gym: { name: string } | { name: string }[] | null } | { name: string; kind?: string | null; started_at: string; gym: { name: string } | { name: string }[] | null }[] | null;
  exercise: { name: string; equipment_type: string } | { name: string; equipment_type: string }[] | null;
  setup: { name: string; pin_position: string | null } | { name: string; pin_position: string | null }[] | null;
};

export const CSV_HEADER = [
  "workout_date",
  "workout_name",
  "gym",
  "exercise",
  "equipment",
  "bench_setup",
  "pin_position",
  "set_number",
  "weight_lb",
  "weight_kg",
  "reps",
  "set_type",
  "completed_at",
  "workout_type",
  "duration_min",
  "distance_km",
  "distance_mi",
  "effort",
  "superset_group",
];

export function rowToCells(r: Row): Cell[] {
  const w = one(r.workout);
  const kg = r.weight_kg == null ? null : Number(r.weight_kg);
  return [
    w?.started_at ?? "",
    text(w?.name),
    text(one(w?.gym)?.name),
    text(one(r.exercise)?.name),
    one(r.exercise)?.equipment_type ?? "",
    text(one(r.setup)?.name),
    text(one(r.setup)?.pin_position),
    r.set_index + 1,
    kg == null ? null : Number((kg * KG_TO_LB).toFixed(2)),
    kg == null ? null : Number(kg.toFixed(3)),
    r.reps,
    r.set_type ?? "",
    r.completed_at ?? "",
    w?.kind ?? "strength",
    r.duration_s == null ? null : Number((r.duration_s / 60).toFixed(2)),
    r.distance_m == null ? null : Number((Number(r.distance_m) / 1000).toFixed(3)),
    r.distance_m == null ? null : Number((Number(r.distance_m) / 1609.344).toFixed(3)),
    r.rpe ?? null,
    r.superset_id ?? "",
  ];
}

// Every set you have logged, oldest first.
export async function exportAllSets(db: SupabaseClient): Promise<{ csv: string; count: number } | { error: string }> {
  const PAGE = 1000;
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const res = await db
      .from("workout_sets")
      .select(
        "set_index,set_type,weight_kg,reps,duration_s,distance_m,rpe,superset_id,completed_at,workout:workouts(name,kind,started_at,gym:gyms(name)),exercise:exercises(name,equipment_type),setup:exercise_setups(name,pin_position)",
      )
      .order("completed_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (res.error) return { error: res.error.message };
    const page = (res.data ?? []) as unknown as Row[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return { csv: buildCsv([CSV_HEADER, ...rows.map(rowToCells)]), count: rows.length };
}

export function downloadCsv(filename: string, csv: string): void {
  // The leading BOM makes Excel read the file as UTF-8.
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}

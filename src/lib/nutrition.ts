import type { SupabaseClient } from "@supabase/supabase-js";
import { cacheKey, readCache, writeCache } from "./cache";

// Nutrition: daily targets, meals and the foods eaten each day.

export type Macros = { kcal: number; protein: number; carbs: number; fat: number };

export type Targets = { kcal: number | null; protein: number | null; carbs: number | null; fat: number | null };

export type NutritionProfile = {
  targets: Targets;
  mealNames: string[];
  height_cm: number | null;
  weight_kg: number | null;
  birth_year: number | null;
  sex: "male" | "female" | null;
  activity: "sedentary" | "light" | "moderate" | "active" | "very_active" | null;
  goal: "lose" | "maintain" | "gain" | null;
};

export const DEFAULT_MEALS = ["Breakfast", "Lunch", "Dinner", "Snacks"];

export const EMPTY_PROFILE: NutritionProfile = {
  targets: { kcal: null, protein: null, carbs: null, fat: null },
  mealNames: DEFAULT_MEALS,
  height_cm: null,
  weight_kg: null,
  birth_year: null,
  sex: null,
  activity: null,
  goal: null,
};

export type FoodEntry = {
  id: string;
  eaten_on: string; // YYYY-MM-DD, your local date
  meal: string;
  name: string;
  brand: string | null;
  source: "usda" | "off" | "manual" | "saved";
  source_id: string | null;
  amount: number | null;
  unit: string | null;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  created_at?: string;
};

const num = (v: unknown): number | null => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

// "2026-10-14" for a date, in the phone's time zone.
export function localDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return localDate(new Date(y, m - 1, d + days));
}

export function prettyDate(date: string): string {
  const today = localDate();
  if (date === today) return "Today";
  if (date === shiftDate(today, -1)) return "Yesterday";
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function sumMacros(entries: FoodEntry[]): Macros {
  return entries.reduce(
    (t, e) => ({
      kcal: t.kcal + Number(e.kcal),
      protein: t.protein + Number(e.protein_g),
      carbs: t.carbs + Number(e.carbs_g),
      fat: t.fat + Number(e.fat_g),
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

export const round1 = (n: number) => Math.round(n * 10) / 10;

// ----- loading and caching -----

const PROFILE_COLS =
  "target_kcal,target_protein_g,target_carbs_g,target_fat_g,meal_names,height_cm,weight_kg,birth_year,sex,activity_level,nutrition_goal";

export async function loadNutritionProfile(db: SupabaseClient, userId: string): Promise<NutritionProfile> {
  const ck = cacheKey(userId, "nutrition-profile");
  const res = await db.from("profiles").select(PROFILE_COLS).eq("id", userId).maybeSingle();
  if (res.error || !res.data) return readCache<NutritionProfile>(ck) ?? EMPTY_PROFILE;
  const r = res.data as Record<string, unknown>;
  const names = Array.isArray(r.meal_names) ? (r.meal_names as unknown[]).filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
  const p: NutritionProfile = {
    targets: { kcal: num(r.target_kcal), protein: num(r.target_protein_g), carbs: num(r.target_carbs_g), fat: num(r.target_fat_g) },
    mealNames: names.length > 0 ? names : DEFAULT_MEALS,
    height_cm: num(r.height_cm),
    weight_kg: num(r.weight_kg),
    birth_year: num(r.birth_year),
    sex: r.sex === "male" || r.sex === "female" ? r.sex : null,
    activity: ["sedentary", "light", "moderate", "active", "very_active"].includes(r.activity_level as string) ? (r.activity_level as NutritionProfile["activity"]) : null,
    goal: ["lose", "maintain", "gain"].includes(r.nutrition_goal as string) ? (r.nutrition_goal as NutritionProfile["goal"]) : null,
  };
  writeCache(ck, p);
  return p;
}

function normalize(r: Record<string, unknown>): FoodEntry {
  return {
    id: String(r.id),
    eaten_on: String(r.eaten_on),
    meal: String(r.meal),
    name: String(r.name),
    brand: (r.brand as string | null) ?? null,
    source: (r.source as FoodEntry["source"]) ?? "manual",
    source_id: (r.source_id as string | null) ?? null,
    amount: num(r.amount),
    unit: (r.unit as string | null) ?? null,
    kcal: Number(r.kcal ?? 0),
    protein_g: Number(r.protein_g ?? 0),
    carbs_g: Number(r.carbs_g ?? 0),
    fat_g: Number(r.fat_g ?? 0),
    created_at: r.created_at as string | undefined,
  };
}

// Foods eaten on one day. Falls back to the copy kept on this phone when there is no signal.
export async function loadDay(db: SupabaseClient, userId: string, date: string): Promise<{ entries: FoodEntry[]; saved: boolean }> {
  const ck = cacheKey(userId, `food:${date}`);
  const res = await db
    .from("food_entries")
    .select("id,eaten_on,meal,name,brand,source,source_id,amount,unit,kcal,protein_g,carbs_g,fat_g,created_at")
    .eq("eaten_on", date)
    .order("created_at", { ascending: true });
  if (res.error) {
    const copy = readCache<FoodEntry[]>(ck);
    return { entries: copy ?? [], saved: !!copy };
  }
  const entries = ((res.data ?? []) as Record<string, unknown>[]).map(normalize);
  writeCache(ck, entries);
  return { entries, saved: false };
}

export function cacheDay(userId: string, date: string, entries: FoodEntry[]): void {
  writeCache(cacheKey(userId, `food:${date}`), entries);
}

// ----- food amounts -----

export type FoodHit = {
  id: string;
  name: string;
  brand: string | null;
  source: "off" | "usda";
  per100: Macros; // per 100 g
  servingG: number | null; // grams in one labelled serving, when the label says
  servingText: string | null;
};

export type AmountUnit = "g" | "oz" | "serving";
const G_PER_OZ = 28.3495;

export function gramsFor(amount: number, unit: AmountUnit, servingG: number | null): number {
  if (unit === "oz") return amount * G_PER_OZ;
  if (unit === "serving") return amount * (servingG ?? 100);
  return amount;
}

export function macrosFor(hit: FoodHit, amount: number, unit: AmountUnit): Macros {
  const f = gramsFor(amount, unit, hit.servingG) / 100;
  return {
    kcal: round1(hit.per100.kcal * f),
    protein: round1(hit.per100.protein * f),
    carbs: round1(hit.per100.carbs * f),
    fat: round1(hit.per100.fat * f),
  };
}

// ----- suggesting targets -----

const ACTIVITY: Record<NonNullable<NutritionProfile["activity"]>, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

// A starting point from the Mifflin-St Jeor estimate. Protein is about 1.8 g per kg of body weight,
// fat 25% of calories, carbs the rest. It is only an estimate, so the person edits the numbers.
export function suggestTargets(p: NutritionProfile, nowYear = new Date().getFullYear()): { targets: Targets; note: string } | null {
  if (!p.height_cm || !p.weight_kg || !p.birth_year || !p.sex || !p.activity || !p.goal) return null;
  const age = nowYear - p.birth_year;
  if (age < 15 || age > 100) return null;
  const bmr = 10 * p.weight_kg + 6.25 * p.height_cm - 5 * age + (p.sex === "male" ? 5 : -161);
  const factor = p.goal === "lose" ? 0.8 : p.goal === "gain" ? 1.1 : 1;
  let kcal = Math.round((bmr * ACTIVITY[p.activity] * factor) / 10) * 10;
  let note = "Estimated from your stats. Edit any number.";
  if (kcal < 1200) {
    kcal = 1200;
    note = "Raised to 1,200 calories, a floor this estimate should not go below. Edit any number.";
  }
  const protein = Math.round(p.weight_kg * 1.8);
  const fat = Math.round((kcal * 0.25) / 9);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { targets: { kcal, protein, carbs, fat }, note };
}

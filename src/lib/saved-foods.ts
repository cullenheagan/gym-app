import type { SupabaseClient } from "@supabase/supabase-js";
import { cacheKey, readCache, writeCache } from "./cache";
import type { FoodEntry } from "./nutrition";

// Saved foods and meals for the "My foods" tab. A food is saved as the totals for one amount.

export type FoodItem = {
  name: string;
  brand: string | null;
  amount: number | null;
  unit: string | null;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};
export type SavedFood = FoodItem & { id: string };
export type SavedMeal = { id: string; name: string; items: FoodItem[] };
export type MyFoods = { foods: SavedFood[]; meals: SavedMeal[]; recent: FoodItem[] };

export const EMPTY_MY_FOODS: MyFoods = { foods: [], meals: [], recent: [] };

const num = (v: unknown): number | null => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

export function toItem(r: Record<string, unknown>): FoodItem {
  return {
    name: String(r.name ?? ""),
    brand: (r.brand as string | null) ?? null,
    amount: num(r.amount),
    unit: (r.unit as string | null) ?? null,
    kcal: Number(r.kcal ?? 0),
    protein_g: Number(r.protein_g ?? 0),
    carbs_g: Number(r.carbs_g ?? 0),
    fat_g: Number(r.fat_g ?? 0),
  };
}

export const itemFromEntry = (e: FoodEntry): FoodItem => ({
  name: e.name,
  brand: e.brand,
  amount: e.amount,
  unit: e.unit,
  kcal: e.kcal,
  protein_g: e.protein_g,
  carbs_g: e.carbs_g,
  fat_g: e.fat_g,
});

// Two items are "the same food" when name, brand, amount and unit match.
export const sameFood = (a: FoodItem, b: FoodItem): boolean =>
  a.name.trim().toLowerCase() === b.name.trim().toLowerCase() &&
  (a.brand ?? "").toLowerCase() === (b.brand ?? "").toLowerCase() &&
  (a.amount ?? null) === (b.amount ?? null) &&
  (a.unit ?? "") === (b.unit ?? "");

export const sumItems = (items: FoodItem[]) =>
  items.reduce((t, i) => ({ kcal: t.kcal + i.kcal, protein: t.protein + i.protein_g, carbs: t.carbs + i.carbs_g, fat: t.fat + i.fat_g }), {
    kcal: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
  });

// The foods you eat most recently, without repeats and without ones you already saved.
function recentFrom(rows: Record<string, unknown>[], saved: SavedFood[]): FoodItem[] {
  const out: FoodItem[] = [];
  for (const r of rows) {
    const it = toItem(r);
    if (!it.name || saved.some((s) => sameFood(s, it)) || out.some((o) => sameFood(o, it))) continue;
    out.push(it);
    if (out.length >= 15) break;
  }
  return out;
}

export async function loadMyFoods(db: SupabaseClient, userId: string): Promise<MyFoods> {
  const ck = cacheKey(userId, "my-foods");
  const [f, m, r] = await Promise.all([
    db.from("saved_foods").select("id,name,brand,amount,unit,kcal,protein_g,carbs_g,fat_g").order("created_at", { ascending: false }),
    db.from("saved_meals").select("id,name,items").order("created_at", { ascending: false }),
    db.from("food_entries").select("name,brand,amount,unit,kcal,protein_g,carbs_g,fat_g").order("created_at", { ascending: false }).limit(80),
  ]);
  if (f.error || m.error) return readCache<MyFoods>(ck) ?? EMPTY_MY_FOODS;
  const foods = ((f.data ?? []) as Record<string, unknown>[]).map((x) => ({ id: String(x.id), ...toItem(x) }));
  const meals = ((m.data ?? []) as Record<string, unknown>[]).map((x) => ({
    id: String(x.id),
    name: String(x.name),
    items: Array.isArray(x.items) ? (x.items as Record<string, unknown>[]).map(toItem) : [],
  }));
  const result: MyFoods = { foods, meals, recent: r.error ? [] : recentFrom((r.data ?? []) as Record<string, unknown>[], foods) };
  writeCache(ck, result);
  return result;
}

export function cacheMyFoods(userId: string, v: MyFoods): void {
  writeCache(cacheKey(userId, "my-foods"), v);
}

export async function insertSavedFood(db: SupabaseClient, userId: string, item: FoodItem): Promise<{ food?: SavedFood; error?: string }> {
  const food: SavedFood = { id: crypto.randomUUID(), ...item };
  const { error } = await db.from("saved_foods").insert({ ...food, user_id: userId });
  return error ? { error: error.message } : { food };
}

export async function insertSavedMeal(db: SupabaseClient, userId: string, name: string, items: FoodItem[]): Promise<{ meal?: SavedMeal; error?: string }> {
  const meal: SavedMeal = { id: crypto.randomUUID(), name, items };
  const { error } = await db.from("saved_meals").insert({ ...meal, user_id: userId });
  return error ? { error: error.message } : { meal };
}

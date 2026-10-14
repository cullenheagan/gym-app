import type { FoodHit } from "./nutrition";

// Turns Open Food Facts search results into the app's food list. Kept separate from the
// network call so it can be tested on its own.

type OffProduct = {
  code?: string;
  product_name?: string;
  generic_name?: string;
  brands?: string;
  serving_size?: string;
  serving_quantity?: number | string;
  nutriments?: Record<string, unknown>;
};

const n = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) && x >= 0 ? x : null;
};

export function parseOff(products: unknown): FoodHit[] {
  if (!Array.isArray(products)) return [];
  const out: FoodHit[] = [];
  const seen = new Set<string>();
  for (const raw of products as OffProduct[]) {
    const name = (raw.product_name || raw.generic_name || "").trim();
    const nu = raw.nutriments ?? {};
    const kcal = n(nu["energy-kcal_100g"]) ?? (n(nu["energy_100g"]) != null ? (n(nu["energy_100g"]) as number) / 4.184 : null);
    const protein = n(nu["proteins_100g"]);
    const carbs = n(nu["carbohydrates_100g"]);
    const fat = n(nu["fat_100g"]);
    if (!name || kcal == null || protein == null || carbs == null || fat == null || kcal > 950) continue;
    const brand = (raw.brands ?? "").split(",")[0]?.trim() || null;
    const key = `${name.toLowerCase()}|${(brand ?? "").toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const sq = n(raw.serving_quantity);
    out.push({
      id: raw.code || key,
      name: name.slice(0, 120),
      brand: brand ? brand.slice(0, 60) : null,
      source: "off",
      per100: { kcal: Math.round(kcal * 10) / 10, protein, carbs, fat },
      servingG: sq && sq > 0 && sq < 2000 ? sq : null,
      servingText: raw.serving_size ? String(raw.serving_size).slice(0, 40) : null,
    });
  }
  return out;
}

// ----- USDA FoodData Central -----

type UsdaFood = {
  fdcId?: number;
  description?: string;
  dataType?: string;
  brandOwner?: string;
  brandName?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  householdServingFullText?: string;
  foodNutrients?: { nutrientId?: number; nutrientNumber?: string | number; value?: number }[];
};

// USDA writes branded names in capitals ("CHICKEN BREAST"); make them readable.
const readable = (s: string) => {
  const t = s.trim();
  if (t !== t.toUpperCase()) return t;
  const l = t.toLowerCase();
  return l.charAt(0).toUpperCase() + l.slice(1);
};

// Search results give nutrients per 100 g. `generic` is true for Foundation and SR Legacy foods
// (plain chicken, rice, eggs), false for branded packages.
export function parseUsda(foods: unknown): (FoodHit & { generic: boolean })[] {
  if (!Array.isArray(foods)) return [];
  const out: (FoodHit & { generic: boolean })[] = [];
  const seen = new Set<string>();
  for (const raw of foods as UsdaFood[]) {
    const name = readable(raw.description ?? "");
    const by: Record<string, number> = {};
    for (const fn of raw.foodNutrients ?? []) {
      const id = String(fn.nutrientId ?? fn.nutrientNumber ?? "");
      const v = n(fn.value);
      if (id && v != null) by[id] = v;
    }
    const kcal = by["1008"] ?? by["2047"] ?? by["2048"];
    const protein = by["1003"];
    const carbs = by["1005"];
    const fat = by["1004"];
    if (!name || kcal == null || protein == null || carbs == null || fat == null || kcal > 950) continue;
    const generic = raw.dataType === "Foundation" || raw.dataType === "SR Legacy";
    const brand = generic ? null : readable(raw.brandName || raw.brandOwner || "") || null;
    const key = `${name.toLowerCase()}|${(brand ?? "").toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const unit = (raw.servingSizeUnit ?? "").toLowerCase();
    const sq = n(raw.servingSize);
    const servingG = !generic && sq && sq > 0 && sq < 2000 && (unit === "g" || unit === "grm" || unit === "ml") ? sq : null;
    out.push({
      id: `usda-${raw.fdcId ?? key}`,
      name: name.slice(0, 120),
      brand: brand ? brand.slice(0, 60) : null,
      source: "usda",
      per100: { kcal: Math.round(kcal * 10) / 10, protein, carbs, fat },
      servingG,
      servingText: servingG ? (raw.householdServingFullText ? String(raw.householdServingFullText) : `${sq} ${unit}`).slice(0, 40) : null,
      generic,
    });
  }
  return out;
}

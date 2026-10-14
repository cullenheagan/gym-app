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

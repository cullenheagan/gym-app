import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { parseOff, parseUsda } from "@/lib/food-parse";
import type { FoodHit } from "@/lib/nutrition";

// Food search for the Nutrition tab. Only signed-in people can use it, and it asks Open Food Facts
// (free, no key). Results are per 100 g so any amount can be worked out on the phone.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "Food search is not set up." }, { status: 500 });

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Sign in to search foods." }, { status: 401 });
  const who = await createClient(url, key).auth.getUser(token);
  if (who.error || !who.data.user) return NextResponse.json({ error: "Sign in to search foods." }, { status: 401 });

  const params = new URL(req.url).searchParams;

  // Barcode lookup: one product by its number.
  const code = (params.get("code") ?? "").trim();
  if (code) {
    if (!/^\d{8,14}$/.test(code)) return NextResponse.json({ error: "That does not look like a barcode number." }, { status: 400 });
    const [off, usda] = await Promise.all([lookupOff(code), lookupUsda(code)]);
    if (off === null && usda === null) return NextResponse.json({ error: "The food database did not answer. Try again." }, { status: 502 });
    const found = [...(off ?? []), ...(usda ?? [])].slice(0, 1).map((h) => {
      const { ...hit } = h as FoodHit & { generic?: boolean };
      delete hit.generic;
      return hit;
    });
    return NextResponse.json({ foods: found });
  }

  const q = (params.get("q") ?? "").trim().slice(0, 80);
  if (q.length < 2) return NextResponse.json({ foods: [] });

  const [off, usda] = await Promise.all([searchOff(q), searchUsda(q)]);
  if (off === null && usda === null) return NextResponse.json({ error: "The food database did not answer. Try again." }, { status: 502 });

  // Plain foods from USDA first (chicken, rice, eggs), then packaged foods from Open Food Facts,
  // then USDA's branded ones. Duplicates by name and brand are dropped.
  const u = usda ?? [];
  const merged: FoodHit[] = [];
  const seen = new Set<string>();
  for (const h of [...u.filter((x) => x.generic).slice(0, 8), ...(off ?? []).slice(0, 12), ...u.filter((x) => !x.generic)]) {
    const k = `${h.name.toLowerCase()}|${(h.brand ?? "").toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const { ...hit } = h as FoodHit & { generic?: boolean };
    delete hit.generic;
    merged.push(hit);
  }
  return NextResponse.json({ foods: merged.slice(0, 25) });
}

// Each source returns null when it fails, so one being down does not break search.
async function timed(fetcher: (signal: AbortSignal) => Promise<Response>): Promise<unknown | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetcher(ctl.signal);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function searchOff(q: string): Promise<FoodHit[] | null> {
  const off = new URL("https://world.openfoodfacts.org/cgi/search.pl");
  off.searchParams.set("search_terms", q);
  off.searchParams.set("search_simple", "1");
  off.searchParams.set("action", "process");
  off.searchParams.set("json", "1");
  off.searchParams.set("page_size", "30");
  off.searchParams.set("sort_by", "unique_scans_n");
  off.searchParams.set("fields", "code,product_name,generic_name,brands,serving_size,serving_quantity,nutriments");
  const body = (await timed((signal) =>
    fetch(off, { signal, headers: { "User-Agent": "GymCompanion/1.0 (personal project)", Accept: "application/json" }, cache: "no-store" }),
  )) as { products?: unknown } | null;
  return body ? parseOff(body.products) : null;
}

// USDA FoodData Central (free key in USDA_API_KEY). Without the key this source is simply skipped.
async function searchUsda(q: string): Promise<(FoodHit & { generic: boolean })[] | null> {
  const key = process.env.USDA_API_KEY;
  if (!key) return null;
  const u = new URL("https://api.nal.usda.gov/fdc/v1/foods/search");
  u.searchParams.set("query", q);
  u.searchParams.set("pageSize", "25");
  u.searchParams.set("dataType", "Foundation,SR Legacy,Branded");
  const body = (await timed((signal) => fetch(u, { signal, headers: { "X-Api-Key": key, Accept: "application/json" }, cache: "no-store" }))) as {
    foods?: unknown;
  } | null;
  return body ? parseUsda(body.foods) : null;
}

// Barcode lookups. Open Food Facts is asked first (it knows most packaged foods), then USDA's
// branded foods, which are matched on the exact barcode.
async function lookupOff(code: string): Promise<FoodHit[] | null> {
  const u = new URL(`https://world.openfoodfacts.org/api/v2/product/${code}.json`);
  u.searchParams.set("fields", "code,product_name,generic_name,brands,serving_size,serving_quantity,nutriments");
  const body = (await timed((signal) =>
    fetch(u, { signal, headers: { "User-Agent": "GymCompanion/1.0 (personal project)", Accept: "application/json" }, cache: "no-store" }),
  )) as { status?: number; product?: Record<string, unknown> } | null;
  if (!body) return null;
  return body.status === 1 && body.product ? parseOff([{ code, ...body.product }]) : [];
}

async function lookupUsda(code: string): Promise<(FoodHit & { generic: boolean })[] | null> {
  const key = process.env.USDA_API_KEY;
  if (!key) return null;
  const u = new URL("https://api.nal.usda.gov/fdc/v1/foods/search");
  u.searchParams.set("query", code);
  u.searchParams.set("pageSize", "10");
  u.searchParams.set("dataType", "Branded");
  const body = (await timed((signal) => fetch(u, { signal, headers: { "X-Api-Key": key, Accept: "application/json" }, cache: "no-store" }))) as {
    foods?: unknown;
  } | null;
  return body ? parseUsda(body.foods, code) : null;
}

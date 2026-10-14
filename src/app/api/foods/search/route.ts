import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { parseOff } from "@/lib/food-parse";

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

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 80);
  if (q.length < 2) return NextResponse.json({ foods: [] });

  const off = new URL("https://world.openfoodfacts.org/cgi/search.pl");
  off.searchParams.set("search_terms", q);
  off.searchParams.set("search_simple", "1");
  off.searchParams.set("action", "process");
  off.searchParams.set("json", "1");
  off.searchParams.set("page_size", "30");
  off.searchParams.set("sort_by", "unique_scans_n");
  off.searchParams.set("fields", "code,product_name,generic_name,brands,serving_size,serving_quantity,nutriments");

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(off, {
      signal: ctl.signal,
      headers: { "User-Agent": "GymCompanion/1.0 (personal project)", Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return NextResponse.json({ error: "The food database did not answer. Try again." }, { status: 502 });
    const body = (await res.json()) as { products?: unknown };
    return NextResponse.json({ foods: parseOff(body.products).slice(0, 20) });
  } catch {
    return NextResponse.json({ error: "The food database did not answer. Try again." }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}

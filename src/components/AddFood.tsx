"use client";

import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import NumField from "./NumField";
import { explain } from "@/lib/net";
import { type AmountUnit, type FoodEntry, type FoodHit, macrosFor, round1 } from "@/lib/nutrition";

// The Add food sheet: search the food database, or type the numbers in yourself.
export default function AddFood({
  db,
  userId,
  meal,
  date,
  onAdded,
  onClose,
}: {
  db: SupabaseClient;
  userId: string;
  meal: string;
  date: string;
  onAdded: (e: FoodEntry) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"search" | "manual">("search");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<FoodHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [hit, setHit] = useState<FoodHit | null>(null);
  const [amount, setAmount] = useState<number | null>(100);
  const [unit, setUnit] = useState<AmountUnit>("g");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Typed in by hand
  const [name, setName] = useState("");
  const [kcal, setKcal] = useState<number | null>(null);
  const [protein, setProtein] = useState<number | null>(null);
  const [carbs, setCarbs] = useState<number | null>(null);
  const [fat, setFat] = useState<number | null>(null);

  const latest = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Search a moment after you stop typing.
  useEffect(() => {
    const q = query.trim();
    if (tab !== "search" || q.length < 2) {
      setHits(null);
      setSearchErr(null);
      setSearching(false);
      return;
    }
    const mine = ++latest.current;
    setSearching(true);
    const t = window.setTimeout(async () => {
      try {
        const session = await db.auth.getSession();
        const token = session.data.session?.access_token ?? "";
        const res = await fetch(`/api/foods/search?q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${token}` } });
        const body = (await res.json()) as { foods?: FoodHit[]; error?: string };
        if (mine !== latest.current) return;
        if (!res.ok) {
          setSearchErr(body.error ?? "Search failed. Try again.");
          setHits([]);
        } else {
          setSearchErr(null);
          setHits(body.foods ?? []);
        }
      } catch {
        if (mine !== latest.current) return;
        setSearchErr(explain("Failed to fetch", "Search failed. Try again."));
        setHits([]);
      } finally {
        if (mine === latest.current) setSearching(false);
      }
    }, 450);
    return () => window.clearTimeout(t);
  }, [query, tab, db]);

  function pick(h: FoodHit) {
    setHit(h);
    setError(null);
    if (h.servingG) {
      setUnit("serving");
      setAmount(1);
    } else {
      setUnit("g");
      setAmount(100);
    }
  }

  const preview = hit && amount != null && amount > 0 ? macrosFor(hit, amount, unit) : null;

  async function save(entry: Omit<FoodEntry, "id" | "eaten_on" | "meal">) {
    setSaving(true);
    setError(null);
    const full: FoodEntry = { id: crypto.randomUUID(), eaten_on: date, meal, ...entry };
    const { error: err } = await db.from("food_entries").insert({ ...full, user_id: userId });
    setSaving(false);
    if (err) {
      setError(explain(err.message, "Could not save that food."));
      return;
    }
    onAdded(full);
    onClose();
  }

  function addFound() {
    if (!hit || !preview || amount == null) return;
    const label = unit === "serving" ? (amount === 1 ? "serving" : "servings") : unit;
    save({
      name: hit.name,
      brand: hit.brand,
      source: hit.source,
      source_id: hit.id,
      amount,
      unit: label,
      kcal: preview.kcal,
      protein_g: preview.protein,
      carbs_g: preview.carbs,
      fat_g: preview.fat,
    });
  }

  function addManual() {
    if (!name.trim()) {
      setError("Give the food a name.");
      return;
    }
    if (kcal == null && protein == null && carbs == null && fat == null) {
      setError("Enter at least the calories or one macro.");
      return;
    }
    save({
      name: name.trim().slice(0, 120),
      brand: null,
      source: "manual",
      source_id: null,
      amount: null,
      unit: null,
      kcal: round1(Math.max(0, kcal ?? (protein ?? 0) * 4 + (carbs ?? 0) * 4 + (fat ?? 0) * 9)),
      protein_g: round1(Math.max(0, protein ?? 0)),
      carbs_g: round1(Math.max(0, carbs ?? 0)),
      fat_g: round1(Math.max(0, fat ?? 0)),
    });
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={`Add food to ${meal}`} className="fixed inset-0 z-[60] flex items-end bg-black/40" onClick={onClose}>
      <div
        className="mx-auto flex max-h-[92vh] w-full max-w-md flex-col rounded-t-[24px] bg-card p-4 pb-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-extrabold">Add to {meal}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-10 w-10 items-center justify-center rounded-full bg-field">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="mt-3 flex rounded-xl bg-line p-[3px]" role="group" aria-label="How to add">
          {(["search", "manual"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTab(t);
                setError(null);
              }}
              aria-pressed={tab === t}
              className={`h-10 flex-1 rounded-[10px] text-sm font-bold ${tab === t ? "bg-card text-ink" : "text-muted"}`}
            >
              {t === "search" ? "Search" : "Type it in"}
            </button>
          ))}
        </div>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
          {tab === "search" && !hit && (
            <>
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search foods, like chicken breast"
                aria-label="Search foods"
                className="h-11 w-full rounded-[14px] bg-field px-4 text-base outline-none"
              />
              {searching && <p className="mt-3 text-sm font-medium text-muted">Searching...</p>}
              {searchErr && (
                <p role="alert" className="mt-3 text-sm font-semibold text-red-600">
                  {searchErr}
                </p>
              )}
              {!searching && hits && hits.length === 0 && !searchErr && (
                <p className="mt-3 text-sm font-medium text-muted">Nothing found. Try another word, or use Type it in.</p>
              )}
              {hits && hits.length > 0 && (
                <ul className="mt-2 flex flex-col">
                  {hits.map((h) => (
                    <li key={h.id}>
                      <button type="button" onClick={() => pick(h)} className="flex w-full items-center justify-between gap-3 border-t border-line py-2.5 text-left">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-bold">{h.name}</span>
                          <span className="block truncate text-xs font-medium text-muted">
                            {h.brand ? `${h.brand} · ` : ""}
                            per 100 g · {Math.round(h.per100.kcal)} kcal · P {Math.round(h.per100.protein)} C {Math.round(h.per100.carbs)} F{" "}
                            {Math.round(h.per100.fat)}
                          </span>
                        </span>
                        <span className="shrink-0 text-sm font-bold text-accent">Pick</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {!hits && !searching && <p className="mt-3 text-sm font-medium text-muted">Type at least two letters. Food data comes from Open Food Facts.</p>}
            </>
          )}

          {tab === "search" && hit && (
            <div>
              <p className="text-base font-extrabold">{hit.name}</p>
              {hit.brand && <p className="text-xs font-medium text-muted">{hit.brand}</p>}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <NumField ariaLabel="Amount" value={amount} onChange={setAmount} max={9999} />
                <select
                  aria-label="Unit"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value as AmountUnit)}
                  className="h-11 rounded-[14px] bg-field px-3 text-base outline-none"
                >
                  <option value="g">g</option>
                  <option value="oz">oz</option>
                  {hit.servingG && <option value="serving">serving{hit.servingText ? ` (${hit.servingText})` : ""}</option>}
                </select>
              </div>
              <p className="mt-3 text-sm font-bold">
                {preview ? `${Math.round(preview.kcal)} kcal · P ${round1(preview.protein)} · C ${round1(preview.carbs)} · F ${round1(preview.fat)}` : "Enter an amount"}
              </p>
              <button
                type="button"
                onClick={addFound}
                disabled={saving || !preview}
                className="mt-4 h-12 w-full rounded-[14px] bg-accent text-base font-bold text-on-accent disabled:opacity-50"
              >
                {saving ? "Saving..." : `Add to ${meal}`}
              </button>
              <button type="button" onClick={() => setHit(null)} disabled={saving} className="mt-1 h-11 w-full text-sm font-bold text-muted">
                Back to results
              </button>
            </div>
          )}

          {tab === "manual" && (
            <div className="flex flex-col gap-3">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Food name"
                aria-label="Food name"
                maxLength={120}
                className="h-11 w-full rounded-[14px] bg-field px-4 text-base outline-none"
              />
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs font-bold text-muted">
                  Calories
                  <NumField ariaLabel="Calories" value={kcal} onChange={setKcal} max={5000} />
                </label>
                <label className="text-xs font-bold text-muted">
                  Protein (g)
                  <NumField ariaLabel="Protein in grams" value={protein} onChange={setProtein} max={500} />
                </label>
                <label className="text-xs font-bold text-muted">
                  Carbs (g)
                  <NumField ariaLabel="Carbs in grams" value={carbs} onChange={setCarbs} max={1000} />
                </label>
                <label className="text-xs font-bold text-muted">
                  Fat (g)
                  <NumField ariaLabel="Fat in grams" value={fat} onChange={setFat} max={500} />
                </label>
              </div>
              <p className="text-xs font-medium text-muted">Leave calories empty and they are worked out from the macros.</p>
              <button
                type="button"
                onClick={addManual}
                disabled={saving}
                className="h-12 w-full rounded-[14px] bg-accent text-base font-bold text-on-accent disabled:opacity-50"
              >
                {saving ? "Saving..." : `Add to ${meal}`}
              </button>
            </div>
          )}

          {error && (
            <p role="alert" className="mt-3 text-sm font-semibold text-red-600">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

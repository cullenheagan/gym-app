"use client";

import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import AddFood from "./AddFood";
import MacroBars from "./MacroBars";
import NumField from "./NumField";
import { explain } from "@/lib/net";
import {
  EMPTY_PROFILE,
  type FoodEntry,
  type NutritionProfile,
  cacheDay,
  loadDay,
  loadNutritionProfile,
  localDate,
  prettyDate,
  round1,
  shiftDate,
  sumMacros,
} from "@/lib/nutrition";

// The Nutrition tab: what you ate on a day, by meal, against your daily targets.
export default function Nutrition({ db, userId, onOpenSettings }: { db: SupabaseClient; userId: string; onOpenSettings: () => void }) {
  const today = localDate();
  const [date, setDate] = useState(today);
  const [entries, setEntries] = useState<FoodEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false); // showing the copy kept on this phone
  const [profile, setProfile] = useState<NutritionProfile>(EMPTY_PROFILE);
  const [addTo, setAddTo] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState<number | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mealsOpen, setMealsOpen] = useState(false);
  const [newMeal, setNewMeal] = useState("");

  useEffect(() => {
    let live = true;
    loadNutritionProfile(db, userId).then((p) => live && setProfile(p));
    return () => {
      live = false;
    };
  }, [db, userId]);

  useEffect(() => {
    let live = true;
    setLoaded(false);
    loadDay(db, userId, date).then((r) => {
      if (!live) return;
      setEntries(r.entries);
      setSaved(r.saved);
      setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, [db, userId, date]);

  const totals = useMemo(() => sumMacros(entries), [entries]);
  const t = profile.targets;

  // Your meals, plus any meal name that has foods on this day but was removed from the list.
  const sections = useMemo(() => {
    const names = [...profile.mealNames];
    for (const e of entries) if (!names.some((n) => n.toLowerCase() === e.meal.toLowerCase())) names.push(e.meal);
    return names;
  }, [profile.mealNames, entries]);

  function change(next: FoodEntry[]) {
    setEntries(next);
    cacheDay(userId, date, next);
  }

  async function remove(e: FoodEntry) {
    if (confirmId !== e.id) {
      setConfirmId(e.id);
      window.setTimeout(() => setConfirmId((c) => (c === e.id ? null : c)), 4000);
      return;
    }
    const { error: err } = await db.from("food_entries").delete().eq("id", e.id);
    setConfirmId(null);
    if (err) {
      setError(explain(err.message, "Could not remove that food."));
      return;
    }
    setError(null);
    change(entries.filter((x) => x.id !== e.id));
    setOpenId(null);
  }

  async function rescale(e: FoodEntry) {
    if (!e.amount || e.amount <= 0 || editAmount == null || editAmount <= 0) return;
    const f = editAmount / e.amount;
    const patch = {
      amount: editAmount,
      kcal: round1(e.kcal * f),
      protein_g: round1(e.protein_g * f),
      carbs_g: round1(e.carbs_g * f),
      fat_g: round1(e.fat_g * f),
    };
    const { error: err } = await db.from("food_entries").update(patch).eq("id", e.id);
    if (err) {
      setError(explain(err.message, "Could not change that amount."));
      return;
    }
    setError(null);
    change(entries.map((x) => (x.id === e.id ? { ...x, ...patch } : x)));
    setOpenId(null);
  }

  async function saveMeals(names: string[]) {
    const { error: err } = await db.from("profiles").update({ meal_names: names }).eq("id", userId);
    if (err) {
      setError(explain(err.message, "Could not save your meals."));
      return;
    }
    setError(null);
    setProfile((p) => ({ ...p, mealNames: names }));
  }

  function addMeal() {
    const n = newMeal.trim().slice(0, 24);
    if (!n) return;
    if (profile.mealNames.some((m) => m.toLowerCase() === n.toLowerCase())) {
      setError("You already have a meal with that name.");
      return;
    }
    setNewMeal("");
    saveMeals([...profile.mealNames, n]);
  }

  const hasTargets = t.kcal != null;

  return (
    <div className="px-4 pb-8 pt-4">
      <h2 className="px-1 text-[32px] font-extrabold leading-tight tracking-tight">Nutrition</h2>

      <div className="mt-3 flex items-center justify-between gap-2">
        <button type="button" onClick={() => setDate(shiftDate(date, -1))} aria-label="Previous day" className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-lg font-bold shadow-sm">
          {"‹"}
        </button>
        <span className="text-base font-extrabold">{prettyDate(date)}</span>
        <button
          type="button"
          onClick={() => setDate(shiftDate(date, 1))}
          disabled={date >= today}
          aria-label="Next day"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-lg font-bold shadow-sm disabled:opacity-30"
        >
          {"›"}
        </button>
      </div>

      {saved && <p className="mt-2 px-1 text-xs font-semibold text-muted">Showing the copy saved on this phone.</p>}

      <section className="mt-3 rounded-[20px] bg-card p-4 shadow-sm">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-2xl font-extrabold">
            {Math.round(totals.kcal).toLocaleString("en-US")}
            <span className="ml-1.5 text-sm font-bold text-muted">{hasTargets ? `of ${Math.round(t.kcal as number).toLocaleString("en-US")} kcal` : "kcal"}</span>
          </p>
          {hasTargets && (
            <span className="text-xs font-bold text-muted">
              {totals.kcal <= (t.kcal as number)
                ? `${Math.round((t.kcal as number) - totals.kcal).toLocaleString("en-US")} left`
                : `${Math.round(totals.kcal - (t.kcal as number)).toLocaleString("en-US")} over`}
            </span>
          )}
        </div>
        <div className="mt-3">
          <MacroBars totals={totals} targets={t} />
        </div>
        {!hasTargets && (
          <button type="button" onClick={onOpenSettings} className="mt-3 text-sm font-bold text-accent">
            Set daily targets
          </button>
        )}
      </section>

      {error && (
        <p role="alert" className="mt-3 px-1 text-sm font-semibold text-red-600">
          {error}
        </p>
      )}

      {!loaded ? (
        <p className="mt-4 px-1 text-sm font-medium text-muted">Loading...</p>
      ) : (
        sections.map((meal) => {
          const list = entries.filter((e) => e.meal.toLowerCase() === meal.toLowerCase());
          const sub = sumMacros(list);
          return (
            <section key={meal} className="mt-3 rounded-[20px] bg-card p-4 shadow-sm">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-base font-extrabold">{meal}</h3>
                <span className="text-sm font-bold text-muted">{list.length > 0 ? `${Math.round(sub.kcal)} kcal` : ""}</span>
              </div>
              {list.map((e) => (
                <div key={e.id} className="mt-2 border-t border-line pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setOpenId(openId === e.id ? null : e.id);
                      setEditAmount(e.amount);
                      setConfirmId(null);
                    }}
                    aria-expanded={openId === e.id}
                    className="flex w-full items-center justify-between gap-3 text-left"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold">{e.name}</span>
                      <span className="block truncate text-xs font-medium text-muted">
                        {e.amount ? `${e.amount} ${e.unit ?? ""} · ` : ""}P {round1(e.protein_g)} · C {round1(e.carbs_g)} · F {round1(e.fat_g)}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-bold">{Math.round(e.kcal)}</span>
                  </button>
                  {openId === e.id && (
                    <div className="mt-2 flex flex-col gap-2">
                      {e.amount ? (
                        <div className="flex items-center gap-2">
                          <div className="w-28">
                            <NumField ariaLabel={`Amount of ${e.name}`} value={editAmount} onChange={setEditAmount} max={9999} />
                          </div>
                          <span className="text-sm font-medium text-muted">{e.unit}</span>
                          <button
                            type="button"
                            onClick={() => rescale(e)}
                            disabled={editAmount == null || editAmount <= 0 || editAmount === e.amount}
                            className="ml-auto h-10 rounded-[12px] bg-accent px-4 text-sm font-bold text-on-accent disabled:opacity-40"
                          >
                            Update
                          </button>
                        </div>
                      ) : null}
                      <button type="button" onClick={() => remove(e)} className="h-10 rounded-[12px] bg-field text-sm font-bold text-red-600">
                        {confirmId === e.id ? "Tap again to remove" : "Remove"}
                      </button>
                    </div>
                  )}
                </div>
              ))}
              <button type="button" onClick={() => setAddTo(meal)} className="mt-3 h-10 w-full rounded-[12px] bg-tint text-sm font-bold text-accent">
                + Add food
              </button>
            </section>
          );
        })
      )}

      <section className="mt-3 rounded-[20px] bg-card p-4 shadow-sm">
        <button type="button" onClick={() => setMealsOpen((o) => !o)} aria-expanded={mealsOpen} className="flex w-full items-center justify-between text-left text-sm font-extrabold">
          Your meals
          <span className="text-xs font-bold text-accent">{mealsOpen ? "Hide ▴" : "Edit ▾"}</span>
        </button>
        {mealsOpen && (
          <div className="mt-3 flex flex-col gap-2">
            {profile.mealNames.map((m) => (
              <div key={m} className="flex items-center justify-between gap-3 text-sm">
                <span className="font-bold">{m}</span>
                <button
                  type="button"
                  onClick={() => profile.mealNames.length > 1 && saveMeals(profile.mealNames.filter((x) => x !== m))}
                  disabled={profile.mealNames.length <= 1}
                  className="h-9 rounded-[10px] bg-field px-3 text-xs font-bold text-red-600 disabled:opacity-40"
                >
                  Remove
                </button>
              </div>
            ))}
            <p className="text-xs font-medium text-muted">Removing a meal only hides it. Foods you logged under it stay on their days.</p>
            <div className="flex gap-2">
              <input
                value={newMeal}
                onChange={(e) => setNewMeal(e.target.value)}
                placeholder="New meal, like Pre-workout"
                aria-label="New meal name"
                maxLength={24}
                className="h-11 min-w-0 flex-1 rounded-[14px] bg-field px-4 text-base outline-none"
              />
              <button type="button" onClick={addMeal} disabled={!newMeal.trim()} className="h-11 rounded-[14px] bg-accent px-4 text-sm font-bold text-on-accent disabled:opacity-40">
                Add
              </button>
            </div>
            <button type="button" onClick={() => saveMeals(["Breakfast", "Lunch", "Dinner", "Snacks"])} className="h-9 text-xs font-bold text-muted">
              Reset to Breakfast, Lunch, Dinner, Snacks
            </button>
          </div>
        )}
      </section>

      {addTo && (
        <AddFood
          db={db}
          userId={userId}
          meal={addTo}
          date={date}
          onAdded={(e) => change([...entries, e])}
          onClose={() => setAddTo(null)}
        />
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import NumField from "./NumField";
import { explain } from "@/lib/net";
import { type Unit, fromDisplay, toDisplay } from "@/lib/units";
import { EMPTY_PROFILE, type NutritionProfile, loadNutritionProfile, suggestTargets } from "@/lib/nutrition";

const CM_PER_IN = 2.54;

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | null;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-xl bg-line p-[3px]" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={`h-10 flex-1 rounded-[10px] text-sm font-bold ${value === o.id ? "bg-card text-ink" : "text-muted"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// The Nutrition targets section of Settings: type your own numbers, or get a starting point from
// your stats and goal. Your numbers always win.
export default function NutritionTargets({ db, userId, unit }: { db: SupabaseClient; userId: string; unit: Unit }) {
  const [p, setP] = useState<NutritionProfile>(EMPTY_PROFILE);
  const [ready, setReady] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    loadNutritionProfile(db, userId).then((r) => {
      if (!live) return;
      setP(r);
      setReady(true);
    });
    return () => {
      live = false;
    };
  }, [db, userId]);

  const heightShown = p.height_cm == null ? null : unit === "lb" ? Math.round((p.height_cm / CM_PER_IN) * 10) / 10 : p.height_cm;
  const weightShown = p.weight_kg == null ? null : Math.round(toDisplay(p.weight_kg, unit) * 10) / 10;

  function setTarget(k: keyof NutritionProfile["targets"], v: number | null) {
    setP((cur) => ({ ...cur, targets: { ...cur.targets, [k]: v } }));
  }

  function suggest() {
    const s = suggestTargets(p);
    if (!s) {
      setNote({ ok: false, text: "Fill in every stat first: height, weight, birth year, sex, activity and goal." });
      return;
    }
    setP((cur) => ({ ...cur, targets: s.targets }));
    setNote({ ok: true, text: `${s.note} Tap Save targets to keep them.` });
  }

  async function save() {
    setBusy(true);
    setNote(null);
    const t = p.targets;
    const { error } = await db
      .from("profiles")
      .update({
        target_kcal: t.kcal == null ? null : Math.round(t.kcal),
        target_protein_g: t.protein,
        target_carbs_g: t.carbs,
        target_fat_g: t.fat,
        height_cm: p.height_cm,
        weight_kg: p.weight_kg,
        birth_year: p.birth_year,
        sex: p.sex,
        activity_level: p.activity,
        nutrition_goal: p.goal,
      })
      .eq("id", userId);
    setBusy(false);
    if (error) {
      setNote({ ok: false, text: explain(error.message, "Could not save your targets.") });
      return;
    }
    // Keep the copy on this phone in step so Home and Nutrition show the new targets at once.
    await loadNutritionProfile(db, userId);
    setNote({ ok: true, text: "Saved." });
  }

  return (
    <section className="mt-4 rounded-[20px] bg-card p-5 shadow-sm">
      <h3 className="text-sm font-extrabold">Nutrition targets</h3>
      <p className="mt-0.5 text-xs text-muted">Your daily goals for the Nutrition tab and Home. Leave any empty to skip it.</p>
      {!ready ? (
        <p className="mt-3 text-sm font-medium text-muted">Loading...</p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="text-xs font-bold text-muted">
              Calories
              <NumField integer ariaLabel="Daily calories" value={p.targets.kcal} onChange={(v) => setTarget("kcal", v)} max={9999} />
            </label>
            <label className="text-xs font-bold text-muted">
              Protein (g)
              <NumField integer ariaLabel="Daily protein in grams" value={p.targets.protein} onChange={(v) => setTarget("protein", v)} max={999} />
            </label>
            <label className="text-xs font-bold text-muted">
              Carbs (g)
              <NumField integer ariaLabel="Daily carbs in grams" value={p.targets.carbs} onChange={(v) => setTarget("carbs", v)} max={999} />
            </label>
            <label className="text-xs font-bold text-muted">
              Fat (g)
              <NumField integer ariaLabel="Daily fat in grams" value={p.targets.fat} onChange={(v) => setTarget("fat", v)} max={999} />
            </label>
          </div>

          <button type="button" onClick={() => setStatsOpen((o) => !o)} aria-expanded={statsOpen} className="mt-4 text-sm font-bold text-accent">
            {statsOpen ? "Hide my stats ▴" : "Suggest targets from my stats and goal ▾"}
          </button>
          {statsOpen && (
            <div className="mt-3 flex flex-col gap-3">
              <div className="grid grid-cols-3 gap-2">
                <label className="text-xs font-bold text-muted">
                  Height ({unit === "lb" ? "in" : "cm"})
                  <NumField
                    ariaLabel="Height"
                    value={heightShown}
                    onChange={(v) => setP((c) => ({ ...c, height_cm: v == null ? null : unit === "lb" ? v * CM_PER_IN : v }))}
                    max={300}
                  />
                </label>
                <label className="text-xs font-bold text-muted">
                  Weight ({unit})
                  <NumField
                    ariaLabel="Body weight"
                    value={weightShown}
                    onChange={(v) => setP((c) => ({ ...c, weight_kg: v == null ? null : fromDisplay(v, unit) }))}
                    max={999}
                  />
                </label>
                <label className="text-xs font-bold text-muted">
                  Birth year
                  <NumField integer ariaLabel="Birth year" value={p.birth_year} onChange={(v) => setP((c) => ({ ...c, birth_year: v }))} max={2100} />
                </label>
              </div>
              <Choice
                label="Sex"
                value={p.sex}
                options={[
                  { id: "male", label: "Male" },
                  { id: "female", label: "Female" },
                ]}
                onChange={(v) => setP((c) => ({ ...c, sex: v }))}
              />
              <label className="text-xs font-bold text-muted">
                Activity
                <select
                  aria-label="Activity level"
                  value={p.activity ?? ""}
                  onChange={(e) => setP((c) => ({ ...c, activity: (e.target.value || null) as NutritionProfile["activity"] }))}
                  className="mt-1 h-11 w-full rounded-[14px] bg-field px-3 text-base font-normal text-ink outline-none"
                >
                  <option value="">Choose...</option>
                  <option value="sedentary">Mostly sitting, little exercise</option>
                  <option value="light">Light exercise 1 to 3 days a week</option>
                  <option value="moderate">Moderate exercise 3 to 5 days a week</option>
                  <option value="active">Hard exercise 6 to 7 days a week</option>
                  <option value="very_active">Very hard exercise or a physical job</option>
                </select>
              </label>
              <Choice
                label="Goal"
                value={p.goal}
                options={[
                  { id: "lose", label: "Lose" },
                  { id: "maintain", label: "Maintain" },
                  { id: "gain", label: "Gain" },
                ]}
                onChange={(v) => setP((c) => ({ ...c, goal: v }))}
              />
              <button type="button" onClick={suggest} className="h-11 w-full rounded-[14px] bg-field text-sm font-bold">
                Suggest targets
              </button>
              <p className="text-xs text-muted">An estimate only, not medical advice. Your own numbers always win.</p>
            </div>
          )}

          <button type="button" onClick={save} disabled={busy} className="mt-4 h-11 w-full rounded-[14px] bg-accent text-sm font-bold text-on-accent disabled:opacity-50">
            {busy ? "Saving..." : "Save targets"}
          </button>
          {note && (
            <p role="status" className={`mt-2 text-sm font-semibold ${note.ok ? "text-done" : "text-red-600"}`}>
              {note.text}
            </p>
          )}
        </>
      )}
    </section>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Unit, toDisplay } from "@/lib/units";
import { KINDS, type Kind, kindLabel } from "@/lib/kinds";
import ActivityCalendar from "./ActivityCalendar";
import { cacheKey, readCache, writeCache } from "@/lib/cache";
import { formatClock, formatDuration } from "@/lib/format";
import { type HomeWorkout, hasEarlier, kindBreakdown, templates, weekStartBack, weekTotals, weekWorkouts } from "@/lib/home-stats";
import { type RawWorkout, type RepeatPlan, summarize, toPlan } from "./History";
import MacroBars from "./MacroBars";
import { EMPTY_PROFILE, type FoodEntry, type NutritionProfile, loadDay, loadNutritionProfile, localDate, sumMacros } from "@/lib/nutrition";

const KIND_COLOR: Record<Kind, string> = {
  strength: "var(--accent)",
  cardio: "var(--done)",
  intervals: "var(--kind-intervals)",
  sport: "var(--kind-sport)",
};

const SELECT =
  "id,name,kind,started_at,ended_at,gym_id,gym:gyms(name),workout_sets(id,set_index,set_type,duration_s,distance_m,rpe,weight_kg,reps,reps_right,completed_at,setup_id,superset_id,exercise:exercises(id,name),setup:exercise_setups(name,pin_position))";

function toHome(list: RawWorkout[]): HomeWorkout<RepeatPlan>[] {
  return list.map((w) => {
    const sum = summarize(w);
    return { name: w.name, kind: sum.kind, startedAt: w.started_at, volumeKg: sum.volumeKg, activeMs: sum.total ?? 0, plan: toPlan(w, sum) };
  });
}

export default function Home({
  db,
  userId,
  unit,
  name,
  onProfile,
  inProgress,
  elapsedMs,
  onStart,
  onResume,
  onTemplate,
  onOpenNutrition,
  onOpenTrain,
  startOnly = false,
}: {
  db: SupabaseClient;
  userId: string;
  unit: Unit;
  name: string;
  onProfile: () => void;
  inProgress: boolean;
  elapsedMs: number;
  onStart: (kind?: Kind) => void;
  onResume: () => void;
  onTemplate: (plan: RepeatPlan) => void;
  onOpenNutrition?: () => void;
  onOpenTrain?: () => void; // Home: Start workout goes to Train, where you pick the kind
  startOnly?: boolean; // the Train > Workout screen: just the start button and shortcuts
}) {
  const ck = cacheKey(userId, "home");
  const [list, setList] = useState<HomeWorkout<RepeatPlan>[] | null>(() => {
    const copy = readCache<HomeWorkout<RepeatPlan>[]>(ck);
    return copy;
  });

  useEffect(() => {
    let live = true;
    db.from("workouts")
      .select(SELECT)
      .order("started_at", { ascending: false })
      .limit(60)
      .then((res: { data: unknown; error: { message: string } | null }) => {
        if (!live || res.error) return;
        const home = toHome((res.data ?? []) as RawWorkout[]);
        setList(home);
        writeCache(ck, home);
      });
    return () => {
      live = false;
    };
  }, [db, ck]);

  // Today's nutrition for the Today card.
  const [nProfile, setNProfile] = useState<NutritionProfile>(EMPTY_PROFILE);
  const [todayFood, setTodayFood] = useState<FoodEntry[]>([]);
  useEffect(() => {
    if (startOnly) return;
    let live = true;
    loadNutritionProfile(db, userId).then((p) => live && setNProfile(p));
    loadDay(db, userId, localDate()).then((r) => live && setTodayFood(r.entries));
    return () => {
      live = false;
    };
  }, [db, userId, startOnly]);
  const todayTotals = useMemo(() => sumMacros(todayFood), [todayFood]);

  const tpls = useMemo(() => templates(list ?? []), [list]);
  // Tap the This week card to open a breakdown; arrows move back through earlier weeks.
  const [weekOpen, setWeekOpen] = useState(false);
  const [back, setBack] = useState(0);
  const week = useMemo(() => weekTotals(list ?? [], Date.now(), back), [list, back]);
  const weekStartMs = weekStartBack(Date.now(), back);
  const weekList = useMemo(() => weekWorkouts(list ?? [], weekStartMs), [list, weekStartMs]);
  const byKind = useMemo(() => kindBreakdown(weekList), [weekList]);
  const kindMs = byKind.reduce((sum, k) => sum + k.ms, 0);
  const earlier = hasEarlier(list ?? [], weekStartMs);
  const shortDay = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const weekEndMs = (() => {
    const d = new Date(weekStartMs);
    d.setDate(d.getDate() + 6);
    return d.getTime();
  })();
  const weekLabel = back === 0 ? "This week" : `${shortDay(weekStartMs)} to ${shortDay(weekEndMs)}`;

  return (
    <div className="px-4 pb-8 pt-4">
      {startOnly ? null : name ? (
        <h2 className="px-1 text-[32px] font-extrabold leading-tight tracking-tight">Hi, {name}</h2>
      ) : (
        <>
          <h2 className="px-1 text-[32px] font-extrabold leading-tight tracking-tight">Home</h2>
          <button type="button" onClick={onProfile} className="px-1 text-sm font-bold text-accent">
            Add your name
          </button>
        </>
      )}

      <button
        type="button"
        onClick={inProgress ? onResume : !startOnly && onOpenTrain ? onOpenTrain : () => onStart("strength")}
        className={`${startOnly ? "mt-0" : "mt-4"} w-full rounded-[20px] bg-accent p-5 text-left text-on-accent`}
      >
        <span className="block text-xl font-extrabold">{inProgress ? "Resume workout" : "Start workout"}</span>
        <span className="mt-0.5 block text-sm font-semibold opacity-90">
          {inProgress ? `In progress \u00b7 ${formatClock(elapsedMs)}` : startOnly ? "Begin with an empty workout" : "Choose what kind next"}
        </span>
      </button>

      {startOnly && !inProgress && (
        <section className="mt-6">
          <h3 className="px-1 text-sm font-extrabold">What kind?</h3>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                onClick={() => onStart(k.id)}
                className="rounded-[14px] bg-card px-4 py-3 text-left shadow-sm"
              >
                <span className="block text-sm font-extrabold">{k.label}</span>
                <span className="block text-xs text-muted">{k.blurb}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {startOnly && tpls.length > 0 && (
        <section className="mt-6">
          <h3 className="px-1 text-sm font-extrabold">Start from a past workout</h3>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {tpls.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => onTemplate(t.plan)}
                className="rounded-[14px] bg-card px-4 py-3 text-left shadow-sm"
              >
                <span className="block truncate text-sm font-extrabold">{t.label}</span>
                <span className="block text-xs text-muted">
                  {t.kind !== "strength" ? `${kindLabel(t.kind)} · ` : ""}
                  {t.plan.exercises.length} {t.plan.exercises.length === 1 ? "exercise" : "exercises"}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {!startOnly && onOpenNutrition && (
        <section className="mt-6">
          <h3 className="px-1 text-sm font-extrabold">Today</h3>
          <button type="button" onClick={onOpenNutrition} className="mt-2 block w-full rounded-[20px] bg-card p-4 text-left shadow-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-extrabold">Nutrition</span>
              <span className="text-xs font-semibold text-muted">
                {Math.round(todayTotals.kcal).toLocaleString("en-US")}
                {nProfile.targets.kcal != null ? ` of ${Math.round(nProfile.targets.kcal).toLocaleString("en-US")}` : ""} kcal
              </span>
            </div>
            <div className="mt-3">
              <MacroBars totals={todayTotals} targets={nProfile.targets} />
            </div>
            {todayFood.length === 0 && <span className="mt-3 block text-xs font-bold text-accent">Log your first food</span>}
          </button>
        </section>
      )}

      {!startOnly && (
      <section className="mt-6">
        <h3 className="px-1 text-sm font-extrabold">{back === 0 ? "This week" : `Week of ${shortDay(weekStartMs)}`}</h3>
        <div className="mt-2 rounded-[20px] bg-card shadow-sm">
          <button
            type="button"
            onClick={() => {
              setWeekOpen((o) => !o);
              setBack(0);
            }}
            aria-expanded={weekOpen}
            className="block w-full p-4 text-left"
          >
            <div className={`grid gap-2 ${week.volumeKg > 0 ? "grid-cols-3" : "grid-cols-2"}`}>
              <div>
                <div className="text-xs text-muted">Workouts</div>
                <div className="text-2xl font-extrabold">{list == null ? "-" : week.count}</div>
              </div>
              <div>
                <div className="text-xs text-muted">Active time</div>
                <div className="text-2xl font-extrabold">{list == null ? "-" : formatDuration(week.activeMs)}</div>
              </div>
              {week.volumeKg > 0 && (
                <div>
                  <div className="text-xs text-muted">Total lifted</div>
                  <div className="text-2xl font-extrabold">
                    {Math.round(toDisplay(week.volumeKg, unit)).toLocaleString("en-US")}
                    <span className="ml-1 text-sm font-bold text-muted">{unit}</span>
                  </div>
                </div>
              )}
            </div>
            <span className="mt-2 block text-xs font-bold text-accent">{weekOpen ? "Hide breakdown \u25B4" : "See breakdown \u25BE"}</span>
          </button>

          {weekOpen && (
            <div className="mx-4 border-t border-line pb-4 pt-3">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setBack((b) => b + 1)}
                  disabled={!earlier}
                  aria-label="Earlier week"
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-field text-base font-bold disabled:opacity-30"
                >
                  {"\u2039"}
                </button>
                <span className="text-sm font-extrabold">{weekLabel}</span>
                <button
                  type="button"
                  onClick={() => setBack((b) => Math.max(0, b - 1))}
                  disabled={back === 0}
                  aria-label="Later week"
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-field text-base font-bold disabled:opacity-30"
                >
                  {"\u203A"}
                </button>
              </div>

              {weekList.length === 0 ? (
                <p className="mt-3 text-sm font-medium text-muted">No workouts this week.</p>
              ) : (
                <>
                  <p className="mt-4 text-xs font-bold text-muted">By type</p>
                  {kindMs > 0 && (
                    <div className="mt-2 flex h-2.5 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
                      {byKind
                        .filter((k) => k.ms > 0)
                        .map((k) => (
                          <span key={k.kind} style={{ flex: k.ms, background: KIND_COLOR[k.kind] }} />
                        ))}
                    </div>
                  )}
                  <ul className="mt-2 flex flex-col">
                    {byKind.map((k) => (
                      <li key={k.kind} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                        <span className="min-w-0">
                          <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: KIND_COLOR[k.kind] }} />
                          <span className="font-bold">{kindLabel(k.kind)}</span>
                          <span className="text-muted">
                            {" "}
                            · {k.count} {k.count === 1 ? "workout" : "workouts"}
                            {k.volumeKg > 0 ? ` · ${Math.round(toDisplay(k.volumeKg, unit)).toLocaleString("en-US")} ${unit}` : ""}
                          </span>
                        </span>
                        <span className="shrink-0 font-bold">{formatDuration(k.ms)}</span>
                      </li>
                    ))}
                  </ul>

                  <p className="mt-3 text-xs font-bold text-muted">Workouts</p>
                  <ul className="mt-1 flex flex-col">
                    {weekList.map((w, i) => {
                      const kind = w.kind ?? "strength";
                      return (
                        <li key={`${w.startedAt}-${i}`} className="flex items-center justify-between gap-3 border-t border-line py-2">
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-bold">{w.name}</span>
                            <span className="block text-xs font-medium text-muted">
                              {new Date(w.startedAt).toLocaleDateString("en-US", { weekday: "short" })} · {kindLabel(kind)}
                              {w.volumeKg > 0 ? ` · ${Math.round(toDisplay(w.volumeKg, unit)).toLocaleString("en-US")} ${unit}` : ""}
                            </span>
                          </span>
                          <span className="shrink-0 text-sm font-bold">{w.activeMs ? formatDuration(w.activeMs) : "-"}</span>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
      </section>
      )}

      {!startOnly && <ActivityCalendar db={db} userId={userId} />}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Unit, toDisplay } from "@/lib/units";
import { cacheKey, readCache, writeCache } from "@/lib/cache";
import { formatClock } from "@/lib/format";
import { type HomeWorkout, templates, weekTotals } from "@/lib/home-stats";
import { type RawWorkout, type RepeatPlan, summarize, toPlan } from "./History";

const SELECT =
  "id,name,started_at,ended_at,gym_id,gym:gyms(name),workout_sets(id,set_index,set_type,weight_kg,reps,completed_at,setup_id,exercise:exercises(id,name),setup:exercise_setups(name,pin_position))";

function toHome(list: RawWorkout[]): HomeWorkout<RepeatPlan>[] {
  return list.map((w) => {
    const sum = summarize(w);
    return { name: w.name, startedAt: w.started_at, volumeKg: sum.volumeKg, plan: toPlan(w, sum) };
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
  startOnly = false,
}: {
  db: SupabaseClient;
  userId: string;
  unit: Unit;
  name: string;
  onProfile: () => void;
  inProgress: boolean;
  elapsedMs: number;
  onStart: () => void;
  onResume: () => void;
  onTemplate: (plan: RepeatPlan) => void;
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

  const tpls = useMemo(() => templates(list ?? []), [list]);
  const week = useMemo(() => weekTotals(list ?? [], Date.now()), [list]);

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
        onClick={inProgress ? onResume : onStart}
        className={`${startOnly ? "mt-0" : "mt-4"} w-full rounded-[20px] bg-accent p-5 text-left text-on-accent`}
      >
        <span className="block text-xl font-extrabold">{inProgress ? "Resume workout" : "Start workout"}</span>
        <span className="mt-0.5 block text-sm font-semibold opacity-90">
          {inProgress ? `In progress \u00b7 ${formatClock(elapsedMs)}` : "Begin with an empty workout"}
        </span>
      </button>

      {tpls.length > 0 && (
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
                  {t.plan.exercises.length} {t.plan.exercises.length === 1 ? "exercise" : "exercises"}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {!startOnly && (
      <section className="mt-6">
        <h3 className="px-1 text-sm font-extrabold">This week</h3>
        <div className="mt-2 grid grid-cols-2 gap-2 rounded-[20px] bg-card p-4 shadow-sm">
          <div>
            <div className="text-xs text-muted">Workouts</div>
            <div className="text-2xl font-extrabold">{list == null ? "-" : week.count}</div>
          </div>
          <div>
            <div className="text-xs text-muted">Total lifted</div>
            <div className="text-2xl font-extrabold">
              {list == null ? "-" : Math.round(toDisplay(week.volumeKg, unit)).toLocaleString("en-US")}
              <span className="ml-1 text-sm font-bold text-muted">{unit}</span>
            </div>
          </div>
        </div>
      </section>
      )}
    </div>
  );
}

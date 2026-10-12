"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Unit, formatWeight, toDisplay } from "@/lib/units";
import { type Kind, describeSet, distToDisplay, distUnit, fmtSeconds, kindLabel, kindOf } from "@/lib/kinds";
import { formatDate, formatDuration } from "@/lib/format";
import { cacheKey, readCache, writeCache } from "@/lib/cache";
import { downloadCsv, exportAllSets } from "@/lib/csv";
import { explain } from "@/lib/net";
import { applyFilters, gymOptions, typeOptions } from "@/lib/history-filter";

type Named = { name: string };
type ExRef = { id: string; name: string };
type SetupRef = { name: string; pin_position: string | null };

// Everything needed to rebuild a past workout as a new one.
export type RepeatPlan = {
  name: string;
  kind?: string;
  gymId: string | null;
  startedAt: string;
  exercises: {
    exerciseId: string;
    name: string;
    setupId: string | null;
    sets: {
      kg: number | null;
      reps: number | null;
      warmup?: boolean;
      durationS?: number | null;
      distanceM?: number | null;
      rpe?: number | null;
    }[];
  }[];
};
type RawSet = {
  id: string;
  set_index: number;
  set_type?: string | null;
  duration_s?: number | null;
  distance_m?: number | null;
  rpe?: number | null;
  weight_kg: number | null;
  reps: number | null;
  completed_at: string | null;
  setup_id: string | null;
  exercise: ExRef | ExRef[] | null;
  setup: SetupRef | SetupRef[] | null;
};
export type RawWorkout = {
  id: string;
  name: string;
  kind?: string | null;
  started_at: string;
  ended_at: string | null;
  gym_id: string | null;
  gym: Named | Named[] | null;
  workout_sets: RawSet[];
};

// Related rows can come back as an object or a one-item list.
function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

const ms = (iso: string | null) => (iso ? Date.parse(iso) : NaN);

export function summarize(w: RawWorkout) {
  const groups = new Map<string, RawSet[]>();
  for (const s of w.workout_sets) {
    const name = one(s.exercise)?.name ?? "Unknown exercise";
    const key = one(s.exercise)?.id ?? name;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }

  const withTimes = [...groups.values()].map((sets) => {
    const name = one(sets[0].exercise)?.name ?? "Unknown exercise";
    const times = sets.map((s) => ms(s.completed_at)).filter((t) => !Number.isNaN(t));
    return {
      name,
      exerciseId: one(sets[0].exercise)?.id ?? null,
      sets: [...sets].sort((a, b) => a.set_index - b.set_index),
      first: times.length ? Math.min(...times) : Infinity,
      last: times.length ? Math.max(...times) : Infinity,
    };
  });

  // Exercises in the order they were done; ties (older workouts) fall back to name.
  withTimes.sort((a, b) => a.first - b.first || a.name.localeCompare(b.name));

  // Per-exercise time only means something when sets were stamped at different moments.
  const distinct = new Set(w.workout_sets.map((s) => s.completed_at)).size;
  const timed = distinct > 1;

  let prevEnd = ms(w.started_at);
  const exercises = withTimes.map((g) => {
    let duration: number | null = null;
    if (timed && Number.isFinite(g.last) && !Number.isNaN(prevEnd)) {
      duration = Math.max(0, g.last - prevEnd);
      prevEnd = Math.max(prevEnd, g.last);
    }
    const setup = g.sets.map((s) => one(s.setup)).find((x) => x) ?? null;
    return {
      name: g.name,
      exerciseId: g.exerciseId,
      setupId: g.sets.find((s) => s.setup_id)?.setup_id ?? null,
      setup,
      sets: g.sets,
      duration,
    };
  });

  const working = w.workout_sets.filter((s) => s.set_type !== "warmup");
  const volumeKg = working.reduce((sum, s) => sum + Number(s.weight_kg ?? 0) * Number(s.reps ?? 0), 0);
  const total = w.ended_at ? Math.max(0, ms(w.ended_at) - ms(w.started_at)) : null;
  const activeSeconds = working.reduce((sum, s) => sum + Number(s.duration_s ?? 0), 0);
  const meters = working.reduce((sum, s) => sum + Number(s.distance_m ?? 0), 0);
  return { exercises, volumeKg, setCount: working.length, total, activeSeconds, meters, kind: kindOf(w.kind) as Kind };
}

export function toPlan(w: RawWorkout, sum: ReturnType<typeof summarize>): RepeatPlan {
  return {
    name: w.name,
    kind: sum.kind,
    gymId: w.gym_id,
    startedAt: w.started_at,
    exercises: sum.exercises
      .filter((ex) => ex.exerciseId)
      .map((ex) => ({
        exerciseId: ex.exerciseId as string,
        name: ex.name,
        setupId: ex.setupId,
        sets: ex.sets.map((s) => ({
          kg: s.weight_kg == null ? null : Number(s.weight_kg),
          reps: s.reps == null ? null : Number(s.reps),
          warmup: s.set_type === "warmup" || undefined,
          durationS: s.duration_s ?? null,
          distanceM: s.distance_m == null ? null : Number(s.distance_m),
          rpe: s.rpe == null ? null : Number(s.rpe),
        })),
      })),
  };
}

function FilterSelect({
  label,
  allLabel,
  value,
  options,
  onChange,
}: {
  label: string;
  allLabel: string;
  value: string;
  options: { key: string; label: string; count: number }[];
  onChange: (key: string) => void;
}) {
  return (
    <div className="relative min-w-0 flex-1">
      <select
        aria-label={`Filter by ${label.toLowerCase()}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`h-10 w-full appearance-none truncate rounded-full border bg-card pl-4 pr-9 text-sm font-semibold ${
          value ? "border-accent text-accent" : "border-line text-ink"
        }`}
      >
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label} ({o.count})
          </option>
        ))}
      </select>
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-muted"
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
    </div>
  );
}

export default function History({
  db,
  userId,
  unit,
  onRepeat,
}: {
  db: SupabaseClient;
  userId: string;
  unit: Unit;
  onRepeat: (plan: RepeatPlan) => void;
}) {
  const [workouts, setWorkouts] = useState<RawWorkout[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false); // showing the copy kept on this device
  const [gymFilter, setGymFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await db
        .from("workouts")
        .select(
          "id,name,kind,started_at,ended_at,gym_id,gym:gyms(name),workout_sets(id,set_index,set_type,duration_s,distance_m,rpe,weight_kg,reps,completed_at,setup_id,exercise:exercises(id,name),setup:exercise_setups(name,pin_position))",
        )
        .order("started_at", { ascending: false })
        .limit(200);
      if (cancelled) return;
      const ck = cacheKey(userId, "history");
      if (res.error) {
        const copy = readCache<RawWorkout[]>(ck);
        if (copy) {
          setWorkouts(copy);
          setSaved(true);
        } else {
          setError(explain(res.error.message, "Could not load your history."));
          setWorkouts([]);
        }
      } else {
        const list = (res.data ?? []) as unknown as RawWorkout[];
        writeCache(ck, list.slice(0, 50));
        setWorkouts(list);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, userId]);

  async function remove(id: string) {
    if (confirmId !== id) {
      setConfirmId(id);
      window.setTimeout(() => setConfirmId((cur) => (cur === id ? null : cur)), 4000);
      return;
    }
    const res = await db.from("workouts").delete().eq("id", id);
    setConfirmId(null);
    if (res.error) {
      setError(res.error.message);
      return;
    }
    setWorkouts((all) => (all ?? []).filter((w) => w.id !== id));
    setOpenId(null);
  }

  async function exportCsv() {
    setExporting(true);
    setExportNote(null);
    const out = await exportAllSets(db);
    setExporting(false);
    if ("error" in out) {
      setExportNote(explain(out.error, "Could not export your data."));
      return;
    }
    if (out.count === 0) {
      setExportNote("There are no sets to export yet.");
      return;
    }
    downloadCsv(`gym-app-export-${new Date().toISOString().slice(0, 10)}.csv`, out.csv);
    setExportNote(`Exported ${out.count} ${out.count === 1 ? "set" : "sets"}.`);
  }

  const filterable = workouts?.map((w) => ({ ...w, gymName: one(w.gym)?.name ?? null })) ?? [];
  const gymOpts = gymOptions(filterable);
  const typeOpts = typeOptions(filterable);
  // A filter whose workouts were all deleted quietly stops applying.
  const gymSel = gymOpts.some((o) => o.key === gymFilter) ? gymFilter : "";
  const typeSel = typeOpts.some((o) => o.key === typeFilter) ? typeFilter : "";
  const shown = applyFilters(filterable, gymSel, typeSel);
  const filtering = gymSel !== "" || typeSel !== "";

  if (workouts === null) {
    return <p className="px-5 pt-6 text-sm font-medium text-muted">Loading...</p>;
  }

  return (
    <section className="flex flex-col gap-3 px-4 pt-4" aria-label="Workout history">
      {error && (
        <p role="alert" className="px-1 text-sm font-semibold text-red-600">
          {error}
        </p>
      )}

      {saved && (
        <p className="px-1 text-[13px] font-semibold text-muted">
          You&apos;re offline. Showing the history saved on this phone.
        </p>
      )}

      {workouts.length > 0 && (
        <div className="flex flex-col gap-2 px-1" aria-label="Filter workouts">
          <div className="flex gap-2">
            <FilterSelect
              label="Gym"
              allLabel="All gyms"
              value={gymSel}
              options={gymOpts}
              onChange={setGymFilter}
            />
            <FilterSelect
              label="Workout"
              allLabel="All workouts"
              value={typeSel}
              options={typeOpts}
              onChange={setTypeFilter}
            />
          </div>
          {filtering && (
            <p className="flex items-center justify-between text-[13px] font-medium text-muted">
              <span>
                Showing {shown.length} of {workouts.length} {workouts.length === 1 ? "workout" : "workouts"}
              </span>
              <button
                type="button"
                onClick={() => {
                  setGymFilter("");
                  setTypeFilter("");
                }}
                className="font-bold text-accent"
              >
                Clear filters
              </button>
            </p>
          )}
        </div>
      )}

      {filtering && shown.length === 0 && (
        <div className="rounded-[20px] bg-card p-5 text-center shadow-sm">
          <p className="text-base font-bold">No workouts match</p>
          <p className="mt-1 text-sm font-medium text-muted">Try a different gym or workout, or clear the filters.</p>
        </div>
      )}

      {workouts.length === 0 && !error && (
        <div className="rounded-[20px] bg-card p-5 text-center shadow-sm">
          <p className="text-base font-bold">No workouts yet</p>
          <p className="mt-1 text-sm font-medium text-muted">Finished workouts show up here.</p>
        </div>
      )}

      {shown.map((w) => {
        const sum = summarize(w);
        const open = openId === w.id;
        const gym = one(w.gym)?.name;
        return (
          <article key={w.id} className="rounded-[20px] bg-card shadow-sm">
            <button
              type="button"
              onClick={() => setOpenId(open ? null : w.id)}
              aria-expanded={open}
              className="flex w-full items-start justify-between gap-3 p-4 text-left"
            >
              <span className="min-w-0">
                <span className="block truncate text-[19px] font-extrabold leading-tight tracking-tight">{w.name}</span>
                <span className="mt-0.5 block text-[13px] font-medium text-muted">
                  {formatDate(w.started_at)}
                  {gym ? ` · ${gym}` : ""}
                </span>
                <span className="mt-2 block text-[26px] font-extrabold leading-none tracking-tight text-accent">
                  {sum.kind === "strength"
                    ? Math.round(toDisplay(sum.volumeKg, unit)).toLocaleString("en-US")
                    : sum.kind === "cardio" && sum.meters > 0
                      ? distToDisplay(sum.meters, unit)
                      : fmtSeconds(sum.activeSeconds)}
                  <span className="ml-1 text-sm font-bold text-muted">
                    {sum.kind === "strength" ? unit : sum.kind === "cardio" && sum.meters > 0 ? distUnit(unit) : ""}
                  </span>
                </span>
                <span className="mt-1 block text-[13px] font-medium text-muted">
                  {sum.kind !== "strength" ? `${kindLabel(sum.kind)} · ` : ""}
                  {sum.exercises.length} {sum.exercises.length === 1 ? "exercise" : "exercises"} · {sum.setCount}{" "}
                  {sum.kind === "intervals" ? (sum.setCount === 1 ? "round" : "rounds") : sum.kind === "strength" ? (sum.setCount === 1 ? "set" : "sets") : sum.setCount === 1 ? "entry" : "entries"}
                  {sum.total != null ? ` · ${formatDuration(sum.total)}` : ""}
                </span>
              </span>
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className={`mt-1 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>

            {open && (
              <div className="mx-4 border-t border-line pb-4 pt-3">
                <ol className="flex flex-col gap-3">
                  {sum.exercises.map((ex, i) => (
                    <li key={ex.exerciseId ?? ex.name}>
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-sm font-bold">
                          <span className="mr-1.5 text-muted">{i + 1}.</span>
                          {ex.name}
                        </p>
                        {ex.duration != null && (
                          <span className="shrink-0 text-[13px] font-semibold text-muted">
                            {formatDuration(ex.duration)}
                          </span>
                        )}
                      </div>
                      {ex.setup && (
                        <p className="mt-0.5 pl-5 text-[13px] font-semibold text-accent">
                          {ex.setup.name}
                          {ex.setup.pin_position ? ` · pin ${ex.setup.pin_position}` : ""}
                        </p>
                      )}
                      <p className="mt-0.5 pl-5 text-[13px] font-medium text-muted">
                        {ex.sets
                          .map(
                            (s) =>
                              `${s.set_type === "warmup" ? "W " : ""}${describeSet(
                                sum.kind,
                                {
                                  kg: s.weight_kg == null ? null : Number(s.weight_kg),
                                  reps: s.reps == null ? null : Number(s.reps),
                                  durationS: s.duration_s ?? null,
                                  distanceM: s.distance_m == null ? null : Number(s.distance_m),
                                  rpe: s.rpe == null ? null : Number(s.rpe),
                                },
                                unit,
                                (kg) => formatWeight(kg, unit),
                              )}`,
                          )
                          .join(", ")}
                      </p>
                    </li>
                  ))}
                </ol>
                <button
                  type="button"
                  onClick={() => onRepeat(toPlan(w, sum))}
                  className="mt-4 h-11 w-full rounded-[14px] bg-accent text-sm font-bold text-on-accent"
                >
                  Repeat this workout
                </button>
                <button
                  type="button"
                  onClick={() => remove(w.id)}
                  className="mt-2 h-11 w-full rounded-[14px] bg-field text-sm font-bold text-red-600"
                >
                  {confirmId === w.id ? "Tap again to delete this workout" : "Delete workout"}
                </button>
              </div>
            )}
          </article>
        );
      })}

      {workouts.length > 0 && (
        <div className="px-1 pb-2 pt-1">
          <button
            type="button"
            onClick={exportCsv}
            disabled={exporting}
            className="h-11 w-full rounded-[14px] bg-card text-sm font-bold shadow-sm disabled:opacity-60"
          >
            {exporting ? "Preparing..." : "Export all data (CSV)"}
          </button>
          {exportNote && <p className="mt-2 text-center text-[13px] font-medium text-muted">{exportNote}</p>}
        </div>
      )}
    </section>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cacheKey, readCache, writeCache } from "@/lib/cache";
import { formatDuration } from "@/lib/format";
import { type ActivityWorkout, type Day, buildMonth, level, streaks } from "@/lib/activity";

// Shade 1 to 4: how much of the accent color is mixed into the empty-day color.
const SHADE = [0, 28, 50, 75, 100];
const shade = (l: number) => (l ? `color-mix(in srgb, var(--accent) ${SHADE[l]}%, var(--field))` : "var(--field)");

// One month at a time: each day is a square that gets brighter the longer you trained.
export default function ActivityCalendar({ db, userId }: { db: SupabaseClient; userId: string }) {
  const ck = cacheKey(userId, "activity");
  const [list, setList] = useState<ActivityWorkout[] | null>(() => readCache<ActivityWorkout[]>(ck));
  const [picked, setPicked] = useState<Day | null>(null);
  const today = new Date();
  const [ym, setYm] = useState({ y: today.getFullYear(), m: today.getMonth() });

  useEffect(() => {
    let live = true;
    const since = new Date(Date.now() - 1100 * 86400000).toISOString(); // about three years
    db.from("workouts")
      .select("name,started_at,ended_at")
      .gte("started_at", since)
      .order("started_at", { ascending: false })
      .limit(5000)
      .then((res: { data: unknown; error: { message: string } | null }) => {
        if (!live || res.error) return;
        const rows = (res.data ?? []) as ActivityWorkout[];
        setList(rows);
        writeCache(ck, rows);
      });
    return () => {
      live = false;
    };
  }, [db, ck]);

  const now = Date.now();
  const rows = useMemo(() => buildMonth(list ?? [], ym.y, ym.m, now), [list, ym]); // eslint-disable-line react-hooks/exhaustive-deps
  const st = useMemo(() => streaks(list ?? [], now), [list]); // eslint-disable-line react-hooks/exhaustive-deps
  const atCurrent = ym.y === today.getFullYear() && ym.m === today.getMonth();
  const monthName = new Date(ym.y, ym.m, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const monthDays = rows.flat().filter((d): d is Day => !!d);
  const monthWorkouts = monthDays.reduce((n, d) => n + d.workouts.length, 0);
  const activeDays = monthDays.filter((d) => d.workouts.length > 0).length;

  function go(delta: number) {
    const d = new Date(ym.y, ym.m + delta, 1);
    setYm({ y: d.getFullYear(), m: d.getMonth() });
    setPicked(null);
  }

  const arrow = "flex h-9 w-9 items-center justify-center rounded-full bg-field text-ink disabled:opacity-30";

  return (
    <section className="mt-6">
      <h3 className="px-1 text-sm font-extrabold">Activity</h3>
      <div className="mt-2 rounded-[20px] bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => go(-1)} aria-label="Previous month" className={arrow}>
            {"‹"}
          </button>
          <div className="text-center">
            <div className="text-[15px] font-extrabold">{monthName}</div>
            <div className="text-xs text-muted">
              {activeDays} {activeDays === 1 ? "day" : "days"} · {monthWorkouts} {monthWorkouts === 1 ? "workout" : "workouts"}
            </div>
          </div>
          <button type="button" onClick={() => go(1)} disabled={atCurrent} aria-label="Next month" className={arrow}>
            {"›"}
          </button>
        </div>

        <div className="mt-3 grid grid-cols-7 gap-1.5 text-center text-[11px] font-semibold text-muted">
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
            <span key={i}>{d}</span>
          ))}
        </div>
        <div className="mt-1.5 flex flex-col gap-1.5">
          {rows.map((row, r) => (
            <div key={r} className="grid grid-cols-7 gap-1.5">
              {row.map((d, c) =>
                d ? (
                  <button
                    key={c}
                    type="button"
                    disabled={d.future}
                    onClick={() => setPicked(picked?.key === d.key ? null : d)}
                    aria-label={`${d.date.toDateString()}: ${d.workouts.length} ${d.workouts.length === 1 ? "workout" : "workouts"}`}
                    className={`aspect-square rounded-[10px] text-[13px] font-bold ${
                      level(d.minutes, d.workouts.length) >= 3 ? "text-on-accent" : "text-ink"
                    }`}
                    style={{
                      backgroundColor: shade(d.future ? 0 : level(d.minutes, d.workouts.length)),
                      opacity: d.future ? 0.4 : 1,
                      outline: picked?.key === d.key ? "2px solid var(--text)" : "none",
                      outlineOffset: 1,
                    }}
                  >
                    {d.date.getDate()}
                  </button>
                ) : (
                  <span key={c} />
                ),
              )}
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 text-[11px] font-semibold text-muted">
          <span>
            Streak {st.current} {st.current === 1 ? "day" : "days"} · Best {st.longest}
          </span>
          <span className="flex items-center gap-1">
            Less
            {[0, 1, 2, 3, 4].map((l) => (
              <span key={l} className="inline-block h-3 w-3 rounded-[3px]" style={{ backgroundColor: shade(l) }} />
            ))}
            More
          </span>
        </div>

        {picked && (
          <div className="mt-3 border-t border-line pt-3 text-sm">
            <p className="font-bold">
              {picked.date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
            </p>
            {picked.workouts.length === 0 ? (
              <p className="text-muted">Rest day</p>
            ) : (
              <ul className="mt-1 text-muted">
                {picked.workouts.map((w, i) => (
                  <li key={i}>
                    {w.name} · {formatDuration(w.minutes * 60000)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

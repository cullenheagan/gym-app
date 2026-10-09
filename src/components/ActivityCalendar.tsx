"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cacheKey, readCache, writeCache } from "@/lib/cache";
import { formatDuration } from "@/lib/format";
import { type ActivityWorkout, type Day, buildDays, level, streaks } from "@/lib/activity";

// Shade 1 to 4: how much of the accent color is mixed into the empty-day color.
const SHADE = [0, 28, 50, 75, 100];
const shade = (l: number) => (l ? `color-mix(in srgb, var(--accent) ${SHADE[l]}%, var(--field))` : "var(--field)");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// A square per day, brighter the longer you trained. 12 weeks by default, a full year on request.
export default function ActivityCalendar({ db, userId }: { db: SupabaseClient; userId: string }) {
  const ck = cacheKey(userId, "activity");
  const [list, setList] = useState<ActivityWorkout[] | null>(() => readCache<ActivityWorkout[]>(ck));
  const [year, setYear] = useState(false);
  const [picked, setPicked] = useState<Day | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    const since = new Date(Date.now() - 380 * 86400000).toISOString();
    db.from("workouts")
      .select("name,started_at,ended_at")
      .gte("started_at", since)
      .order("started_at", { ascending: false })
      .limit(3000)
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
  const weeks = year ? 53 : 12;
  const cols = useMemo(() => buildDays(list ?? [], now, weeks), [list, weeks]); // eslint-disable-line react-hooks/exhaustive-deps
  const st = useMemo(() => streaks(list ?? [], now), [list]); // eslint-disable-line react-hooks/exhaustive-deps
  const cell = year ? 12 : 22;
  const gap = year ? 3 : 4;

  // The year view is wider than the screen; start at the most recent weeks.
  useEffect(() => {
    if (year && scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth;
  }, [year]);

  const label = (c: number) => {
    const first = cols[c][0].date;
    return c === 0 || first.getMonth() !== cols[c - 1][0].date.getMonth() ? MONTHS[first.getMonth()] : "";
  };

  return (
    <section className="mt-6">
      <div className="flex items-baseline justify-between px-1">
        <h3 className="text-sm font-extrabold">Activity</h3>
        <button type="button" onClick={() => setYear((y) => !y)} className="text-[13px] font-bold text-accent">
          {year ? "Last 12 weeks" : "Show full year"}
        </button>
      </div>
      <div className="mt-2 rounded-[20px] bg-card p-4 shadow-sm">
        <div ref={scroller} className={year ? "overflow-x-auto" : ""}>
          <div className="flex" style={{ gap }}>
            <div className="flex flex-col text-[10px] font-semibold text-muted" style={{ gap, paddingTop: 14 }}>
              {["M", "", "W", "", "F", "", ""].map((d, i) => (
                <span key={i} style={{ height: cell, lineHeight: `${cell}px`, width: 10 }}>
                  {d}
                </span>
              ))}
            </div>
            {cols.map((col, c) => (
              <div key={c} className="flex flex-col" style={{ gap }}>
                <span className="h-[10px] whitespace-nowrap text-[10px] font-semibold text-muted" style={{ marginBottom: 4 }}>
                  {label(c)}
                </span>
                {col.map((d) => {
                  const lv = d.future ? 0 : level(d.minutes, d.workouts.length);
                  return (
                    <button
                      key={d.key}
                      type="button"
                      disabled={d.future}
                      onClick={() => setPicked(picked?.key === d.key ? null : d)}
                      aria-label={`${d.date.toDateString()}: ${d.workouts.length} ${d.workouts.length === 1 ? "workout" : "workouts"}`}
                      className="rounded-[5px]"
                      style={{
                        backgroundColor: shade(lv),
                        width: cell,
                        height: cell,
                        opacity: d.future ? 0.35 : 1,
                        outline: picked?.key === d.key ? "2px solid var(--text)" : "none",
                        outlineOffset: 1,
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 text-[11px] font-semibold text-muted">
          <span>
            Streak {st.current} {st.current === 1 ? "day" : "days"} · Best {st.longest}
          </span>
          <span className="flex items-center gap-1">
            Less
            {[0, 1, 2, 3, 4].map((l) => (
              <span
                key={l}
                className="inline-block h-3 w-3 rounded-[3px]"
                style={{ backgroundColor: shade(l) }}
              />
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

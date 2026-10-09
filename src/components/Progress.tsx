"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Unit, toDisplay } from "@/lib/units";
import { cacheKey, readCache, writeCache } from "@/lib/cache";
import { explain } from "@/lib/net";
import {
  type ExerciseProgress,
  type Metric,
  type ProgressSet,
  type Range,
  type Session,
  buildProgress,
  inRange,
  prIndexes,
  summarize,
} from "@/lib/progress";

type Named = { name: string };
type Row = {
  exercise_id: string;
  set_type: string | null;
  weight_kg: number | null;
  reps: number | null;
  exercise: Named | Named[] | null;
  workout: { id: string; started_at: string; gym: Named | Named[] | null } | { id: string; started_at: string; gym: Named | Named[] | null }[] | null;
};
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

const METRICS: { id: Metric; label: string; title: string; note: string }[] = [
  { id: "e1rm", label: "Est. 1RM", title: "Estimated one-rep max", note: "Heaviest single you could likely lift, worked out from each session's best set." },
  { id: "top", label: "Top weight", title: "Top weight", note: "The heaviest weight you used in each session." },
  { id: "volume", label: "Volume", title: "Total volume", note: "Weight x reps added up over every working set in the session." },
];
const RANGES: Range[] = ["1M", "3M", "6M", "All"];

async function loadRows(db: SupabaseClient, userId: string): Promise<ProgressSet[]> {
  const out: ProgressSet[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("workout_sets")
      .select("exercise_id,set_type,weight_kg,reps,exercise:exercises(name),workout:workouts(id,started_at,gym:gyms(name))")
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    const rows = (data ?? []) as unknown as Row[];
    for (const r of rows) {
      const w = one(r.workout);
      const ex = one(r.exercise);
      if (!w || !ex) continue;
      out.push({
        exerciseId: r.exercise_id,
        exerciseName: ex.name,
        workoutId: w.id,
        startedAt: w.started_at,
        gymName: one(w.gym)?.name ?? null,
        kg: r.weight_kg == null ? null : Number(r.weight_kg),
        reps: r.reps,
        setType: r.set_type,
      });
    }
    if (rows.length < 1000) break;
  }
  return out;
}

const fmtVal = (kg: number, unit: Unit) => Math.round(toDisplay(kg, unit)).toLocaleString();
const fmtDay = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const fmtDayYear = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

function Spark({ sessions }: { sessions: Session[] }) {
  if (sessions.length < 2) return <div className="h-9 w-[120px]" />;
  const vals = sessions.slice(-12).map((s) => s.value.e1rm);
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const pts = vals.map((v, i) => [(i / (vals.length - 1)) * 112 + 4, 32 - ((v - min) / span) * 26] as const);
  return (
    <svg width="120" height="36" viewBox="0 0 120 36" aria-hidden>
      <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="4" fill="var(--accent)" stroke="var(--card)" strokeWidth="2" />
    </svg>
  );
}

function Chart({ sessions, metric, unit }: { sessions: Session[]; metric: Metric; unit: Unit }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(320);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(240, el.clientWidth)));
    ro.observe(el);
    setW(Math.max(240, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const H = 200, L = 40, R = 14, T = 16, B = 26;
  const vals = sessions.map((s) => toDisplay(s.value[metric], unit));
  const rawMin = Math.min(...vals), rawMax = Math.max(...vals);
  const pad = (rawMax - rawMin || rawMax || 1) * 0.15;
  const lo = metric === "volume" ? 0 : Math.max(0, rawMin - pad);
  const hi = rawMax + pad;
  const t0 = sessions[0].date, t1 = sessions[sessions.length - 1].date;
  const x = (t: number) => (t1 === t0 ? L + (w - L - R) / 2 : L + ((t - t0) / (t1 - t0)) * (w - L - R));
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B);
  const pts = sessions.map((s, i) => [x(s.date), y(vals[i])] as const);
  const prs = new Set(prIndexes(sessions, metric));
  const bestI = vals.indexOf(rawMax);
  const ticks = [0, 1, 2, 3].map((i) => lo + ((hi - lo) * i) / 3);
  const line = pts.map((p) => p.join(",")).join(" ");
  const area = `${pts[0][0]},${H - B} ${line} ${pts[pts.length - 1][0]},${H - B}`;

  function nearest(clientX: number) {
    const r = wrap.current!.getBoundingClientRect();
    const px = clientX - r.left;
    let bi = 0;
    pts.forEach((p, i) => { if (Math.abs(p[0] - px) < Math.abs(pts[bi][0] - px)) bi = i; });
    setHover(bi);
  }
  const shown = hover ?? sessions.length - 1;

  return (
    <div ref={wrap} className="relative" onPointerMove={(e) => nearest(e.clientX)} onPointerDown={(e) => nearest(e.clientX)} onPointerLeave={() => setHover(null)}>
      <svg width={w} height={H} role="img" aria-label="Progress chart" className="block touch-pan-y">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={w - R} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth="1" />
            <text x={L - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize="11" fill="var(--muted)">{Math.round(t).toLocaleString()}</text>
          </g>
        ))}
        <polygon points={area} fill="var(--accent-tint)" opacity="0.7" />
        <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {pts.length <= 60 && pts.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r={4} fill={prs.has(i) ? "var(--card)" : "var(--accent)"} stroke={prs.has(i) ? "var(--accent)" : "var(--card)"} strokeWidth="2" />
        ))}
        {hover != null && <line x1={pts[hover][0]} x2={pts[hover][0]} y1={T} y2={H - B} stroke="var(--muted)" strokeWidth="1" strokeDasharray="3 3" />}
        <circle cx={pts[shown][0]} cy={pts[shown][1]} r={5} fill="var(--accent)" stroke="var(--card)" strokeWidth="2" />
        <text x={L} y={H - 6} fontSize="11" fill="var(--muted)">{fmtDay(t0)}</text>
        <text x={w - R} y={H - 6} fontSize="11" fill="var(--muted)" textAnchor="end">{fmtDay(t1)}</text>
        {hover == null && sessions.length > 1 && (
          <text x={Math.min(pts[bestI][0], w - R - 4)} y={Math.max(T - 4, pts[bestI][1] - 12)} fontSize="11" fontWeight="700" fill="var(--text)" textAnchor={pts[bestI][0] > w - 60 ? "end" : "middle"}>
            Best {Math.round(rawMax).toLocaleString()}
          </text>
        )}
      </svg>
      {hover != null && (
        <div
          className="pointer-events-none absolute -top-1 rounded-lg bg-ink px-2.5 py-1.5 text-xs font-bold text-bg"
          style={{ left: Math.min(Math.max(pts[hover][0] - 50, 0), w - 110), whiteSpace: "nowrap" }}
        >
          {fmtDayYear(sessions[hover].date)}: {Math.round(vals[hover]).toLocaleString()} {unit}{prs.has(hover) ? " PR" : ""}
        </div>
      )}
    </div>
  );
}

function Detail({ ex, unit, onBack }: { ex: ExerciseProgress; unit: Unit; onBack: () => void }) {
  const [metric, setMetric] = useState<Metric>("e1rm");
  const [range, setRange] = useState<Range>("3M");
  const now = Date.now();
  const sessions = inRange(ex.sessions, range, now);
  const sum = summarize(sessions, metric);
  const m = METRICS.find((x) => x.id === metric)!;
  const recent = [...ex.sessions].reverse().slice(0, 8);
  const chip = (on: boolean) => `h-9 rounded-full px-4 text-[13px] font-bold ${on ? "bg-accent text-on-accent" : "bg-card text-ink shadow-sm"}`;
  const rchip = (on: boolean) => `h-8 rounded-full px-3.5 text-xs font-bold ${on ? "bg-tint text-accent" : "bg-field text-muted"}`;
  return (
    <div className="px-4 pb-8 pt-4">
      <button type="button" onClick={onBack} className="text-sm font-bold text-accent">‹ All exercises</button>
      <h2 className="mt-2 px-1 text-2xl font-extrabold tracking-tight">{ex.name}</h2>
      <p className="px-1 text-[13px] text-muted">{ex.gymNames.join(" · ") || "No gym"} · {ex.sessions.length} {ex.sessions.length === 1 ? "session" : "sessions"}</p>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Metric">
        {METRICS.map((x) => (
          <button key={x.id} type="button" aria-pressed={metric === x.id} onClick={() => setMetric(x.id)} className={chip(metric === x.id)}>{x.label}</button>
        ))}
      </div>
      <div className="mt-3 rounded-[20px] bg-card p-4 shadow-sm">
        <h3 className="text-sm font-extrabold">{m.title} ({unit})</h3>
        <p className="mt-0.5 text-xs text-muted">{m.note}</p>
        <div className="mt-3 flex gap-2" role="group" aria-label="Date range">
          {RANGES.map((r) => (
            <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)} className={rchip(range === r)}>{r}</button>
          ))}
        </div>
        <div className="mt-3">
          {sessions.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">No sessions in this range. Try a longer one.</p>
          ) : sessions.length === 1 ? (
            <p className="py-10 text-center text-sm text-muted">Only one session so far ({Math.round(toDisplay(sessions[0].value[metric], unit)).toLocaleString()} {unit}). The chart appears after your next one.</p>
          ) : (
            <Chart sessions={sessions} metric={metric} unit={unit} />
          )}
        </div>
      </div>
      {sum && (
        <div className="mt-3 grid grid-cols-3 gap-2 rounded-[20px] bg-card p-4 shadow-sm">
          {[
            ["Best", fmtVal(sum.best, unit) + " " + unit, false],
            ["Latest", fmtVal(sum.latest, unit) + " " + unit, false],
            ["Change", (sum.change > 0 ? "+" : sum.change < 0 ? "-" : "") + fmtVal(Math.abs(sum.change), unit) + " " + unit, sum.change > 0],
          ].map(([k, v, good]) => (
            <div key={k as string}>
              <div className="text-xs text-muted">{k}</div>
              <div className={`text-lg font-extrabold ${good ? "text-done" : ""}`}>{v}</div>
            </div>
          ))}
        </div>
      )}
      <h3 className="mt-5 px-1 text-sm font-extrabold">Recent sessions</h3>
      <ul className="mt-2 space-y-2">
        {recent.map((s) => (
          <li key={s.workoutId} className="flex items-center justify-between gap-3 rounded-[14px] bg-card px-4 py-3 text-[13px] shadow-sm">
            <span className="font-bold">{fmtDay(s.date)}</span>
            <span className="min-w-0 flex-1 truncate text-muted">{s.sets.map((t) => `${Math.round(toDisplay(t.kg, unit) * 10) / 10} x ${t.reps}`).join(" · ")}</span>
            <span className="font-extrabold">{fmtVal(s.value[metric], unit)} {unit}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Progress({ db, userId, unit }: { db: SupabaseClient; userId: string; unit: Unit }) {
  const [rows, setRows] = useState<ProgressSet[] | null>(() => readCache<ProgressSet[]>(cacheKey(userId, "progress")));
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadRows(db, userId)
      .then((r) => { if (live) { setRows(r); setError(null); writeCache(cacheKey(userId, "progress"), r); } })
      .catch((e) => { if (live) setError(explain((e as { message?: string })?.message, "Could not load your progress.")); });
    return () => { live = false; };
  }, [db, userId]);

  const all = useMemo(() => buildProgress(rows ?? []), [rows]);
  const selected = open ? all.find((e) => e.exerciseId === open) : null;
  if (selected) return <Detail ex={selected} unit={unit} onBack={() => setOpen(null)} />;

  const list = all.filter((e) => e.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="px-4 pb-8 pt-4">
      <h2 className="px-1 text-[32px] font-extrabold leading-tight tracking-tight">Progress</h2>
      <p className="px-1 text-[13px] text-muted">Tap an exercise to see how it is trending</p>
      {error && <p role="alert" className="mt-3 rounded-[14px] bg-tint px-4 py-3 text-[13px] font-semibold text-accent">{error}{rows ? " Showing your last saved copy." : ""}</p>}
      <label htmlFor="pq" className="sr-only">Search exercises</label>
      <input id="pq" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search exercises" className="mt-3 h-11 w-full rounded-full border border-line bg-card px-4 text-sm outline-none" />
      {rows == null && !error && <p className="mt-6 text-center text-sm text-muted">Loading...</p>}
      {rows != null && all.length === 0 && <p className="mt-6 rounded-[20px] bg-card p-5 text-center text-sm text-muted shadow-sm">Finish a workout and your exercises show up here.</p>}
      <ul className="mt-3 space-y-3">
        {list.map((e) => {
          const last = e.sessions[e.sessions.length - 1];
          const change = last.value.e1rm - e.sessions[0].value.e1rm;
          return (
            <li key={e.exerciseId}>
              <button type="button" onClick={() => setOpen(e.exerciseId)} className="w-full rounded-[20px] bg-card p-4 text-left shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <span className="font-extrabold">{e.name}</span>
                  {e.sessions.length > 1 && (
                    <span className={`shrink-0 text-[13px] font-bold ${change > 0 ? "text-done" : "text-muted"}`}>
                      {change > 0 ? "▲ +" : change < 0 ? "▼ -" : ""}{fmtVal(Math.abs(change), unit)} {unit}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted">{e.gymNames.join(" · ") || "No gym"} · {e.sessions.length} {e.sessions.length === 1 ? "session" : "sessions"}</div>
                <div className="mt-2 flex items-end justify-between">
                  <div><span className="text-[22px] font-extrabold">{fmtVal(last.value.e1rm, unit)} {unit}</span> <span className="text-xs text-muted">est. 1RM</span></div>
                  <Spark sessions={e.sessions} />
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

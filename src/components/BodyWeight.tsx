"use client";

import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import NumField from "./NumField";
import { explain } from "@/lib/net";
import { type Unit, fromDisplay, toDisplay } from "@/lib/units";
import { type Range, rangeStart } from "@/lib/progress";
import { type WeightLog, cacheWeights, dayMs, deleteWeight, loadWeights, saveWeight, withWeight } from "@/lib/bodyweight";
import { loadNutritionProfile, localDate } from "@/lib/nutrition";

const RANGES: Range[] = ["1M", "3M", "6M", "All"];
const show = (kg: number, unit: Unit) => Math.round(toDisplay(kg, unit) * 10) / 10;
const fmtDay = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const fmtDayYear = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

// Small trend line for the Nutrition card.
function Spark({ logs }: { logs: WeightLog[] }) {
  const vals = logs.slice(-14).map((l) => l.weight_kg);
  if (vals.length < 2) return <div className="h-9 w-[120px]" />;
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const pts = vals.map((v, i) => [(i / (vals.length - 1)) * 112 + 4, 32 - ((v - min) / span) * 26] as const);
  return (
    <svg width="120" height="36" viewBox="0 0 120 36" aria-hidden>
      <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="4" fill="var(--accent)" stroke="var(--card)" strokeWidth="2" />
    </svg>
  );
}

// The weight card on the Nutrition tab: log the weight for the day shown and see a mini trend.
export function WeightCard({ db, userId, unit, date }: { db: SupabaseClient; userId: string; unit: Unit; date: string }) {
  const [logs, setLogs] = useState<WeightLog[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [value, setValue] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadWeights(db, userId).then((r) => {
      if (!live) return;
      setLogs(r.logs);
      setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, [db, userId]);

  const mine = logs.find((l) => l.measured_on === date) ?? null;
  const latest = logs.length > 0 ? logs[logs.length - 1] : null;

  // Show the day's saved weight in the box when the day changes or the log loads.
  useEffect(() => {
    setValue(mine ? show(mine.weight_kg, unit) : null);
    setConfirmDel(false);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, mine?.weight_kg, unit, loaded]);

  async function save() {
    if (value == null || value <= 0) return;
    const kg = fromDisplay(value, unit);
    setBusy(true);
    setError(null);
    const err = await saveWeight(db, userId, date, kg);
    if (err) {
      setBusy(false);
      setError(explain(err, "Could not save your weight."));
      return;
    }
    const next = withWeight(logs, date, kg);
    setLogs(next);
    cacheWeights(userId, next);
    // Today's weight also becomes the weight used to suggest nutrition targets.
    if (date === localDate()) {
      await db.from("profiles").update({ weight_kg: Math.round(kg * 10) / 10 }).eq("id", userId);
      await loadNutritionProfile(db, userId);
    }
    setBusy(false);
  }

  async function remove() {
    if (!confirmDel) {
      setConfirmDel(true);
      window.setTimeout(() => setConfirmDel(false), 4000);
      return;
    }
    setBusy(true);
    const err = await deleteWeight(db, userId, date);
    setBusy(false);
    setConfirmDel(false);
    if (err) {
      setError(explain(err, "Could not remove that weight."));
      return;
    }
    const next = logs.filter((l) => l.measured_on !== date);
    setLogs(next);
    cacheWeights(userId, next);
    setValue(null);
  }

  return (
    <section className="mt-3 rounded-[20px] bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-extrabold">Weight</h3>
          <p className="text-xs font-medium text-muted">
            {latest ? `Latest ${show(latest.weight_kg, unit)} ${unit} · ${fmtDay(dayMs(latest.measured_on))}` : "Not logged yet"}
          </p>
        </div>
        <Spark logs={logs} />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <div className="w-28">
          <NumField ariaLabel={`Body weight in ${unit}`} value={value} onChange={setValue} max={999} placeholder={unit} />
        </div>
        <span className="text-sm font-medium text-muted">{unit}</span>
        <button
          type="button"
          onClick={save}
          disabled={busy || value == null || value <= 0 || (mine != null && show(mine.weight_kg, unit) === value)}
          className="ml-auto h-10 rounded-[12px] bg-accent px-4 text-sm font-bold text-on-accent disabled:opacity-40"
        >
          {busy ? "Saving..." : mine ? "Update" : "Log weight"}
        </button>
      </div>
      {mine && (
        <button type="button" onClick={remove} disabled={busy} className="mt-1 h-9 text-xs font-bold text-muted">
          {confirmDel ? "Tap again to remove this day's weight" : "Remove this day's weight"}
        </button>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm font-semibold text-red-600">
          {error}
        </p>
      )}
      <p className="mt-2 text-xs font-medium text-muted">Full chart on Train, Progress.</p>
    </section>
  );
}

function TrendChart({ logs, unit }: { logs: WeightLog[]; unit: Unit }) {
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

  const H = 180, L = 40, R = 14, T = 16, B = 26;
  const vals = logs.map((l) => show(l.weight_kg, unit));
  const rawMin = Math.min(...vals), rawMax = Math.max(...vals);
  const pad = (rawMax - rawMin || rawMax || 1) * 0.2;
  const lo = Math.max(0, rawMin - pad), hi = rawMax + pad;
  const ts = logs.map((l) => dayMs(l.measured_on));
  const t0 = ts[0], t1 = ts[ts.length - 1];
  const x = (t: number) => (t1 === t0 ? L + (w - L - R) / 2 : L + ((t - t0) / (t1 - t0)) * (w - L - R));
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B);
  const pts = ts.map((t, i) => [x(t), y(vals[i])] as const);
  const ticks = [0, 1, 2].map((i) => lo + ((hi - lo) * i) / 2);
  const line = pts.map((p) => p.join(",")).join(" ");
  const area = `${pts[0][0]},${H - B} ${line} ${pts[pts.length - 1][0]},${H - B}`;
  const shown = hover ?? logs.length - 1;

  function nearest(clientX: number) {
    const r = wrap.current!.getBoundingClientRect();
    const px = clientX - r.left;
    let bi = 0;
    pts.forEach((p, i) => {
      if (Math.abs(p[0] - px) < Math.abs(pts[bi][0] - px)) bi = i;
    });
    setHover(bi);
  }

  return (
    <div ref={wrap} className="relative" onPointerMove={(e) => nearest(e.clientX)} onPointerDown={(e) => nearest(e.clientX)} onPointerLeave={() => setHover(null)}>
      <svg width={w} height={H} role="img" aria-label="Bodyweight chart" className="block touch-pan-y">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={w - R} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth="1" />
            <text x={L - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize="11" fill="var(--muted)">
              {Math.round(t * 10) / 10}
            </text>
          </g>
        ))}
        <polygon points={area} fill="var(--accent-tint)" opacity="0.7" />
        <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {pts.length <= 60 &&
          pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={3.5} fill="var(--accent)" stroke="var(--card)" strokeWidth="2" />)}
        {hover != null && <line x1={pts[hover][0]} x2={pts[hover][0]} y1={T} y2={H - B} stroke="var(--muted)" strokeWidth="1" strokeDasharray="3 3" />}
        <circle cx={pts[shown][0]} cy={pts[shown][1]} r={5} fill="var(--accent)" stroke="var(--card)" strokeWidth="2" />
        <text x={L} y={H - 6} fontSize="11" fill="var(--muted)">
          {fmtDay(t0)}
        </text>
        <text x={w - R} y={H - 6} fontSize="11" fill="var(--muted)" textAnchor="end">
          {fmtDay(t1)}
        </text>
      </svg>
      {hover != null && (
        <div
          className="pointer-events-none absolute -top-1 rounded-lg bg-ink px-2.5 py-1.5 text-xs font-bold text-bg"
          style={{ left: Math.min(Math.max(pts[hover][0] - 50, 0), w - 120), whiteSpace: "nowrap" }}
        >
          {fmtDayYear(ts[hover])}: {vals[hover]} {unit}
        </div>
      )}
    </div>
  );
}

// The bodyweight card at the top of Train > Progress.
export function WeightProgress({ db, userId, unit }: { db: SupabaseClient; userId: string; unit: Unit }) {
  const [logs, setLogs] = useState<WeightLog[] | null>(null);
  const [range, setRange] = useState<Range>("3M");

  useEffect(() => {
    let live = true;
    loadWeights(db, userId).then((r) => live && setLogs(r.logs));
    return () => {
      live = false;
    };
  }, [db, userId]);

  if (logs == null) return null;
  const rchip = (on: boolean) => `h-8 rounded-full px-3.5 text-xs font-bold ${on ? "bg-tint text-accent" : "bg-field text-muted"}`;

  if (logs.length === 0) {
    return (
      <section className="mt-3 rounded-[20px] bg-card p-4 shadow-sm">
        <h3 className="text-sm font-extrabold">Bodyweight</h3>
        <p className="mt-1 text-xs text-muted">Log your weight on the Nutrition tab and its trend shows up here.</p>
      </section>
    );
  }

  const start = rangeStart(range, Date.now());
  const inRange = logs.filter((l) => dayMs(l.measured_on) >= start);
  const first = inRange[0];
  const last = inRange[inRange.length - 1];
  const change = first && last ? show(last.weight_kg, unit) - show(first.weight_kg, unit) : 0;
  const latest = logs[logs.length - 1];

  return (
    <section className="mt-3 rounded-[20px] bg-card p-4 shadow-sm">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-extrabold">Bodyweight</h3>
        <span className="text-[22px] font-extrabold">
          {show(latest.weight_kg, unit)} <span className="text-xs font-bold text-muted">{unit}</span>
        </span>
      </div>
      <p className="text-xs text-muted">
        Latest {fmtDay(dayMs(latest.measured_on))}
        {inRange.length > 1 ? ` · ${change > 0 ? "+" : change < 0 ? "-" : ""}${Math.abs(Math.round(change * 10) / 10)} ${unit} in this range` : ""}
      </p>
      <div className="mt-3 flex gap-2" role="group" aria-label="Date range">
        {RANGES.map((r) => (
          <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)} className={rchip(range === r)}>
            {r}
          </button>
        ))}
      </div>
      <div className="mt-3">
        {inRange.length < 2 ? (
          <p className="py-8 text-center text-sm text-muted">{inRange.length === 0 ? "No weights in this range. Try a longer one." : "Log another weight and the chart appears."}</p>
        ) : (
          <TrendChart logs={inRange} unit={unit} />
        )}
      </div>
    </section>
  );
}

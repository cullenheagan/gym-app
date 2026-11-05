"use client";

// My plan > Goals (HCI proposal F7): set how many workouts a week you want, see this week's
// progress and your streak of weeks in a row. Progress comes from logged workouts (including ones
// still waiting on the phone to sync), so it updates every time a workout is finished.
import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_TARGET, activeGoal, weekStart, weeklyProgress, type Goal } from "@/lib/goals";
import { loadOutbox } from "@/lib/outbox";
import { cacheKey, readCache, writeCache } from "@/lib/cache";
import { explain } from "@/lib/net";

type Cached = { goals: Goal[]; starts: string[] };

export default function GoalsCard({
  db,
  userId,
  suggested,
}: {
  db: SupabaseClient;
  userId: string;
  suggested: number; // the plan's days per week, used as the starting number
}) {
  const ck = cacheKey(userId, "goals");
  const [data, setData] = useState<Cached | null>(() => readCache<Cached>(ck));
  const [editing, setEditing] = useState<number | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const g = await db.from("goals").select("id,target,created_at,ended_at").eq("user_id", userId).order("created_at");
    if (g.error) return;
    const goals = (g.data ?? []) as Goal[];
    let starts: string[] = [];
    if (goals.length) {
      const since = weekStart(new Date(goals[0].created_at)).toISOString();
      const w = await db.from("workouts").select("id,started_at").eq("user_id", userId).gte("started_at", since);
      if (w.error) return;
      const ids = new Set((w.data ?? []).map((r) => r.id as string));
      starts = (w.data ?? []).map((r) => r.started_at as string);
      // Finished workouts still waiting to sync count too.
      for (const item of loadOutbox(userId)) if (!ids.has(item.workout.id)) starts.push(item.workout.started_at);
    }
    const next = { goals, starts };
    setData(next);
    writeCache(ck, next);
  }, [db, userId, ck]);

  useEffect(() => {
    load();
  }, [load]);

  const goals = data?.goals ?? [];
  const current = activeGoal(goals);
  const progress = data ? weeklyProgress(goals, data.starts, new Date()) : null;

  async function save() {
    if (editing === null) return;
    setBusy(true);
    setError(null);
    const now = new Date().toISOString();
    if (current) {
      if (current.target === editing) {
        setBusy(false);
        setEditing(null);
        return;
      }
      const end = await db.from("goals").update({ ended_at: now }).eq("id", current.id);
      if (end.error) {
        setBusy(false);
        setError(explain(end.error.message, "Could not save the goal. Check your connection."));
        return;
      }
    }
    const ins = await db.from("goals").insert({ user_id: userId, target: editing, created_at: now });
    setBusy(false);
    if (ins.error) {
      setError(explain(ins.error.message, "Could not save the goal. Check your connection."));
      await load();
      return;
    }
    setEditing(null);
    await load();
  }

  async function endGoal() {
    if (!current) return;
    if (!confirmEnd) {
      setConfirmEnd(true);
      return;
    }
    setBusy(true);
    const { error: err } = await db.from("goals").update({ ended_at: new Date().toISOString() }).eq("id", current.id);
    setBusy(false);
    setConfirmEnd(false);
    if (err) {
      setError(explain(err.message, "Could not end the goal. Check your connection."));
      return;
    }
    setEditing(null);
    await load();
  }

  return (
    <div className="mx-4 mt-3 rounded-[20px] bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-base font-extrabold">Goals</p>
        {!current && editing === null && (
          <button
            type="button"
            onClick={() => setEditing(Math.min(Math.max(suggested, 1), MAX_TARGET))}
            className="h-9 text-sm font-extrabold text-accent"
          >
            + Add
          </button>
        )}
        {current && editing === null && (
          <button type="button" onClick={() => setEditing(current.target)} className="h-9 text-sm font-extrabold text-accent">
            Edit
          </button>
        )}
      </div>

      {editing !== null ? (
        <div className="mt-2">
          <p className="text-sm font-bold text-muted">Workouts per week</p>
          <div className="mt-2 flex gap-1.5" role="radiogroup" aria-label="Workouts per week">
            {Array.from({ length: MAX_TARGET }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={editing === n}
                onClick={() => setEditing(n)}
                className={`h-11 flex-1 rounded-xl text-base font-extrabold ${
                  editing === n ? "bg-accent text-[var(--on-accent)]" : "bg-field"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="h-11 flex-1 rounded-[14px] bg-accent text-sm font-extrabold text-[var(--on-accent)] disabled:opacity-60"
            >
              Save goal
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setConfirmEnd(false);
                setError(null);
              }}
              className="h-11 flex-1 rounded-[14px] bg-field text-sm font-extrabold"
            >
              Cancel
            </button>
          </div>
          {current && (
            <button type="button" onClick={endGoal} disabled={busy} className="mt-2 h-10 w-full text-sm font-bold text-red-600">
              {confirmEnd ? "Tap again to end this goal" : "End this goal"}
            </button>
          )}
        </div>
      ) : current && progress ? (
        <div className="mt-1">
          <p className="text-[15px] font-extrabold">
            {current.target} {current.target === 1 ? "workout" : "workouts"} a week
          </p>
          <div className="mt-2 flex items-center gap-1.5" aria-hidden="true">
            {Array.from({ length: current.target }, (_, i) => (
              <span key={i} className={`h-3 w-3 rounded-full ${i < progress.thisWeek ? "bg-done" : "bg-line"}`} />
            ))}
          </div>
          <p className={`mt-1.5 text-sm font-bold ${progress.met ? "text-done" : "text-muted"}`}>
            {progress.met ? "Goal met this week" : `${progress.thisWeek} of ${current.target} this week`}
          </p>
          <p className="mt-1 text-sm font-semibold text-muted">
            {progress.streak > 0
              ? `${progress.streak}-week streak${progress.best > progress.streak ? ` · best ${progress.best}` : ""}`
              : "Meet it this week to start a streak"}
          </p>
        </div>
      ) : (
        <p className="mt-1 text-sm font-semibold text-muted">
          Set how many workouts you want each week. It updates every time you log one.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm font-semibold text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

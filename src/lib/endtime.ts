// Turning a typed "Ended at" clock time into a real timestamp.

export function clockOf(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function showClock(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// The clock time is read on the day the workout started; if that lands before the start,
// the workout ran past midnight, so it moves to the next day.
// It can't be before the start or the last logged set, or in the future.
export function resolveEnd(
  clock: string,
  o: { startedAt: number; lastSetAt: number | null; now: number },
): { ok: true; ms: number } | { ok: false; error: string } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(clock);
  if (!m) return { ok: false, error: "Enter the time you finished." };
  const d = new Date(o.startedAt);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  let ms = d.getTime();
  if (ms < o.startedAt - 60000) ms += 24 * 3600 * 1000;
  const floor = Math.max(o.startedAt, o.lastSetAt ?? 0);
  if (ms < floor) {
    // Same minute as the last set: the clock has no seconds, so allow it.
    if (floor - ms < 60000) ms = floor;
    else return { ok: false, error: `That's before your last set (${showClock(floor)}). Pick a later time.` };
  }
  if (ms > o.now + 60000) return { ok: false, error: "That time is in the future." };
  return { ok: true, ms: Math.min(ms, o.now) };
}

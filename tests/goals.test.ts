// Automated checks for the weekly workout goal (HCI proposal F7). Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { activeGoal, weekStart, weeklyProgress, type Goal } from "../src/lib/goals.ts";

// Wednesday 5 Nov 2026, noon local time; that week starts Monday 2 Nov.
const NOW = new Date(2026, 10, 4, 12);
const at = (y: number, m: number, d: number, h = 18) => new Date(y, m - 1, d, h).toISOString();
const goal = (target: number, created: string, ended: string | null = null, id = created): Goal => ({
  id,
  target,
  created_at: created,
  ended_at: ended,
});

test("weeks start on Monday at local midnight", () => {
  const s = weekStart(NOW);
  assert.equal(s.getDay(), 1);
  assert.equal(s.getDate(), 2);
  assert.equal(s.getHours(), 0);
  assert.equal(weekStart(new Date(2026, 10, 8, 23, 59)).getDate(), 2); // Sunday night is the same week
  assert.equal(weekStart(new Date(2026, 10, 9, 0, 1)).getDate(), 9); // Monday starts a new one
});

test("no goal means no progress", () => {
  assert.equal(weeklyProgress([], [at(2026, 11, 3)], NOW), null);
  assert.equal(weeklyProgress([goal(3, at(2026, 10, 1), at(2026, 10, 20))], [], NOW), null);
});

test("this week's count updates with each logged workout", () => {
  const g = [goal(3, at(2026, 11, 2, 8))];
  assert.deepEqual(weeklyProgress(g, [], NOW), { target: 3, thisWeek: 0, met: false, streak: 0, best: 0 });
  const two = [at(2026, 11, 2), at(2026, 11, 3)];
  assert.equal(weeklyProgress(g, two, NOW)!.thisWeek, 2);
  const three = [...two, at(2026, 11, 4, 9)];
  const p = weeklyProgress(g, three, NOW)!;
  assert.equal(p.met, true);
  assert.equal(p.streak, 1);
  // Last week's workouts don't count toward this week.
  assert.equal(weeklyProgress(g, [at(2026, 11, 1)], NOW)!.thisWeek, 0);
});

test("streak counts weeks in a row; an unfinished week doesn't break it", () => {
  const g = [goal(2, at(2026, 10, 12, 8))]; // set on Monday 12 Oct
  const weeks = [at(2026, 10, 13), at(2026, 10, 15), at(2026, 10, 20), at(2026, 10, 22), at(2026, 10, 27), at(2026, 10, 29)];
  const p = weeklyProgress(g, weeks, NOW)!; // three met weeks, this week 0 so far
  assert.equal(p.thisWeek, 0);
  assert.equal(p.streak, 3);
  assert.equal(p.best, 3);
  const met = weeklyProgress(g, [...weeks, at(2026, 11, 2), at(2026, 11, 3)], NOW)!;
  assert.equal(met.streak, 4);
  // A missed week resets the streak but keeps the best.
  const gap = [at(2026, 10, 13), at(2026, 10, 15), at(2026, 10, 20), at(2026, 10, 27), at(2026, 10, 29)];
  const q = weeklyProgress(g, gap, NOW)!;
  assert.equal(q.streak, 1);
  assert.equal(q.best, 1);
});

test("weeks before the first goal don't count", () => {
  const g = [goal(1, at(2026, 10, 28, 8))];
  const p = weeklyProgress(g, [at(2026, 10, 6), at(2026, 10, 13), at(2026, 10, 27)], NOW)!;
  assert.equal(p.streak, 1); // only the week of 26 Oct, when the goal was set
});

test("editing keeps past weeks judged by the goal at the time", () => {
  // 1 a week until Wed 28 Oct, then 3 a week.
  const old = goal(1, at(2026, 10, 12, 8), at(2026, 10, 28, 9), "old");
  const now3 = goal(3, at(2026, 10, 28, 9), null, "new");
  assert.equal(activeGoal([old, now3])!.id, "new");
  const w = [at(2026, 10, 14), at(2026, 10, 21), at(2026, 10, 26), at(2026, 10, 27), at(2026, 10, 30)];
  const p = weeklyProgress([old, now3], w, NOW)!;
  assert.equal(p.target, 3);
  assert.equal(p.streak, 3); // weeks of 12, 19 (one each, old goal) and 26 Oct (three, new goal)
});

test("ending a goal hides it; starting again begins a new streak", () => {
  const ended = goal(2, at(2026, 10, 5), at(2026, 10, 25), "a");
  const fresh = goal(2, at(2026, 11, 2, 8), null, "b");
  const p = weeklyProgress([ended, fresh], [at(2026, 11, 2), at(2026, 11, 3)], NOW)!;
  assert.equal(p.met, true);
  assert.equal(p.streak, 1);
});

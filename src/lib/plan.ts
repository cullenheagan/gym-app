// My plan (HCI proof of concept): the questionnaire scoring (F2), the weekly plan generator (F3)
// and the rest rules (F5). Pure functions with no imports beyond types, so tests/plan.test.ts can
// run them directly with Node and check every combination of answers.
import type { Equipment, LibraryExercise, Muscle, Pattern } from "./exercise-library";

export type Answers = {
  // How often have you worked out in the last 3 months? 0 never, 1 now and then, 2 once or twice
  // a week, 3 three or more times a week.
  recent: 0 | 1 | 2 | 3;
  // How long have you trained regularly? 0 not yet or under 3 months, 1 three to twelve months,
  // 2 more than a year.
  history: 0 | 1 | 2;
  goal: "muscle" | "strength" | "fitness" | "health";
  days: 2 | 3 | 4 | 5;
  minutes: 30 | 45 | 60;
  equipment: Equipment;
};

export type Level = "beginner" | "intermediate" | "advanced";

export type PlanExercise = { id: string; slot: Pattern; sets: number; reps: string };
export type PlanDay = {
  // 0 = Monday ... 6 = Sunday
  weekday: number;
  kind: "workout" | "optional" | "rest";
  title: string;
  exercises: PlanExercise[];
};
export type Plan = { level: Level; days: PlanDay[] };

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function levelFor(a: Pick<Answers, "recent" | "history">): Level {
  if (a.history === 0 || a.recent <= 1) return "beginner";
  if (a.history === 2 && a.recent === 3) return "advanced";
  return "intermediate";
}

const MAX_DIFFICULTY: Record<Level, number> = { beginner: 1, intermediate: 2, advanced: 3 };
const EQUIPMENT_RANK: Record<Equipment, number> = { bodyweight: 0, dumbbells: 1, gym: 2 };

// Each kind of session asks for movements in priority order; shorter sessions keep the first ones.
type Session = { title: string; slots: Pattern[]; variant: number };
const SESSIONS: Record<string, Omit<Session, "title">> = {
  "Full body A": { slots: ["squat", "h_push", "h_pull", "hinge", "core", "v_push", "biceps"], variant: 0 },
  "Full body B": { slots: ["single_leg", "v_push", "v_pull", "hinge", "core", "h_push", "triceps"], variant: 1 },
  "Upper body A": { slots: ["h_push", "h_pull", "v_push", "v_pull", "biceps", "triceps"], variant: 0 },
  "Upper body B": { slots: ["v_pull", "h_push", "h_pull", "v_push", "triceps", "biceps"], variant: 1 },
  "Lower body A": { slots: ["squat", "hinge", "single_leg", "core", "leg_curl", "calves"], variant: 0 },
  "Lower body B": { slots: ["hinge", "single_leg", "squat", "core", "calves", "leg_curl"], variant: 1 },
  Push: { slots: ["h_push", "v_push", "triceps", "h_push", "triceps"], variant: 0 },
  Pull: { slots: ["v_pull", "h_pull", "biceps", "h_pull", "biceps"], variant: 0 },
  Legs: { slots: ["squat", "hinge", "single_leg", "core", "calves", "leg_curl"], variant: 0 },
};

// Which session goes on which weekday (0 = Monday). Every layout leaves at least one rest day and
// never trains the same muscles two days running (including Sunday into Monday).
function weekLayout(days: Answers["days"], level: Level): (string | null)[] {
  switch (days) {
    case 2:
      return ["Full body A", null, null, "Full body B", null, null, null];
    case 3:
      return ["Full body A", null, "Full body B", null, "Full body A", null, null];
    case 4:
      return ["Upper body A", "Lower body A", null, "Upper body B", "Lower body B", null, null];
    case 5:
      // Beginners get four lifting days and an easy walk; others get a push/pull/legs + upper/lower week.
      return level === "beginner"
        ? ["Upper body A", "Lower body A", null, "Upper body B", "Lower body B", "Walk", null]
        : ["Push", "Pull", "Legs", null, "Upper body A", "Lower body A", null];
  }
}

function exerciseCount(minutes: Answers["minutes"], level: Level): number {
  const n = minutes === 30 ? 4 : minutes === 45 ? 5 : 6;
  return level === "beginner" ? Math.min(n, 5) : n;
}

const MAIN_LIFTS: Pattern[] = ["squat", "hinge", "h_push", "v_push", "h_pull", "v_pull"];

function dose(ex: LibraryExercise, slot: Pattern, a: Answers, level: Level): { sets: number; reps: string } {
  const main = MAIN_LIFTS.includes(slot);
  let sets = 3;
  let reps = "8–12";
  if (a.goal === "strength") {
    if (main && level !== "beginner") {
      sets = 4;
      reps = "5–8";
    } else reps = main ? "8–10" : "10–12";
  } else if (a.goal === "fitness") reps = "12–15";
  else if (a.goal === "health") {
    sets = 2;
    reps = "10–12";
  }
  if (level === "beginner") sets = Math.max(2, sets - 1);
  if (ex.hold) reps = level === "beginner" ? "20–30 sec" : "30–45 sec";
  if (ex.pattern === "single_leg" || ["one-arm-dumbbell-row", "side-plank", "bird-dog"].includes(ex.id)) reps += " each side";
  return { sets, reps };
}

// The exercises that can fill a slot for these answers, best first: the most equipment-specific
// option the person has (a machine before dumbbells before bodyweight), then the harder one they
// are ready for.
export function candidates(slot: Pattern, a: Answers, library: LibraryExercise[]): LibraryExercise[] {
  const level = levelFor(a);
  const fits = (max: number) =>
    library.filter(
      (e) => e.pattern === slot && EQUIPMENT_RANK[e.needs] <= EQUIPMENT_RANK[a.equipment] && e.difficulty <= max,
    );
  // A beginner with nothing at difficulty 1 for this slot gets the easiest step up instead.
  let list = fits(MAX_DIFFICULTY[level]);
  if (list.length === 0) list = fits(3).filter((e) => e.difficulty === Math.min(...fits(3).map((x) => x.difficulty)));
  return list.sort(
    (x, y) => EQUIPMENT_RANK[y.needs] - EQUIPMENT_RANK[x.needs] || y.difficulty - x.difficulty || x.id.localeCompare(y.id),
  );
}

function buildSession(title: string, a: Answers, library: LibraryExercise[]): PlanExercise[] {
  const level = levelFor(a);
  if (title === "Walk") {
    const walk = library.find((e) => e.pattern === "walk");
    return walk ? [{ id: walk.id, slot: "walk", sets: 1, reps: "20–30 min" }] : [];
  }
  const s = SESSIONS[title];
  const want = exerciseCount(a.minutes, level);
  const out: PlanExercise[] = [];
  const used = new Set<string>();
  for (const slot of s.slots) {
    if (out.length >= want) break;
    const list = candidates(slot, a, library).filter((e) => !used.has(e.id));
    if (list.length === 0) continue; // nothing for this slot with this equipment; the next slot fills in
    // The B version of a session picks a different exercise for the same movement when there is
    // another one with the same equipment (so a gym plan doesn't drop to bodyweight for variety).
    const top = list.filter((e) => e.needs === list[0].needs);
    const pick = top[s.variant % top.length];
    used.add(pick.id);
    out.push({ id: pick.id, slot, ...dose(pick, slot, a, level) });
  }
  return out;
}

export function generatePlan(a: Answers, library: LibraryExercise[]): Plan {
  const level = levelFor(a);
  const days = weekLayout(a.days, level).map((title, weekday): PlanDay => {
    if (!title) return { weekday, kind: "rest", title: "Rest", exercises: [] };
    return {
      weekday,
      kind: title === "Walk" ? "optional" : "workout",
      title: title === "Walk" ? "Easy walk (optional)" : title,
      exercises: buildSession(title, a, library),
    };
  });
  return { level, days };
}

// F8: swap one exercise for the next one that fits the same movement (and isn't already that day).
export function swapExercise(
  plan: Plan,
  weekday: number,
  index: number,
  a: Answers,
  library: LibraryExercise[],
): Plan {
  const day = plan.days[weekday];
  const current = day?.exercises[index];
  if (!current) return plan;
  const inDay = new Set(day.exercises.map((e) => e.id));
  const list = candidates(current.slot, a, library);
  const at = list.findIndex((e) => e.id === current.id);
  const next = [...list.slice(at + 1), ...list.slice(0, Math.max(at, 0))].find((e) => !inDay.has(e.id));
  if (!next) return plan;
  const exercises = day.exercises.map((e, i) =>
    i === index ? { id: next.id, slot: e.slot, ...dose(next, e.slot, a, plan.level) } : e,
  );
  return { ...plan, days: plan.days.map((d) => (d.weekday === weekday ? { ...d, exercises } : d)) };
}

// The muscles a day trains, for the rest rule and for the week view.
export function musclesOf(day: PlanDay, library: Record<string, LibraryExercise>): Set<Muscle> {
  const out = new Set<Muscle>();
  for (const e of day.exercises) for (const m of library[e.id]?.muscles ?? []) if (m !== "cardio") out.add(m);
  return out;
}

// F5 check, also used by the tests: problems with a plan's week, or an empty list when it is fine.
export function restProblems(plan: Plan, library: Record<string, LibraryExercise>): string[] {
  const problems: string[] = [];
  if (!plan.days.some((d) => d.kind === "rest")) problems.push("no rest day");
  for (let i = 0; i < 7; i++) {
    const today = musclesOf(plan.days[i], library);
    const tomorrow = musclesOf(plan.days[(i + 1) % 7], library);
    const both = [...today].filter((m) => tomorrow.has(m));
    if (both.length) problems.push(`${WEEKDAYS[i]} and ${WEEKDAYS[(i + 1) % 7]} both train ${both.join(", ")}`);
  }
  return problems;
}

// Monday-first weekday index (0..6) of a date.
export function weekdayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

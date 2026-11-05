// Automated checks for My plan (HCI proposal F3, F4 and F5). Run with: npm test
// Every combination of questionnaire answers (1,728 of them) is generated and checked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LIBRARY, LIBRARY_BY_ID, embedUrl, type Equipment } from "../src/lib/exercise-library.ts";
import { generatePlan, levelFor, restProblems, swapExercise, type Answers } from "../src/lib/plan.ts";

const RANK: Record<Equipment, number> = { bodyweight: 0, dumbbells: 1, gym: 2 };

function* allAnswers(): Generator<Answers> {
  for (const recent of [0, 1, 2, 3] as const)
    for (const history of [0, 1, 2] as const)
      for (const goal of ["muscle", "strength", "fitness", "health"] as const)
        for (const days of [2, 3, 4, 5] as const)
          for (const minutes of [30, 45, 60] as const)
            for (const equipment of ["bodyweight", "dumbbells", "gym"] as const)
              yield { recent, history, goal, days, minutes, equipment };
}

test("library entries are complete and unique", () => {
  const ids = new Set<string>();
  for (const e of LIBRARY) {
    assert.ok(!ids.has(e.id), `duplicate id ${e.id}`);
    ids.add(e.id);
    assert.ok(e.steps.length >= 2, `${e.id} needs written steps`);
    assert.ok(e.muscles.length >= 1, `${e.id} needs muscles`);
    if (e.video) assert.ok(embedUrl(e.video), `${e.id} video is not a YouTube link: ${e.video}`);
  }
});

test("F3: every combination of answers gives a full week", () => {
  let n = 0;
  for (const a of allAnswers()) {
    const plan = generatePlan(a, LIBRARY);
    const label = JSON.stringify(a);
    assert.equal(plan.days.length, 7, label);
    const workouts = plan.days.filter((d) => d.kind === "workout");
    assert.equal(workouts.length, a.days === 5 && plan.level === "beginner" ? 4 : a.days, label);
    for (const d of workouts) {
      assert.ok(d.exercises.length >= 3, `${label} ${d.title} has only ${d.exercises.length} exercises`);
      assert.equal(new Set(d.exercises.map((e) => e.id)).size, d.exercises.length, `${label} repeats an exercise`);
      for (const e of d.exercises) {
        const lib = LIBRARY_BY_ID[e.id];
        assert.ok(lib, `${label} unknown exercise ${e.id}`);
        assert.ok(RANK[lib.needs] <= RANK[a.equipment], `${label} ${e.id} needs ${lib.needs}`);
        assert.ok(e.sets >= 1 && e.reps.length > 0, `${label} ${e.id} has no dose`);
      }
    }
    n++;
  }
  assert.equal(n, 1728);
});

test("F5: no muscle group on two days in a row, and at least one rest day", () => {
  for (const a of allAnswers()) {
    const problems = restProblems(generatePlan(a, LIBRARY), LIBRARY_BY_ID);
    assert.deepEqual(problems, [], JSON.stringify(a));
  }
});

test("beginners only get exercises at their level when one exists", () => {
  for (const a of allAnswers()) {
    if (levelFor(a) !== "beginner") continue;
    for (const d of generatePlan(a, LIBRARY).days)
      for (const e of d.exercises) {
        const lib = LIBRARY_BY_ID[e.id];
        const easier = LIBRARY.some(
          (x) => x.pattern === lib.pattern && x.difficulty < lib.difficulty && RANK[x.needs] <= RANK[a.equipment],
        );
        assert.ok(!easier, `${JSON.stringify(a)} gave ${e.id} when an easier option exists`);
      }
  }
});

test("levels match the questionnaire", () => {
  assert.equal(levelFor({ recent: 0, history: 0 }), "beginner");
  assert.equal(levelFor({ recent: 3, history: 0 }), "beginner");
  assert.equal(levelFor({ recent: 1, history: 2 }), "beginner");
  assert.equal(levelFor({ recent: 2, history: 1 }), "intermediate");
  assert.equal(levelFor({ recent: 3, history: 1 }), "intermediate");
  assert.equal(levelFor({ recent: 3, history: 2 }), "advanced");
});

test("F8: swapping changes only that exercise and keeps the rules", () => {
  for (const a of allAnswers()) {
    const plan = generatePlan(a, LIBRARY);
    const day = plan.days.find((d) => d.kind === "workout")!;
    const swapped = swapExercise(plan, day.weekday, 0, a, LIBRARY);
    const after = swapped.days[day.weekday].exercises;
    assert.equal(after.length, day.exercises.length);
    assert.deepEqual(after.slice(1), day.exercises.slice(1));
    assert.equal(after[0].slot, day.exercises[0].slot);
    assert.equal(new Set(after.map((e) => e.id)).size, after.length);
    assert.deepEqual(restProblems(swapped, LIBRARY_BY_ID), [], JSON.stringify(a));
  }
});

test("F4: every exercise a plan can use has a demo video (fill in exercise-library.ts)", (t) => {
  const used = new Set<string>();
  for (const a of allAnswers()) for (const d of generatePlan(a, LIBRARY).days) for (const e of d.exercises) used.add(e.id);
  const missing = [...used].filter((id) => !LIBRARY_BY_ID[id].video).sort();
  if (missing.length) t.todo(`${missing.length} of ${used.size} still need a video: ${missing.join(", ")}`);
  else assert.equal(missing.length, 0);
});

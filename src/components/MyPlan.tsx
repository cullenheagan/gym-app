"use client";

// Train > My plan (HCI proof of concept): a short questionnaire (F2) builds a weekly plan (F3) from
// the exercise library with demo videos (F4) and the rest rules (F5). Exercises can be swapped and
// the questionnaire retaken (F8) without touching logged workouts.
import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LIBRARY, LIBRARY_BY_ID, embedUrl, type Equipment, type LibraryExercise } from "@/lib/exercise-library";
import {
  WEEKDAYS,
  generatePlan,
  musclesOf,
  swapExercise,
  weekdayIndex,
  type Answers,
  type Plan,
  type PlanDay,
  type PlanExercise,
} from "@/lib/plan";
import { cacheKey, readCache, writeCache } from "@/lib/cache";
import { explain } from "@/lib/net";

type Saved = { answers: Answers; plan: Plan };

type Question = {
  key: keyof Answers;
  title: string;
  hint?: string;
  options: { value: Answers[keyof Answers]; label: string; sub?: string }[];
};

const QUESTIONS: Question[] = [
  {
    key: "recent",
    title: "How often have you worked out in the last 3 months?",
    options: [
      { value: 0, label: "Not at all" },
      { value: 1, label: "Now and then" },
      { value: 2, label: "Once or twice a week" },
      { value: 3, label: "3 or more times a week" },
    ],
  },
  {
    key: "history",
    title: "How long have you trained regularly?",
    options: [
      { value: 0, label: "Not yet, or under 3 months" },
      { value: 1, label: "3 to 12 months" },
      { value: 2, label: "More than a year" },
    ],
  },
  {
    key: "goal",
    title: "What's your main goal?",
    hint: "You can change this later.",
    options: [
      { value: "muscle", label: "Build muscle", sub: "Get bigger and more defined" },
      { value: "strength", label: "Get stronger", sub: "Lift more weight over time" },
      { value: "fitness", label: "Get fit and lose fat", sub: "More reps, shorter rests" },
      { value: "health", label: "Feel healthier", sub: "A simple routine to stay active" },
    ],
  },
  {
    key: "days",
    title: "How many days a week can you train?",
    options: [
      { value: 2, label: "2 days", sub: "Two full-body workouts" },
      { value: 3, label: "3 days", sub: "Three full-body workouts" },
      { value: 4, label: "4 days", sub: "Upper body and lower body, twice each" },
      { value: 5, label: "5 days", sub: "Beginners get four workouts and an easy walk" },
    ],
  },
  {
    key: "minutes",
    title: "How long can each workout be?",
    options: [
      { value: 30, label: "About 30 minutes" },
      { value: 45, label: "About 45 minutes" },
      { value: 60, label: "About 60 minutes" },
    ],
  },
  {
    key: "equipment",
    title: "What equipment do you have?",
    options: [
      { value: "gym", label: "A full gym", sub: "Machines, barbells and dumbbells" },
      { value: "dumbbells", label: "Dumbbells", sub: "At home or a small gym" },
      { value: "bodyweight", label: "No equipment", sub: "Just your bodyweight" },
    ],
  },
];

const LEVEL_LABEL = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" };
const GOAL_LABEL = { muscle: "Build muscle", strength: "Get stronger", fitness: "Get fit", health: "Feel healthier" };
const EQUIPMENT_LABEL: Record<Equipment, string> = { gym: "Full gym", dumbbells: "Dumbbells", bodyweight: "No equipment" };
const NEEDS_LABEL: Record<Equipment, string> = { gym: "Gym", dumbbells: "Dumbbells", bodyweight: "No equipment" };
const MUSCLE_LABEL: Record<string, string> = {
  chest: "Chest",
  back: "Back",
  shoulders: "Shoulders",
  biceps: "Biceps",
  triceps: "Triceps",
  quads: "Quads",
  hamstrings: "Hamstrings",
  glutes: "Glutes",
  calves: "Calves",
  core: "Core",
  cardio: "Cardio",
};

// Short, plain list of what a day trains ("Legs, shoulders, back, core").
function dayFocus(day: PlanDay): string {
  const m = musclesOf(day, LIBRARY_BY_ID);
  const parts: string[] = [];
  if (m.has("quads") || m.has("hamstrings") || m.has("glutes") || m.has("calves")) parts.push("legs");
  if (m.has("chest")) parts.push("chest");
  if (m.has("shoulders")) parts.push("shoulders");
  if (m.has("back")) parts.push("back");
  if (m.has("biceps") || m.has("triceps")) parts.push("arms");
  if (m.has("core")) parts.push("core");
  const s = parts.join(", ");
  return s ? s[0].toUpperCase() + s.slice(1) : "";
}

function youtubeId(video: string | null): string | null {
  const url = embedUrl(video);
  return url ? url.split("/").pop() ?? null : null;
}

export default function MyPlan({
  db,
  userId,
  onStartDay,
}: {
  db: SupabaseClient;
  userId: string;
  onStartDay: (day: PlanDay) => void;
}) {
  const ck = cacheKey(userId, "plan");
  const [saved, setSaved] = useState<Saved | null>(() => readCache<Saved>(ck));
  const [loaded, setLoaded] = useState(false);
  const [step, setStep] = useState<number | null>(null); // questionnaire screen, or null
  const [draft, setDraft] = useState<Partial<Answers>>({});
  const [selected, setSelected] = useState(() => weekdayIndex(new Date()));
  const [open, setOpen] = useState<{ weekday: number; index: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = weekdayIndex(new Date());

  useEffect(() => {
    let cancelled = false;
    db.from("plans")
      .select("answers,plan")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (!err) {
          const s = (data as Saved | null) ?? null;
          setSaved(s);
          writeCache(ck, s);
        }
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [db, userId, ck]);

  async function save(next: Saved): Promise<boolean> {
    setBusy(true);
    setError(null);
    const { error: err } = await db
      .from("plans")
      .upsert({ user_id: userId, answers: next.answers, plan: next.plan, updated_at: new Date().toISOString() });
    setBusy(false);
    if (err) {
      setError(explain(err.message, "Could not save your plan. Check your connection and try again."));
      return false;
    }
    setSaved(next);
    writeCache(ck, next);
    return true;
  }

  function begin() {
    setDraft(saved?.answers ?? {});
    setStep(0);
    setError(null);
  }

  async function choose(value: Answers[keyof Answers]) {
    if (step === null) return;
    const q = QUESTIONS[step];
    setDraft((d) => ({ ...d, [q.key]: value }));
  }

  async function next() {
    if (step === null) return;
    if (step < QUESTIONS.length - 1) {
      setStep(step + 1);
      return;
    }
    const answers = draft as Answers;
    const ok = await save({ answers, plan: generatePlan(answers, LIBRARY) });
    if (ok) {
      setStep(null);
      setSelected(today);
    }
  }

  async function swap(weekday: number, index: number) {
    if (!saved) return;
    const plan = swapExercise(saved.plan, weekday, index, saved.answers, LIBRARY);
    if (plan === saved.plan) {
      setError("There is no other exercise for this movement with your equipment.");
      return;
    }
    await save({ ...saved, plan });
  }

  // Questionnaire
  if (step !== null) {
    const q = QUESTIONS[step];
    const picked = draft[q.key];
    return (
      <section className="px-4 pb-32 pt-2">
        <div className="flex items-center justify-between px-1">
          <button
            type="button"
            onClick={() => (step === 0 ? setStep(null) : setStep(step - 1))}
            className="h-11 text-[15px] font-extrabold text-accent"
          >
            ‹ Back
          </button>
          <span className="text-sm font-bold text-muted">
            {step + 1} of {QUESTIONS.length}
          </span>
        </div>
        <div className="mx-1 h-1.5 rounded bg-line" aria-hidden="true">
          <div className="h-full rounded bg-accent" style={{ width: `${((step + 1) / QUESTIONS.length) * 100}%` }} />
        </div>
        <h2 className="mt-5 px-1 text-[26px] font-extrabold leading-tight tracking-tight">{q.title}</h2>
        {q.hint && <p className="mt-1 px-1 text-sm font-semibold text-muted">{q.hint}</p>}
        <div className="mt-3 flex flex-col gap-2.5" role="radiogroup" aria-label={q.title}>
          {q.options.map((o) => {
            const on = picked === o.value;
            return (
              <button
                key={String(o.value)}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => choose(o.value)}
                className={`rounded-[14px] border-2 px-4 py-3 text-left text-[15px] font-bold ${
                  on ? "border-accent bg-tint" : "border-line bg-card"
                }`}
              >
                {o.label}
                {o.sub && <span className="mt-0.5 block text-[13px] font-semibold text-muted">{o.sub}</span>}
              </button>
            );
          })}
        </div>
        {error && (
          <p role="alert" className="mt-3 px-1 text-sm font-semibold text-red-600">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={next}
          disabled={picked === undefined || busy}
          className="mt-5 h-[50px] w-full rounded-[14px] bg-accent text-base font-extrabold text-[var(--on-accent)] disabled:opacity-50"
        >
          {step === QUESTIONS.length - 1 ? (busy ? "Building..." : "Build my plan") : "Next"}
        </button>
      </section>
    );
  }

  // No plan yet
  if (!saved) {
    return (
      <section className="pb-32">
        <h2 className="mt-4 px-5 text-[32px] font-extrabold leading-tight tracking-tight">My plan</h2>
        <p className="px-5 text-sm font-semibold text-muted">A weekly routine made for you, with a video for every exercise.</p>
        <div className="mx-4 mt-4 rounded-[20px] bg-card p-5 shadow-sm">
          <p className="text-[17px] font-extrabold">New to training, or want a routine?</p>
          <p className="mt-1.5 text-sm font-semibold text-muted">
            Answer 6 quick questions about your experience, goal, time and equipment. Takes about 2 minutes.
          </p>
          <button
            type="button"
            onClick={begin}
            disabled={!loaded && !saved}
            className="mt-4 h-[50px] w-full rounded-[14px] bg-accent text-base font-extrabold text-[var(--on-accent)] disabled:opacity-60"
          >
            Build my plan
          </button>
        </div>
        <div className="mx-4 mt-3 rounded-[20px] bg-card p-5 text-sm font-semibold text-muted shadow-sm">
          <p className="mb-2 font-extrabold text-ink">How it works</p>
          <ul className="flex flex-col gap-1">
            <li>· Muscles get a day off before they&apos;re trained again</li>
            <li>· At least one full rest day every week</li>
            <li>· Tap any exercise to see a video and the steps</li>
            <li>· Start a planned day and it opens in the workout log</li>
          </ul>
        </div>
      </section>
    );
  }

  // The week
  const { answers, plan } = saved;
  const day = plan.days[selected];
  const sheet = open ? plan.days[open.weekday]?.exercises[open.index] : undefined;
  return (
    <section className="pb-32">
      <h2 className="mt-4 px-5 text-[32px] font-extrabold leading-tight tracking-tight">My plan</h2>
      <p className="px-5 text-sm font-semibold text-muted">
        {LEVEL_LABEL[plan.level]} · {GOAL_LABEL[answers.goal]} · {answers.days} days · {EQUIPMENT_LABEL[answers.equipment]}
      </p>

      <div className="mx-4 mt-4 rounded-[20px] bg-card px-4 py-2 shadow-sm">
        {plan.days.map((d) => {
          const isToday = d.weekday === today;
          const isSel = d.weekday === selected;
          const rest = d.kind === "rest";
          return (
            <button
              key={d.weekday}
              type="button"
              disabled={rest}
              onClick={() => setSelected(d.weekday)}
              aria-pressed={isSel}
              className={`flex w-full items-center gap-3 border-t border-line py-3 text-left first:border-t-0 ${
                isSel && !rest ? "-mx-2.5 w-[calc(100%+20px)] rounded-xl border-t-0 bg-tint px-2.5" : ""
              }`}
            >
              <span className={`w-10 text-[13px] font-extrabold ${isSel && !rest ? "text-accent" : "text-muted"}`}>
                {WEEKDAYS[d.weekday].slice(0, 3).toUpperCase()}
              </span>
              <span className={`flex-1 text-[15px] ${rest ? "font-bold text-muted" : "font-extrabold"}`}>
                {d.title}
                {!rest && (
                  <span className="mt-px block text-xs font-semibold text-muted">
                    {d.kind === "optional"
                      ? "Optional · 20–30 min"
                      : isSel
                        ? dayFocus(d)
                        : `${d.exercises.length} exercises · about ${answers.minutes} min`}
                  </span>
                )}
              </span>
              {isToday && !rest && (
                <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-extrabold text-[var(--on-accent)]">TODAY</span>
              )}
              {isToday && rest && <span className="text-[11px] font-extrabold text-muted">TODAY</span>}
              {!rest && !isToday && <span className="font-extrabold text-muted">›</span>}
            </button>
          );
        })}
      </div>

      {day && day.kind === "rest" ? (
        <div className="mx-4 mt-3 rounded-[20px] bg-card p-5 shadow-sm">
          <p className="text-base font-extrabold">Today is a rest day</p>
          <p className="mt-1 text-sm font-semibold text-muted">
            Rest lets your muscles recover and get stronger. Tap a day above to see its workout.
          </p>
        </div>
      ) : (
        day && (
          <div className="mx-4 mt-3 rounded-[20px] bg-card px-4 pb-4 pt-3.5 shadow-sm">
            <p className="text-base font-extrabold">
              {selected === today ? "Today" : WEEKDAYS[selected]}: {day.title}
            </p>
            <ul className="mt-1">
              {day.exercises.map((e, i) => (
                <ExerciseRow key={`${e.id}-${i}`} ex={e} onOpen={() => setOpen({ weekday: day.weekday, index: i })} />
              ))}
            </ul>
            <button
              type="button"
              onClick={() => onStartDay(day)}
              className="mt-3 h-[50px] w-full rounded-[14px] bg-accent text-base font-extrabold text-[var(--on-accent)]"
            >
              {selected === today ? "Start today's workout" : "Start this workout"}
            </button>
          </div>
        )
      )}

      {error && !open && (
        <p role="alert" className="mx-5 mt-3 text-sm font-semibold text-red-600">
          {error}
        </p>
      )}

      <div className="mt-4 flex justify-center">
        <button type="button" onClick={begin} className="h-11 text-sm font-extrabold text-accent">
          Retake questions
        </button>
      </div>

      {open && sheet && (
        <ExerciseSheet
          ex={sheet}
          lib={LIBRARY_BY_ID[sheet.id]}
          busy={busy}
          error={error}
          onSwap={() => swap(open.weekday, open.index)}
          onClose={() => {
            setOpen(null);
            setError(null);
          }}
        />
      )}
    </section>
  );
}

function Thumb({ lib }: { lib: LibraryExercise | undefined }) {
  const id = youtubeId(lib?.video ?? null);
  return id ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`https://i.ytimg.com/vi/${id}/mqdefault.jpg`} alt="" className="h-10 w-[54px] rounded-lg object-cover" />
  ) : (
    <span aria-hidden="true" className="grid h-10 w-[54px] place-items-center rounded-lg bg-[#20232b] text-sm text-white/70">
      ▶
    </span>
  );
}

function ExerciseRow({ ex, onOpen }: { ex: PlanExercise; onOpen: () => void }) {
  const lib = LIBRARY_BY_ID[ex.id];
  return (
    <li className="border-t border-line first:border-t-0">
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 py-2.5 text-left">
        <Thumb lib={lib} />
        <span className="flex-1 text-sm font-extrabold">
          {lib?.name ?? ex.id}
          <span className="block text-xs font-semibold text-muted">
            {ex.sets} × {ex.reps}
          </span>
        </span>
        <span className="font-extrabold text-muted">›</span>
      </button>
    </li>
  );
}

function ExerciseSheet({
  ex,
  lib,
  busy,
  error,
  onSwap,
  onClose,
}: {
  ex: PlanExercise;
  lib: LibraryExercise | undefined;
  busy: boolean;
  error: string | null;
  onSwap: () => void;
  onClose: () => void;
}) {
  const embed = useMemo(() => embedUrl(lib?.video ?? null), [lib]);
  if (!lib) return null;
  const setWord = ex.sets === 1 ? "set" : "sets";
  return (
    <div role="dialog" aria-modal="true" aria-label={lib.name} className="fixed inset-0 z-[60] flex items-end bg-black/40" onClick={onClose}>
      <div
        className="mx-auto max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-[26px] bg-card p-[18px] pb-8 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xl font-extrabold">{lib.name}</h3>
          <button type="button" onClick={onClose} className="h-11 font-extrabold text-accent">
            Close
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {lib.muscles.map((m) => (
            <span key={m} className="rounded-full bg-field px-2.5 py-1 text-xs font-extrabold">
              {MUSCLE_LABEL[m]}
            </span>
          ))}
          <span className="rounded-full bg-field px-2.5 py-1 text-xs font-extrabold">{NEEDS_LABEL[lib.needs]}</span>
        </div>
        {embed ? (
          <div className="relative mt-3 aspect-video overflow-hidden rounded-[14px] bg-black">
            <iframe
              src={embed}
              title={`${lib.name} demo video`}
              className="absolute inset-0 h-full w-full"
              allow="encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              loading="lazy"
            />
          </div>
        ) : (
          <div className="mt-3 grid aspect-video place-items-center rounded-[14px] bg-[#20232b] text-sm font-bold text-white/70">
            Video coming soon
          </div>
        )}
        <p className="mt-3 font-extrabold">
          {ex.sets} {setWord} × {ex.reps}
        </p>
        <ol className="mt-1.5 list-decimal pl-5 text-sm font-semibold leading-relaxed">
          {lib.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        {ex.slot !== "walk" && (
          <p className="mt-2 text-xs font-semibold text-muted">
            A <span className="border-b border-dotted border-muted">set</span> is a group of reps done in a row, then a short
            rest.
          </p>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm font-semibold text-red-600">
            {error}
          </p>
        )}
        {ex.slot !== "walk" && (
          <button
            type="button"
            onClick={onSwap}
            disabled={busy}
            className="mt-4 h-[50px] w-full rounded-[14px] bg-field text-base font-extrabold disabled:opacity-60"
          >
            Swap for a different exercise
          </button>
        )}
      </div>
    </div>
  );
}

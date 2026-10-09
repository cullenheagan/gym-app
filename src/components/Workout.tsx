"use client";

import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Unit, formatWeight, fromDisplay, toDisplay } from "@/lib/units";
import { formatClock, formatDate } from "@/lib/format";
import History, { type RepeatPlan } from "./History";
import SetupPanel from "./SetupPanel";
import { cacheKey, readCache, writeCache } from "@/lib/cache";
import { explain, isOffline, looksLikeNetworkError } from "@/lib/net";
import { type OutboxSet, type OutboxWorkout, enqueue, flushOutbox, loadOutbox } from "@/lib/outbox";
import { compressPhoto, uploadPhoto } from "@/lib/photo";

type SetRow = {
  id: string; // generated on the device so a retried save never duplicates a set
  prevKg: number | null;
  prevReps: number | null;
  kg: number | null;
  reps: number | null;
  done: boolean;
  doneAt: string | null; // when the set was marked done
};

type Exercise = {
  key: string;
  name: string;
  exerciseId: string | null; // null only for drafts saved before exercises were picked from a list
  prevDate: string | null; // when this exercise was last logged
  setupId?: string | null; // bench / seat setup used (optional; older drafts lack it)
  sets: SetRow[];
};

type Gym = { id: string; name: string };

// An exercise in the account's library. gym_id null means it is available at every gym.
type Catalog = { id: string; name: string; equipment_type: string; gym_id: string | null; photo_path: string | null };

type PastSet = {
  workout_id: string;
  set_index: number;
  weight_kg: number | null;
  reps: number | null;
  completed_at: string | null;
  setup_id: string | null;
};

// Free weights and bodyweight work anywhere; machines and cables belong to one gym.
const EQUIPMENT = [
  { value: "free_weight", label: "Free weight", anyGym: true },
  { value: "bodyweight", label: "Bodyweight", anyGym: true },
  { value: "pin_machine", label: "Pin-loaded machine", anyGym: false },
  { value: "plate_machine", label: "Plate-loaded machine", anyGym: false },
  { value: "cable", label: "Cable", anyGym: false },
] as const;

const equipmentLabel = (v: string) => EQUIPMENT.find((e) => e.value === v)?.label ?? "Other";

const newId = () => crypto.randomUUID();

function Thumb({ url, size = 40 }: { url?: string; size?: number }) {
  if (!url) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-lg object-cover"
      style={{ width: size, height: size }}
      onError={(e) => {
        // Photo links need a connection; hide the broken picture when offline.
        e.currentTarget.style.visibility = "hidden";
      }}
    />
  );
}

function CheckIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12l5 5 10-10" />
    </svg>
  );
}

function ChevronDown({ className }: { className?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

type Previous = { sets: PastSet[]; date: string | null; setupId: string | null };

// Workouts finished offline that have not reached the database yet still count as "last time".
function pendingPrevious(userId: string, exerciseId: string): Previous | null {
  let best: OutboxSet | null = null;
  for (const item of loadOutbox(userId)) {
    for (const st of item.sets) {
      if (st.exercise_id === exerciseId && (!best || Date.parse(st.completed_at) > Date.parse(best.completed_at))) {
        best = st;
      }
    }
  }
  if (!best) return null;
  const workoutId = best.workout_id;
  const sets: PastSet[] = loadOutbox(userId)
    .flatMap((i) => i.sets)
    .filter((st) => st.workout_id === workoutId && st.exercise_id === exerciseId)
    .map((st) => ({
      workout_id: st.workout_id,
      set_index: st.set_index,
      weight_kg: st.weight_kg,
      reps: st.reps,
      completed_at: st.completed_at,
      setup_id: st.setup_id,
    }))
    .sort((x, y) => x.set_index - y.set_index);
  return { sets, date: best.completed_at, setupId: best.setup_id };
}

// The sets from the most recent time this exercise was logged, and when that was.
// Falls back to a copy saved on this device when there is no connection.
async function loadPrevious(db: SupabaseClient, userId: string, exerciseId: string): Promise<Previous> {
  const ck = cacheKey(userId, `prev:${exerciseId}`);
  let result: Previous = { sets: [], date: null, setupId: null };
  const { data, error } = await db
    .from("workout_sets")
    .select("workout_id,set_index,weight_kg,reps,completed_at,setup_id")
    .eq("exercise_id", exerciseId)
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false })
    .limit(30);
  if (error) {
    result = readCache<Previous>(ck) ?? result;
  } else if (data && data.length > 0) {
    const rows = data as PastSet[];
    const last = rows[0].workout_id;
    result = {
      sets: rows
        .filter((r: PastSet) => r.workout_id === last)
        .sort((a: PastSet, b: PastSet) => a.set_index - b.set_index),
      date: rows[0].completed_at,
      setupId: rows[0].setup_id,
    };
    writeCache(ck, result);
  }
  const waiting = pendingPrevious(userId, exerciseId);
  if (waiting && (!result.date || Date.parse(waiting.date ?? "") > Date.parse(result.date))) return waiting;
  return result;
}

export default function Workout({
  db,
  userId,
  email,
  onSignOut,
}: {
  db: SupabaseClient;
  userId: string;
  email: string;
  onSignOut: () => void;
}) {
  const [unit, setUnit] = useState<Unit>("lb");
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");
  const [title, setTitle] = useState("Workout");
  const [startedAt, setStartedAt] = useState(() => new Date().toISOString());
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [gyms, setGyms] = useState<Gym[]>([]);
  const [gymId, setGymId] = useState("");
  const [catalog, setCatalog] = useState<Catalog[]>([]);
  const [addingGym, setAddingGym] = useState(false);
  const [newGym, setNewGym] = useState("");
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [newType, setNewType] = useState<string>("free_weight");
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const photoInput = useRef<HTMLInputElement>(null);
  const existingPhotoInput = useRef<HTMLInputElement>(null);
  const photoTarget = useRef<string | null>(null);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [view, setView] = useState<"log" | "history">("log");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [online, setOnline] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const draftKey = `draft:${userId}`;

  // Bring back an unfinished workout from this device, if there is one.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const d = JSON.parse(raw) as {
          title?: string;
          startedAt?: string;
          gymId?: string;
          exercises?: Exercise[];
        };
        if (Array.isArray(d.exercises)) setExercises(d.exercises);
        if (typeof d.title === "string") setTitle(d.title);
        if (typeof d.startedAt === "string") setStartedAt(d.startedAt);
        if (typeof d.gymId === "string" && d.gymId) setGymId(d.gymId);
      }
    } catch {}
    setDraftReady(true);
  }, [draftKey]);

  // Keep the unfinished workout saved on this device as you log.
  useEffect(() => {
    if (!draftReady) return;
    try {
      if (exercises.length === 0) localStorage.removeItem(draftKey);
      else localStorage.setItem(draftKey, JSON.stringify({ title, startedAt, gymId, exercises }));
    } catch {}
  }, [draftReady, draftKey, title, startedAt, gymId, exercises]);

  // The workout clock ticks while there is something in the workout.
  const active = exercises.length > 0;
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);

  // Restore saved preferences and load this account's gyms and exercise library.
  useEffect(() => {
    try {
      const u = localStorage.getItem("unit");
      if (u === "lb" || u === "kg") setUnit(u);
      const t = localStorage.getItem("theme");
      if (t === "light" || t === "dark") setTheme(t);
    } catch {}

    // Show the copy saved on this device straight away; fresh data replaces it when it arrives.
    const savedGyms = readCache<Gym[]>(cacheKey(userId, "gyms"));
    if (savedGyms) {
      setGyms(savedGyms);
      if (savedGyms.length > 0) setGymId((cur) => cur || savedGyms[0].id);
    }
    const savedCatalog = readCache<Catalog[]>(cacheKey(userId, "catalog"));
    if (savedCatalog) setCatalog(savedCatalog);

    let cancelled = false;
    (async () => {
      const profile = await db.from("profiles").select("unit").eq("id", userId).maybeSingle();
      if (!cancelled && profile.data && (profile.data.unit === "lb" || profile.data.unit === "kg")) {
        setUnit(profile.data.unit as Unit);
      }
      const res = await db.from("gyms").select("id,name").order("created_at", { ascending: true });
      if (!cancelled && res.data) {
        const list = res.data as Gym[];
        writeCache(cacheKey(userId, "gyms"), list);
        setGyms(list);
        if (list.length > 0) setGymId((cur) => cur || list[0].id);
      }
      const cat = await db
        .from("exercises")
        .select("id,name,equipment_type,gym_id,photo_path")
        .order("name", { ascending: true });
      if (!cancelled && cat.data) {
        const list = cat.data as Catalog[];
        writeCache(cacheKey(userId, "catalog"), list);
        setCatalog(list);
        const paths = list.map((c) => c.photo_path).filter((p): p is string => !!p);
        if (paths.length > 0) {
          const signed = await db.storage.from("equipment-photos").createSignedUrls(paths, 3600);
          if (!cancelled && signed.data) {
            const map: Record<string, string> = {};
            for (const row of signed.data) if (row.path && row.signedUrl) map[row.path] = row.signedUrl;
            setPhotoUrls(map);
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, userId]);

  async function syncNow() {
    if (loadOutbox(userId).length === 0) {
      setPending(0);
      return;
    }
    setSyncing(true);
    const r = await flushOutbox(db, userId);
    setSyncing(false);
    setPending(r.left);
    if (r.sent > 0) {
      setMessage({
        kind: "ok",
        text: r.sent === 1 ? "Saved your workout to your account." : `Saved ${r.sent} workouts to your account.`,
      });
    }
  }

  // Send finished workouts that are waiting: on open, when the connection comes back,
  // when the app is reopened, and every 30 seconds while something is waiting.
  useEffect(() => {
    setPending(loadOutbox(userId).length);
    setOnline(navigator.onLine);
    const goOnline = () => {
      setOnline(true);
      syncNow();
    };
    const goOffline = () => setOnline(false);
    const onVisible = () => {
      if (document.visibilityState === "visible" && navigator.onLine) syncNow();
    };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    document.addEventListener("visibilitychange", onVisible);
    syncNow();
    const id = window.setInterval(() => {
      if (navigator.onLine && loadOutbox(userId).length > 0) syncNow();
    }, 30000);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, userId]);

  function handleSignOut() {
    const n = loadOutbox(userId).length;
    if (
      n > 0 &&
      !window.confirm(
        `${n} ${n === 1 ? "workout hasn't" : "workouts haven't"} synced yet. ${
          n === 1 ? "It stays" : "They stay"
        } on this phone and will sync the next time you sign in here. Sign out anyway?`,
      )
    ) {
      return;
    }
    onSignOut();
  }

  function chooseUnit(u: Unit) {
    setUnit(u);
    try {
      localStorage.setItem("unit", u);
    } catch {}
    db.from("profiles").update({ unit: u }).eq("id", userId).then(() => {});
  }

  function toggleTheme() {
    const dark =
      theme === "dark" ||
      (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    const next = dark ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {}
  }

  async function saveGym() {
    const name = newGym.trim();
    if (!name) return;
    const { data, error } = await db.from("gyms").insert({ user_id: userId, name }).select("id,name").single();
    if (error || !data) {
      setMessage({ kind: "error", text: explain(error?.message, "Could not add the gym.") });
      return;
    }
    const gym = data as Gym;
    setGyms((g) => [...g, gym]);
    setGymId(gym.id);
    setNewGym("");
    setAddingGym(false);
  }

  // Exercises you can pick right now: this gym's equipment plus anything that works anywhere.
  const available = catalog.filter((c) => c.gym_id === null || c.gym_id === gymId);
  const needle = query.trim().toLowerCase();
  const matches = available.filter((c) => c.name.toLowerCase().includes(needle));
  const exact = available.find((c) => c.name.toLowerCase() === needle);
  const chosenType = EQUIPMENT.find((e) => e.value === newType) ?? EQUIPMENT[0];
  const gymName = gyms.find((g) => g.id === gymId)?.name;

  const urlFor = (id: string | null) => {
    const path = catalog.find((c) => c.id === id)?.photo_path;
    return path ? photoUrls[path] : undefined;
  };

  function clearPhoto() {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoBlob(null);
    setPhotoPreview(null);
  }

  function closePicker() {
    setPicking(false);
    setQuery("");
    clearPhoto();
  }

  async function onPhotoChosen(file: File | undefined) {
    if (!file) return;
    try {
      const blob = await compressPhoto(file);
      if (photoPreview) URL.revokeObjectURL(photoPreview);
      setPhotoBlob(blob);
      setPhotoPreview(URL.createObjectURL(blob));
    } catch (e) {
      setMessage({ kind: "error", text: explain(e instanceof Error ? e.message : null, "Could not read that photo.") });
    }
  }

  // Add or replace the photo of a machine that is already in the library.
  async function onExistingPhoto(file: File | undefined) {
    const id = photoTarget.current;
    photoTarget.current = null;
    if (!file || !id) return;
    try {
      const blob = await compressPhoto(file);
      const path = `${userId}/${id}.jpg`;
      const up = await uploadPhoto(db, path, blob);
      if (up.error) throw new Error(up.error);
      const upd = await db.from("exercises").update({ photo_path: path }).eq("id", id);
      if (upd.error) throw new Error(upd.error.message);
      setCatalog((all) => all.map((c) => (c.id === id ? { ...c, photo_path: path } : c)));
      const url = up.url;
      if (url) setPhotoUrls((m) => ({ ...m, [path]: url }));
      setMessage(null);
    } catch (e) {
      setMessage({ kind: "error", text: explain(e instanceof Error ? e.message : null, "Could not save the photo.") });
    }
  }

  function choosePhotoFor(exerciseId: string) {
    photoTarget.current = exerciseId;
    existingPhotoInput.current?.click();
  }

  // Start a new workout that copies a past one: same gym, exercises, order, setups and sets.
  function repeatWorkout(plan: RepeatPlan) {
    if (exercises.length > 0 && !window.confirm("This replaces the workout you are logging right now. Continue?")) {
      return;
    }
    const copied: Exercise[] = plan.exercises.map((p) => ({
      key: newId(),
      name: p.name,
      exerciseId: p.exerciseId,
      prevDate: plan.startedAt,
      setupId: p.setupId,
      sets: p.sets.map((s) => ({
        id: newId(),
        prevKg: s.kg,
        prevReps: s.reps,
        kg: s.kg,
        reps: s.reps,
        done: false,
        doneAt: null,
      })),
    }));
    setTitle(plan.name);
    if (plan.gymId && gyms.some((g) => g.id === plan.gymId)) setGymId(plan.gymId);
    setStartedAt(new Date().toISOString());
    setExercises(copied);
    setMessage({ kind: "ok", text: "Workout copied. Mark each set done as you go." });
    setView("log");
  }

  function setSetup(exKey: string, setupId: string | null) {
    setExercises((all) => all.map((ex) => (ex.key === exKey ? { ...ex, setupId } : ex)));
  }

  // The camera button: open the picker for a new machine and go straight to the camera.
  function startMachinePhoto() {
    setPicking(true);
    setNewType("pin_machine");
    photoInput.current?.click();
  }

  function addToWorkout(c: Catalog, past: PastSet[], prevDate: string | null, setupId: string | null = null) {
    // The clock starts when the first exercise goes in.
    if (exercises.length === 0) setStartedAt(new Date().toISOString());

    const sets: SetRow[] =
      past.length > 0
        ? past.map((p: PastSet) => ({
            id: newId(),
            prevKg: p.weight_kg == null ? null : Number(p.weight_kg),
            prevReps: p.reps,
            kg: p.weight_kg == null ? null : Number(p.weight_kg),
            reps: null,
            done: false,
            doneAt: null,
          }))
        : [{ id: newId(), prevKg: null, prevReps: null, kg: null, reps: null, done: false, doneAt: null }];

    setExercises((all) => [...all, { key: newId(), name: c.name, exerciseId: c.id, prevDate, setupId, sets }]);
  }

  async function pickExercise(c: Catalog) {
    closePicker();
    setMessage(null);
    const prev = await loadPrevious(db, userId, c.id);
    addToWorkout(c, prev.sets, prev.date, prev.setupId);
  }

  async function createExercise() {
    const name = query.trim();
    if (!name) return;
    if (exact) {
      await pickExercise(exact);
      return;
    }
    if (!chosenType.anyGym && !gymId) {
      setMessage({ kind: "error", text: "Pick a gym first. Machines are saved to the gym they are in." });
      return;
    }
    const { data, error } = await db
      .from("exercises")
      .insert({
        user_id: userId,
        name,
        equipment_type: chosenType.value,
        gym_id: chosenType.anyGym ? null : gymId,
      })
      .select("id,name,equipment_type,gym_id,photo_path")
      .single();
    if (error || !data) {
      setMessage({ kind: "error", text: explain(error?.message, "Could not create the exercise.") });
      return;
    }
    let made = data as Catalog;
    let photoProblem: string | null = null;
    if (photoBlob) {
      const path = `${userId}/${made.id}.jpg`;
      const up = await uploadPhoto(db, path, photoBlob);
      if (up.error) {
        photoProblem = `Saved, but the photo did not upload: ${up.error}`;
      } else {
        await db.from("exercises").update({ photo_path: path }).eq("id", made.id);
        made = { ...made, photo_path: path };
        const url = up.url;
        if (url) setPhotoUrls((m) => ({ ...m, [path]: url }));
      }
    }
    setCatalog((c) => [...c, made]);
    closePicker();
    setMessage(photoProblem ? { kind: "error", text: photoProblem } : null);
    addToWorkout(made, [], null);
  }

  function updateSet(exKey: string, setId: string, patch: Partial<SetRow>) {
    setExercises((all) =>
      all.map((ex) =>
        ex.key !== exKey ? ex : { ...ex, sets: ex.sets.map((s) => (s.id === setId ? { ...s, ...patch } : s)) },
      ),
    );
  }

  function addSet(exKey: string) {
    setExercises((all) =>
      all.map((ex) => {
        if (ex.key !== exKey) return ex;
        const last = ex.sets[ex.sets.length - 1];
        const next: SetRow = {
          id: newId(),
          prevKg: last?.kg ?? null,
          prevReps: last?.reps ?? null,
          kg: last?.kg ?? null,
          reps: null,
          done: false,
          doneAt: null,
        };
        return { ...ex, sets: [...ex.sets, next] };
      }),
    );
  }

  function removeSet(exKey: string, setId: string) {
    setExercises((all) =>
      all.map((ex) => (ex.key !== exKey ? ex : { ...ex, sets: ex.sets.filter((s) => s.id !== setId) })),
    );
  }

  function removeExercise(exKey: string) {
    setExercises((all) => all.filter((ex) => ex.key !== exKey));
  }

  function discardWorkout() {
    if (!confirmDiscard) {
      setConfirmDiscard(true);
      window.setTimeout(() => setConfirmDiscard(false), 4000);
      return;
    }
    setExercises([]);
    setTitle("Workout");
    setStartedAt(new Date().toISOString());
    setConfirmDiscard(false);
    setMessage(null);
  }

  async function finishWorkout() {
    const withDone = exercises.filter((ex) => ex.sets.some((s) => s.done));
    if (withDone.length === 0) {
      setMessage({ kind: "error", text: "Mark at least one set done before finishing." });
      return;
    }
    setSaving(true);
    setMessage(null);
    const finishedAt = new Date().toISOString();
    const workoutId = newId();

    // Drafts from before the picker existed may hold exercises that are not in the library yet.
    // Those need a connection to create; everything else can be saved with no signal.
    const idsByName = new Map<string, string>();
    for (const ex of withDone) {
      const known = ex.exerciseId ?? idsByName.get(ex.name);
      if (known) {
        idsByName.set(ex.name, known);
        continue;
      }
      const made = await db
        .from("exercises")
        .insert({ user_id: userId, name: ex.name, equipment_type: "free_weight", gym_id: null })
        .select("id")
        .single();
      if (made.error || !made.data) {
        setSaving(false);
        setMessage({ kind: "error", text: explain(made.error?.message, "Could not save an exercise.") });
        return;
      }
      idsByName.set(ex.name, (made.data as { id: string }).id);
    }

    const workout: OutboxWorkout = {
      id: workoutId,
      user_id: userId,
      gym_id: gymId || null,
      name: title.trim() || "Workout",
      started_at: startedAt,
      ended_at: finishedAt,
    };
    const sets: OutboxSet[] = withDone.flatMap((ex) =>
      ex.sets
        .filter((s) => s.done)
        .map((s, i) => ({
          id: s.id,
          user_id: userId,
          workout_id: workoutId,
          exercise_id: (ex.exerciseId ?? idsByName.get(ex.name)) as string,
          set_index: i,
          set_type: "working",
          weight_kg: s.kg,
          reps: s.reps,
          completed_at: s.doneAt ?? finishedAt,
          setup_id: ex.setupId ?? null,
        })),
    );

    // Save on this phone first. Only after that is the screen cleared, so nothing can be lost.
    if (!enqueue(userId, workout, sets)) {
      setSaving(false);
      setMessage({
        kind: "error",
        text: "Could not store the workout on this phone (storage is full or blocked). Your sets are still on screen, so try again.",
      });
      return;
    }
    setExercises([]);
    setTitle("Workout");
    setStartedAt(new Date().toISOString());
    setPending(loadOutbox(userId).length);

    const r = await flushOutbox(db, userId);
    setPending(r.left);
    setSaving(false);
    if (r.left === 0) {
      setMessage({ kind: "ok", text: "Workout saved." });
    } else {
      const err = loadOutbox(userId)[0]?.lastError;
      setMessage({
        kind: "ok",
        text:
          err && !looksLikeNetworkError(err) && !isOffline()
            ? `Saved on this phone, but syncing failed: ${err}. It will keep retrying.`
            : "Saved on this phone. It will sync when you have signal.",
      });
    }
  }

  const doneSets = exercises.flatMap((e) => e.sets).filter((s) => s.done);
  const volumeKg = doneSets.reduce((sum, s) => sum + (s.kg ?? 0) * (s.reps ?? 0), 0);

  const breakdown = exercises.map((ex) => {
    const done = ex.sets.filter((s) => s.done);
    return {
      key: ex.key,
      name: ex.name,
      count: done.length,
      volumeKg: done.reduce((sum, s) => sum + (s.kg ?? 0) * (s.reps ?? 0), 0),
      sets: done.map((s) => ({ id: s.id, kg: s.kg ?? 0, reps: s.reps ?? 0 })),
    };
  });

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col pb-28">
      <div className="flex items-center justify-between px-4 pt-4">
        <button
          type="button"
          onClick={toggleTheme}
          aria-label="Switch between light and dark mode"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink shadow-sm"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />
          </svg>
        </button>
        <button
          type="button"
          onClick={handleSignOut}
          className="h-11 truncate px-3 text-sm font-semibold text-muted"
          aria-label={`Sign out ${email}`}
        >
          Sign out
        </button>
        <div className="flex rounded-xl bg-line p-[3px]" role="group" aria-label="Weight unit">
          {(["lb", "kg"] as Unit[]).map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => chooseUnit(u)}
              aria-pressed={unit === u}
              className={`h-9 min-w-11 rounded-[10px] px-4 text-sm font-bold ${
                unit === u ? "bg-card text-ink" : "text-muted"
              }`}
            >
              {u}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-4 mt-4 flex rounded-xl bg-line p-[3px]" role="group" aria-label="Screen">
        {(["log", "history"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            aria-pressed={view === v}
            className={`h-10 flex-1 rounded-[10px] text-sm font-bold ${
              view === v ? "bg-card text-ink" : "text-muted"
            }`}
          >
            {v === "log" ? "Log" : "History"}
          </button>
        ))}
      </div>

      {(!online || pending > 0) && (
        <div
          role="status"
          className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-[14px] bg-tint px-4 py-3 text-[13px] font-semibold text-accent"
        >
          <span>
            {!online ? "Offline. Your sets are saved on this phone." : ""}
            {!online && pending > 0 ? " " : ""}
            {pending > 0 ? `${pending} ${pending === 1 ? "workout" : "workouts"} waiting to sync.` : ""}
          </span>
          {pending > 0 && online && (
            <button type="button" onClick={syncNow} disabled={syncing} className="shrink-0 font-bold underline">
              {syncing ? "Syncing..." : "Sync now"}
            </button>
          )}
        </div>
      )}

      {view === "history" && <History db={db} userId={userId} unit={unit} onRepeat={repeatWorkout} />}

      <header className={view === "log" ? "px-5 pt-4" : "hidden"}>
        <label htmlFor="title" className="sr-only">
          Workout name
        </label>
        <input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full bg-transparent text-[32px] font-extrabold leading-tight tracking-tight outline-none"
        />

        <div className="mt-3 rounded-[20px] bg-accent text-on-accent">
          <button
            type="button"
            onClick={() => setShowBreakdown((v) => !v)}
            aria-expanded={showBreakdown}
            aria-controls="volume-breakdown"
            className="flex w-full items-start justify-between gap-3 p-4 text-left"
          >
            <span>
              <span className="block text-xs font-bold uppercase tracking-wider opacity-80">Total weight lifted</span>
              <span className="mt-1 block text-[44px] font-extrabold leading-none tracking-tight">
                {Math.round(toDisplay(volumeKg, unit)).toLocaleString("en-US")}
                <span className="ml-1.5 text-xl font-bold opacity-80">{unit}</span>
              </span>
              <span className="mt-2 block text-sm font-semibold opacity-90">
                {doneSets.length} {doneSets.length === 1 ? "set" : "sets"} completed
                {active && ` · ${formatClock(now - Date.parse(startedAt))}`}
              </span>
            </span>
            <ChevronDown className={`mt-1 shrink-0 transition-transform ${showBreakdown ? "rotate-180" : ""}`} />
          </button>

          {showBreakdown && (
            <div id="volume-breakdown" className="mx-4 border-t border-on-accent/30 pb-4 pt-3">
              {doneSets.length === 0 ? (
                <p className="text-sm font-medium opacity-90">Complete a set to see the breakdown.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {breakdown
                    .filter((b) => b.count > 0)
                    .map((b) => (
                      <li key={b.key}>
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-sm font-bold">{b.name}</span>
                          <span className="text-sm font-extrabold">
                            {Math.round(toDisplay(b.volumeKg, unit)).toLocaleString("en-US")} {unit}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[13px] font-medium opacity-85">
                          {b.count} {b.count === 1 ? "set" : "sets"}
                          {" · "}
                          {b.sets.map((s) => `${formatWeight(s.kg, unit)} × ${s.reps}`).join(", ")}
                        </p>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="mt-4">
          <label htmlFor="gym" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted">
            Current gym
          </label>
          {addingGym ? (
            <div className="flex gap-2">
              <input
                id="gym"
                autoFocus
                value={newGym}
                onChange={(e) => setNewGym(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveGym();
                  if (e.key === "Escape") setAddingGym(false);
                }}
                placeholder="Gym name"
                className="h-11 min-w-0 flex-1 rounded-xl border-2 border-accent bg-card px-3 text-sm font-semibold outline-none"
              />
              <button type="button" onClick={saveGym} className="h-11 rounded-xl bg-accent px-4 text-sm font-bold text-on-accent">
                Save
              </button>
              <button type="button" onClick={() => setAddingGym(false)} className="h-11 rounded-xl bg-field px-3 text-sm font-bold text-muted">
                Cancel
              </button>
            </div>
          ) : (
            <div className="relative">
              <select
                id="gym"
                value={gymId}
                onChange={(e) => {
                  if (e.target.value === "__add__") setAddingGym(true);
                  else setGymId(e.target.value);
                }}
                className="h-11 w-full appearance-none rounded-full border border-line bg-card pl-4 pr-12 text-sm font-semibold text-ink"
              >
                <option value="">No gym selected</option>
                {gyms.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
                <option value="__add__">+ Add a gym</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-muted" />
            </div>
          )}
        </div>
      </header>

      <div className={view === "log" ? "mt-4 flex flex-col gap-3 px-4" : "hidden"}>
        {picking && (
          <section className="rounded-[20px] bg-card p-4 shadow-sm" aria-label="Add exercise">
            <label htmlFor="exercise-search" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted">
              Add exercise{gymName ? ` · ${gymName}` : ""}
            </label>
            <div className="flex gap-2">
              <input
                id="exercise-search"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") closePicker();
                  if (e.key === "Enter" && query.trim()) createExercise();
                }}
                placeholder="Search, or type a new name"
                className="h-11 min-w-0 flex-1 rounded-xl border-2 border-accent bg-card px-3 text-sm font-semibold outline-none"
              />
              <button type="button" onClick={closePicker} className="h-11 rounded-xl bg-field px-3 text-sm font-bold text-muted">
                Cancel
              </button>
            </div>

            {matches.length > 0 && (
              <ul className="mt-2 flex max-h-64 flex-col overflow-y-auto">
                {matches.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => pickExercise(c)}
                      className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-2 text-left hover:bg-field"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <Thumb url={urlFor(c.id)} />
                        <span className="truncate text-sm font-bold">{c.name}</span>
                      </span>
                      <span className="shrink-0 text-xs font-semibold text-muted">{equipmentLabel(c.equipment_type)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {available.length === 0 && !needle && (
              <p className="mt-3 text-sm font-medium text-muted">
                Nothing saved{gymName ? ` for ${gymName}` : ""} yet. Type a name to create your first exercise.
              </p>
            )}

            {needle && !exact && (
              <div className="mt-3 border-t border-line pt-3">
                <p className="text-sm font-bold">Create &ldquo;{query.trim()}&rdquo;</p>
                <label htmlFor="exercise-type" className="mb-1.5 mt-2 block text-xs font-bold uppercase tracking-wider text-muted">
                  Equipment
                </label>
                <div className="relative">
                  <select
                    id="exercise-type"
                    value={newType}
                    onChange={(e) => setNewType(e.target.value)}
                    className="h-11 w-full appearance-none rounded-xl border border-line bg-field pl-3 pr-10 text-sm font-semibold text-ink"
                  >
                    {EQUIPMENT.map((e) => (
                      <option key={e.value} value={e.value}>
                        {e.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
                </div>
                <p className="mt-1.5 text-[13px] font-medium text-muted">
                  {chosenType.anyGym
                    ? "Available at every gym."
                    : gymName
                      ? `Saved for ${gymName} only.`
                      : "Pick a gym first. Machines belong to one gym."}
                </p>
                <div className="mt-3 flex items-center gap-3">
                  {photoPreview ? (
                    <>
                      <Thumb url={photoPreview} size={56} />
                      <button type="button" onClick={clearPhoto} className="text-sm font-bold text-muted">
                        Remove photo
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => photoInput.current?.click()}
                      className="h-11 rounded-xl bg-field px-4 text-sm font-bold"
                    >
                      Add a photo (optional)
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={createExercise}
                  className="mt-3 h-11 w-full rounded-[14px] bg-accent text-sm font-bold text-on-accent"
                >
                  Create and add
                </button>
              </div>
            )}
          </section>
        )}

        {exercises.length === 0 && !picking && (
          <section className="rounded-[20px] bg-card p-5 text-center shadow-sm">
            <p className="text-base font-bold">No exercises yet</p>
            <p className="mt-1 text-sm font-medium text-muted">Tap Add exercise below to start logging.</p>
          </section>
        )}

        {exercises.map((ex) => (
          <section key={ex.key} className="rounded-[20px] bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  {ex.exerciseId && (
                    <button
                      type="button"
                      onClick={() => choosePhotoFor(ex.exerciseId as string)}
                      aria-label={urlFor(ex.exerciseId) ? `Replace photo of ${ex.name}` : `Add a photo of ${ex.name}`}
                      className="shrink-0"
                    >
                      {urlFor(ex.exerciseId) ? (
                        <Thumb url={urlFor(ex.exerciseId)} size={44} />
                      ) : (
                        <span className="flex h-11 w-11 items-center justify-center rounded-lg border-2 border-dashed border-line text-muted">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
                            <circle cx="12" cy="13" r="3.5" />
                          </svg>
                        </span>
                      )}
                    </button>
                  )}
                  <h2 className="text-[19px] font-extrabold leading-tight tracking-tight">{ex.name}</h2>
                </div>
                {ex.prevDate && (
                  <p className="mt-0.5 text-[13px] font-medium text-muted">Last time: {formatDate(ex.prevDate)}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => removeExercise(ex.key)}
                aria-label={`Remove ${ex.name}`}
                className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted hover:text-ink"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            {ex.exerciseId && (
              <SetupPanel
                db={db}
                userId={userId}
                exerciseId={ex.exerciseId}
                gymId={gymId}
                value={ex.setupId ?? null}
                onChange={(id) => setSetup(ex.key, id)}
              />
            )}

            {ex.sets.length > 0 && (
              <div className="mt-2">
                <div className="grid grid-cols-[28px_1fr_1fr_1fr_44px_36px] gap-2 px-0.5 text-xs font-bold text-muted">
                  <span>Set</span>
                  <span>Previous</span>
                  <span className="text-center">{unit}</span>
                  <span className="text-center">Reps</span>
                  <span />
                  <span />
                </div>
                {ex.sets.map((s, i) => (
                  <div key={s.id} className="mt-1.5 grid grid-cols-[28px_1fr_1fr_1fr_44px_36px] items-center gap-2">
                    <span className="text-base font-bold">{i + 1}</span>
                    <span className="text-sm font-medium text-muted">
                      {s.prevKg != null && s.prevReps != null
                        ? `${formatWeight(s.prevKg, unit)} × ${s.prevReps}`
                        : "-"}
                    </span>
                    <input
                      inputMode="decimal"
                      aria-label={`Weight in ${unit}, set ${i + 1}`}
                      value={s.kg == null ? "" : formatWeight(s.kg, unit)}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        updateSet(ex.key, s.id, { kg: Number.isNaN(v) ? null : fromDisplay(v, unit) });
                      }}
                      className="h-11 w-full rounded-xl border-2 border-transparent bg-field text-center text-[17px] font-bold outline-none focus:border-accent"
                    />
                    <input
                      inputMode="numeric"
                      aria-label={`Reps, set ${i + 1}`}
                      value={s.reps ?? ""}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        updateSet(ex.key, s.id, { reps: Number.isNaN(v) ? null : v });
                      }}
                      className="h-11 w-full rounded-xl border-2 border-transparent bg-field text-center text-[17px] font-bold outline-none focus:border-accent"
                    />
                    <button
                      type="button"
                      aria-label={`Set ${i + 1} ${s.done ? "done, tap to undo" : "mark done"}`}
                      aria-pressed={s.done}
                      onClick={() =>
                        updateSet(ex.key, s.id, {
                          done: !s.done,
                          doneAt: s.done ? null : new Date().toISOString(),
                        })
                      }
                      className={`flex h-11 w-11 items-center justify-center rounded-full ${
                        s.done ? "bg-done text-on-accent" : "bg-field text-muted"
                      }`}
                    >
                      <CheckIcon />
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove set ${i + 1}`}
                      onClick={() => removeSet(ex.key, s.id)}
                      className="flex h-11 w-9 items-center justify-center rounded-lg text-muted hover:text-ink"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => addSet(ex.key)}
              className="mt-3 h-11 w-full rounded-[14px] bg-tint text-sm font-bold text-accent"
            >
              Add set
            </button>
          </section>
        ))}

        {message && (
          <p
            role={message.kind === "error" ? "alert" : "status"}
            className={`px-1 text-sm font-semibold ${message.kind === "error" ? "text-red-600" : "text-done"}`}
          >
            {message.text}
          </p>
        )}

        {exercises.length > 0 && (
          <>
            <button
              type="button"
              onClick={finishWorkout}
              disabled={saving}
              className="h-12 w-full rounded-[14px] bg-done text-base font-bold text-on-accent disabled:opacity-60"
            >
              {saving ? "Saving..." : "Finish workout"}
            </button>
            <button type="button" onClick={discardWorkout} className="h-11 w-full text-sm font-bold text-muted">
              {confirmDiscard ? "Tap again to discard this workout" : "Discard workout"}
            </button>
          </>
        )}
      </div>

      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          onPhotoChosen(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      <input
        ref={existingPhotoInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          onExistingPhoto(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      <nav
        className={`fixed inset-x-4 bottom-6 mx-auto max-w-md items-center gap-2 rounded-full bg-ink p-2 shadow-lg ${
          view === "log" ? "flex" : "hidden"
        }`}
        aria-label="Workout actions"
      >
        <button type="button" onClick={() => setPicking(true)} className="h-12 flex-1 text-base font-bold text-bg">
          + Add exercise
        </button>
        <button
          type="button"
          aria-label="Add new machine with a photo"
          onClick={startMachinePhoto}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-on-accent"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
            <circle cx="12" cy="13" r="3.5" />
          </svg>
        </button>
      </nav>
    </main>
  );
}

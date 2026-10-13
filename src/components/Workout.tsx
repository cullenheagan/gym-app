"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Unit, formatWeight, fromDisplay, toDisplay } from "@/lib/units";
import { formatClock, formatDate } from "@/lib/format";
import { suggest } from "@/lib/suggest";
import {
  type Kind,
  QUICK_ADD,
  describeSet,
  distFromDisplay,
  distToDisplay,
  distUnit,
  fmtPace,
  fmtSeconds,
  kindLabel,
  kindOf,
  minToSec,
  secToMin,
} from "@/lib/kinds";
import { normName } from "@/lib/history-filter";
import { workoutNameChips } from "@/lib/workout-names";
import Home from "./Home";
import NumField from "./NumField";
import GymPicker from "./GymPicker";
import BottomBar, { type Section } from "./BottomBar";
import Settings, { type ThemeChoice } from "./Settings";
import Avatar from "./Avatar";
import { avatarKey, avatarPath, clearPending, compressAvatar, dataUrlToBlob, takePending } from "@/lib/avatar";
import Progress from "./Progress";
import History, { type RepeatPlan } from "./History";
import SetupPanel from "./SetupPanel";
import Gyms from "./Gyms";
import { EQUIPMENT, equipmentLabel } from "@/lib/equipment";
import type { Gym } from "@/lib/types";
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
  warmup?: boolean; // warm-up sets are saved but left out of totals, progress and suggestions
  // Cardio, intervals and sport sets (optional; strength sets and older drafts lack them)
  durationS?: number | null;
  distanceM?: number | null;
  rpe?: number | null;
  prevDurationS?: number | null;
  prevDistanceM?: number | null;
  prevRpe?: number | null;
};

type Exercise = {
  key: string;
  name: string;
  exerciseId: string | null; // null only for drafts saved before exercises were picked from a list
  prevDate: string | null; // when this exercise was last logged
  setupId?: string | null; // bench / seat setup used (optional; older drafts lack it)
  kind?: Kind; // missing on older drafts, which were all strength
  supersetId?: string | null; // two exercises sharing this id are a superset (a pair)
  suggestion?: { kg: number; reps: number; hit: boolean; lastKg: number } | null;
  sets: SetRow[];
};


// An exercise in the account's library. gym_id null means it is available at every gym.
type Catalog = {
  id: string;
  name: string;
  equipment_type: string;
  gym_id: string | null;
  photo_path: string | null;
  archived_at?: string | null; // removed from your lists; history is kept
  kind?: string | null; // strength, cardio, intervals or sport
};

type PastSet = {
  workout_id: string;
  set_index: number;
  weight_kg: number | null;
  reps: number | null;
  completed_at: string | null;
  setup_id: string | null;
  set_type?: string | null;
  duration_s?: number | null;
  distance_m?: number | null;
  rpe?: number | null;
};

const newId = () => crypto.randomUUID();

// A new empty set that remembers the last row for its Previous column.
function blankLike(last: SetRow | undefined, strength: boolean): SetRow {
  return {
    id: newId(),
    prevKg: last?.kg ?? null,
    prevReps: last?.reps ?? null,
    kg: strength ? (last?.kg ?? null) : null,
    reps: null,
    prevDurationS: strength ? null : (last?.durationS ?? last?.prevDurationS ?? null),
    prevDistanceM: strength ? null : (last?.distanceM ?? last?.prevDistanceM ?? null),
    prevRpe: strength ? null : (last?.rpe ?? last?.prevRpe ?? null),
    done: false,
    doneAt: null,
  };
}

// In a superset round n holds set n of both exercises, so both need the same number of rows.
function padSets(ex: Exercise, n: number): Exercise {
  if (ex.sets.length >= n) return ex;
  const sets = [...ex.sets];
  while (sets.length < n) sets.push(blankLike(sets[sets.length - 1], kindOf(ex.kind) === "strength"));
  return { ...ex, sets };
}

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

// Smallest jump offered when suggesting a heavier weight: 5 lb or 2.5 kg, in kg.
const stepKg = (unit: Unit) => (unit === "kg" ? 2.5 : 5 / 2.20462262);

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
    .filter((st) => st.workout_id === workoutId && st.exercise_id === exerciseId && st.set_type !== "warmup")
    .map((st) => ({
      workout_id: st.workout_id,
      set_index: st.set_index,
      weight_kg: st.weight_kg,
      reps: st.reps,
      completed_at: st.completed_at,
      setup_id: st.setup_id,
      set_type: st.set_type,
      duration_s: st.duration_s ?? null,
      distance_m: st.distance_m ?? null,
      rpe: st.rpe ?? null,
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
    .select("workout_id,set_index,weight_kg,reps,completed_at,setup_id,set_type,duration_s,distance_m,rpe")
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
        .filter((r: PastSet) => r.workout_id === last && r.set_type !== "warmup")
        .map((r: PastSet) => ({ ...r, reps: r.reps == null ? null : Number(r.reps) }))
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
  const [workoutKind, setWorkoutKind] = useState<Kind>("strength");
  const [startedAt, setStartedAt] = useState(() => new Date().toISOString());
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [allGyms, setAllGyms] = useState<Gym[]>([]);
  const [gymsLoaded, setGymsLoaded] = useState(false);
  // Removed gyms stay in allGyms (they keep their history) but leave the dropdown.
  const gyms = allGyms.filter((g) => !g.archived_at);
  const [gymId, setGymId] = useState("");
  const [catalog, setCatalog] = useState<Catalog[]>([]);
  const [addingGym, setAddingGym] = useState(false);
  const [gymUrls, setGymUrls] = useState<Record<string, string>>({});
  const [newGym, setNewGym] = useState("");
  const [picking, setPicking] = useState(false);
  const [supersetFor, setSupersetFor] = useState<string | null>(null); // key of the exercise the picker is choosing a partner for
  const [query, setQuery] = useState("");
  const [newType, setNewType] = useState<string>("free_weight");
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const photoInput = useRef<HTMLInputElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const existingPhotoInput = useRef<HTMLInputElement>(null);
  const photoTarget = useRef<string | null>(null);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [view, setView] = useState<"home" | "log" | "history" | "gyms" | "progress" | "settings">("home");
  const [displayName, setDisplayName] = useState(() => {
    try {
      return localStorage.getItem(`name:${userId}`) ?? "";
    } catch {
      return "";
    }
  });
  // Suggested names: up to four you have used before (most used first), then the usual splits.
  const nameChips = useMemo(
    () => workoutNameChips(readCache<{ name: string; kind?: string }[]>(cacheKey(userId, "home")) ?? [], workoutKind),
    // Recomputed when the log screen opens so a just-finished workout's name is included.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userId, view, workoutKind],
  );
  // The "tap a set number" hint goes away for good once you have marked a warm-up.
  const [warmupHintSeen, setWarmupHintSeen] = useState(() => {
    try {
      return localStorage.getItem("hint:warmup") === "1";
    } catch {
      return false;
    }
  });
  const [avatar, setAvatar] = useState<string | null>(() => {
    try {
      return localStorage.getItem(avatarKey(userId));
    } catch {
      return null;
    }
  });
  // An empty workout counts as in progress from the moment Start workout is tapped.
  const [workoutStarted, setWorkoutStarted] = useState(false);
  // The Train sub-tab to come back to when the Train button is tapped.
  const [trainTab, setTrainTab] = useState<"log" | "history" | "gyms" | "progress">("log");
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
          kind?: string;
        };
        if (Array.isArray(d.exercises)) setExercises(d.exercises);
        if (d.kind) setWorkoutKind(kindOf(d.kind));
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
      else localStorage.setItem(draftKey, JSON.stringify({ title, startedAt, gymId, exercises, kind: workoutKind }));
    } catch {}
  }, [draftReady, draftKey, title, startedAt, gymId, exercises, workoutKind]);

  // The workout clock ticks while there is something in the workout.
  const active = exercises.length > 0;
  const inProgress = active || workoutStarted;
  const logOpen = view === "log" && inProgress;
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
      setAllGyms(savedGyms);
      const firstActive = savedGyms.find((g) => !g.archived_at);
      if (firstActive) setGymId((cur) => cur || firstActive.id);
    }
    const savedCatalog = readCache<Catalog[]>(cacheKey(userId, "catalog"));
    if (savedCatalog) setCatalog(savedCatalog);

    let cancelled = false;
    (async () => {
      // Newer columns may not exist until their migration is run; fall back to what does.
      let profile: { data: Record<string, unknown> | null } = { data: null };
      for (const cols of ["unit,display_name,avatar_path", "unit,display_name", "unit"]) {
        const r = await db.from("profiles").select(cols).eq("id", userId).maybeSingle();
        if (!r.error) {
          profile = { data: r.data as Record<string, unknown> | null };
          break;
        }
      }
      if (!cancelled && profile.data && (profile.data.unit === "lb" || profile.data.unit === "kg")) {
        setUnit(profile.data.unit as Unit);
      }
      let nm = typeof profile.data?.display_name === "string" ? (profile.data.display_name as string) : "";
      let path = typeof profile.data?.avatar_path === "string" ? (profile.data.avatar_path as string) : "";

      // Details typed on the sign-up form are saved here the first time you sign in.
      if (profile.data && (!nm || !path)) {
        const pending = takePending(email);
        const meta = (await db.auth.getUser()).data.user?.user_metadata as { display_name?: string } | undefined;
        const patch: Record<string, string> = {};
        const wantName = nm ? "" : (pending?.name || meta?.display_name || "").trim();
        if (wantName) patch.display_name = wantName;
        if (!path && pending?.avatar) {
          const blob = dataUrlToBlob(pending.avatar);
          if (blob) {
            const up = await uploadPhoto(db, avatarPath(userId), blob);
            if (!up.error) patch.avatar_path = avatarPath(userId);
            if (!cancelled && !up.error) {
              setAvatar(pending.avatar);
              try {
                localStorage.setItem(avatarKey(userId), pending.avatar);
              } catch {}
            }
          }
        }
        if (Object.keys(patch).length > 0) {
          const upd = await db.from("profiles").update(patch).eq("id", userId);
          if (!upd.error) {
            nm = patch.display_name ?? nm;
            path = patch.avatar_path ?? path;
            clearPending(email);
          }
        } else if (pending) {
          clearPending(email);
        }
      }
      if (!cancelled && nm) {
        setDisplayName(nm);
        try {
          localStorage.setItem(`name:${userId}`, nm);
        } catch {}
      }
      // On a phone that has no saved copy of the photo yet, show it from storage.
      if (!cancelled && path) {
        const signed = await db.storage.from("equipment-photos").createSignedUrl(path, 3600);
        const url = signed.data?.signedUrl;
        if (url) setAvatar((cur) => cur ?? url);
      }
      const full = await db
        .from("gyms")
        .select("id,name,photo_path,archived_at")
        .order("created_at", { ascending: true });
      let gymRows = full.error ? null : (full.data as Gym[] | null);
      // Until the latest database update is run, those two columns do not exist yet.
      if (full.error && /photo_path|archived_at/.test(full.error.message)) {
        const basic = await db.from("gyms").select("id,name").order("created_at", { ascending: true });
        gymRows = basic.error ? null : (basic.data as Gym[] | null);
      }
      if (!cancelled && gymRows) {
        const list = gymRows;
        writeCache(cacheKey(userId, "gyms"), list);
        setAllGyms(list);
        const firstActive = list.find((g) => !g.archived_at);
        if (firstActive) setGymId((cur) => cur || firstActive.id);
        setGymsLoaded(true);
      }
      const catFull = await db
        .from("exercises")
        .select("id,name,equipment_type,gym_id,photo_path,archived_at,kind")
        .order("name", { ascending: true });
      let catRows = catFull.error ? null : (catFull.data as Catalog[] | null);
      // Until migration 0009 is run the column does not exist; fall back so nothing breaks.
      if (catFull.error && /archived_at/.test(catFull.error.message)) {
        const basic = await db
          .from("exercises")
          .select("id,name,equipment_type,gym_id,photo_path")
          .order("name", { ascending: true });
        catRows = basic.error ? null : (basic.data as Catalog[] | null);
      }
      if (!cancelled && catRows) {
        const list = catRows;
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

  // Temporary links to the gym photos, for the gym menu (they live in a private bucket).
  const gymPhotoKey = allGyms.map((g) => g.photo_path ?? "").join("|");
  useEffect(() => {
    const paths = allGyms.map((g) => g.photo_path).filter((p): p is string => !!p);
    if (paths.length === 0) return;
    let cancelled = false;
    (async () => {
      const signed = await db.storage.from("equipment-photos").createSignedUrls(paths, 3600);
      if (cancelled || !signed.data) return;
      const map: Record<string, string> = {};
      for (const row of signed.data) if (row.path && row.signedUrl) map[row.path] = row.signedUrl;
      setGymUrls((cur) => ({ ...cur, ...map }));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, gymPhotoKey]);

  // Keep the saved copy of the gym list current when gyms are added, photographed or removed.
  useEffect(() => {
    if (gymsLoaded) writeCache(cacheKey(userId, "gyms"), allGyms);
  }, [gymsLoaded, allGyms, userId]);

  // If the selected gym was removed (here or from the Gyms tab), switch to another one.
  useEffect(() => {
    if (!gymsLoaded || !gymId) return;
    if (!gyms.some((g) => g.id === gymId)) setGymId(gyms[0]?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gymsLoaded, allGyms, gymId]);

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

  async function saveName(name: string): Promise<string | null> {
    const { error } = await db.from("profiles").update({ display_name: name || null }).eq("id", userId);
    if (error) return explain(error.message, "Could not save your name.");
    setDisplayName(name);
    try {
      localStorage.setItem(`name:${userId}`, name);
    } catch {}
    return null;
  }

  function chooseTheme(t: ThemeChoice) {
    setTheme(t);
    if (t === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
    try {
      if (t === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", t);
    } catch {}
  }

  async function savePhoto(file: File): Promise<string | null> {
    try {
      const { blob, dataUrl } = await compressAvatar(file);
      const up = await uploadPhoto(db, avatarPath(userId), blob);
      if (up.error) return explain(up.error, "Could not save your photo.");
      const upd = await db.from("profiles").update({ avatar_path: avatarPath(userId) }).eq("id", userId);
      if (upd.error) {
        return /avatar_path/.test(upd.error.message)
          ? "Saving a photo needs migration 0010 in the Supabase SQL Editor first."
          : explain(upd.error.message, "Could not save your photo.");
      }
      setAvatar(dataUrl);
      try {
        localStorage.setItem(avatarKey(userId), dataUrl);
      } catch {}
      return null;
    } catch (e) {
      return explain(e instanceof Error ? e.message : null, "Could not read that photo.");
    }
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
    setAllGyms((g) => [...g, gym]);
    setGymId(gym.id);
    setNewGym("");
    setAddingGym(false);
  }

  // Exercises you can pick right now: this gym's equipment plus anything that works anywhere.
  const available = catalog.filter(
    (c) => !c.archived_at && kindOf(c.kind) === workoutKind && (c.gym_id === null || c.gym_id === gymId),
  );
  const needle = query.trim().toLowerCase();
  const matches = available.filter((c) => c.name.toLowerCase().includes(needle));
  const exact = available.find((c) => c.name.toLowerCase() === needle);
  const chosenType =
    workoutKind === "strength"
      ? (EQUIPMENT.find((e) => e.value === newType) ?? EQUIPMENT[0])
      : { value: "other", label: "Other", anyGym: true };
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
    setSupersetFor(null);
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
    // Rebuild superset pairs exactly: only a pair of two exercises sharing an id counts.
    const pairCount = new Map<string, number>();
    for (const p of plan.exercises) if (p.supersetId) pairCount.set(p.supersetId, (pairCount.get(p.supersetId) ?? 0) + 1);
    const newPairId = new Map<string, string>();
    const copiedRaw: Exercise[] = plan.exercises.map((p) => ({
      key: newId(),
      name: p.name,
      exerciseId: p.exerciseId,
      prevDate: plan.startedAt,
      setupId: p.setupId,
      kind: kindOf(plan.kind),
      supersetId:
        p.supersetId && pairCount.get(p.supersetId) === 2
          ? (newPairId.get(p.supersetId) ?? (newPairId.set(p.supersetId, newId()), newPairId.get(p.supersetId)!))
          : null,
      suggestion:
        kindOf(plan.kind) === "strength"
          ? suggest(
              p.sets.filter((s) => !s.warmup),
              stepKg(unit),
            )
          : null,
      sets: p.sets.map((s) => ({
        id: newId(),
        prevKg: s.kg,
        prevReps: s.reps,
        kg: s.kg,
        reps: s.reps,
        done: false,
        doneAt: null,
        warmup: s.warmup || undefined,
        prevDurationS: s.durationS ?? null,
        prevDistanceM: s.distanceM ?? null,
        prevRpe: s.rpe ?? null,
        durationS: kindOf(plan.kind) === "strength" ? null : (s.durationS ?? null),
        distanceM: kindOf(plan.kind) === "strength" ? null : (s.distanceM ?? null),
        rpe: kindOf(plan.kind) === "strength" ? null : (s.rpe ?? null),
      })),
    }));
    // Put each partner right after its first half and give both the same number of rounds.
    const copied: Exercise[] = [];
    const placed = new Set<Exercise>();
    for (const ex of copiedRaw) {
      if (placed.has(ex)) continue;
      placed.add(ex);
      const mate = ex.supersetId ? copiedRaw.find((o) => o !== ex && o.supersetId === ex.supersetId) : undefined;
      if (!mate) {
        copied.push(ex);
        continue;
      }
      placed.add(mate);
      const rounds = Math.max(ex.sets.length, mate.sets.length);
      copied.push(padSets(ex, rounds), padSets(mate, rounds));
    }
    setTitle(plan.name);
    setWorkoutKind(kindOf(plan.kind));
    if (plan.gymId && gyms.some((g) => g.id === plan.gymId)) setGymId(plan.gymId);
    setStartedAt(new Date().toISOString());
    setExercises(copied);
    setMessage({ kind: "ok", text: "Workout copied. Mark each set done as you go." });
    setView("log");
  }

  // Begin an empty workout and open the log screen.
  function startWorkout(kind: Kind = "strength") {
    setWorkoutKind(kind);
    setWorkoutStarted(true);
    setStartedAt(new Date().toISOString());
    setMessage(null);
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
    const kind = kindOf(c.kind ?? workoutKind);

    const blank = (): SetRow => ({
      id: newId(),
      prevKg: null,
      prevReps: null,
      kg: null,
      reps: null,
      done: false,
      doneAt: null,
    });
    const sets: SetRow[] =
      past.length > 0
        ? past.map((p: PastSet) => ({
            id: newId(),
            prevKg: p.weight_kg == null ? null : Number(p.weight_kg),
            prevReps: p.reps,
            kg: kind === "strength" && p.weight_kg != null ? Number(p.weight_kg) : null,
            reps: null,
            prevDurationS: p.duration_s ?? null,
            prevDistanceM: p.distance_m == null ? null : Number(p.distance_m),
            prevRpe: p.rpe == null ? null : Number(p.rpe),
            done: false,
            doneAt: null,
          }))
        : [blank()];

    const sg =
      kind === "strength"
        ? suggest(
            past.map((p) => ({ kg: p.weight_kg == null ? null : Number(p.weight_kg), reps: p.reps == null ? null : Number(p.reps) })),
            stepKg(unit),
          )
        : null;
    const added: Exercise = { key: newId(), name: c.name, exerciseId: c.id, prevDate, setupId, kind, suggestion: sg, sets };
    const partnerKey = supersetFor;
    setExercises((all) => {
      const at = partnerKey ? all.findIndex((e) => e.key === partnerKey) : -1;
      if (at < 0) return [...all, added];
      // Pair it with the exercise it was picked for and put it right after, with matching rounds.
      const id = all[at].supersetId ?? newId();
      const rounds = Math.max(all[at].sets.length, added.sets.length);
      const first = padSets({ ...all[at], supersetId: id }, rounds);
      const second = padSets({ ...added, supersetId: id }, rounds);
      return [...all.slice(0, at), first, second, ...all.slice(at + 1)];
    });
    setSupersetFor(null);
  }

  // The Superset? button: choose the second exercise from the picker.
  function startSuperset(exKey: string) {
    setSupersetFor(exKey);
    setPicking(true);
    setMessage(null);
  }

  // Break a superset back into two normal exercises (nothing is deleted).
  function unlinkSuperset(exKey: string) {
    setExercises((all) => {
      const id = all.find((e) => e.key === exKey)?.supersetId;
      return id ? all.map((e) => (e.supersetId === id ? { ...e, supersetId: null } : e)) : all;
    });
  }

  async function pickExercise(c: Catalog) {
    closePicker();
    setMessage(null);
    const prev = await loadPrevious(db, userId, c.id);
    addToWorkout(c, prev.sets, prev.date, prev.setupId);
  }

  // Tap-to-add for cardio, intervals and sport: creates the exercise (or brings a removed one back) and adds it.
  async function addQuick(name: string) {
    setQuery(name);
    await createExercise(name);
  }

  async function createExercise(typed?: string) {
    const name = (typed ?? query).trim();
    if (!name) return;
    const existing =
      typed != null ? available.find((c) => c.name.toLowerCase() === name.toLowerCase()) : exact;
    if (existing) {
      await pickExercise(existing);
      return;
    }
    const removedSame = catalog.find(
      (c) => c.archived_at && kindOf(c.kind) === workoutKind && c.name.toLowerCase() === name.toLowerCase() && (c.gym_id === null || c.gym_id === gymId),
    );
    if (removedSame) {
      const res = await db.from("exercises").update({ archived_at: null }).eq("id", removedSame.id);
      if (res.error) {
        setMessage({ kind: "error", text: explain(res.error.message, "Could not bring that machine back.") });
        return;
      }
      const revived = { ...removedSame, archived_at: null };
      setCatalog((all) => all.map((c) => (c.id === revived.id ? revived : c)));
      await pickExercise(revived);
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
        kind: workoutKind,
      })
      .select("id,name,equipment_type,gym_id,photo_path,archived_at,kind")
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

  function toggleWarmup(exKey: string, setId: string, warmup: boolean) {
    updateSet(exKey, setId, { warmup });
    if (warmup && !warmupHintSeen) {
      setWarmupHintSeen(true);
      try {
        localStorage.setItem("hint:warmup", "1");
      } catch {}
    }
  }

  function updateSet(exKey: string, setId: string, patch: Partial<SetRow>) {
    setExercises((all) =>
      all.map((ex) =>
        ex.key !== exKey ? ex : { ...ex, sets: ex.sets.map((s) => (s.id === setId ? { ...s, ...patch } : s)) },
      ),
    );
  }

  // Fill every working set that is not done yet with the suggested weight and reps.
  function applySuggestion(exKey: string) {
    setExercises((all) =>
      all.map((ex) => {
        if (ex.key !== exKey || !ex.suggestion) return ex;
        const { kg, reps } = ex.suggestion;
        return { ...ex, sets: ex.sets.map((s) => (s.done || s.warmup ? s : { ...s, kg, reps })) };
      }),
    );
  }

  // In a superset a new set is a new round: it is added to both exercises.
  function addSet(exKey: string) {
    setExercises((all) => {
      const id = all.find((e) => e.key === exKey)?.supersetId;
      return all.map((ex) => {
        const inPair = id ? ex.supersetId === id : false;
        if (ex.key !== exKey && !inPair) return ex;
        const next = blankLike(ex.sets[ex.sets.length - 1], kindOf(ex.kind) === "strength");
        return { ...ex, sets: [...ex.sets, next] };
      });
    });
  }

  // In a superset, removing a set removes that round from both exercises.
  function removeSet(exKey: string, setId: string) {
    setExercises((all) => {
      const me = all.find((e) => e.key === exKey);
      const idx = me ? me.sets.findIndex((s) => s.id === setId) : -1;
      const id = me?.supersetId;
      return all.map((ex) => {
        if (ex.key === exKey) return { ...ex, sets: ex.sets.filter((s) => s.id !== setId) };
        if (id && ex.supersetId === id && idx >= 0) return { ...ex, sets: ex.sets.filter((_, k) => k !== idx) };
        return ex;
      });
    });
  }

  // Removing one half of a superset leaves the other as a normal exercise.
  function removeExercise(exKey: string) {
    setExercises((all) => {
      const id = all.find((e) => e.key === exKey)?.supersetId;
      return all.filter((ex) => ex.key !== exKey).map((ex) => (id && ex.supersetId === id ? { ...ex, supersetId: null } : ex));
    });
  }

  function discardWorkout() {
    // With nothing logged there is nothing to lose, so cancel straight away.
    if (exercises.length > 0 && !confirmDiscard) {
      setConfirmDiscard(true);
      window.setTimeout(() => setConfirmDiscard(false), 4000);
      return;
    }
    setExercises([]);
    setWorkoutStarted(false);
    setWorkoutKind("strength");
    setTitle("Workout");
    setStartedAt(new Date().toISOString());
    setConfirmDiscard(false);
    setMessage(null);
    setView("home");
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
      kind: workoutKind,
    };
    // Only keep the superset link when both exercises actually have sets to save.
    const pairedIds = new Set(
      withDone.filter((ex) => ex.supersetId && withDone.filter((o) => o.supersetId === ex.supersetId).length === 2).map((ex) => ex.supersetId as string),
    );
    const sets: OutboxSet[] = withDone.flatMap((ex) =>
      ex.sets
        .filter((s) => s.done)
        .map((s, i) => ({
          id: s.id,
          user_id: userId,
          workout_id: workoutId,
          exercise_id: (ex.exerciseId ?? idsByName.get(ex.name)) as string,
          set_index: i,
          set_type: s.warmup ? "warmup" : "working",
          weight_kg: s.kg,
          reps: s.reps,
          duration_s: s.durationS ?? null,
          distance_m: s.distanceM ?? null,
          rpe: s.rpe ?? null,
          completed_at: s.doneAt ?? finishedAt,
          setup_id: ex.setupId ?? null,
          superset_id: ex.supersetId && pairedIds.has(ex.supersetId) ? ex.supersetId : null,
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
    setWorkoutStarted(false);
    setWorkoutKind("strength");
    setTitle("Workout");
    setStartedAt(new Date().toISOString());
    setPending(loadOutbox(userId).length);
    setView("home");

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

  // What the summary card shows depends on the workout type.
  const doneSets = exercises.flatMap((e) => e.sets).filter((s) => s.done && !s.warmup);
  const volumeKg = doneSets.reduce((sum, s) => sum + (s.kg ?? 0) * (s.reps ?? 0), 0);
  const totalSeconds = doneSets.reduce((sum, s) => sum + (s.durationS ?? 0), 0);
  const totalMeters = doneSets.reduce((sum, s) => sum + (s.distanceM ?? 0), 0);
  const effortSets = doneSets.filter((s) => s.rpe != null);
  const avgEffort = effortSets.length ? effortSets.reduce((sum, s) => sum + (s.rpe ?? 0), 0) / effortSets.length : null;
  // A superset is two exercises that share a supersetId; the partner is the other one.
  const partnerOf = (ex: Exercise): Exercise | null =>
    ex.supersetId ? (exercises.find((o) => o.key !== ex.key && o.supersetId === ex.supersetId) ?? null) : null;

  const exHeader = (ex: Exercise, tag?: string) => (
    <>
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
            {tag && (
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-tint text-xs font-extrabold text-accent">
                {tag}
              </span>
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

      {!tag && kindOf(ex.kind) === "strength" && (
        <button
          type="button"
          onClick={() => startSuperset(ex.key)}
          className="mt-3 h-9 rounded-[10px] border-2 border-dashed border-accent px-3 text-xs font-extrabold text-accent"
        >
          Superset?
        </button>
      )}

      {ex.suggestion && ex.sets.some((x) => !x.done && !x.warmup) && (
        <button
          type="button"
          onClick={() => applySuggestion(ex.key)}
          className="mt-3 w-full rounded-[14px] bg-tint px-4 py-2.5 text-left"
        >
          <span className="block text-sm font-extrabold text-accent">
            Try {formatWeight(ex.suggestion.kg, unit)} {unit} × {ex.suggestion.reps}
          </span>
          <span className="block text-xs text-muted">
            {ex.suggestion.hit
              ? `You hit your reps at ${formatWeight(ex.suggestion.lastKg, unit)} ${unit} last time. Tap to fill your sets.`
              : `Some sets fell short at ${formatWeight(ex.suggestion.lastKg, unit)} ${unit} last time, so stay here. Tap to fill your sets.`}
          </span>
        </button>
      )}
    </>
  );

  const setRow = (ex: Exercise, s: SetRow, i: number, suffix: string) => {
    const num = ex.sets.slice(0, i + 1).filter((x) => !x.warmup).length;
    return (
    <div
      key={s.id}
      className={`mt-1.5 grid ${suffix ? "grid-cols-[36px_1fr_1fr_1fr_44px_36px]" : "grid-cols-[28px_1fr_1fr_1fr_44px_36px]"} items-center gap-2 ${
        s.warmup ? "rounded-xl bg-tint" : ""
      }`}
    >
      {kindOf(ex.kind) !== "strength" ? (
        <span className={`flex h-8 items-center justify-center rounded-full bg-field text-base font-bold ${suffix ? "w-9" : "w-7"}`}>
          {i + 1}{suffix}
        </span>
      ) : (
      <button
        type="button"
        onClick={() => toggleWarmup(ex.key, s.id, !s.warmup)}
        aria-label={
          s.warmup
            ? "Warm-up set. Tap to make it a working set"
            : `Working set ${num}${suffix}. Tap to make it a warm-up`
        }
        className={`h-8 rounded-full text-base font-bold ${suffix ? "w-9" : "w-7"} ${s.warmup ? "bg-accent text-on-accent" : "bg-field"}`}
      >
        {s.warmup ? "W" : `${num}${suffix}`}
      </button>
      )}
      <span className="text-sm font-medium text-muted">
        {kindOf(ex.kind) !== "strength"
          ? describeSet(
              kindOf(ex.kind),
              {
                kg: null,
                reps: null,
                durationS: s.prevDurationS ?? null,
                distanceM: s.prevDistanceM ?? null,
                rpe: s.prevRpe ?? null,
              },
              unit,
              String,
            )
          : !s.warmup && s.prevKg != null && s.prevReps != null
            ? `${formatWeight(s.prevKg, unit)} × ${s.prevReps}`
            : "-"}
      </span>
      {kindOf(ex.kind) === "strength" ? (
        <>
          <NumField
            ariaLabel={`Weight in ${unit}, set ${i + 1}`}
            value={s.kg == null ? null : toDisplay(s.kg, unit)}
            onChange={(v) => updateSet(ex.key, s.id, { kg: v == null ? null : fromDisplay(v, unit) })}
          />
          <NumField
            ariaLabel={`Reps, set ${i + 1} (decimals like 8.5 allowed)`}
            max={999}
            value={s.reps ?? null}
            onChange={(v) => updateSet(ex.key, s.id, { reps: v == null ? null : Math.round(v * 100) / 100 })}
          />
        </>
      ) : kindOf(ex.kind) === "intervals" ? (
        <>
          <NumField
            integer
            ariaLabel={`Seconds, round ${i + 1}`}
            value={s.durationS ?? null}
            onChange={(v) => updateSet(ex.key, s.id, { durationS: v })}
          />
          <NumField
            integer
            ariaLabel={`Reps, round ${i + 1} (optional)`}
            value={s.reps ?? null}
            onChange={(v) => updateSet(ex.key, s.id, { reps: v })}
          />
        </>
      ) : (
        <>
          <NumField
            ariaLabel={`Minutes, entry ${i + 1}`}
            value={s.durationS == null ? null : secToMin(s.durationS)}
            onChange={(v) => updateSet(ex.key, s.id, { durationS: v == null ? null : minToSec(v) })}
          />
          {kindOf(ex.kind) === "cardio" ? (
            <NumField
              ariaLabel={`Distance in ${distUnit(unit)}, entry ${i + 1}`}
              value={s.distanceM == null ? null : distToDisplay(s.distanceM, unit)}
              onChange={(v) =>
                updateSet(ex.key, s.id, { distanceM: v == null ? null : distFromDisplay(v, unit) })
              }
            />
          ) : (
            <NumField
              integer
              max={10}
              ariaLabel={`Effort 1 to 10, entry ${i + 1}`}
              value={s.rpe ?? null}
              onChange={(v) => updateSet(ex.key, s.id, { rpe: v })}
            />
          )}
        </>
      )}
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
    );
  };

  const setWord = (n: number) =>
    workoutKind === "strength" ? (n === 1 ? "set" : "sets") : workoutKind === "intervals" ? (n === 1 ? "round" : "rounds") : n === 1 ? "entry" : "entries";
  const headline: { label: string; value: string; unit: string } =
    workoutKind === "strength"
      ? { label: "Total weight lifted", value: Math.round(toDisplay(volumeKg, unit)).toLocaleString("en-US"), unit }
      : workoutKind === "cardio" && totalMeters > 0
        ? { label: "Total distance", value: String(distToDisplay(totalMeters, unit)), unit: distUnit(unit) }
        : { label: "Total time", value: String(Math.round(secToMin(totalSeconds))), unit: "min" };
  const subLine =
    workoutKind === "cardio" && totalMeters > 0 && totalSeconds > 0
      ? `${fmtSeconds(totalSeconds)} · ${fmtPace(totalSeconds, totalMeters, unit) ?? ""}`
      : workoutKind === "sport" && avgEffort != null
        ? `Average effort ${Math.round(avgEffort * 10) / 10}`
        : "";

  const breakdown = exercises.map((ex) => {
    const done = ex.sets.filter((s) => s.done && !s.warmup);
    const kind = kindOf(ex.kind);
    const secs = done.reduce((sum, s) => sum + (s.durationS ?? 0), 0);
    const meters = done.reduce((sum, s) => sum + (s.distanceM ?? 0), 0);
    return {
      key: ex.key,
      name: ex.name,
      count: done.length,
      volumeKg: done.reduce((sum, s) => sum + (s.kg ?? 0) * (s.reps ?? 0), 0),
      total:
        kind === "strength"
          ? null
          : kind === "cardio" && meters > 0
            ? `${distToDisplay(meters, unit)} ${distUnit(unit)}`
            : fmtSeconds(secs),
      lines: done.map((s) =>
        describeSet(
          kind,
          { kg: s.kg, reps: s.reps, durationS: s.durationS ?? null, distanceM: s.distanceM ?? null, rpe: s.rpe ?? null },
          unit,
          (kg) => formatWeight(kg, unit),
        ),
      ),
    };
  });

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col pb-40">
      <div className="flex items-center justify-end px-4 pt-4">
        <button
          type="button"
          onClick={() => setView("settings")}
          aria-label="Settings"
          className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-card shadow-sm"
        >
          <Avatar src={avatar} name={displayName} email={email} size={44} />
        </button>
      </div>

      {(view === "log" || view === "history" || view === "gyms" || view === "progress") && (
        <div className="mx-4 mt-4 flex rounded-xl bg-line p-[3px]" role="group" aria-label="Train">
          {(["log", "history", "gyms", "progress"] as const).map(
            (v) => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  setView(v);
                  setTrainTab(v);
                }}
                aria-pressed={view === v}
                className={`flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[10px] text-sm font-bold ${
                  view === v ? "bg-card text-ink" : "text-muted"
                }`}
              >
                {v === "log" ? "Workout" : v === "history" ? "History" : v === "gyms" ? "Gyms" : "Progress"}
                {v === "log" && inProgress && <span aria-label="in progress" className="h-2 w-2 rounded-full bg-done" />}
              </button>
            ),
          )}
        </div>
      )}

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

      {view === "log" && !inProgress && (
        <div>
          <Home
            db={db}
            userId={userId}
            unit={unit}
            name={displayName}
            onProfile={() => setView("settings")}
            inProgress={false}
            elapsedMs={0}
            onStart={startWorkout}
            onResume={() => setView("log")}
            onTemplate={repeatWorkout}
            startOnly
          />
        </div>
      )}

      {view === "home" && message && (
        <p role="status" className="mx-5 mt-3 text-sm font-semibold text-done">
          {message.text}
        </p>
      )}

      {view === "home" && (
        <Home
          db={db}
          userId={userId}
          unit={unit}
          name={displayName}
          onProfile={() => setView("settings")}
          inProgress={inProgress}
          elapsedMs={now - Date.parse(startedAt)}
          onStart={startWorkout}
          onResume={() => setView("log")}
          onTemplate={repeatWorkout}
        />
      )}

      {view === "settings" && (
        <Settings
          email={email}
          name={displayName}
          avatar={avatar}
          theme={theme}
          unit={unit}
          onSaveName={saveName}
          onPhoto={savePhoto}
          onTheme={chooseTheme}
          onUnit={chooseUnit}
          onSignOut={handleSignOut}
        />
      )}

      {view === "history" && <History db={db} userId={userId} unit={unit} onRepeat={repeatWorkout} />}

      {view === "progress" && <Progress db={db} userId={userId} unit={unit} />}

      {view === "gyms" && (
        <Gyms
          db={db}
          userId={userId}
          gyms={allGyms}
          catalog={catalog}
          onCatalogChange={(update) => setCatalog(update)}
          machineUrls={photoUrls}
          currentGymId={gymId}
          onChange={(update) => setAllGyms(update)}
        />
      )}

      <header className={logOpen ? "px-5 pt-4" : "hidden"}>
        <label htmlFor="title" className="sr-only">
          Workout name
        </label>
        <div className="flex items-center gap-2">
          <input
            id="title"
            ref={titleInput}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[32px] font-extrabold leading-tight tracking-tight outline-none"
          />
          <button
            type="button"
            aria-label="Rename workout"
            onClick={() => {
              titleInput.current?.focus();
              titleInput.current?.select();
            }}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-card text-muted shadow-sm"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
            </svg>
          </button>
        </div>

        <p className="px-1 text-xs font-bold uppercase tracking-wider text-muted">{kindLabel(workoutKind)} workout</p>

        {exercises.length === 0 && (
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Suggested workout names">
            {nameChips.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setTitle(n)}
                aria-pressed={normName(title) === normName(n)}
                className={`h-9 rounded-full px-4 text-[13px] font-bold ${
                  normName(title) === normName(n) ? "bg-accent text-on-accent" : "bg-card text-ink shadow-sm"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        )}

        <div className="mt-3 rounded-[20px] bg-accent text-on-accent">
          <button
            type="button"
            onClick={() => setShowBreakdown((v) => !v)}
            aria-expanded={showBreakdown}
            aria-controls="volume-breakdown"
            className="flex w-full items-start justify-between gap-3 p-4 text-left"
          >
            <span>
              <span className="block text-xs font-bold uppercase tracking-wider opacity-80">{headline.label}</span>
              <span className="mt-1 block text-[44px] font-extrabold leading-none tracking-tight">
                {headline.value}
                <span className="ml-1.5 text-xl font-bold opacity-80">{headline.unit}</span>
              </span>
              <span className="mt-2 block text-sm font-semibold opacity-90">
                {doneSets.length} {setWord(doneSets.length)} completed
                {active && ` · ${formatClock(now - Date.parse(startedAt))}`}
                {subLine && ` · ${subLine}`}
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
                            {b.total ?? `${Math.round(toDisplay(b.volumeKg, unit)).toLocaleString("en-US")} ${unit}`}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[13px] font-medium opacity-85">
                          {b.count} {setWord(b.count)}
                          {" · "}
                          {b.lines.join(", ")}
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
            <GymPicker
              gyms={gyms}
              urls={gymUrls}
              value={gymId}
              onChange={setGymId}
              onAdd={() => setAddingGym(true)}
            />
          )}
        </div>
      </header>

      <div className={logOpen ? "mt-4 flex flex-col gap-3 px-4" : "hidden"}>
        {picking && (
          <section className="rounded-[20px] bg-card p-4 shadow-sm" aria-label="Add exercise">
            <label htmlFor="exercise-search" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted">
              {supersetFor ? `Superset with ${exercises.find((e) => e.key === supersetFor)?.name ?? "this exercise"} · pick the second exercise` : `Add exercise${gymName ? ` · ${gymName}` : ""}`}
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

            {!needle && QUICK_ADD[workoutKind].filter((n) => !available.some((c) => c.name.toLowerCase() === n.toLowerCase())).length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-bold uppercase tracking-wider text-muted">Quick add</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {QUICK_ADD[workoutKind]
                    .filter((n) => !available.some((c) => c.name.toLowerCase() === n.toLowerCase()))
                    .map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => addQuick(n)}
                        className="h-9 rounded-full bg-field px-4 text-[13px] font-bold"
                      >
                        {n}
                      </button>
                    ))}
                </div>
              </div>
            )}

            {available.length === 0 && !needle && workoutKind === "strength" && (
              <p className="mt-3 text-sm font-medium text-muted">
                Nothing saved{gymName ? ` for ${gymName}` : ""} yet. Type a name to create your first exercise.
              </p>
            )}

            {needle && !exact && (
              <div className="mt-3 border-t border-line pt-3">
                <p className="text-sm font-bold">Create &ldquo;{query.trim()}&rdquo;</p>
                {workoutKind === "strength" && (
                <>
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
                </>
                )}
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
                  onClick={() => createExercise()}
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

        {exercises.map((ex) => {
          const partner = partnerOf(ex);
          if (partner && exercises.indexOf(partner) < exercises.indexOf(ex)) return null; // shown inside its partner's card
          if (partner) {
            const rounds = Math.max(ex.sets.length, partner.sets.length);
            return (
              <section key={ex.key} className="rounded-[20px] border-l-[5px] border-accent bg-card p-4 shadow-sm">
                <div className="mb-2 flex items-center justify-between">
                  <span className="rounded-lg bg-accent px-2 py-0.5 text-[11px] font-extrabold tracking-wider text-on-accent">
                    SUPERSET
                  </span>
                  <button type="button" onClick={() => unlinkSuperset(ex.key)} className="h-8 px-1 text-xs font-bold text-muted">
                    Unlink
                  </button>
                </div>
                {exHeader(ex, "A")}
                <div className="mt-4 border-t border-line pt-3">{exHeader(partner, "B")}</div>
                <div className="mt-2">
                  <div className="grid grid-cols-[36px_1fr_1fr_1fr_44px_36px] gap-2 px-0.5 text-xs font-bold text-muted">
                    <span>Set</span>
                    <span>Previous</span>
                    <span className="text-center">{unit}</span>
                    <span className="text-center">Reps</span>
                    <span />
                    <span />
                  </div>
                  {Array.from({ length: rounds }).flatMap((_, n) => [
                    ex.sets[n] ? setRow(ex, ex.sets[n], n, "a") : null,
                    partner.sets[n] ? setRow(partner, partner.sets[n], n, "b") : null,
                  ])}
                </div>
                <button
                  type="button"
                  onClick={() => addSet(ex.key)}
                  className="mt-3 h-11 w-full rounded-[14px] bg-tint text-sm font-bold text-accent"
                >
                  Add set
                </button>
              </section>
            );
          }
          return (
          <section key={ex.key} className="rounded-[20px] bg-card p-4 shadow-sm">
            {exHeader(ex)}

            {ex.sets.length > 0 && (
              <div className="mt-2">
                {!warmupHintSeen && kindOf(ex.kind) === "strength" && (
                  <p className="mb-1.5 px-0.5 text-xs font-semibold text-accent">
                    Tap a set number to mark it as a warm-up
                  </p>
                )}
                <div className="grid grid-cols-[28px_1fr_1fr_1fr_44px_36px] gap-2 px-0.5 text-xs font-bold text-muted">
                  <span>Set</span>
                  <span>Previous</span>
                  <span className="text-center">
                    {kindOf(ex.kind) === "strength" ? unit : kindOf(ex.kind) === "intervals" ? "sec" : "min"}
                  </span>
                  <span className="text-center">
                    {kindOf(ex.kind) === "cardio"
                      ? distUnit(unit)
                      : kindOf(ex.kind) === "sport"
                        ? "Effort"
                        : kindOf(ex.kind) === "intervals"
                          ? "Reps"
                          : "Reps"}
                  </span>
                  <span />
                  <span />
                </div>
                {ex.sets.map((s, i) => setRow(ex, s, i, ""))}
              </div>
            )}

            <button
              type="button"
              onClick={() => addSet(ex.key)}
              className="mt-3 h-11 w-full rounded-[14px] bg-tint text-sm font-bold text-accent"
            >
              {kindOf(ex.kind) === "strength" ? "Add set" : kindOf(ex.kind) === "intervals" ? "Add round" : "Add entry"}
            </button>
          </section>
          );
        })}

        {message && (
          <p
            role={message.kind === "error" ? "alert" : "status"}
            className={`px-1 text-sm font-semibold ${message.kind === "error" ? "text-red-600" : "text-done"}`}
          >
            {message.text}
          </p>
        )}

        {exercises.length === 0 && (
          <button type="button" onClick={discardWorkout} className="h-11 w-full text-sm font-bold text-muted">
            Cancel workout
          </button>
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
        className="hidden"
        onChange={(e) => {
          onExistingPhoto(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      <nav
        className={`fixed inset-x-4 bottom-[88px] mx-auto max-w-md items-center gap-2 rounded-full bg-ink p-2 shadow-lg ${
          logOpen ? "flex" : "hidden"
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
      <BottomBar
        selected={view === "home" ? "home" : view === "settings" ? null : "train"}
        onSelect={(sec: Section) => {
          if (sec === "home") setView("home");
          else if (view === "home" || view === "settings") setView(inProgress ? "log" : trainTab);
        }}
      />
    </main>
  );
}

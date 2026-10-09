import type { SupabaseClient } from "@supabase/supabase-js";

// Finished workouts wait here until they are safely in the database. Every row has an id made
// on the phone, so sending the same workout twice never creates a duplicate.

export type OutboxWorkout = {
  id: string;
  user_id: string;
  gym_id: string | null;
  name: string;
  started_at: string;
  ended_at: string;
};

export type OutboxSet = {
  id: string;
  user_id: string;
  workout_id: string;
  exercise_id: string;
  set_index: number;
  set_type: string;
  weight_kg: number | null;
  reps: number | null;
  completed_at: string;
  setup_id: string | null;
};

export type OutboxItem = {
  workout: OutboxWorkout;
  sets: OutboxSet[];
  queuedAt: string;
  lastError?: string;
};

const key = (userId: string) => `outbox:${userId}`;

export function loadOutbox(userId: string): OutboxItem[] {
  try {
    const raw = localStorage.getItem(key(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as OutboxItem[]) : [];
  } catch {
    return [];
  }
}

function saveOutbox(userId: string, items: OutboxItem[]): boolean {
  try {
    if (items.length === 0) localStorage.removeItem(key(userId));
    else localStorage.setItem(key(userId), JSON.stringify(items));
    return true;
  } catch {
    return false;
  }
}

// Returns false if the phone refused to store it (storage full or blocked).
export function enqueue(userId: string, workout: OutboxWorkout, sets: OutboxSet[]): boolean {
  const items = loadOutbox(userId).filter((i) => i.workout.id !== workout.id);
  items.push({ workout, sets, queuedAt: new Date().toISOString() });
  return saveOutbox(userId, items);
}

let running: Promise<{ sent: number; left: number }> | null = null;

// Sends queued workouts oldest first. Stops at the first failure and keeps the rest for later.
export function flushOutbox(db: SupabaseClient, userId: string): Promise<{ sent: number; left: number }> {
  if (running) return running;
  running = (async () => {
    let sent = 0;
    let items = loadOutbox(userId);
    if (items.length === 0) return { sent, left: 0 };

    // Only send under the signed-in account that owns these workouts.
    const session = await db.auth.getSession();
    if (session.data.session?.user.id !== userId) return { sent, left: items.length };

    for (const item of [...items]) {
      const w = await db.from("workouts").upsert(item.workout, { onConflict: "id", ignoreDuplicates: true });
      let error = w.error?.message;
      if (!error && item.sets.length > 0) {
        const s = await db.from("workout_sets").upsert(item.sets, { onConflict: "id", ignoreDuplicates: true });
        error = s.error?.message;
      }
      if (error) {
        items = loadOutbox(userId).map((i) => (i.workout.id === item.workout.id ? { ...i, lastError: error } : i));
        saveOutbox(userId, items);
        return { sent, left: items.length };
      }
      items = loadOutbox(userId).filter((i) => i.workout.id !== item.workout.id);
      saveOutbox(userId, items);
      sent += 1;
    }
    return { sent, left: items.length };
  })().finally(() => {
    running = null;
  });
  return running;
}

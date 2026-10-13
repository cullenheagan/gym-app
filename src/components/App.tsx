"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import AuthForm from "./AuthForm";
import { clearPersonalData } from "@/lib/cache";
import Workout from "./Workout";

type KnownUser = { id: string; email: string };
const LAST_USER = "lastUser";

function rememberUser(user: KnownUser) {
  try {
    localStorage.setItem(LAST_USER, JSON.stringify(user));
  } catch {}
}

function forgetUser() {
  try {
    localStorage.removeItem(LAST_USER);
  } catch {}
}

// With no signal the saved sign-in cannot be refreshed. If the phone is offline and someone
// signed in here before, open the app as that person so a workout can still be logged.
function offlineUser(): KnownUser | null {
  try {
    if (navigator.onLine !== false) return null;
    const raw = localStorage.getItem(LAST_USER);
    const u = raw ? (JSON.parse(raw) as KnownUser) : null;
    return u && typeof u.id === "string" ? u : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [fallback, setFallback] = useState<KnownUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setReady(true);
      return;
    }
    supabase.auth
      .getSession()
      .then(({ data }: { data: { session: Session | null } }) => {
        setSession(data.session);
        if (data.session) rememberUser({ id: data.session.user.id, email: data.session.user.email ?? "" });
        else setFallback(offlineUser());
        setReady(true);
      })
      .catch(() => {
        setFallback(offlineUser());
        setReady(true);
      });
    const { data: sub } = supabase.auth.onAuthStateChange((event: string, next: Session | null) => {
      setSession(next);
      if (next) {
        rememberUser({ id: next.user.id, email: next.user.email ?? "" });
        setFallback(null);
      } else if (event === "SIGNED_OUT") {
        forgetUser();
        setFallback(null);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!supabase) {
    return (
      <main className="mx-auto max-w-md px-5 pt-16">
        <h1 className="text-2xl font-extrabold">Supabase is not set up</h1>
        <p className="mt-2 text-muted">
          Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to a file named .env.local in the
          project folder, then restart the dev server.
        </p>
      </main>
    );
  }

  const db = supabase;

  if (!ready) {
    return <main className="mx-auto max-w-md px-5 pt-16 text-muted">Loading...</main>;
  }

  const user: KnownUser | null = session ? { id: session.user.id, email: session.user.email ?? "" } : fallback;

  if (!user) {
    return <AuthForm db={db} />;
  }

  return (
    <Workout
      db={db}
      userId={user.id}
      email={user.email}
      onSignOut={() => {
        clearPersonalData(user.id);
        forgetUser();
        setFallback(null);
        db.auth.signOut();
      }}
    />
  );
}

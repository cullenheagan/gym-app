"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import AuthForm from "./AuthForm";
import Workout from "./Workout";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setReady(true);
      return;
    }
    supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event: string, next: Session | null) => {
      setSession(next);
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

  if (!session) {
    return <AuthForm db={db} />;
  }

  return (
    <Workout
      db={db}
      userId={session.user.id}
      email={session.user.email ?? ""}
      onSignOut={() => {
        db.auth.signOut();
      }}
    />
  );
}

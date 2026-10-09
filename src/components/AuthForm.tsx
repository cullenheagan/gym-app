"use client";

import { useRef, useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Avatar as AvatarData, avatarPath, compressAvatar, savePending, avatarKey } from "@/lib/avatar";
import { uploadPhoto } from "@/lib/photo";

export default function AuthForm({ db }: { db: SupabaseClient }) {
  const [name, setName] = useState("");
  const [photo, setPhoto] = useState<AvatarData | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    if (mode === "in") {
      const { error: err } = await db.auth.signInWithPassword({ email, password });
      if (err) setError(err.message);
    } else {
      const cleanName = name.trim();
      const { data, error: err } = await db.auth.signUp({
        email,
        password,
        options: { data: cleanName ? { display_name: cleanName } : {} },
      });
      if (err) setError(err.message);
      else if (!data.session) {
        // No session until the email is confirmed, so keep the name and photo on this phone for the first sign-in.
        if (cleanName || photo) savePending(email, { name: cleanName, avatar: photo?.dataUrl ?? null });
        setInfo("Check your email for a confirmation link, then sign in.");
      } else {
        const uid = data.session.user.id;
        const patch: Record<string, string> = {};
        if (cleanName) patch.display_name = cleanName;
        if (photo) {
          const up = await uploadPhoto(db, avatarPath(uid), photo.blob);
          if (!up.error) {
            patch.avatar_path = avatarPath(uid);
            try {
              localStorage.setItem(avatarKey(uid), photo.dataUrl);
            } catch {}
          }
        }
        if (Object.keys(patch).length > 0) await db.from("profiles").update(patch).eq("id", uid);
      }
    }
    setBusy(false);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5">
      <h1 className="text-[32px] font-extrabold leading-tight tracking-tight">Gym Companion</h1>
      <p className="mt-1 text-[15px] font-medium text-muted">
        {mode === "in" ? "Sign in to see your workouts." : "Create an account. Your data stays private to you."}
      </p>

      <form onSubmit={submit} className="mt-6 flex flex-col gap-3 rounded-[20px] bg-card p-4 shadow-sm">
        {mode === "up" && (
          <>
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => photoInput.current?.click()}
                aria-label={photo ? "Change photo" : "Add photo"}
                className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-field text-sm font-bold text-muted"
              >
                {photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo.dataUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  "+ Photo"
                )}
              </button>
              <p className="text-xs font-medium text-muted">Optional. Take a photo or choose one from your library.</p>
            </div>
            <input
              ref={photoInput}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                try {
                  setPhoto(await compressAvatar(f));
                } catch {
                  setError("Could not read that photo.");
                }
              }}
            />
            <label className="text-xs font-bold uppercase tracking-wider text-muted" htmlFor="name">
              Name
            </label>
            <input
              id="name"
              maxLength={40}
              autoComplete="given-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-11 rounded-xl border-2 border-transparent bg-field px-3 text-base font-semibold outline-none focus:border-accent"
            />
          </>
        )}
        <label className="text-xs font-bold uppercase tracking-wider text-muted" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-11 rounded-xl border-2 border-transparent bg-field px-3 text-base font-semibold outline-none focus:border-accent"
        />
        <label className="text-xs font-bold uppercase tracking-wider text-muted" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          required
          minLength={6}
          autoComplete={mode === "in" ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-11 rounded-xl border-2 border-transparent bg-field px-3 text-base font-semibold outline-none focus:border-accent"
        />

        {error && (
          <p role="alert" className="text-sm font-semibold text-red-600">
            {error}
          </p>
        )}
        {info && <p className="text-sm font-semibold text-done">{info}</p>}

        <button
          type="submit"
          disabled={busy}
          className="mt-1 h-12 rounded-[14px] bg-accent text-base font-bold text-on-accent disabled:opacity-60"
        >
          {busy ? "Please wait..." : mode === "in" ? "Sign in" : "Create account"}
        </button>
      </form>

      <button
        type="button"
        onClick={() => {
          setMode(mode === "in" ? "up" : "in");
          setError(null);
          setInfo(null);
        }}
        className="mt-4 h-11 text-sm font-bold text-accent"
      >
        {mode === "in" ? "New here? Create an account" : "Already have an account? Sign in"}
      </button>
    </main>
  );
}

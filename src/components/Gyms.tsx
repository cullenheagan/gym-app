"use client";

import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Gym } from "@/lib/types";
import { equipmentLabel } from "@/lib/equipment";
import { PHOTO_BUCKET, compressPhoto, uploadPhoto } from "@/lib/photo";
import { explain } from "@/lib/net";

type Machine = { id: string; name: string; equipment_type: string; gym_id: string | null; photo_path: string | null };

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

// The gyms tab: every gym with its photo and the machines saved there. Removing a gym only hides it
// from the gym dropdown; its workouts and machines stay.
export default function Gyms({
  db,
  userId,
  gyms,
  catalog,
  machineUrls,
  currentGymId,
  onChange,
}: {
  db: SupabaseClient;
  userId: string;
  gyms: Gym[];
  catalog: Machine[];
  machineUrls: Record<string, string>;
  currentGymId: string;
  onChange: (update: (all: Gym[]) => Gym[]) => void;
}) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const photoTarget = useRef<string | null>(null);

  const active = gyms.filter((g) => !g.archived_at);
  const removed = gyms.filter((g) => g.archived_at);

  // How many workouts were logged at each gym.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await db.from("workouts").select("gym_id").limit(5000);
      if (cancelled || res.error || !res.data) return;
      const next: Record<string, number> = {};
      for (const row of res.data as { gym_id: string | null }[]) {
        if (row.gym_id) next[row.gym_id] = (next[row.gym_id] ?? 0) + 1;
      }
      setCounts(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [db]);

  // Links to the gym photos (they live in a private bucket, so each link is temporary).
  const photoKey = gyms.map((g) => g.photo_path ?? "").join("|");
  useEffect(() => {
    let cancelled = false;
    const paths = gyms.map((g) => g.photo_path).filter((p): p is string => !!p);
    if (paths.length === 0) return;
    (async () => {
      const signed = await db.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600);
      if (cancelled || !signed.data) return;
      const map: Record<string, string> = {};
      for (const row of signed.data) if (row.path && row.signedUrl) map[row.path] = row.signedUrl;
      setUrls((cur) => ({ ...cur, ...map }));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, photoKey]);

  async function addGym() {
    const label = name.trim();
    if (!label) return;
    setBusy(true);
    setError(null);
    const res = await db.from("gyms").insert({ user_id: userId, name: label }).select("id,name").single();
    setBusy(false);
    if (res.error || !res.data) {
      setError(explain(res.error?.message, "Could not add the gym."));
      return;
    }
    const gym = res.data as Gym;
    onChange((all) => [...all, gym]);
    setName("");
    setAdding(false);
    setOpenId(gym.id);
  }

  function choosePhoto(gymId: string) {
    photoTarget.current = gymId;
    fileInput.current?.click();
  }

  async function onPhoto(file: File | undefined) {
    const id = photoTarget.current;
    photoTarget.current = null;
    if (!file || !id) return;
    setError(null);
    try {
      const blob = await compressPhoto(file);
      const path = `${userId}/gym-${id}.jpg`;
      const up = await uploadPhoto(db, path, blob);
      if (up.error) throw new Error(up.error);
      const upd = await db.from("gyms").update({ photo_path: path }).eq("id", id);
      if (upd.error) throw new Error(upd.error.message);
      onChange((all) => all.map((g) => (g.id === id ? { ...g, photo_path: path } : g)));
      const url = up.url;
      if (url) setUrls((cur) => ({ ...cur, [path]: url }));
    } catch (e) {
      setError(explain(e instanceof Error ? e.message : null, "Could not save the photo."));
    }
  }

  async function setArchived(id: string, archived: boolean) {
    setError(null);
    const stamp = archived ? new Date().toISOString() : null;
    const res = await db.from("gyms").update({ archived_at: stamp }).eq("id", id);
    if (res.error) {
      setError(explain(res.error.message, "Could not update the gym. Run the latest database update first."));
      return;
    }
    onChange((all) => all.map((g) => (g.id === id ? { ...g, archived_at: stamp } : g)));
    setConfirmId(null);
    if (archived) setOpenId(null);
  }

  function removeTap(id: string) {
    if (confirmId !== id) {
      setConfirmId(id);
      window.setTimeout(() => setConfirmId((cur) => (cur === id ? null : cur)), 5000);
      return;
    }
    setArchived(id, true);
  }

  return (
    <section className="flex flex-col gap-3 px-4 pt-4" aria-label="Gyms">
      {error && (
        <p role="alert" className="px-1 text-sm font-semibold text-red-600">
          {error}
        </p>
      )}

      {active.length === 0 && !adding && (
        <div className="rounded-[20px] bg-card p-5 text-center shadow-sm">
          <p className="text-base font-bold">No gyms yet</p>
          <p className="mt-1 text-sm font-medium text-muted">Add the gyms you train at to keep their machines together.</p>
        </div>
      )}

      {active.map((g) => {
        const open = openId === g.id;
        const machines = catalog.filter((c) => c.gym_id === g.id);
        const photo = g.photo_path ? urls[g.photo_path] : undefined;
        const workouts = counts[g.id] ?? 0;
        return (
          <article key={g.id} className="overflow-hidden rounded-[20px] bg-card shadow-sm">
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photo}
                alt={`${g.name}`}
                className="h-36 w-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            ) : null}
            <button
              type="button"
              onClick={() => setOpenId(open ? null : g.id)}
              aria-expanded={open}
              className="flex w-full items-center justify-between gap-3 p-4 text-left"
            >
              <span className="min-w-0">
                <span className="block truncate text-[19px] font-extrabold leading-tight tracking-tight">{g.name}</span>
                <span className="mt-0.5 block text-[13px] font-medium text-muted">
                  {machines.length} {machines.length === 1 ? "machine" : "machines"} · {workouts}{" "}
                  {workouts === 1 ? "workout" : "workouts"}
                  {g.id === currentGymId ? " · current gym" : ""}
                </span>
              </span>
              <Chevron open={open} />
            </button>

            {open && (
              <div className="mx-4 border-t border-line pb-4 pt-3">
                <p className="text-xs font-bold uppercase tracking-wider text-muted">Machines here</p>
                {machines.length === 0 ? (
                  <p className="mt-2 text-sm font-medium text-muted">
                    No machines saved at this gym yet. Add one from the Log tab with the camera button. Free weights
                    work at every gym, so they are not listed here.
                  </p>
                ) : (
                  <ul className="mt-2 flex flex-col gap-2">
                    {machines.map((m) => {
                      const url = m.photo_path ? machineUrls[m.photo_path] : undefined;
                      return (
                        <li key={m.id} className="flex items-center gap-3">
                          {url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={url}
                              alt=""
                              className="h-11 w-11 shrink-0 rounded-lg object-cover"
                              onError={(e) => {
                                e.currentTarget.style.visibility = "hidden";
                              }}
                            />
                          ) : (
                            <span className="h-11 w-11 shrink-0 rounded-lg bg-field" />
                          )}
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-bold">{m.name}</span>
                            <span className="block text-[13px] font-medium text-muted">
                              {equipmentLabel(m.equipment_type)}
                            </span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}

                <button
                  type="button"
                  onClick={() => choosePhoto(g.id)}
                  className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-[14px] bg-field text-sm font-bold"
                >
                  <CameraIcon />
                  {g.photo_path ? "Change gym photo" : "Add a gym photo"}
                </button>
                <button
                  type="button"
                  onClick={() => removeTap(g.id)}
                  className="mt-2 h-11 w-full rounded-[14px] bg-field text-sm font-bold text-red-600"
                >
                  {confirmId === g.id ? "Tap again to remove from my list" : "Remove from my gym list"}
                </button>
                <p className="mt-2 text-[13px] font-medium text-muted">
                  Removing hides it from the gym dropdown. Its workouts and machines are kept, and you can bring it back
                  below.
                </p>
              </div>
            )}
          </article>
        );
      })}

      {adding ? (
        <div className="flex gap-2 rounded-[20px] bg-card p-3 shadow-sm">
          <label htmlFor="new-gym" className="sr-only">
            Gym name
          </label>
          <input
            id="new-gym"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addGym();
              if (e.key === "Escape") setAdding(false);
            }}
            placeholder="Gym name"
            className="h-11 min-w-0 flex-1 rounded-xl border-2 border-accent bg-card px-3 text-sm font-semibold outline-none"
          />
          <button
            type="button"
            onClick={addGym}
            disabled={busy}
            className="h-11 rounded-xl bg-accent px-4 text-sm font-bold text-on-accent disabled:opacity-60"
          >
            Add
          </button>
          <button type="button" onClick={() => setAdding(false)} className="h-11 rounded-xl bg-field px-3 text-sm font-bold text-muted">
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="h-12 rounded-[14px] bg-card text-sm font-bold text-accent shadow-sm"
        >
          + Add a gym
        </button>
      )}

      {removed.length > 0 && (
        <div className="px-1">
          <button
            type="button"
            onClick={() => setShowRemoved((v) => !v)}
            aria-expanded={showRemoved}
            className="text-sm font-bold text-muted"
          >
            Removed gyms ({removed.length}) {showRemoved ? "▴" : "▾"}
          </button>
          {showRemoved && (
            <ul className="mt-2 flex flex-col gap-2">
              {removed.map((g) => (
                <li key={g.id} className="flex items-center justify-between gap-3 rounded-[14px] bg-card px-4 py-3 shadow-sm">
                  <span className="min-w-0 truncate text-sm font-bold">{g.name}</span>
                  <button type="button" onClick={() => setArchived(g.id, false)} className="shrink-0 text-sm font-bold text-accent">
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          onPhoto(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </section>
  );
}

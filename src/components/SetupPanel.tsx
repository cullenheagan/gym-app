"use client";

import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PHOTO_BUCKET, compressPhoto, uploadPhoto } from "@/lib/photo";
import { cacheKey, readCache, writeCache } from "@/lib/cache";
import { explain } from "@/lib/net";

type Setup = { id: string; name: string; pin_position: string | null; photo_path: string | null };

// Seat / bench setups for one exercise at one gym: a photo of the bench plus where the pin goes.
export default function SetupPanel({
  db,
  userId,
  exerciseId,
  gymId,
  value,
  onChange,
}: {
  db: SupabaseClient;
  userId: string;
  exerciseId: string;
  gymId: string;
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const [setups, setSetups] = useState<Setup[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [blob, setBlob] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editPin, setEditPin] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let q = db
        .from("exercise_setups")
        .select("id,name,pin_position,photo_path")
        .eq("exercise_id", exerciseId)
        .order("created_at", { ascending: true });
      q = gymId ? q.eq("gym_id", gymId) : q.is("gym_id", null);
      const res = await q;
      if (cancelled) return;
      const ck = cacheKey(userId, `setups:${exerciseId}:${gymId || "none"}`);
      if (res.error) {
        // No connection: use the copy saved on this device, quietly.
        const copy = readCache<Setup[]>(ck);
        setSetups(copy ?? []);
        if (!copy) setError(null);
        return;
      }
      const list = (res.data ?? []) as Setup[];
      writeCache(ck, list);
      setSetups(list);
      // A setup remembered from another gym does not apply here.
      if (value && !list.some((s) => s.id === value)) onChange(null);
      const paths = list.map((s) => s.photo_path).filter((p): p is string => !!p);
      if (paths.length > 0) {
        const signed = await db.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600);
        if (!cancelled && signed.data) {
          const map: Record<string, string> = {};
          for (const row of signed.data) if (row.path && row.signedUrl) map[row.path] = row.signedUrl;
          setUrls(map);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, userId, exerciseId, gymId]);

  function reset() {
    if (preview) URL.revokeObjectURL(preview);
    setBlob(null);
    setPreview(null);
    setName("");
    setPin("");
    setAdding(false);
    setError(null);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      const b = await compressPhoto(file);
      if (preview) URL.revokeObjectURL(preview);
      setBlob(b);
      setPreview(URL.createObjectURL(b));
    } catch (e) {
      setError(explain(e instanceof Error ? e.message : null, "Could not read that photo."));
    }
  }

  async function save() {
    const label = name.trim();
    if (!label) {
      setError("Give this setup a name, like “Bench by the window”.");
      return;
    }
    setBusy(true);
    setError(null);
    const ins = await db
      .from("exercise_setups")
      .insert({
        user_id: userId,
        exercise_id: exerciseId,
        gym_id: gymId || null,
        name: label,
        pin_position: pin.trim() || null,
      })
      .select("id,name,pin_position,photo_path")
      .single();
    if (ins.error || !ins.data) {
      setBusy(false);
      setError(explain(ins.error?.message, "Could not save the setup."));
      return;
    }
    let made = ins.data as Setup;
    if (blob) {
      const path = `${userId}/setup-${made.id}.jpg`;
      const up = await uploadPhoto(db, path, blob);
      if (up.error) {
        setError(`Saved, but the photo did not upload: ${up.error}`);
      } else {
        await db.from("exercise_setups").update({ photo_path: path }).eq("id", made.id);
        made = { ...made, photo_path: path };
        const url = up.url;
        if (url) setUrls((m) => ({ ...m, [path]: url }));
      }
    }
    setSetups((all) => [...(all ?? []), made]);
    onChange(made.id);
    setBusy(false);
    if (!blob || made.photo_path) reset();
    else setAdding(false);
  }

  async function savePin(s: Setup) {
    const next = (editPin ?? "").trim() || null;
    setEditPin(null);
    if (next === s.pin_position) return;
    const res = await db.from("exercise_setups").update({ pin_position: next }).eq("id", s.id);
    if (res.error) {
      setError(res.error.message);
      return;
    }
    setSetups((all) => (all ?? []).map((x) => (x.id === s.id ? { ...x, pin_position: next } : x)));
  }

  if (setups === null) return null;
  const selected = setups.find((s) => s.id === value) ?? null;

  return (
    <div className="mt-3 rounded-[14px] bg-field p-3">
      <p className="text-xs font-bold uppercase tracking-wider text-muted">Bench / seat setup</p>

      {setups.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {setups.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onChange(s.id === value ? null : s.id)}
              aria-pressed={s.id === value}
              className={`h-9 rounded-full px-3 text-[13px] font-bold ${
                s.id === value ? "bg-accent text-on-accent" : "bg-card text-ink"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="mt-3 flex items-center gap-3">
          {selected.photo_path && urls[selected.photo_path] && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={urls[selected.photo_path]} alt={selected.name} className="h-20 w-20 shrink-0 rounded-xl object-cover" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-muted">Pin position</p>
            {editPin !== null ? (
              <input
                autoFocus
                value={editPin}
                onChange={(e) => setEditPin(e.target.value)}
                onBlur={() => savePin(selected)}
                onKeyDown={(e) => e.key === "Enter" && savePin(selected)}
                placeholder="e.g. hole 4"
                className="mt-0.5 h-10 w-full rounded-lg border-2 border-accent bg-card px-2 text-sm font-semibold outline-none"
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditPin(selected.pin_position ?? "")}
                className="mt-0.5 h-10 w-full rounded-lg bg-card px-2 text-left text-sm font-semibold"
              >
                {selected.pin_position || "Tap to set"}
              </button>
            )}
          </div>
        </div>
      )}

      {!adding ? (
        <button type="button" onClick={() => setAdding(true)} className="mt-2 text-sm font-bold text-accent">
          + {setups.length === 0 ? "Add a bench or seat setup" : "New setup"}
        </button>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (Bench by the window)"
            className="h-11 rounded-xl border border-line bg-card px-3 text-sm font-semibold"
          />
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="Pin position (hole 4, notch 3...)"
            className="h-11 rounded-xl border border-line bg-card px-3 text-sm font-semibold"
          />
          <div className="flex items-center gap-3">
            {preview ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt="" className="h-14 w-14 rounded-lg object-cover" />
                <button type="button" onClick={() => fileInput.current?.click()} className="text-sm font-bold text-muted">
                  Retake
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="h-11 rounded-xl bg-card px-4 text-sm font-bold"
              >
                Photo of the bench (optional)
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="h-11 flex-1 rounded-[14px] bg-accent text-sm font-bold text-on-accent disabled:opacity-60"
            >
              {busy ? "Saving..." : "Save setup"}
            </button>
            <button type="button" onClick={reset} className="h-11 rounded-[14px] bg-card px-4 text-sm font-bold text-muted">
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-[13px] font-semibold text-red-600">
          {error}
        </p>
      )}

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}

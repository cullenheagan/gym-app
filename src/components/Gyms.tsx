"use client";

import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Gym } from "@/lib/types";
import { EQUIPMENT, equipmentLabel } from "@/lib/equipment";
import { PHOTO_BUCKET, compressPhoto, uploadPhoto } from "@/lib/photo";
import { explain } from "@/lib/net";
import PhotoViewer from "./PhotoViewer";
import { loadOutbox } from "@/lib/outbox";

type Machine = {
  id: string;
  name: string;
  equipment_type: string;
  gym_id: string | null;
  photo_path: string | null;
  archived_at?: string | null;
};

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
  onCatalogChange,
  machineUrls,
  onReplacePhoto,
  onDeletePhoto,
  currentGymId,
  activeGymId,
  activeExerciseIds,
  onChange,
}: {
  db: SupabaseClient;
  userId: string;
  gyms: Gym[];
  catalog: Machine[];
  onCatalogChange: (update: (all: Machine[]) => Machine[]) => void;
  machineUrls: Record<string, string>;
  onReplacePhoto: (machineId: string, file: File) => Promise<string | null>;
  onDeletePhoto: (machineId: string) => Promise<string | null>;
  currentGymId: string;
  activeGymId: string | null; // gym of the workout in progress, if any
  activeExerciseIds: string[]; // machines in the workout in progress
  onChange: (update: (all: Gym[]) => Gym[]) => void;
}) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);
  const [confirmMachine, setConfirmMachine] = useState<string | null>(null);
  const [removedMachinesOpen, setRemovedMachinesOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const photoTarget = useRef<string | null>(null);
  const [viewing, setViewing] = useState<{ kind: "gym" | "machine"; id: string } | null>(null);
  // The small edit form for one gym or machine. deletable: null while checking, false once history exists.
  const [editing, setEditing] = useState<{ kind: "gym" | "machine"; id: string; name: string; equip: string; deletable: boolean | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const machineTypes = EQUIPMENT.filter((e) => !e.anyGym);

  // A gym or machine can only be deleted for good if nothing was ever logged with it.
  async function checkDeletable(kind: "gym" | "machine", id: string): Promise<boolean> {
    // Workouts in progress or still waiting on this phone to sync count too: deleting what they
    // use would make them impossible to save.
    const waiting = loadOutbox(userId);
    const usedIds = new Set([...activeExerciseIds, ...waiting.flatMap((i) => i.sets.map((s) => s.exercise_id))]);
    const machineIds = kind === "machine" ? [id] : catalog.filter((c) => c.gym_id === id).map((c) => c.id);
    if (machineIds.some((m) => usedIds.has(m))) return false;
    if (kind === "gym" && (activeGymId === id || waiting.some((i) => i.workout.gym_id === id))) return false;
    if (kind === "machine") {
      const r = await db.from("workout_sets").select("id", { count: "exact", head: true }).eq("exercise_id", id);
      return !r.error && r.count === 0;
    }
    const w = await db.from("workouts").select("id", { count: "exact", head: true }).eq("gym_id", id);
    if (w.error || w.count !== 0) return false;
    const ids = catalog.filter((c) => c.gym_id === id).map((c) => c.id);
    if (ids.length === 0) return true;
    const r = await db.from("workout_sets").select("id", { count: "exact", head: true }).in("exercise_id", ids);
    return !r.error && r.count === 0;
  }

  function startEdit(kind: "gym" | "machine", id: string, name: string, equip: string) {
    setError(null);
    setConfirmDelete(false);
    setEditing({ kind, id, name, equip, deletable: null });
    checkDeletable(kind, id).then((ok) =>
      setEditing((cur) => (cur && cur.kind === kind && cur.id === id ? { ...cur, deletable: ok } : cur)),
    );
  }

  async function saveEdit() {
    if (!editing) return;
    const label = editing.name.trim();
    if (!label) {
      setError("Give it a name first.");
      return;
    }
    setBusy(true);
    setError(null);
    if (editing.kind === "gym") {
      const res = await db.from("gyms").update({ name: label }).eq("id", editing.id);
      if (res.error) setError(explain(res.error.message, "Could not rename the gym."));
      else {
        onChange((all) => all.map((g) => (g.id === editing.id ? { ...g, name: label } : g)));
        setEditing(null);
      }
    } else {
      const res = await db.from("exercises").update({ name: label, equipment_type: editing.equip }).eq("id", editing.id);
      if (res.error) setError(explain(res.error.message, "Could not save the machine."));
      else {
        onCatalogChange((all) => all.map((m) => (m.id === editing.id ? { ...m, name: label, equipment_type: editing.equip } : m)));
        setEditing(null);
      }
    }
    setBusy(false);
  }

  // Delete forever. Only offered when checkDeletable said nothing was logged with it.
  async function deleteForever() {
    if (!editing || editing.deletable !== true) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      window.setTimeout(() => setConfirmDelete(false), 4000);
      return;
    }
    setBusy(true);
    setError(null);
    const { kind, id } = editing;
    const paths: string[] = [];
    if (kind === "machine") {
      const m = catalog.find((c) => c.id === id);
      if (m?.photo_path) paths.push(m.photo_path);
      const sp = await db.from("exercise_setups").select("photo_path").eq("exercise_id", id);
      for (const r of (sp.data ?? []) as { photo_path: string | null }[]) if (r.photo_path) paths.push(r.photo_path);
      const del = await db.from("exercises").delete().eq("id", id);
      if (del.error) {
        setBusy(false);
        setError(explain(del.error.message, "Could not delete the machine."));
        return;
      }
      onCatalogChange((all) => all.filter((c) => c.id !== id));
    } else {
      const g = gyms.find((x) => x.id === id);
      if (g?.photo_path) paths.push(g.photo_path);
      for (const m of catalog.filter((c) => c.gym_id === id)) if (m.photo_path) paths.push(m.photo_path);
      const sp = await db.from("exercise_setups").select("photo_path").eq("gym_id", id);
      for (const r of (sp.data ?? []) as { photo_path: string | null }[]) if (r.photo_path) paths.push(r.photo_path);
      const dm = await db.from("exercises").delete().eq("gym_id", id);
      if (dm.error) {
        setBusy(false);
        setError(explain(dm.error.message, "Could not delete the gym's machines."));
        return;
      }
      const dg = await db.from("gyms").delete().eq("id", id);
      if (dg.error) {
        setBusy(false);
        setError(explain(dg.error.message, "Could not delete the gym."));
        return;
      }
      onCatalogChange((all) => all.filter((c) => c.gym_id !== id));
      onChange((all) => all.filter((x) => x.id !== id));
      setOpenId(null);
    }
    if (paths.length > 0) await db.storage.from(PHOTO_BUCKET).remove(paths);
    setBusy(false);
    setConfirmDelete(false);
    setEditing(null);
  }

  // The name / type form with the delete choice, shared by gyms and machines.
  function editForm(kind: "gym" | "machine") {
    if (!editing || editing.kind !== kind) return null;
    return (
      <div className="mt-2 rounded-[14px] bg-field p-3">
        <label className="text-xs font-bold text-muted" htmlFor={`edit-${editing.id}`}>
          Name
        </label>
        <input
          id={`edit-${editing.id}`}
          autoFocus
          value={editing.name}
          onChange={(e) => setEditing({ ...editing, name: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveEdit();
            if (e.key === "Escape") setEditing(null);
          }}
          className="mt-0.5 h-11 w-full rounded-xl border-2 border-accent bg-card px-3 text-base font-semibold outline-none"
        />
        {kind === "machine" && (
          <>
            <label className="mt-2 block text-xs font-bold text-muted" htmlFor={`type-${editing.id}`}>
              Type
            </label>
            <select
              id={`type-${editing.id}`}
              value={editing.equip}
              onChange={(e) => setEditing({ ...editing, equip: e.target.value })}
              className="mt-0.5 h-11 w-full rounded-xl border border-line bg-card px-3 text-base font-semibold"
            >
              {machineTypes.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
              {!machineTypes.some((t) => t.value === editing.equip) && (
                <option value={editing.equip}>{equipmentLabel(editing.equip)}</option>
              )}
            </select>
          </>
        )}
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={saveEdit}
            disabled={busy}
            className="h-11 flex-1 rounded-[14px] bg-accent text-sm font-bold text-on-accent disabled:opacity-60"
          >
            {busy ? "Saving..." : "Save"}
          </button>
          <button type="button" onClick={() => setEditing(null)} className="h-11 rounded-[14px] bg-card px-4 text-sm font-bold text-muted">
            Cancel
          </button>
        </div>
        {editing.deletable === true ? (
          <>
            <button
              type="button"
              onClick={deleteForever}
              disabled={busy}
              className="mt-3 h-11 w-full rounded-[14px] bg-card text-sm font-bold text-red-600 disabled:opacity-60"
            >
              {confirmDelete ? "Tap again to delete forever" : "Delete forever"}
            </button>
            <p className="mt-1.5 text-[13px] font-medium text-muted">
              Nothing was ever logged with this {kind === "gym" ? "gym" : "machine"}, so it can be deleted for good.
            </p>
          </>
        ) : (
          <p className="mt-3 text-[13px] font-medium text-muted">
            {editing.deletable === null
              ? "Checking if it can be deleted..."
              : "Workouts were logged with this, so it can only be removed (hidden). That keeps your history."}
          </p>
        )}
      </div>
    );
  }

  // Replace or delete a gym's photo (from the full-screen viewer).
  async function replaceGymPhoto(id: string, file: File): Promise<string | null> {
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
      return null;
    } catch (e) {
      return explain(e instanceof Error ? e.message : null, "Could not save the photo.");
    }
  }

  async function deleteGymPhoto(id: string): Promise<string | null> {
    const path = gyms.find((g) => g.id === id)?.photo_path;
    const upd = await db.from("gyms").update({ photo_path: null }).eq("id", id);
    if (upd.error) return explain(upd.error.message, "Could not delete the photo.");
    if (path) await db.storage.from(PHOTO_BUCKET).remove([path]);
    onChange((all) => all.map((g) => (g.id === id ? { ...g, photo_path: null } : g)));
    return null;
  }

  // Removing a machine only hides it (archived_at); its logged sets stay in History and Progress.
  async function setMachineRemoved(id: string, removed: boolean) {
    if (removed && confirmMachine !== id) {
      setConfirmMachine(id);
      window.setTimeout(() => setConfirmMachine((cur) => (cur === id ? null : cur)), 4000);
      return;
    }
    setConfirmMachine(null);
    setError(null);
    const stamp = removed ? new Date().toISOString() : null;
    const res = await db.from("exercises").update({ archived_at: stamp }).eq("id", id);
    if (res.error) {
      setError(
        /archived_at/.test(res.error.message)
          ? "Removing machines needs migration 0009 in the Supabase SQL Editor first."
          : explain(res.error.message, "Could not update that machine."),
      );
      return;
    }
    onCatalogChange((all) => all.map((m) => (m.id === id ? { ...m, archived_at: stamp } : m)));
  }

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
        const machines = catalog.filter((c) => c.gym_id === g.id && !c.archived_at);
        const removedMachines = catalog.filter((c) => c.gym_id === g.id && c.archived_at);
        const photo = g.photo_path ? urls[g.photo_path] : undefined;
        const workouts = counts[g.id] ?? 0;
        return (
          <article key={g.id} className="overflow-hidden rounded-[20px] bg-card shadow-sm">
            {photo ? (
              <button
                type="button"
                onClick={() => setViewing({ kind: "gym", id: g.id })}
                aria-label={`View photo of ${g.name}`}
                className="block w-full"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo}
                  alt={`${g.name}`}
                  className="h-36 w-full object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              </button>
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
                        <li key={m.id} className="flex flex-wrap items-center gap-3">
                          {url ? (
                            <button
                              type="button"
                              onClick={() => setViewing({ kind: "machine", id: m.id })}
                              aria-label={`View photo of ${m.name}`}
                              className="shrink-0"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={url}
                                alt=""
                                className="h-11 w-11 rounded-lg object-cover"
                                onError={(e) => {
                                  e.currentTarget.style.visibility = "hidden";
                                }}
                              />
                            </button>
                          ) : (
                            <span className="h-11 w-11 shrink-0 rounded-lg bg-field" />
                          )}
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-bold">{m.name}</span>
                            <span className="block text-[13px] font-medium text-muted">
                              {equipmentLabel(m.equipment_type)}
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={() => (editing?.kind === "machine" && editing.id === m.id ? setEditing(null) : startEdit("machine", m.id, m.name, m.equipment_type))}
                            className="ml-auto h-9 shrink-0 rounded-lg px-3 text-[13px] font-bold text-accent"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => setMachineRemoved(m.id, true)}
                            className="h-9 shrink-0 rounded-lg px-3 text-[13px] font-bold text-red-600"
                          >
                            {confirmMachine === m.id ? "Tap again" : "Remove"}
                          </button>
                          {editing?.kind === "machine" && editing.id === m.id && <div className="w-full">{editForm("machine")}</div>}
                        </li>
                      );
                    })}
                  </ul>
                )}

                {removedMachines.length > 0 && (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => setRemovedMachinesOpen(removedMachinesOpen === g.id ? null : g.id)}
                      aria-expanded={removedMachinesOpen === g.id}
                      className="text-[13px] font-bold text-accent"
                    >
                      {removedMachinesOpen === g.id ? "Hide" : "Show"} removed machines ({removedMachines.length})
                    </button>
                    {removedMachinesOpen === g.id && (
                      <ul className="mt-2 flex flex-col gap-2">
                        {removedMachines.map((m) => (
                          <li key={m.id} className="flex items-center gap-3">
                            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-muted">{m.name}</span>
                            <button
                              type="button"
                              onClick={() => setMachineRemoved(m.id, false)}
                              className="h-9 shrink-0 rounded-lg bg-field px-3 text-[13px] font-bold"
                            >
                              Restore
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {editing?.kind === "gym" && editing.id === g.id ? (
                  <div className="mt-4">{editForm("gym")}</div>
                ) : (
                  <button
                    type="button"
                    onClick={() => startEdit("gym", g.id, g.name, "")}
                    className="mt-4 h-11 w-full rounded-[14px] bg-field text-sm font-bold"
                  >
                    Edit gym name
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => choosePhoto(g.id)}
                  className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-[14px] bg-field text-sm font-bold"
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
            className="h-11 min-w-0 flex-1 rounded-xl border-2 border-accent bg-card px-3 text-base font-semibold outline-none"
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

      {viewing &&
        (() => {
          const g = viewing.kind === "gym" ? gyms.find((x) => x.id === viewing.id) : null;
          const m = viewing.kind === "machine" ? catalog.find((x) => x.id === viewing.id) : null;
          const path = g?.photo_path ?? m?.photo_path ?? null;
          const url = path ? (viewing.kind === "gym" ? urls[path] : machineUrls[path]) : undefined;
          if (!url) return null;
          return (
            <PhotoViewer
              url={url}
              title={g?.name ?? m?.name ?? "Photo"}
              onClose={() => setViewing(null)}
              onReplace={(file) => (viewing.kind === "gym" ? replaceGymPhoto(viewing.id, file) : onReplacePhoto(viewing.id, file))}
              onDelete={() => (viewing.kind === "gym" ? deleteGymPhoto(viewing.id) : onDeletePhoto(viewing.id))}
            />
          );
        })()}

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          onPhoto(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </section>
  );
}

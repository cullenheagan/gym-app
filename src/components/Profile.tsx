"use client";

import { useState } from "react";

export default function Profile({
  email,
  name,
  onSave,
}: {
  email: string;
  name: string;
  onSave: (name: string) => Promise<string | null>; // returns an error message, or null when saved
}) {
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setBusy(true);
    setNote(null);
    const err = await onSave(value.trim());
    setBusy(false);
    setNote(err ? { ok: false, text: err } : { ok: true, text: "Saved." });
  }

  return (
    <div className="px-4 pb-8 pt-4">
      <h2 className="px-1 text-[32px] font-extrabold leading-tight tracking-tight">Profile</h2>
      <div className="mt-4 rounded-[20px] bg-card p-5 shadow-sm">
        <label htmlFor="display-name" className="text-sm font-extrabold">
          Your name
        </label>
        <p className="mt-0.5 text-xs text-muted">Shown in the greeting on Home.</p>
        <input
          id="display-name"
          value={value}
          maxLength={40}
          onChange={(e) => setValue(e.target.value)}
          className="mt-3 h-11 w-full rounded-[14px] bg-field px-4 text-base outline-none"
          autoComplete="given-name"
        />
        <button
          type="button"
          onClick={save}
          disabled={busy || value.trim() === name}
          className="mt-3 h-11 w-full rounded-[14px] bg-accent text-sm font-bold text-on-accent disabled:opacity-50"
        >
          {busy ? "Saving..." : "Save"}
        </button>
        {note && (
          <p role="status" className={`mt-2 text-sm font-semibold ${note.ok ? "text-done" : "text-red-600"}`}>
            {note.text}
          </p>
        )}
      </div>
      <p className="mt-4 px-1 text-xs text-muted">Signed in as {email}</p>
    </div>
  );
}

"use client";

import { useRef, useState } from "react";
import type { Unit } from "@/lib/units";
import Avatar from "./Avatar";

export type ThemeChoice = "light" | "dark" | "system";

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-xl bg-line p-[3px]" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={`h-10 flex-1 rounded-[10px] text-sm font-bold ${value === o.id ? "bg-card text-ink" : "text-muted"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function Settings({
  email,
  name,
  avatar,
  theme,
  unit,
  onSaveName,
  onPhoto,
  onTheme,
  onUnit,
  onSignOut,
}: {
  email: string;
  name: string;
  avatar: string | null;
  theme: ThemeChoice;
  unit: Unit;
  onSaveName: (name: string) => Promise<string | null>; // error message, or null when saved
  onPhoto: (file: File) => Promise<string | null>;
  onTheme: (t: ThemeChoice) => void;
  onUnit: (u: Unit) => void;
  onSignOut: () => void;
}) {
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  async function save() {
    setBusy(true);
    setNote(null);
    const err = await onSaveName(value.trim());
    setBusy(false);
    setNote(err ? { ok: false, text: err } : { ok: true, text: "Saved." });
  }

  async function picked(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    setNote(null);
    const err = await onPhoto(f);
    setBusy(false);
    setNote(err ? { ok: false, text: err } : { ok: true, text: "Photo saved." });
  }

  return (
    <div className="px-4 pb-8 pt-4">
      <h2 className="px-1 text-[32px] font-extrabold leading-tight tracking-tight">Settings</h2>

      <section className="mt-4 rounded-[20px] bg-card p-5 shadow-sm">
        <div className="flex items-center gap-4">
          <Avatar src={avatar} name={name} email={email} size={72} />
          <button
            type="button"
            onClick={() => file.current?.click()}
            disabled={busy}
            className="h-10 rounded-[14px] bg-field px-4 text-sm font-bold disabled:opacity-60"
          >
            {avatar ? "Change photo" : "Add photo"}
          </button>
        </div>
        <input
          ref={file}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            picked(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <label htmlFor="display-name" className="mt-4 block text-sm font-extrabold">
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
          {busy ? "Saving..." : "Save name"}
        </button>
        {note && (
          <p role="status" className={`mt-2 text-sm font-semibold ${note.ok ? "text-done" : "text-red-600"}`}>
            {note.text}
          </p>
        )}
      </section>

      <section className="mt-4 rounded-[20px] bg-card p-5 shadow-sm">
        <h3 className="text-sm font-extrabold">Appearance</h3>
        <div className="mt-2">
          <Segmented
            label="Appearance"
            value={theme}
            options={[
              { id: "light", label: "Light" },
              { id: "dark", label: "Dark" },
              { id: "system", label: "Match phone" },
            ]}
            onChange={onTheme}
          />
        </div>
        <h3 className="mt-5 text-sm font-extrabold">Weight unit</h3>
        <div className="mt-2">
          <Segmented
            label="Weight unit"
            value={unit}
            options={[
              { id: "lb", label: "lb" },
              { id: "kg", label: "kg" },
            ]}
            onChange={onUnit}
          />
        </div>
      </section>

      <p className="mt-4 px-1 text-xs text-muted">Signed in as {email}</p>
      <button type="button" onClick={onSignOut} className="mt-2 h-11 w-full rounded-[14px] bg-card text-sm font-bold text-red-600 shadow-sm">
        Sign out
      </button>
    </div>
  );
}

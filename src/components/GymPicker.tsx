"use client";

import { useEffect, useRef, useState } from "react";
import type { Gym } from "@/lib/types";

function Thumb({ gym, url, size }: { gym: Gym | null; url?: string; size: number }) {
  const [bad, setBad] = useState(false);
  if (gym && url && !bad) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        onError={() => setBad(true)}
        className="shrink-0 rounded-lg object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-lg bg-field text-xs font-extrabold text-muted"
      style={{ width: size, height: size }}
    >
      {gym ? gym.name.trim()[0]?.toUpperCase() : ""}
    </span>
  );
}

// The "Current gym" menu. A plain <select> cannot show pictures, so this is a small custom menu
// that shows each gym's photo next to its name.
export default function GymPicker({
  gyms,
  urls,
  value,
  onChange,
  onAdd,
}: {
  gyms: Gym[];
  urls: Record<string, string>;
  value: string;
  onChange: (id: string) => void;
  onAdd: () => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const current = gyms.find((g) => g.id === value) ?? null;

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const photoOf = (g: Gym | null) => (g?.photo_path ? urls[g.photo_path] : undefined);
  const row = "flex w-full items-center gap-3 px-3 py-2 text-left text-sm font-semibold";

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        id="gym"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-12 w-full items-center gap-3 rounded-full border border-line bg-card pl-2 pr-4 text-left text-sm font-semibold text-ink"
      >
        <Thumb gym={current} url={photoOf(current)} size={34} />
        <span className="min-w-0 flex-1 truncate">{current ? current.name : "No gym selected"}</span>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label="Current gym"
          className="absolute left-0 right-0 z-20 mt-2 max-h-80 overflow-y-auto rounded-[20px] border border-line bg-card py-1 shadow-lg"
        >
          <li role="option" aria-selected={value === ""}>
            <button
              type="button"
              className={`${row} text-muted`}
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              <Thumb gym={null} size={34} />
              No gym selected
            </button>
          </li>
          {gyms.map((g) => (
            <li key={g.id} role="option" aria-selected={g.id === value}>
              <button
                type="button"
                className={`${row} ${g.id === value ? "bg-tint text-accent" : ""}`}
                onClick={() => {
                  onChange(g.id);
                  setOpen(false);
                }}
              >
                <Thumb gym={g} url={photoOf(g)} size={34} />
                <span className="min-w-0 flex-1 truncate">{g.name}</span>
              </button>
            </li>
          ))}
          <li role="option" aria-selected={false}>
            <button
              type="button"
              className={`${row} text-accent`}
              onClick={() => {
                setOpen(false);
                onAdd();
              }}
            >
              <span aria-hidden="true" className="flex h-[34px] w-[34px] shrink-0 items-center justify-center text-lg">
                +
              </span>
              Add a gym
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

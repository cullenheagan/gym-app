"use client";

import { useEffect, useRef, useState } from "react";

// Full-screen look at a machine, bench setup or gym photo, with Replace and Delete.
// onReplace / onDelete return an error message, or null when it worked.
export default function PhotoViewer({
  url,
  title,
  onClose,
  onReplace,
  onDelete,
}: {
  url: string;
  title: string;
  onClose: () => void;
  onReplace: (file: File) => Promise<string | null>;
  onDelete: () => Promise<string | null>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function replace(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    const err = await onReplace(file);
    setBusy(false);
    if (err) setError(err);
  }

  async function remove() {
    if (!confirm) {
      setConfirm(true);
      window.setTimeout(() => setConfirm(false), 4000);
      return;
    }
    setBusy(true);
    setError(null);
    const err = await onDelete();
    setBusy(false);
    if (err) setError(err);
    else onClose();
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={`Photo of ${title}`} className="fixed inset-0 z-[70] flex flex-col bg-black/90 p-4">
      <div className="flex items-center justify-between gap-3 text-white">
        <p className="min-w-0 truncate text-base font-extrabold">{title}</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close photo"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <button type="button" onClick={onClose} aria-label="Tap to close" className="my-3 flex min-h-0 flex-1 items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={title} className="max-h-full max-w-full rounded-xl object-contain" />
      </button>

      {error && (
        <p role="alert" className="mb-2 text-center text-sm font-semibold text-red-300">
          {error}
        </p>
      )}
      <div className="mx-auto flex w-full max-w-md gap-2">
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          className="h-12 flex-1 rounded-[14px] bg-white text-sm font-bold text-black disabled:opacity-60"
        >
          {busy ? "Working..." : "Replace photo"}
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="h-12 flex-1 rounded-[14px] bg-red-600 text-sm font-bold text-white disabled:opacity-60"
        >
          {confirm ? "Tap again to delete" : "Delete photo"}
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          replace(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}

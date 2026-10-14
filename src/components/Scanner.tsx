"use client";

import { useEffect, useRef, useState } from "react";
import { decodeFrame } from "@/lib/barcode";

// Full-screen barcode scanner. Uses the phone's own reader when it has one (Android Chrome) and
// otherwise reads the camera picture itself (iPhones). A code counts once it is read twice.
type Detector = { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> };

export default function Scanner({ onCode, onClose, onTypeIt }: { onCode: (code: string) => void; onClose: () => void; onTypeIt: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [number, setNumber] = useState("");

  useEffect(() => {
    let stop = false;
    let stream: MediaStream | null = null;
    let timer = 0;
    let last = "";
    const canvas = document.createElement("canvas");

    const found = (code: string) => {
      if (stop) return;
      if (code !== last) {
        last = code;
        return; // wait for a second matching read
      }
      stop = true;
      onCode(code);
    };

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("no camera");
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        if (stop) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const v = video.current;
        if (!v) return;
        // Ask for continuous autofocus when the phone offers it (helps up close); ignored otherwise.
        try {
          await stream.getVideoTracks()[0]?.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] });
        } catch {}
        v.srcObject = stream;
        await v.play();
        const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
        let native: Detector | null = null;
        try {
          native = BD ? new BD({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] }) : null;
        } catch {
          native = null;
        }
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const tick = async () => {
          if (stop) return;
          try {
            if (v.videoWidth > 0) {
              let code: string | null = null;
              if (native) {
                const r = await native.detect(v);
                code = r[0]?.rawValue ?? null;
              }
              if (!code && ctx) {
                // Read the middle of the picture at full size (a small barcode needs every pixel).
                const w = Math.min(1920, v.videoWidth);
                const scale = w / v.videoWidth;
                const sy = Math.round(v.videoHeight * 0.22);
                const sh = Math.round(v.videoHeight * 0.56);
                const h = Math.max(8, Math.round(sh * scale));
                canvas.width = w;
                canvas.height = h;
                ctx.drawImage(v, 0, sy, v.videoWidth, sh, 0, 0, w, h);
                code = decodeFrame(ctx.getImageData(0, 0, w, h).data, w, h);
              }
              if (code) found(code);
            }
          } catch {}
          if (!stop) timer = window.setTimeout(tick, 120);
        };
        tick();
      } catch (e) {
        const name = (e as { name?: string }).name;
        setError(
          name === "NotAllowedError" || name === "SecurityError"
            ? "The camera is blocked. Allow camera access for this app in your phone's settings, or type the food in."
            : "The camera could not start. You can type the barcode number or the food in instead.",
        );
      }
    })();

    return () => {
      stop = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const digits = number.replace(/\D/g, "");

  return (
    <div role="dialog" aria-modal="true" aria-label="Scan a barcode" className="fixed inset-0 z-[80] flex flex-col bg-black text-white">
      <div className="flex items-center justify-between gap-3 p-4">
        <h2 className="text-lg font-extrabold">Scan a barcode</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        <video ref={video} playsInline muted className="h-full w-full object-cover" />
        {!error && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-32 w-[82%] rounded-2xl border-2 border-white/80" />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black p-6 text-center">
            <p role="alert" className="text-base font-semibold">
              {error}
            </p>
            <button type="button" onClick={onTypeIt} className="h-11 rounded-[14px] bg-white px-5 text-sm font-bold text-black">
              Type it in
            </button>
          </div>
        )}
      </div>

      <div className="p-4 pb-6">
        <p className="text-center text-sm font-medium text-white/80">Line the barcode up inside the box and hold steady.</p>
        <div className="mt-3 flex gap-2">
          <input
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            inputMode="numeric"
            placeholder="Or type the barcode number"
            aria-label="Barcode number"
            maxLength={14}
            className="h-11 min-w-0 flex-1 rounded-[14px] bg-white/15 px-4 text-base text-white outline-none placeholder:text-white/60"
          />
          <button
            type="button"
            onClick={() => onCode(digits)}
            disabled={digits.length < 8}
            className="h-11 rounded-[14px] bg-white px-4 text-sm font-bold text-black disabled:opacity-40"
          >
            Look up
          </button>
        </div>
      </div>
    </div>
  );
}

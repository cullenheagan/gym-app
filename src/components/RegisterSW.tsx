"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/sw-register";

export default function RegisterSW() {
  useEffect(() => {
    // Only in the deployed build; during development it would cache stale code.
    if (process.env.NODE_ENV !== "production") return;
    if (document.readyState === "complete") registerServiceWorker();
    else window.addEventListener("load", () => registerServiceWorker(), { once: true });
  }, []);
  return null;
}

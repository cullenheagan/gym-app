// Registers the offline service worker and hands it the built files this page uses.
export async function registerServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    const reg = await navigator.serviceWorker.ready;
    const urls = performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .filter((n) => n.includes("/_next/static/"));
    reg.active?.postMessage({ type: "CACHE_URLS", urls });
  } catch {
    // Offline mode is a bonus; the app works without it.
  }
}

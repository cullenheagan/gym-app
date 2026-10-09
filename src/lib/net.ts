// Turns raw network failures ("TypeError: Failed to fetch") into something readable.
export function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export function looksLikeNetworkError(message: string | undefined | null): boolean {
  return !!message && /failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(message);
}

export function explain(message: string | undefined | null, fallback: string): string {
  if (isOffline() || looksLikeNetworkError(message)) {
    return "You're offline. This needs a connection, so try again once you have signal.";
  }
  return message || fallback;
}

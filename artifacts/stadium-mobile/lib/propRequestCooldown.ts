/** Per-route backpressure for the shared prop fan-out. Never caches odds. */
export function createPropRequestCooldown(now: () => number = Date.now) {
  const until = new Map<string, number>();
  const route = (path: string) => {
    const key = path.split("?")[0]!;
    return key === "/sports/props" || key === "/sports/prizepicks-props" ? key : null;
  };
  const isBlocked = (path: string) => {
    const key = route(path);
    if (!key) return false;
    if ((until.get(key) ?? 0) > now()) return true;
    until.delete(key);
    return false;
  };
  return {
    isBlocked,
    assertAllowed(path: string) {
      if (isBlocked(path)) throw new Error("HTTP 429 prop route cooldown");
    },
    block(path: string, retryAfter: string | null) {
      const key = route(path);
      if (!key) return false;
      const seconds = retryAfter?.trim() ? Number(retryAfter) : NaN;
      const date = retryAfter ? Date.parse(retryAfter) : NaN;
      const delay = Number.isFinite(seconds) && seconds >= 0
        ? seconds * 1000
        : Number.isFinite(date) ? Math.max(0, date - now()) : 60_000;
      until.set(key, Math.max(until.get(key) ?? 0, now() + Math.max(1000, delay)));
      return true;
    },
  };
}

export const propRequestCooldown = createPropRequestCooldown();

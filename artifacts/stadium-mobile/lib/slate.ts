// Pure slate / pickability helpers. Kept dependency-free (no expo, no fetch) so
// they can be unit-tested under `node --test` and shared widely. api.ts
// re-exports these so existing `from "./api"` imports keep working.

// ---------- Pickability window ----------

// In progress (started up to 4h ago) OR tips off within the next 48h.
export function isPickable(startsAt?: string | null): boolean {
  if (!startsAt) return false;
  const t = Date.parse(startsAt);
  if (!Number.isFinite(t)) return false;
  const now = Date.now();
  return t > now - 4 * 3600_000 && t < now + 48 * 3600_000;
}

// "Today / tonight only" intent. The user wants games on the CURRENT local
// calendar day that haven't started yet — no tomorrow, no already-in-progress.
// "tomorrow" anywhere disables it so "today or tomorrow" keeps the full window.
export function wantsTodayOnly(text?: string | null): boolean {
  const t = String(text || "").toLowerCase();
  if (!t) return false;
  if (/\btomorrow\b/.test(t)) return false;
  return /\b(?:today|tonight)\b/.test(t);
}

// A game is "today & upcoming" when it tips off later on the device's current
// calendar day (LOCAL time). Excludes already-started games and any game on a
// different date — matching the Today / Tomorrow labels the cards show, so a
// "today" ask never surfaces a tomorrow game or one that already kicked off.
export function startsTodayUpcoming(startsAt?: string | null): boolean {
  if (!startsAt) return false;
  const t = Date.parse(startsAt);
  if (!Number.isFinite(t)) return false;
  const now = Date.now();
  if (t <= now) return false; // already started (or tipping off right now)
  const d = new Date(t);
  const n = new Date(now);
  return (
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate()
  );
}

// Decide whether a "today / tonight" restriction should ACTUALLY be applied to
// the chat-context pools. It is requested by wantsTodayOnly(focalText), but we
// drop it when NO candidate game qualifies as today-and-upcoming — i.e. late in
// the evening, when tonight's slate has already started and the only posted
// games left in the feed are tomorrow's. Applying the restriction then would
// empty realOdds/realGames/realProps and make the coach falsely report the live
// board isn't loaded. Returning false in that case falls back to the normal
// next-48h pickable window; the games keep their real startsAt, so nothing is
// fabricated. `startTimes` is the flat list of candidate game start times (odds
// commence times + non-final game starts) gathered at context-build time.
export function resolveTodayOnly(
  requested: boolean,
  startTimes: (string | null | undefined)[],
): boolean {
  if (!requested) return false;
  return startTimes.some((t) => isPickable(t) && startsTodayUpcoming(t));
}

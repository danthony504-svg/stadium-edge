// Pure slate / pickability helpers. Kept dependency-free (no expo, no fetch) so
// they can be unit-tested under `node --test` and shared widely. api.ts
// re-exports these so existing `from "./api"` imports keep working.

// ---------- Pickability window ----------

// In progress (started up to 4h ago) OR tips off within the next 48h. Used by
// the Home/slate/Upcoming screens, which legitimately SHOW in-progress games.
export function isPickable(startsAt?: string | null): boolean {
  if (!startsAt) return false;
  const t = Date.parse(startsAt);
  if (!Number.isFinite(t)) return false;
  const now = Date.now();
  return t > now - 4 * 3600_000 && t < now + 48 * 3600_000;
}

// A game is BETTABLE by the AI Coach only while it is still PREGAME (hasn't
// started yet) and tips off within the next 48h. This is intentionally STRICTER
// than isPickable's 4h started-grace window: the coach's betting pools
// (realOdds/realProps) carry FROZEN pregame prices from the odds feed and mobile
// has NO live in-game odds feed, live score, or live dead-market guard. So once
// a game has started, its posted line is stale — offering it as a pregame value
// pick (e.g. a moneyline on a team that's already losing, off a frozen edge) is
// dishonest. Started games stay visible on the slate screens via isPickable, but
// must NOT seed coach picks. A game tipping off "right now" (t <= now) is treated
// as started.
export function isPregameBettable(startsAt?: string | null): boolean {
  if (!startsAt) return false;
  const t = Date.parse(startsAt);
  if (!Number.isFinite(t)) return false;
  const now = Date.now();
  return t > now && t < now + 48 * 3600_000;
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

// Parlay-build phrasing with no explicit future date — users expect tonight's slate
// (matches quick prompts + the Coach header copy).
const PARLAY_BUILD_RE =
  /\bbuild\b[^?]*\bparlay\b|\b\d{1,3}[-\s]?leg\b|\blongshot\b|\bplayer props only\b/i;

const FUTURE_SLATE_RE =
  /\b(?:next week|this weekend|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/;

/** Local calendar-day offset from now (0 = today, 1 = tomorrow). Matches formatGameTime. */
export function localDayDiff(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const startOfDay = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  return Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000);
}

/** True when the user wants tonight's / today's upcoming slate (not tomorrow). */
export function wantsTonightSlate(text?: string | null): boolean {
  if (wantsTodayOnly(text)) return true;
  const t = String(text || "").toLowerCase();
  if (/\btomorrow\b/.test(t)) return false;
  if (FUTURE_SLATE_RE.test(t)) return false;
  return PARLAY_BUILD_RE.test(t);
}

/** Inherit tonight intent from recent user turns ("5 leg parlay" after "for tonight"). */
export function threadWantsTonightSlate(
  current: string,
  priorUserTexts: string[] = [],
): boolean {
  if (wantsTonightSlate(current)) return true;
  for (let i = priorUserTexts.length - 1; i >= 0; i--) {
    const prior = priorUserTexts[i] ?? "";
    if (/\btomorrow\b/i.test(prior)) return false;
    if (wantsTonightSlate(prior)) return true;
  }
  return false;
}

export function filterTonightSlatePicks<T extends { startsAt?: string | null }>(
  picks: T[],
): T[] {
  return picks.filter((p) => startsTodayUpcoming(p.startsAt));
}

// True when the user explicitly asked for ONE game's ticket (same-game parlay,
// SGP, "for Team A @ Team B", etc.). Used to scope backfill to a single matchup.
// A generic "15-leg parlay for tonight" is NOT single-game even if the model's
// first few legs happen to land on one game — widening to the full slate is required.
export function explicitSingleGameIntent(text?: string | null): boolean {
  const t = String(text || "");
  if (!t) return false;
  if (/\bsame[\s-]?game\b/i.test(t)) return true;
  if (/\bsgp\b/i.test(t)) return true;
  if (/\b(this|that|the|one|single)\s+game\b/i.test(t)) return true;
  if (/\bgame\s*#?\s*\d+\b/i.test(t)) return true;
  if (
    /\bfor\s+[\w.&'’-]+\s+(?:@|vs\.?|versus|at|against)\s+[\w.&'’-]+/i.test(t)
  ) {
    return true;
  }
  return false;
}

// A game is "today & upcoming" when it tips off later on the device's current
// calendar day (LOCAL time). Excludes already-started games and any game on a
// different date — matching the Today / Tomorrow labels the cards show, so a
// "today" ask never surfaces a tomorrow game or one that already kicked off.
export function startsTodayUpcoming(startsAt?: string | null): boolean {
  if (!startsAt) return false;
  const t = Date.parse(startsAt);
  if (!Number.isFinite(t)) return false;
  if (t <= Date.now()) return false;
  return localDayDiff(startsAt) === 0;
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

// Pick the honest note appended under a "today / tonight" build after the
// startsTodayUpcoming post-parse filter. This only ever runs when todayOnly is
// active, which (via resolveTodayOnly) GUARANTEES at least one game is still
// upcoming today — so we must NEVER tell the user "nothing is upcoming". The
// note must distinguish the two reasons a today build can come back empty:
//   - before > 0  : legs DID ground in real odds but every one was on a game
//                   that already kicked off or isn't on today's calendar day,
//                   so the today filter removed them all.
//   - before === 0: the model emitted PICK lines but none grounded in real
//                   odds — today's slate is too thin to build the requested
//                   ticket without forcing it (e.g. a sport-locked soccer ask
//                   when only one match is still to come; you cannot make a
//                   SAFE 7-leg from a single game).
// When some legs survive but others were dropped, surface the transparency
// count. `before` is the resolved-pick count BEFORE the filter, `surviving` is
// the count after it. Returns "" when no note is warranted.
export function todayBuildNote(opts: {
  before: number;
  surviving: number;
  emittedPickLines: number;
}): string {
  const { before, surviving, emittedPickLines } = opts;
  if (surviving === 0 && emittedPickLines > 0) {
    return before > 0
      ? `\n\n_The legs I found are on games that already kicked off or aren't today, so there's nothing left to show for a today-only ticket. I can build from the next 48 hours instead, or you can check back as today's games get closer to kickoff._`
      : `\n\n_Today's slate is too thin to safely fill that — there aren't enough games still to start today to build it without forcing it. Want me to build from this week's full slate, or a shorter ticket from what's still to come today?_`;
  }
  const dropped = before - surviving;
  if (dropped > 0) {
    return `\n\n_Showing the ${surviving} real leg${surviving === 1 ? "" : "s"} for games still to start today; dropped ${dropped} that already started or aren't today._`;
  }
  return "";
}

// When the user asked for "tonight" but resolveTodayOnly dropped the pool
// restriction (every today game already started), explain why tomorrow legs are
// NOT shown and how to get them.
export function tonightExhaustedNote(opts: {
  tonightRequested: boolean;
  todayOnlyApplied: boolean;
  surviving: number;
  requestedLegs: number;
}): string {
  const { tonightRequested, todayOnlyApplied, surviving, requestedLegs } = opts;
  if (!tonightRequested || todayOnlyApplied) return "";
  if (surviving === 0) {
    return `\n\n_Tonight's games have already started and nothing is left on today's board. I won't pad this with tomorrow's slate — ask for a **tomorrow** parlay if you want those matchups._`;
  }
  if (requestedLegs > 0 && surviving < requestedLegs) {
    return `\n\n_Only legs from games still to play **today** — I won't add tomorrow's matchups to a "tonight" ticket._`;
  }
  return "";
}
// a specific prop market like strikeouts / home runs / shots / receptions, or a
// points-as-prop phrasing)? Used to keep a real props-only / prop-market ask from
// falling back to GAME-LEVEL mains: both the reach-the-count backfill and the
// today-only salvage skip the game-main fill when this is true so a "6 home run
// hitters" / "strikeout parlay" stays in props instead of silently becoming
// moneylines. A GENERIC "6-leg parlay for tonight" carries none of these words,
// so it returns false and the game-main fill stays available.
export function mentionsPropIntent(text?: string | null): boolean {
  const t = String(text || "");
  return (
    /\b(props?|prop bets?|player props?)\b/i.test(t) ||
    /\b(strikeouts?|k'?s|home runs?|hr|anytime td|anytime touchdowns?|touchdowns?|goal scorer|anytime goal|first goal|shots on target|sot|shots on goal|sog|shots?|passing yards?|pass yds?|rushing yards?|rush yds?|receiving yards?|rec yds?|receptions?|sacks?|pra|rebounds?|reb|assists?|ast|threes|3pm|3-?pointers?|stolen bases?|blocks?|blk|steals?|stl|turnovers?|hits?|total bases?)\b/i.test(
      t,
    ) ||
    /\b(points?|pts)\b(?=[^\n]{0,40}\b(props?|prop bet|parlay|legs?|over|under|line|ticket|\d+(?:\.\d+)?)\b)|\b(props?|prop bet|parlay|legs?|over|under|line|ticket|\d+(?:\.\d+)?)\b[^\n]{0,40}\b(points?|pts)\b/i.test(
      t,
    )
  );
}

// True when the user wants an ALL-PROP ticket (no game-level ML/spread/total legs).
// Keep "with player props" OUT of this helper: that means a prop-heavy mixed
// ticket, where player props should be included first but team/game props can
// still fill the requested count.
export function wantsPropsOnly(text?: string | null): boolean {
  if (!mentionsPropIntent(text)) return false;
  const t = String(text || "").toLowerCase();
  if (/\b(?:player\s+)?props?\s+only\b/.test(t)) return true;
  if (/\bonly\s+(?:player\s+)?props?\b/.test(t)) return true;
  if (/\b(?:player\s+)?props?\s+parlay\b/.test(t)) return true;
  if (/\bparlay\s+(?:of\s+)?(?:player\s+)?props?\b/.test(t)) return true;
  if (
    /\bparlay\b/.test(t) &&
    /\b(strikeouts?|k'?s|home runs?|hrs?|anytime td|receptions?|hits?|total bases?)\b/.test(t)
  ) {
    return true;
  }
  return false;
}

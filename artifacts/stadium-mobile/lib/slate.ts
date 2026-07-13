// Pure slate / pickability helpers. Kept dependency-free (no expo, no fetch) so
// they can be unit-tested under `node --test` and shared widely. api.ts
// re-exports these so existing `from "./api"` imports keep working.

import { focalSportsFromText } from "./chatContextPriority.ts";

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

// Home Discover / Upcoming rail: wider than isPickable so off-days (MLB All-Star
// break, etc.) still surface the next scheduled slate when the odds feed is empty
// or lines aren't posted yet. Coach betting pools keep the strict 48h gate.
export function isHomeDiscoverable(startsAt?: string | null): boolean {
  if (!startsAt) return false;
  const t = Date.parse(startsAt);
  if (!Number.isFinite(t)) return false;
  const now = Date.now();
  return t > now - 4 * 3600_000 && t < now + 7 * 24 * 3600_000;
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

/** Coach bettable horizon — pregame only, within the next 48h (all sports). */
export function isPregameBettableForSport(
  startsAt: string | null | undefined,
  _sport?: string,
): boolean {
  return isPregameBettable(startsAt);
}

/** Game Simulator pool: pregame only — no in-progress or final games. */
export function isSimulatorEligible(
  game: {
    startsAt?: string | null;
    state?: string | null;
    status?: string | null;
  } | null | undefined,
): boolean {
  if (!game) return false;
  if (game.state === "post" || game.state === "in") return false;
  const status = String(game.status ?? "").toLowerCase();
  if (
    status.includes("final") ||
    status.includes("in progress") ||
    status.includes("halftime") ||
    status.includes("end of")
  ) {
    return false;
  }
  // ESPN often lags `state: pre` after first pitch — the clock is authoritative.
  if (!isPregameBettable(game.startsAt)) return false;
  return true;
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
  /\b(?:build|make|give me|need|want)\b[^?]*\bparlay\b|\b\d{1,3}[-\s]?leg\b|\blongshot\b|\bplayer props only\b|\b(?:best|strongest|safest|top|good|great)\s+parlay\b/i;

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

/** True when the user explicitly asked for tonight's / today's upcoming slate. */
export function wantsTonightSlate(text?: string | null): boolean {
  if (wantsTodayOnly(text)) return true;
  const t = String(text || "").toLowerCase();
  if (/\btomorrow\b/.test(t)) return false;
  if (FUTURE_SLATE_RE.test(t)) return false;
  // A bare "N-leg parlay" uses the normal next-48h pickable window — defaulting
  // every build ask to tonight empties the pool in the evening and caps tickets at
  // the few games still upcoming today (e.g. 6-leg → honest 3-leg).
  return false;
}

/** MLB pitcher/bullpen slate targeting ("worst pitchers today", strikeout stacks). */
export function wantsMlbPitcherSlateAsk(text?: string | null): boolean {
  const t = String(text || "").toLowerCase();
  if (!t) return false;
  if (/\b(pitchers?|bullpens?|strikeouts?|k'?s|probables?)\b/.test(t)) {
    return /\b(slate|today|tonight|target|stack|fade|attack)\b/.test(t);
  }
  return false;
}

/** Inherit tonight intent from recent user turns ("5 leg parlay" after "for tonight"). */
export function threadWantsTonightSlate(
  current: string,
  priorUserTexts: string[] = [],
): boolean {
  if (wantsTomorrowSlate(current)) return false;
  if (wantsTonightSlate(current)) return true;
  for (let i = priorUserTexts.length - 1; i >= 0; i--) {
    const prior = priorUserTexts[i] ?? "";
    if (wantsTomorrowSlate(prior)) return false;
    if (wantsTonightSlate(prior)) return true;
  }
  return false;
}

export function filterTonightSlatePicks<T extends { startsAt?: string | null }>(
  picks: T[],
): T[] {
  return picks.filter((p) => startsTodayUpcoming(p.startsAt));
}

export function wantsTomorrowOnly(text?: string | null): boolean {
  return /\btomorrow\b/i.test(String(text || ""));
}

/** Game tips off tomorrow (local calendar) and hasn't started. */
export function startsTomorrowUpcoming(startsAt?: string | null): boolean {
  if (!startsAt) return false;
  const t = Date.parse(startsAt);
  if (!Number.isFinite(t)) return false;
  if (t <= Date.now()) return false;
  return localDayDiff(startsAt) === 1;
}

export function wantsTomorrowSlate(text?: string | null): boolean {
  return wantsTomorrowOnly(text);
}

export function threadWantsTomorrowSlate(
  current: string,
  priorUserTexts: string[] = [],
): boolean {
  if (wantsTomorrowSlate(current)) return true;
  for (let i = priorUserTexts.length - 1; i >= 0; i--) {
    if (wantsTomorrowSlate(priorUserTexts[i])) return true;
  }
  return false;
}

export function filterTomorrowSlatePicks<T extends { startsAt?: string | null }>(
  picks: T[],
): T[] {
  return picks.filter((p) => startsTomorrowUpcoming(p.startsAt));
}

export type SlateDay = "tonight" | "tomorrow" | null;

/** Which calendar-day slate the user asked for (tomorrow wins over tonight default). */
export function slateDayFromThread(
  current: string,
  priorUserTexts: string[] = [],
): SlateDay {
  if (threadWantsTomorrowSlate(current, priorUserTexts)) return "tomorrow";
  if (threadWantsTonightSlate(current, priorUserTexts)) return "tonight";
  return null;
}

export function slateOddsLabel(day: SlateDay): string {
  if (day === "tomorrow") return "tomorrow's";
  if (day === "tonight") return "tonight's";
  return "live";
}

export function filterPicksForSlateDay<T extends { startsAt?: string | null }>(
  picks: T[],
  day: SlateDay,
): T[] {
  if (day === "tonight") return filterTonightSlatePicks(picks);
  if (day === "tomorrow") return filterTomorrowSlatePicks(picks);
  return picks;
}

export function filterOddsForSlateDay<T extends { startsAt?: string | null }>(
  entries: T[],
  day: SlateDay,
): T[] {
  if (day === "tonight") {
    return entries.filter((e) => startsTodayUpcoming(e.startsAt));
  }
  if (day === "tomorrow") {
    return entries.filter((e) => startsTomorrowUpcoming(e.startsAt));
  }
  return entries;
}

/** Odds API games within the coach 48h pregame window. */
export function filterBettableOddsGames<T extends { sport?: string; commenceTime?: string }>(
  games: T[],
): T[] {
  return games.filter((g) => isPregameBettableForSport(g.commenceTime, g.sport ?? ""));
}

/** Prop pool rows within the same pregame horizon as coach context. */
export function filterBettablePropPool<T extends { sport?: string; startsAt?: string | null }>(
  pool: T[],
): T[] {
  return pool.filter((p) => isPregameBettableForSport(p.startsAt, p.sport ?? ""));
}

/** Resolved picks — drop far-future or already-started games. */
export function filterBettablePicks<T extends { sport?: string; startsAt?: string | null }>(
  picks: T[],
): T[] {
  return picks.filter((p) => isPregameBettableForSport(p.startsAt, p.sport ?? ""));
}

/** Strict coach delivery gate — requires kickoff metadata and 48h pregame window. */
export function filterCoachHorizonPicks<T extends { sport?: string; startsAt?: string | null }>(
  picks: T[],
): T[] {
  return picks.filter((p) => {
    if (!p.startsAt) return false;
    return isPregameBettableForSport(p.startsAt, p.sport ?? "");
  });
}

export function filterCoachHorizonPicksAfterEnrich<
  T extends {
    game?: string;
    market?: string;
    pick?: string;
    startsAt?: string | null;
    isProp?: boolean;
    player?: string;
    sport?: string;
  },
>(
  picks: T[],
  sources: Parameters<typeof enrichPicksWithStartsAt>[1],
): T[] {
  return filterCoachHorizonPicks(enrichPicksWithStartsAt(picks, sources));
}

/**
 * Drop legs with kickoff outside 48h. If every leg has a timestamp and none qualify,
 * return [] — never pass through an all-far-future ticket.
 */
export function preferBettableQualifiedPicks<T extends { sport?: string; startsAt?: string | null }>(
  picks: T[],
): T[] {
  if (!picks.length) return picks;
  const timestamped = picks.filter((p) => p.startsAt);
  if (!timestamped.length) return picks;
  const inWindow = timestamped.filter((p) =>
    isPregameBettableForSport(p.startsAt, p.sport ?? ""),
  );
  return inWindow;
}

/** Attach game kickoff times from odds/props/meta when board-built picks omit startsAt. */
export function enrichPicksWithStartsAt<
  T extends {
    game?: string;
    market?: string;
    pick?: string;
    startsAt?: string | null;
    isProp?: boolean;
    player?: string;
  },
>(
  picks: T[],
  sources: {
    realOdds?: Array<{ game: string; market?: string; pick?: string; startsAt?: string | null }>;
    propPool?: Array<{ game: string; player?: string; startsAt?: string | null }>;
    gameMeta?: Array<{ game: string; startsAt?: string | null }>;
    realGames?: Array<{ game?: string; startsAt?: string | null; commenceTime?: string }>;
  },
): T[] {
  const byGame = new Map<string, string>();
  for (const g of sources.realGames ?? []) {
    const label = g.game;
    const ts = g.startsAt ?? g.commenceTime;
    if (label && ts) byGame.set(label.toLowerCase(), ts);
  }
  for (const g of sources.gameMeta ?? []) {
    if (g.game && g.startsAt) byGame.set(g.game.toLowerCase(), g.startsAt);
  }
  for (const e of sources.realOdds ?? []) {
    if (e.game && e.startsAt) byGame.set(e.game.toLowerCase(), e.startsAt);
  }
  for (const e of sources.propPool ?? []) {
    if (e.game && e.startsAt) byGame.set(e.game.toLowerCase(), e.startsAt);
  }
  return picks.map((p) => {
    if (p.startsAt) return p;
    const fromGame = p.game ? byGame.get(p.game.toLowerCase()) : undefined;
    if (fromGame) return { ...p, startsAt: fromGame };
    if (!p.isProp) {
      const ro = sources.realOdds?.find(
        (r) => r.game === p.game && r.market === p.market && r.pick === p.pick && r.startsAt,
      );
      if (ro?.startsAt) return { ...p, startsAt: ro.startsAt };
    }
    if (p.isProp && p.player) {
      const pe = sources.propPool?.find(
        (e) => e.game === p.game && e.player === p.player && e.startsAt,
      );
      if (pe?.startsAt) return { ...p, startsAt: pe.startsAt };
    }
    return p;
  });
}

/** Sport-focused odds pool for parlay salvage (World Cup → soccer only, etc.). */
export function filterSalvageOddsPool<T extends { sport?: string; startsAt?: string | null }>(
  odds: T[],
  trimmed: string,
  slateDay: SlateDay,
): T[] {
  const salvageSports = focalSportsFromText(trimmed);
  const day = slateDay ? filterOddsForSlateDay(odds, slateDay) : odds;
  return salvageSports.size > 0 ? day.filter((e) => salvageSports.has(e.sport!)) : day;
}

export function resolveTomorrowOnly(
  requested: boolean,
  startTimes: (string | null | undefined)[],
): boolean {
  if (!requested) return false;
  return startTimes.some((t) => isPickable(t) && startsTomorrowUpcoming(t));
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
    /\b(scorers?|goalkeepers?|keepers?)\b/i.test(t) ||
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

/** Explicit N-leg count from user text, or 0 when omitted. */
export function parseRequestedLegCount(text: string): number {
  const m = String(text || "").match(/\b(\d{1,3})\s*[-\s]?\s*leg/i);
  if (!m) return 0;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Leg target for compact parlay builds when the user omits a count ("build a
 * parlay", "player props only parlay"). Without this, those asks fall through
 * to full buildChatContext and often connect-stall on mobile.
 */
export function effectiveBuildLegCount(text: string): number {
  const explicit = parseRequestedLegCount(text);
  if (explicit > 0) return explicit;
  if (!PARLAY_BUILD_RE.test(text)) return 0;
  return wantsPropsOnly(text) ? 6 : 8;
}

/**
 * Superlative / pool prop asks ("best HR for Dodgers tonight", "top strikeout
 * plays today") that name a market but NOT a parlay leg count. Without a fast
 * path these fall through to full all-sport buildChatContext and connect-stall
 * on cellular before the first stream token.
 */
export function wantsPropPickRecommendation(text?: string | null): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  const low = t.toLowerCase();
  if (PARLAY_BUILD_RE.test(t) || parseRequestedLegCount(t) > 0) return false;
  if (!mentionsPropIntent(t)) return false;
  // Either-or comparisons want the normal recommendation flow, not this tier.
  if (
    /\b or \b/i.test(t) &&
    /\b(hit|hr|home runs?|homers?|score|get|strikeouts?|touchdowns?|goals?|points?|pts|better|more likely)\b/.test(
      low,
    )
  )
    return false;
  if (/\b(?:best|top|strongest|safest|favorite|fav|value)\b/.test(low)) return true;
  if (/\b(?:picks?|plays?|bets?)\b/.test(low)) return true;
  if (/\b(?:give me|show me|find me|need|want)\b/.test(low)) return true;
  if (/\b(?:who|which)\b/.test(low) && /\b(?:hit|hr|home runs?|score|strikeout|touchdown|goal)\b/.test(low))
    return true;
  return false;
}

/** Ranked soccer scorer vs weak-keeper matchup asks — want PICK cards, not discovery prose. */
export function wantsSoccerScorerGoalkeeperPicks(text?: string | null): boolean {
  const low = String(text || "").toLowerCase();
  if (!low) return false;
  const scorerCue =
    /\b(?:best|top)\s+(?:goal\s+)?scorers?\b/.test(low) ||
    /\bscorers?\s+facing\b/.test(low) ||
    /\bworst\s+goalkeepers?\b/.test(low);
  const keeperCue = /\b(?:goalkeepers?|keepers?|goalies?)\b/.test(low);
  return scorerCue && keeperCue;
}

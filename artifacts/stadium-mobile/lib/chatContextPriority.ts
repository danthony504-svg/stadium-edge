// Pure, dependency-free helpers for focusing the AI Coach's chat context on the
// league(s)/game the user actually named. Kept out of ./api.ts (which imports
// expo/fetch and can't load in a plain Node test) so the prioritization that
// guards player game logs on busy slates can be unit-tested in isolation.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { PropPoolEntry } from "./api.ts";

// Sport keywords used to focus the chat realOdds context on the league(s) the
// user named. Only unambiguous terms — "football" is omitted because it spans
// NFL/CFB (and soccer in much of the world), so it can't resolve to one league.
export const FOCAL_SPORT_KEYWORDS: Record<string, string[]> = {
  mlb: ["mlb", "baseball", "pitcher", "pitchers", "bullpen", "bullpens", "pitching"],
  wnba: ["wnba", "wmba", "emba", "women's basketball"],
  nba: ["nba"],
  nhl: ["nhl", "hockey"],
  soccer: ["soccer", "epl", "mls", "la liga", "bundesliga", "serie a", "ligue 1", "premier league", "champions league", "ucl", "world cup", "fifa"],
  ufc: ["ufc", "mma"],
  tennis: ["tennis", "atp", "wta"],
  nfl: ["nfl"],
  ncaaf: ["ncaaf", "cfb", "college football"],
  ncaab: ["ncaab", "cbb", "college basketball"],
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when a sport keyword is explicitly negated ("no MLB", "without baseball"). */
export function isNegatedSportKeyword(text: string, keyword: string): boolean {
  const kw = escapeRegExp(keyword);
  return new RegExp(
    `\\b(?:no|not|without|exclude|excluding|skip|avoid)\\s+(?:any\\s+)?${kw}\\b`,
    "i",
  ).test(text);
}

export function focalSportsFromText(text: string | null | undefined): Set<string> {
  const out = new Set<string>();
  const t = String(text || "");
  if (!t) return out;
  for (const [id, words] of Object.entries(FOCAL_SPORT_KEYWORDS)) {
    for (const w of words) {
      if (isNegatedSportKeyword(t, w)) continue;
      if (new RegExp(`\\b${escapeRegExp(w)}\\b`, "i").test(t)) {
        out.add(id);
        break;
      }
    }
  }
  return out;
}

/** Sports the user explicitly excluded ("no MLB", "without NBA"). */
export function excludedSportsFromText(text: string | null | undefined): Set<string> {
  const out = new Set<string>();
  const t = String(text || "");
  if (!t) return out;
  for (const [id, words] of Object.entries(FOCAL_SPORT_KEYWORDS)) {
    for (const w of words) {
      if (isNegatedSportKeyword(t, w)) {
        out.add(id);
        break;
      }
    }
  }
  return out;
}

export function filterForExcludedSports<T extends { sport?: string | null }>(
  entries: T[],
  excluded: Set<string>,
): T[] {
  if (!excluded.size) return entries;
  return entries.filter((e) => !e.sport || !excluded.has(e.sport));
}

/** Strict pick filter — drops legs tagged or inferred as an excluded league. */
export function filterPicksForExcludedSports(
  picks: ParsedPick[],
  excluded: Set<string>,
): ParsedPick[] {
  if (!excluded.size) return picks;
  return picks.filter((p) => {
    for (const sport of excluded) {
      if (pickMatchesExcludedSport(p, sport)) return false;
    }
    return true;
  });
}

function sportForGameLabel(game: string, sportByGame: Map<string, string>): string | undefined {
  const key = game.toLowerCase();
  const direct = sportByGame.get(key);
  if (direct) return direct;
  for (const [g, sport] of sportByGame) {
    if (g === key || g.includes(key) || key.includes(g)) return sport;
  }
  return undefined;
}

const PROP_MARKET_SPORT_HINTS: { sport: string; re: RegExp }[] = [
  {
    sport: "mlb",
    re: /\b(home runs?|hrs?|strikeouts?|k'?s|hits?|hits runs rbis|rbis?|total bases?|stolen bases?|pitchers?|bullpens?)\b/i,
  },
  {
    sport: "nfl",
    re: /\b(anytime td|anytime touchdowns?|touchdowns?|receptions?|passing yards?|pass yds?|rushing yards?|rush yds?|receiving yards?|rec yds?)\b/i,
  },
  {
    sport: "nba",
    re: /\b(rebounds?|reb|assists?|ast|threes|3pm|3-?pointers?|steals?|stl|blocks?|blk)\b/i,
  },
  {
    sport: "soccer",
    re: /\b(scorers?|goalkeepers?|keepers?|shots on target|sot|goal scorer|anytime goal|first goal|clean sheets?)\b/i,
  },
  { sport: "nhl", re: /\b(shots on goal|sog|saves?)\b/i },
];

function normPickText(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sportFromPropMarketKey(key?: string | null): string | undefined {
  if (!key) return undefined;
  if (/^batter_|^pitcher_/.test(key)) return "mlb";
  if (/^player_(threes|points_rebounds_assists|points_rebounds|points_assists|rebounds_assists)/.test(key)) {
    return "nba";
  }
  return undefined;
}

function inferSportFromPickText(pick: ParsedPick): string | undefined {
  const fromKey = sportFromPropMarketKey(pick.propMarketKey);
  if (fromKey) return fromKey;
  const blob = normPickText(`${pick.market} ${pick.pick}`);
  for (const { sport, re } of PROP_MARKET_SPORT_HINTS) {
    if (re.test(blob)) return sport;
  }
  return undefined;
}

/** True when a leg should be removed for an active sport exclusion. */
export function pickMatchesExcludedSport(pick: ParsedPick, sport: string): boolean {
  if (pick.sport === sport) return true;
  if (inferSportFromPickText(pick) === sport) return true;
  if (sportFromPropMarketKey(pick.propMarketKey) === sport) return true;
  return false;
}

/** Scan the full Coach thread — exclusions from an earlier turn still apply. */
export function excludedSportsFromThread(
  ...texts: (string | null | undefined)[]
): Set<string> {
  return excludedSportsFromText(texts.filter(Boolean).join(" "));
}

/**
 * Merge persisted exclusions with the current thread, and lift a ban when the
 * user positively names a league this turn ("15 leg MLB parlay").
 */
export function resolveExcludedSports(
  priorUserTexts: string[],
  currentText: string,
  persisted: Set<string>,
): Set<string> {
  const out = new Set(persisted);
  for (const sport of excludedSportsFromThread(...priorUserTexts, currentText)) {
    out.add(sport);
  }
  for (const sport of focalSportsFromText(currentText)) {
    out.delete(sport);
  }
  return out;
}

/** Fill missing pick.sport from the prop pool or game odds so exclusion filters work. */
export function enrichPicksWithSport(
  picks: ParsedPick[],
  propPool: PropPoolEntry[],
  realOdds: { game: string; sport?: string }[],
  gameMeta?: { game: string; sport: string }[],
): ParsedPick[] {
  const sportByGame = new Map<string, string>();
  for (const e of realOdds) {
    if (e.sport && e.game) sportByGame.set(e.game.toLowerCase(), e.sport);
  }
  for (const g of gameMeta ?? []) {
    if (g.sport && g.game) sportByGame.set(g.game.toLowerCase(), g.sport);
  }
  return picks.map((p) => {
    if (p.sport) return p;
    if (p.isProp && p.player) {
      const pool = propPool.find(
        (e) => e.player === p.player && (!p.game || e.game === p.game),
      );
      if (pool?.sport) return { ...p, sport: pool.sport };
    }
    const fromGame = p.game ? sportForGameLabel(p.game, sportByGame) : undefined;
    if (fromGame) return { ...p, sport: fromGame };
    const fromKey = sportFromPropMarketKey(p.propMarketKey);
    if (fromKey) return { ...p, sport: fromKey };
    const inferred = inferSportFromPickText(p);
    return inferred ? { ...p, sport: inferred } : p;
  });
}

/** Enrich sport tags, then drop any leg from an excluded league (or unknown sport). */
export function scrubExcludedSportsFromPicks(
  picks: ParsedPick[],
  excluded: Set<string>,
  propPool: PropPoolEntry[],
  realOdds: { game: string; sport?: string }[],
  gameMeta?: { game: string; sport: string }[],
): ParsedPick[] {
  if (!excluded.size) return picks;
  return filterPicksForExcludedSports(
    enrichPicksWithSport(picks, propPool, realOdds, gameMeta),
    excluded,
  );
}

/** Drop excluded leagues from per-game eval ladders used for alt-line grading. */
export function filterEvalLinesByExcludedSports(
  map: Map<string, { sport?: string | null }[]>,
  excluded: Set<string>,
): Map<string, { sport?: string | null }[]> {
  if (!excluded.size) return map;
  const out = new Map<string, { sport?: string | null }[]>();
  for (const [game, lines] of map) {
    const kept = filterForExcludedSports(lines, excluded);
    if (kept.length) out.set(game, kept);
  }
  return out;
}

/** Infer a single sport for a prop-pick ask from named leagues or market words. */
export function inferPropPickSport(text: string | null | undefined): string {
  const t = String(text || "");
  const focal = focalSportsFromText(t);
  if (focal.size === 1) return [...focal][0]!;
  // Soccer scorer/keeper matchup asks must not lose to a bare "goals" token (NHL).
  if (
    /\b(?:best|top)\s+(?:goal\s+)?scorers?\b/.test(t.toLowerCase()) &&
    /\b(?:goalkeepers?|keepers?|goalies?)\b/.test(t.toLowerCase())
  ) {
    return "soccer";
  }
  for (const { sport, re } of PROP_MARKET_SPORT_HINTS) {
    if (re.test(t)) return sport;
  }
  if (/\b(points?|pts)\b/i.test(t)) return "nba";
  return "mlb";
}

// Does this game label reference a team the user named? Matches alphabetic tokens
// of length >= 5 (skips short city words like "san"/"new"/"los") so a named-game
// ask ("knicks spurs Q1 ticket") floats that exact game's odds to the front.
export function gameMatchesFocalText(gameLabel: string, text: string | null | undefined): boolean {
  const t = String(text || "");
  if (!t) return false;
  const tokens = gameLabel.toLowerCase().match(/[a-z]{5,}/g) || [];
  for (const tok of tokens) {
    if (new RegExp(`\\b${tok}\\b`, "i").test(t)) return true;
  }
  return false;
}

// Default number of unique prop players whose REAL game logs the Coach pulls per
// chat request. The fetch is capped to bound latency/cost; the prioritization
// below decides WHICH players survive the cap.
export const PLAYER_HISTORY_CAP = 40;

// Order the prop players whose game logs get fetched, then trim to the cap. The
// 40-player cap can starve the players the user actually asked about: a busy
// in-season MLB slate alone can fill every slot, so an NBA/NFL game the user
// named would get no recent logs and the Coach would truthfully say "no recent
// log available" even though the server has the data. Priority tiers:
//   3 — the FOCAL game the user named (its players must survive the cap)
//   2 — any sport the user named (e.g. "give me NBA props")
//   1 — MLB (so batter-vs-pitcher platoon coverage stays intact when there is
//        no focal pull — MLB is the only sport with that extra signal)
//   0 — everyone else
// The sort is STABLE within each tier (ties keep original order) so behavior is
// deterministic. Returns at most `cap` targets.
export function prioritizePlayerHistoryTargets<T extends { sport: string; game: string }>(
  targets: T[],
  focalText: string | null | undefined,
  cap: number = PLAYER_HISTORY_CAP,
): T[] {
  const focalSports = focalSportsFromText(focalText);
  const rank = (t: { sport: string; game: string }): number => {
    if (focalText) {
      if (gameMatchesFocalText(t.game, focalText)) return 3;
      if (focalSports.has(t.sport)) return 2;
    }
    return t.sport === "mlb" ? 1 : 0;
  };
  return [...targets]
    .map((t, i) => ({ t, i }))
    .sort((a, b) => rank(b.t) - rank(a.t) || a.i - b.i)
    .map((x) => x.t)
    .slice(0, cap);
}

// How much REAL data the Coach feeds the model, scaled to the SIZE of the ticket
// the user asked for. A small parlay does not need the entire night's slate.
//
// Measured on the wire (api-server logs the serialized context size): the FULL
// pool is ~497 KB, and even a first pass at "medium" (280 props / 90 odds / 28
// logs / 12 matchups) was still ~367 KB — ~90K input tokens. The reasoning model's
// time-to-first-token grows with input length, so a generic "6-leg parlay for
// tonight" still sat on "Building your parlay…" past the stream watchdog, which
// then aborted and re-sent the whole payload in a retry loop (verified: repeated
// `request aborted` on /api/chat, never reaching a first token).
//
// matchupHistory and playerHistory are the heaviest per-ITEM fields — each entry
// carries recent-game / head-to-head / L10 / game-log arrays, so a handful of them
// dwarfs a hundred props. Both are supporting ANALYTICS (winner-consistency / upset
// / grounding prose), NOT the source of the PICK lines (those come from realProps +
// realOdds), so they are the safest things to cut hard. We therefore trim matchup
// most, history next, and keep a props/odds floor that still comfortably fills the
// requested legs (the server also backfills props beyond the context — see the
// server-returned prop pool). Big tickets (11+) keep the FULL breadth so they never
// come back short. (api-server logs an exact per-field BYTE breakdown — chatCtxBytes
// in "chat context size before model call" — use it to retune these tiers.)
export type ContextDepth = { props: number; odds: number; history: number; matchup: number };

// Tiers mirror the product spec: 2-5 legs = focused, 6-10 = medium, 11+ = full.
// `requestedLegs` is 0 when the ask carried no explicit count (general chat or an
// unnumbered build) — that falls back to the MEDIUM tier, still far leaner than
// the old always-max behavior but generous enough to fill a typical parlay.
export const CONTEXT_DEPTH_DEFAULT_LEGS = 8;
export function contextDepthForLegs(
  requestedLegs: number,
  fullPropCap: number,
  fullHistoryCap: number = PLAYER_HISTORY_CAP,
): ContextDepth {
  const n = requestedLegs > 0 ? requestedLegs : CONTEXT_DEPTH_DEFAULT_LEGS;
  // Tiny tickets (2-3 legs) get the smallest pool so the /api/chat POST body
  // stays uploadable on cellular — a generic 3-leg ask used to serialize ~300KB+.
  if (n <= 3) return { props: 45, odds: 28, history: 6, matchup: 2 };
  if (n <= 5) return { props: 80, odds: 45, history: 10, matchup: 3 };
  if (n <= 10) return { props: 110, odds: 55, history: 16, matchup: 4 };
  return { props: fullPropCap, odds: 120, history: fullHistoryCap, matchup: 16 };
}

/** Scale how many prop-capable games we fetch — big tickets need breadth. */
export function propGamesCapForLegs(requestedLegs: number, fullCap = 24): number {
  const n = requestedLegs > 0 ? requestedLegs : 8;
  if (n <= 3) return 4;
  if (n <= 6) return 12;
  if (n <= 10) return 16;
  return fullCap;
}

/**
 * Which sports to fetch for a Coach build. Named leagues win; otherwise scale
 * breadth to ticket size so a generic "3-leg parlay" does not fan out all 10
 * sports (20+ parallel fetches + a 300-500KB POST that connect-stalls on LTE).
 */
export function coachBuildSports(
  text: string | null | undefined,
  requestedLegs: number,
  allSports: string[],
): string[] {
  const excluded = excludedSportsFromText(text);
  const named = focalSportsFromText(text);
  let sports: string[];
  if (named.size > 0) sports = [...named];
  else {
    const n = requestedLegs > 0 ? requestedLegs : CONTEXT_DEPTH_DEFAULT_LEGS;
    if (n >= 11) sports = [...allSports];
    else if (n >= 6) {
      sports = ["mlb", "wnba", "nba", "nhl", "soccer", "ufc", "tennis"].filter((id) =>
        allSports.includes(id),
      );
    } else {
      sports = ["mlb", "wnba", "nba", "nhl"].filter((id) => allSports.includes(id));
    }
  }
  return sports.filter((s) => !excluded.has(s));
}

/** When resolved legs share one sport, focus salvage/top-up pools on that league. */
export function parlayPoolHint(trimmed: string, picks: { sport?: string | null }[]): string {
  const sports = new Set(picks.map((p) => p.sport).filter((s): s is string => !!s));
  if (sports.size !== 1) return trimmed;
  const sport = [...sports][0]!;
  if (focalSportsFromText(trimmed).has(sport)) return trimmed;
  return `${trimmed} ${sport}`;
}

// Pure, dependency-free helpers for focusing the AI Coach's chat context on the
// league(s)/game the user actually named. Kept out of ./api.ts (which imports
// expo/fetch and can't load in a plain Node test) so the prioritization that
// guards player game logs on busy slates can be unit-tested in isolation.

// Sport keywords used to focus the chat realOdds context on the league(s) the
// user named. Only unambiguous terms — "football" is omitted because it spans
// NFL/CFB (and soccer in much of the world), so it can't resolve to one league.
export const FOCAL_SPORT_KEYWORDS: Record<string, string[]> = {
  mlb: ["mlb", "baseball"],
  wnba: ["wnba"],
  nba: ["nba"],
  nhl: ["nhl", "hockey"],
  soccer: ["soccer", "epl", "mls", "la liga", "bundesliga", "serie a", "ligue 1", "premier league", "champions league", "ucl"],
  ufc: ["ufc", "mma"],
  tennis: ["tennis", "atp", "wta"],
  nfl: ["nfl"],
  ncaaf: ["ncaaf", "cfb", "college football"],
  ncaab: ["ncaab", "cbb", "college basketball"],
};

export function focalSportsFromText(text: string | null | undefined): Set<string> {
  const out = new Set<string>();
  const t = String(text || "");
  if (!t) return out;
  for (const [id, words] of Object.entries(FOCAL_SPORT_KEYWORDS)) {
    for (const w of words) {
      if (new RegExp(`\\b${w}\\b`, "i").test(t)) {
        out.add(id);
        break;
      }
    }
  }
  return out;
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
  if (n <= 5) return { props: 80, odds: 45, history: 10, matchup: 3 };
  if (n <= 10) return { props: 110, odds: 55, history: 16, matchup: 4 };
  return { props: fullPropCap, odds: 120, history: fullHistoryCap, matchup: 16 };
}

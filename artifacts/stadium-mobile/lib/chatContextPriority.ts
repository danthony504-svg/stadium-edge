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

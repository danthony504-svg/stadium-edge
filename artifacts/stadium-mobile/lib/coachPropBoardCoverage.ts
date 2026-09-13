/**
 * Which leagues contribute player props to the Coach full-board scan.
 *
 * Odds `/sports/props` only serves these sports (see api-server MARKETS_BY_SPORT).
 * UFC/tennis have game lines but no player-prop markets — they must not be
 * treated as prop-board gaps.
 *
 * Generic ("6 leg") asks previously used a compact sport list that omitted
 * ncaab, so college-basketball props never entered the pool even though the
 * props endpoint supports them. Named-league asks stay scoped.
 */

import {
  coachBuildSports,
  focalSportsFromText,
  isSoftSportPreferenceAsk,
  softSportPreferenceExpandsBoard,
} from "./chatContextPriority.ts";

/** Prop-capable leagues (mirrors stadium-mobile PROPS_SPORTS / api-server markets). */
export const PLAYER_PROP_SPORTS = [
  "mlb",
  "wnba",
  "nba",
  "nhl",
  "nfl",
  "ncaaf",
  "ncaab",
  "soccer",
] as const;

export type PlayerPropSport = (typeof PLAYER_PROP_SPORTS)[number];

export function isPlayerPropSport(sport: string): boolean {
  return (PLAYER_PROP_SPORTS as readonly string[]).includes(sport);
}

/**
 * Sports to load for a Coach board scan so player props cover every prop league
 * on generic (and soft-pref) asks, while hard named-league asks remain focused.
 */
export function coachBoardSportsForAsk(
  askText: string | null | undefined,
  requestedLegs: number,
  allSports: readonly string[],
): string[] {
  const base = coachBuildSports(askText, requestedLegs, [...allSports]);
  const focal = focalSportsFromText(askText);
  const softExpand =
    focal.size > 0 &&
    isSoftSportPreferenceAsk(askText) &&
    softSportPreferenceExpandsBoard(focal);
  // Hard named leagues stay scoped. Soft prefs + generics union every prop sport.
  if (focal.size > 0 && !softExpand) return base;

  const propSports = PLAYER_PROP_SPORTS.filter((s) => allSports.includes(s));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of [...base, ...propSports]) {
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/** True when a prop pool spans every prop-capable sport present in oddsGames. */
export function propPoolCoversPostedPropSports(
  oddsSports: iterableSports,
  poolSports: iterableSports,
): boolean {
  const posted = new Set(
    [...oddsSports].map((s) => String(s).toLowerCase()).filter(isPlayerPropSport),
  );
  if (posted.size === 0) return true;
  const inPool = new Set([...poolSports].map((s) => String(s).toLowerCase()));
  for (const s of posted) {
    if (!inPool.has(s)) return false;
  }
  return true;
}

type iterableSports = Iterable<string | null | undefined>;

/** Market-key families the props API is expected to serve (mains; alts/qh separate). */
export const EXPECTED_MAIN_PROP_FAMILIES: Record<string, string[]> = {
  mlb: ["batter_hits", "batter_hits_runs_rbis", "batter_home_runs", "pitcher_strikeouts"],
  nba: ["player_points", "player_rebounds", "player_assists", "player_threes"],
  nfl: ["player_pass_yds", "player_rush_yds", "player_reception_yds", "player_sacks", "player_anytime_td"],
  ncaaf: ["player_pass_yds", "player_rush_yds", "player_reception_yds", "player_anytime_td", "player_pass_tds"],
  ncaab: ["player_points", "player_rebounds", "player_assists"],
  nhl: ["player_points", "player_goals", "player_shots_on_goal", "player_assists"],
  wnba: ["player_points", "player_rebounds", "player_assists", "player_threes"],
  soccer: ["player_goal_scorer_anytime", "player_shots_on_target", "player_shots"],
};

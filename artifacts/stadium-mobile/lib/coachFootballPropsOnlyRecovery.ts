/**
 * Props-only quality-bar recovery — when a locked market family (TD / yards /
 * receptions / …) grades but stages 0, expand to the full football skill board
 * (yards, receptions, sacks, TDs, combos) including alt rungs.
 *
 * Not a gate tweak: the locked allowlist never saw softer skill alts that clear
 * history/EV. Phone: "7 leg touchdown" graded 42 TDs → empty quality bar while
 * posted rush/rec/sack alts would have cleared.
 */

import { canonicalPropMarketKey } from "./coachAskMarketFilter.ts";

/**
 * Football skill markets eligible for quality-bar recovery (mains + `_alternate`
 * via canonical key). Intentionally broad — TD ask empties → yards/rec/sacks.
 */
export const FOOTBALL_SKILL_RECOVERY_MARKET_KEYS = [
  "player_anytime_td",
  "player_first_td",
  "player_rush_tds",
  "player_reception_tds",
  "player_pass_tds",
  "player_rush_yds",
  "player_pass_yds",
  "player_reception_yds",
  "player_receptions",
  "player_rush_attempts",
  "player_pass_attempts",
  "player_pass_completions",
  "player_pass_interceptions",
  "player_sacks",
  "player_pass_rush_yds",
  "player_rush_reception_yds",
  "player_rush_reception_tds",
  "player_pass_rush_reception_yds",
  "player_pass_rush_reception_tds",
  "player_field_goals",
] as const;

const RECOVERY_SET = new Set(
  FOOTBALL_SKILL_RECOVERY_MARKET_KEYS.map((k) => canonicalPropMarketKey(k)),
);

export function isFootballSkillRecoveryMarket(
  marketKey: string | null | undefined,
): boolean {
  const canon = canonicalPropMarketKey(marketKey);
  return !!canon && RECOVERY_SET.has(canon);
}

/** Keep posted football skill mains + alts for recovery fill. */
export function filterPoolForFootballSkillRecovery<
  T extends { marketKey?: string | null; sport?: string | null },
>(pool: readonly T[]): T[] {
  return pool.filter((row) => {
    if (!isFootballSkillRecoveryMarket(row.marketKey)) return false;
    const sport = String(row.sport ?? "").toLowerCase();
    // Allow missing sport (some pool rows omit it) — market key is football.
    if (!sport) return true;
    return sport === "nfl" || sport === "ncaaf" || sport.includes("football");
  });
}

/**
 * True when the preferred (allowlisted) pass graded props but staged nothing —
 * recover from the broader skill board instead of painting an empty quality bar.
 */
export function shouldRecoverPropsOnlyWithFootballSkillBoard(opts: {
  graded: number;
  staged: number;
  /** Preferred / allowlisted pool size that just emptied. */
  preferredPoolSize: number;
  /** Broader skill recovery pool size. */
  skillPoolSize: number;
}): boolean {
  if (opts.graded <= 0) return false;
  if (opts.staged > 0) return false;
  if (opts.skillPoolSize <= 0) return false;
  // Need additional skill rows beyond the empty preferred slice when possible;
  // still allow recovery when preferred === skill (full board also emptied on
  // a narrow TD-shaped candidate set) as long as skill pool is non-empty.
  return opts.skillPoolSize >= Math.min(opts.preferredPoolSize, 1);
}

/** Honest Coach note after skill-board recovery fills a wiped allowlist ask. */
export function footballSkillRecoveryNote(opts: {
  preferredGraded: number;
  staged: number;
  target: number;
}): string {
  const n = opts.staged;
  const graded = opts.preferredGraded;
  const lead =
    n >= opts.target
      ? `Graded ${graded} locked-market props below the quality bar — staged ${n} clearing skill props (yards / receptions / sacks / TD alts).`
      : `Graded ${graded} locked-market props below the quality bar — staged ${n} of ${opts.target} clearing skill props (yards / receptions / sacks / TD alts). No ungraded filler was added.`;
  return lead;
}

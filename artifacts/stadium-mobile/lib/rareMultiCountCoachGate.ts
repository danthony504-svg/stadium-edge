/**
 * Fail-closed seating/EV gates for rare multi-count Overs (HR/SB/goals ≥1.5).
 *
 * Normal Coach must not seat lottery Over 1.5+ props just because tiny implied
 * probabilities manufacture huge Edge/EV. Explicit lottery / 2+ / longshot asks
 * keep the rare path. Preserves provider odds and market semantics.
 *
 * Pipeline: requires COACH_PIPELINE_VERSION === "unified-quality-v1".
 */

import { impliedProb } from "./format.ts";
import { scoreLineValue } from "./pickScore.ts";
import { propBelongsToGameTeams } from "./propGameTeamGate.ts";
import type { MlbGameEnvSlice, MlbPlatoonSlice } from "./propHolisticRecommendation.ts";
import {
  isRareCountPropMarket,
  isRareMultiCountOver,
  rareCountHitReliability,
  rareCountThresholdK,
  RARE_COUNT_MIN_SAMPLE,
} from "./rareCountPropModel.ts";
import { COACH_PIPELINE_VERSION } from "./coach/qualifyCoachCandidate.ts";

/** Attest unified-quality authority is present on this mobile path. */
export function assertUnifiedQualityPipeline(): {
  ok: boolean;
  version: string;
  expected: string;
} {
  const expected = "unified-quality-v1";
  return {
    ok: COACH_PIPELINE_VERSION === expected,
    version: COACH_PIPELINE_VERSION,
    expected,
  };
}

/**
 * Implied-prob threshold below which EV cannot dominate holistic grade.
 * ~3% ≈ American +3233; lottery HR (+10k…+110k) is far below this.
 */
export const RARE_IMPLIED_PROB_THRESHOLD = 0.03;

/**
 * Max edge (pct points) allowed into sportsbookValue when implied < threshold.
 * scoreLineValue(2.5) = 5.5 + 1.125 = 6.6 before scale — still cannot alone
 * lift a weak sim (~1.9) composite to C+ (≥6.0) once scaled by implied/θ.
 */
export const RARE_EV_GRADE_EDGE_CAP = 2.5;

/**
 * Minimum rare-count reliability for normal (non-lottery) Coach seating.
 * Cronenworth-style 1×2HR / 10 games lands ~0.29 — blocked.
 */
export const RARE_MULTI_COUNT_MIN_RELIABILITY = 0.55;

/**
 * Exact EV-cap formula for rare multi-count Overs with tiny implied probs:
 *
 *   if !isRareMultiCountOver → edge unchanged
 *   if implied >= RARE_IMPLIED_PROB_THRESHOLD → edge unchanged
 *   else:
 *     scale = implied / RARE_IMPLIED_PROB_THRESHOLD          // (0, 1)
 *     boundedEdge = min(max(0, edgePct), RARE_EV_GRADE_EDGE_CAP) * scale
 *
 * sportsbookValue uses scoreLineValue(boundedEdge). Ordinary markets untouched.
 */
export function rareMultiCountBoundedEdgePct(
  edgePct: number | null | undefined,
  americanOdds: number | null | undefined,
  opts: { market?: string | null; side?: string | null; line?: number | null },
): number | null {
  if (edgePct == null || !Number.isFinite(edgePct)) return null;
  if (
    americanOdds == null ||
    !Number.isFinite(americanOdds) ||
    americanOdds === 0 ||
    !isRareMultiCountOver(opts)
  ) {
    return edgePct;
  }
  const implied = impliedProb(americanOdds);
  if (!Number.isFinite(implied) || implied >= RARE_IMPLIED_PROB_THRESHOLD) {
    return edgePct;
  }
  const scale = implied / RARE_IMPLIED_PROB_THRESHOLD;
  const capped = Math.min(Math.max(0, edgePct), RARE_EV_GRADE_EDGE_CAP);
  return capped * scale;
}

/** Holistic sportsbookValue (1–10) after rare multi-count EV bound. */
export function rareMultiCountSportsbookValueScore(
  edgePct: number | null | undefined,
  americanOdds: number | null | undefined,
  opts: { market?: string | null; side?: string | null; line?: number | null },
): number | null {
  const bounded = rareMultiCountBoundedEdgePct(edgePct, americanOdds, opts);
  return scoreLineValue(bounded);
}

/**
 * Explicit ask allows rare multi-count / lottery path.
 * Matches: lottery, longshot(s), boom, 2+ HR, multi-HR, two-plus, etc.
 */
export function askAllowsRareMultiCountProps(
  askText: string | null | undefined,
): boolean {
  const t = String(askText ?? "").toLowerCase();
  if (!t.trim()) return false;
  if (/\b(?:long\s?shots?|longshots?|lottery|boom)\b/.test(t)) return true;
  // "2+" / "2 or more" — do not require a trailing word-boundary after '+'
  // ( '+' is non-word; "\b" after it never matches before whitespace ).
  if (
    /(?:^|\s)(?:2\+|two\s*\+|2\s*or\s*more|two\s+or\s+more)(?:\s|$)/.test(t) ||
    /\b(?:multi[\s-]?hrs?|multi[\s-]?home\s*runs?|multi[\s-]?homer(?:s|uns?)?)\b/.test(t)
  ) {
    return true;
  }
  // "2 home runs" / "two homers" as a line ask (not "2 leg home runs").
  if (
    /\b(?:2|two)\s+(?:home\s*runs?|homers?|hrs?)\b/.test(t) &&
    !/\b(?:2|two)\s+leg\b/.test(t)
  ) {
    return true;
  }
  return false;
}

export type RareMultiCountSeatAllowOpts = {
  askText?: string | null;
  /** Explicit longshot ticket style / request style. */
  ticketStyle?: string | null;
  requestStyle?: string | null;
  hitReliability?: number | null;
  /** When true, skip reliability floor (still needs sim + grounding elsewhere). */
  allowLotteryPath?: boolean;
};

/** Whether the ask/style opens the rare multi-count lottery path. */
export function rareMultiCountLotteryPathOpen(
  opts: RareMultiCountSeatAllowOpts,
): boolean {
  if (opts.allowLotteryPath) return true;
  if (opts.requestStyle === "longshot" || opts.ticketStyle === "longshot") {
    return true;
  }
  return askAllowsRareMultiCountProps(opts.askText);
}

/**
 * Normal Coach seating eligibility for a rare multi-count Over.
 * Returns true when the leg may compete for a seat (still must pass #711 qualify).
 */
export function rareMultiCountNormalSeatAllowed(
  pick: {
    propMarketKey?: string | null;
    market?: string | null;
    propSide?: string | null;
    propLine?: number | null;
    isProp?: boolean | null;
  },
  opts: RareMultiCountSeatAllowOpts = {},
): boolean {
  if (!pick.isProp) return true;
  const market = pick.propMarketKey ?? pick.market;
  if (
    !isRareMultiCountOver({
      market,
      side: pick.propSide,
      line: pick.propLine,
    })
  ) {
    return true;
  }
  if (rareMultiCountLotteryPathOpen(opts)) return true;
  const rel = opts.hitReliability;
  if (rel == null || !Number.isFinite(rel)) return false;
  return rel >= RARE_MULTI_COUNT_MIN_RELIABILITY;
}

export type RareHrHardContextInput = {
  playerTeamId?: string | null;
  homeTeamId?: string | null;
  awayTeamId?: string | null;
  gameEnv?: MlbGameEnvSlice | null;
  platoon?: MlbPlatoonSlice | null;
  /** Per-game HR counts from logs (same series rareCountHit uses). */
  hrHistoryValues?: number[] | null;
  playerTeamIsHome?: boolean | null;
};

export type RareHrHardContextResult = {
  ok: boolean;
  missing: string[];
  required: string[];
};

/**
 * Hard-required HR context for rare multi-count HR on normal Coach:
 * 1. playerTeamId ∈ {home, away} (authoritative event grounding)
 * 2. opposing pitcher identity or tendency
 * 3. venue/park context (park index or venue/dome flag)
 * 4. sufficient historical HR evidence (sample ≥ RARE_COUNT_MIN_SAMPLE and λ>0)
 *
 * Platoon/handedness: hard when the feed already attached a platoon slice
 * (must be present); optional when never loaded.
 * Weather: optional always.
 */
export function rareHrHardContextOk(
  input: RareHrHardContextInput,
): RareHrHardContextResult {
  const required = [
    "player_event_team_grounding",
    "opposing_pitcher_context",
    "venue_park_context",
    "historical_hr_evidence",
  ];
  const missing: string[] = [];

  if (
    !propBelongsToGameTeams(
      input.playerTeamId,
      input.homeTeamId,
      input.awayTeamId,
    )
  ) {
    missing.push("player_event_team_grounding");
  }

  const env = input.gameEnv;
  const platoon = input.platoon;
  const isHome = input.playerTeamIsHome;
  const oppPitcher =
    isHome === true
      ? env?.awayPitcher
      : isHome === false
        ? env?.homePitcher
        : env?.homePitcher ?? env?.awayPitcher;
  const pitcherOk =
    !!(oppPitcher?.name && String(oppPitcher.name).trim()) ||
    !!(oppPitcher?.tendency && Number.isFinite(oppPitcher.tendency.hrPer9)) ||
    !!(
      platoon?.opposingPitcherTendency &&
      Number.isFinite(platoon.opposingPitcherTendency.hrPer9)
    );
  if (!pitcherOk) missing.push("opposing_pitcher_context");

  const parkOk =
    !!(env?.park && (env.park.hrIndex != null || env.park.dome != null)) ||
    env?.climateControlled === true;
  if (!parkOk) missing.push("venue_park_context");

  const vals = (input.hrHistoryValues ?? []).filter((v) => Number.isFinite(v));
  const histOk =
    vals.length >= RARE_COUNT_MIN_SAMPLE &&
    vals.some((v) => v > 0);
  if (!histOk) missing.push("historical_hr_evidence");

  // Platoon when available: if a slice exists it must carry hand or vs-hand.
  if (platoon != null) {
    required.push("platoon_handedness");
    const handOk =
      !!(platoon.platoon && String(platoon.platoon).trim()) ||
      !!(platoon.vsThatHand && (platoon.vsThatHand.hr != null || platoon.vsThatHand.slg != null));
    if (!handOk) missing.push("platoon_handedness");
  }

  return { ok: missing.length === 0, missing, required };
}

/**
 * Full normal-path seat check for rare multi-count (incl. HR context).
 * Lottery path skips reliability + HR hard context (still needs sim + #711).
 */
export function rareMultiCountCoachMaySeat(
  pick: {
    isProp?: boolean | null;
    propMarketKey?: string | null;
    market?: string | null;
    propSide?: string | null;
    propLine?: number | null;
    sport?: string | null;
    playerTeamId?: string | null;
  },
  opts: RareMultiCountSeatAllowOpts & {
    hrContext?: RareHrHardContextInput | null;
  } = {},
): { allowed: boolean; reason: string } {
  if (!pick.isProp) return { allowed: true, reason: "not_prop" };
  const market = pick.propMarketKey ?? pick.market;
  if (
    !isRareMultiCountOver({
      market,
      side: pick.propSide,
      line: pick.propLine,
    })
  ) {
    return { allowed: true, reason: "not_rare_multicount" };
  }

  if (rareMultiCountLotteryPathOpen(opts)) {
    return { allowed: true, reason: "lottery_path" };
  }

  if (!rareMultiCountNormalSeatAllowed(pick, opts)) {
    return { allowed: false, reason: "reliability_or_lottery_closed" };
  }

  // HR-specific hard context on normal path.
  if (isRareCountPropMarket(market) && /home\s*runs?|\bhr\b/.test(String(market).toLowerCase().replace(/_/g, " "))) {
    const ctx = rareHrHardContextOk({
      ...(opts.hrContext ?? {}),
      playerTeamId: opts.hrContext?.playerTeamId ?? pick.playerTeamId,
    });
    if (!ctx.ok) {
      return {
        allowed: false,
        reason: `hr_context_missing:${ctx.missing.join(",")}`,
      };
    }
  }

  return { allowed: true, reason: "ok" };
}

/**
 * Prefer anytime (Over ≤0.5) over multi-count when both exist for the same
 * player+market family on a normal (non-lottery) ask.
 */
export function preferAnytimeOverRareMultiCount<
  T extends {
    player?: string | null;
    athleteId?: string | null;
    propMarketKey?: string | null;
    market?: string | null;
    propSide?: string | null;
    propLine?: number | null;
    isProp?: boolean | null;
  },
>(
  candidates: T[],
  opts: { allowLotteryPath?: boolean; askText?: string | null; ticketStyle?: string | null } = {},
): T[] {
  if (rareMultiCountLotteryPathOpen(opts)) return candidates;
  const anytimeKeys = new Set<string>();
  for (const c of candidates) {
    if (!c.isProp) continue;
    const market = c.propMarketKey ?? c.market;
    if (!isRareCountPropMarket(market)) continue;
    const line = c.propLine;
    const side = String(c.propSide ?? "").toLowerCase();
    if (side && side !== "over" && side !== "yes") continue;
    if (line != null && Number.isFinite(line) && rareCountThresholdK(line) >= 2) continue;
    // Anytime / Over 0.5 / null-line Yes
    if (line == null || line <= 0.5) {
      const key = `${String(c.athleteId ?? c.player ?? "").toLowerCase()}|${String(market ?? "")
        .toLowerCase()
        .replace(/_alternate$/, "")}`;
      anytimeKeys.add(key);
    }
  }
  if (!anytimeKeys.size) return candidates;
  return candidates.filter((c) => {
    if (!c.isProp) return true;
    const market = c.propMarketKey ?? c.market;
    if (
      !isRareMultiCountOver({
        market,
        side: c.propSide,
        line: c.propLine,
      })
    ) {
      return true;
    }
    const key = `${String(c.athleteId ?? c.player ?? "").toLowerCase()}|${String(market ?? "")
      .toLowerCase()
      .replace(/_alternate$/, "")}`;
    return !anytimeKeys.has(key);
  });
}

/** Reliability helper from raw HR/SB/goal game values. */
export function reliabilityFromCountHistory(
  vals: number[],
  line: number,
  side: "Over" | "Under" = "Over",
): number {
  return rareCountHitReliability(vals, line, side);
}

export {
  isRareMultiCountOver,
  isRareCountPropMarket,
  RARE_COUNT_MIN_SAMPLE,
};

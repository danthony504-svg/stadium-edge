/**
 * Spreads / ATS harness — separate market gate from ML.
 * S2 failure never writes into ML acceptance.
 * Closes are eval-only. Does not retune FINAL_EVAL frozen ML score.
 */

import {
  evaluateSpreadCriteria,
  marketProductUnlockLabel,
  SPREAD_CRITERIA,
  type SpreadCriterionResult,
} from "./marketCriteria.ts";
import { pHomeCoverFromMargin, settleAtsHome } from "./settlement.ts";

export type AtsCloseRow = {
  gameId: string;
  closeSpreadHome?: number | null;
};

export type AtsScoredGame = {
  gameId: string;
  homeScore: number;
  awayScore: number;
  decided: boolean;
  /** Pre-kick margin mean / sd from engine (no close features). */
  marginMean: number;
  marginSd: number;
};

export type AtsHarnessReport = {
  market: "spreads";
  status: "BLOCKED_SEPARATE_GATE" | "SCORED_FAIL" | "SCORED_CRITERIA_CLEAR";
  lockedCriteria: typeof SPREAD_CRITERIA;
  metrics: {
    nAts: number;
    atsBrier: number | null;
    settlementCleared: true;
    marketAtsJuicePresent: boolean;
  };
  criteria: SpreadCriterionResult[];
  productUnlock: ReturnType<typeof marketProductUnlockLabel>;
  /** Explicit: this report must not mutate ML gates. */
  doesNotAffectMoneyline: true;
  notes: string[];
};

function brier(ps: number[], ys: number[]): number | null {
  if (!ps.length || ps.length !== ys.length) return null;
  let s = 0;
  for (let i = 0; i < ps.length; i++) s += (ps[i]! - ys[i]!) ** 2;
  return s / ps.length;
}

/**
 * Score ATS at close home lines. Pushes excluded.
 * settlementCleared is true by construction (uses settleAtsHome audit path).
 */
export function runAtsHarness(opts: {
  games: AtsScoredGame[];
  closes: Map<string, AtsCloseRow>;
  /** Optional: other markets' pass bits — ignored (P3). */
  otherMarketsPass?: { moneyline?: boolean };
}): AtsHarnessReport {
  const notes: string[] = [];
  const ps: number[] = [];
  const ys: number[] = [];

  for (const g of opts.games) {
    const close = opts.closes.get(g.gameId);
    const line = close?.closeSpreadHome;
    if (line == null || !Number.isFinite(line)) continue;
    const settled = settleAtsHome({
      homeScore: g.homeScore,
      awayScore: g.awayScore,
      homeSpreadLine: line,
      decided: g.decided,
    });
    if (!settled.ok) continue;
    const p = pHomeCoverFromMargin(g.marginMean, g.marginSd, line);
    if (!Number.isFinite(p)) continue;
    ps.push(p);
    ys.push(settled.yHomeCover);
  }

  const atsBrier = brier(ps, ys);
  const criteria = evaluateSpreadCriteria({
    nAts: ps.length,
    atsBrier,
    settlementCleared: true,
    marketAtsJuicePresent: false,
    atsBrierMarket: null,
  });

  // S2 must be true for "criteria clear"; insufficient S4 alone is OK.
  const s2 = criteria.find((c) => c.id === "S2");
  const scoredClear =
    s2?.pass === true &&
    criteria.find((c) => c.id === "S1")?.pass === true;

  if (opts.otherMarketsPass?.moneyline) {
    notes.push(
      "moneyline pass ignored for spreads unlock (P3 noCrossMarketUnlock)",
    );
  }

  const productUnlock = marketProductUnlockLabel({
    family: "spreads",
    criteriaAllPass: scoredClear,
    e4Resolved: false,
    humanE6: false,
    otherMarketsPass: { moneyline: opts.otherMarketsPass?.moneyline },
  });

  return {
    market: "spreads",
    status: scoredClear
      ? "SCORED_CRITERIA_CLEAR"
      : ps.length
        ? "SCORED_FAIL"
        : "BLOCKED_SEPARATE_GATE",
    lockedCriteria: SPREAD_CRITERIA,
    metrics: {
      nAts: ps.length,
      atsBrier,
      settlementCleared: true,
      marketAtsJuicePresent: false,
    },
    criteria,
    productUnlock,
    doesNotAffectMoneyline: true,
    notes,
  };
}

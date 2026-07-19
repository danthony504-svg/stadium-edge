// Board leg qualification diagnostics — mirrors staging gates with explicit failure reasons.

import type { ParsedPick } from "./parsedPick.ts";
import type { FinalAiScore } from "./finalAiScore.ts";
import {
  COACH_SIM_MIN_CONFIDENCE,
  COACH_SIM_MIN_GRADE,
  simEvPct,
} from "./gameSimQualityGates.ts";
import { impliedProb } from "./format.ts";
import { marketSupportsSimulation, pickHasSimGrade } from "./simMarketSupport.ts";
import { isAltBoardPick, isAltPropPick, isMainBoardPick } from "./altLinePool.ts";
import { boardLegPoolRole } from "./ticketStaging.ts";
import {
  pickIsAiRecommended,
  propSimEdgeStagingQualifies,
  qualifiesAltPick,
} from "./pickRecommendation.ts";
import { propQualifiesForTicketFill } from "./propHolisticRecommendation.ts";
import { isRealisticBoardPropCandidate } from "./boardPropSimExpansion.ts";

const GRADE_RANK: Record<string, number> = {
  F: 0, D: 1, "C-": 2, C: 3, "C+": 4, "B-": 5, B: 6, "B+": 7, "A-": 8, A: 9, "A+": 10,
};

function gradeRank(g: string | null | undefined): number {
  if (!g) return -1;
  return GRADE_RANK[g] ?? -1;
}

export type BoardLegGateCode =
  | "qualified_main"
  | "qualified_alt"
  | "no_score"
  | "high_risk_value_play"
  | "unsupported_market"
  | "missing_odds"
  | "missing_prop_line"
  | "no_sim_grade"
  | "negative_edge"
  | "negative_ev"
  | "sim_below_implied"
  | "grade_below_minimum"
  | "confidence_below_minimum"
  | "not_sim_aligned"
  | "holistic_not_recommended"
  | "not_ai_recommended"
  | "not_staged";

export type BoardLegQualification = {
  qualifies: boolean;
  role: "main" | "alt" | null;
  gate: BoardLegGateCode;
  reason: string;
};

function evCheck(
  pick: ParsedPick,
  score: FinalAiScore,
): { ok: boolean; gate?: BoardLegGateCode; reason?: string } {
  if (score.simHit == null || pick.odds == null) return { ok: true };
  const implied = impliedProb(pick.odds);
  if (score.simHit <= implied) {
    return {
      ok: false,
      gate: "sim_below_implied",
      reason: `Sim hit ${(score.simHit * 100).toFixed(1)}% ≤ implied ${(implied * 100).toFixed(1)}%`,
    };
  }
  const ev = simEvPct(score.simHit, pick.odds);
  if (ev != null && ev <= 0) {
    return { ok: false, gate: "negative_ev", reason: `EV ${ev.toFixed(2)}% ≤ 0` };
  }
  return { ok: true };
}

function coreSimEdgeChecks(
  pick: ParsedPick,
  score: FinalAiScore,
): BoardLegQualification | null {
  if ((score.edgePct ?? 0) <= 0) {
    return {
      qualifies: false,
      role: null,
      gate: "negative_edge",
      reason: `Edge ${(score.edgePct ?? 0).toFixed(1)}% ≤ 0`,
    };
  }
  if (!score.simAligned) {
    return {
      qualifies: false,
      role: null,
      gate: "not_sim_aligned",
      reason: "Simulation does not align with posted odds",
    };
  }
  if (gradeRank(score.grade) < gradeRank(COACH_SIM_MIN_GRADE)) {
    return {
      qualifies: false,
      role: null,
      gate: "grade_below_minimum",
      reason: `Grade ${score.grade ?? "—"} below minimum ${COACH_SIM_MIN_GRADE}`,
    };
  }
  if ((score.confidencePct ?? 0) < COACH_SIM_MIN_CONFIDENCE) {
    return {
      qualifies: false,
      role: null,
      gate: "confidence_below_minimum",
      reason: `Confidence ${score.confidencePct ?? 0}% below ${COACH_SIM_MIN_CONFIDENCE}%`,
    };
  }
  const ev = evCheck(pick, score);
  if (!ev.ok) {
    return { qualifies: false, role: null, gate: ev.gate!, reason: ev.reason! };
  }
  return null;
}

/** Explain why a board candidate did or did not enter staging pools. */
export function explainBoardLegQualification(
  pick: ParsedPick,
  score: FinalAiScore | null | undefined,
): BoardLegQualification {
  if (!score) {
    return {
      qualifies: false,
      role: null,
      gate: "no_score",
      reason: "No AI score attached",
    };
  }
  if (score.highRiskValuePlay) {
    return {
      qualifies: false,
      role: null,
      gate: "high_risk_value_play",
      reason: "Flagged high-risk value play",
    };
  }

  if (pick.isProp) {
    if (!isRealisticBoardPropCandidate(pick)) {
      if (pick.odds == null || !Number.isFinite(pick.odds) || pick.odds === 0) {
        return {
          qualifies: false,
          role: null,
          gate: "missing_odds",
          reason: "No posted odds",
        };
      }
      if (pick.propLine == null || !pick.propSide) {
        return {
          qualifies: false,
          role: null,
          gate: "missing_prop_line",
          reason: "Missing prop line or side",
        };
      }
      if (!marketSupportsSimulation(pick.market ?? "", pick)) {
        return {
          qualifies: false,
          role: null,
          gate: "unsupported_market",
          reason: `Prop market "${pick.market ?? ""}" has no simulation model`,
        };
      }
    }
  } else if (!marketSupportsSimulation(pick.market ?? "", pick)) {
    return {
      qualifies: false,
      role: null,
      gate: "unsupported_market",
      reason: `Game market "${pick.market ?? ""}" has no simulation model`,
    };
  }

  if (!pickHasSimGrade(pick, score.simHit)) {
    return {
      qualifies: false,
      role: null,
      gate: "no_sim_grade",
      reason: "No simulation result (10k MC not complete)",
    };
  }

  const role = boardLegPoolRole(pick, score);
  if (role === "main") {
    return { qualifies: true, role: "main", gate: "qualified_main", reason: "Passes main AI gates" };
  }
  if (role === "alt") {
    return { qualifies: true, role: "alt", gate: "qualified_alt", reason: "Passes alternate AI gates" };
  }

  if (pick.isProp && score.propHolistic && !score.recommends) {
    if (propSimEdgeStagingQualifies(pick, score)) {
      return {
        qualifies: true,
        role: isAltPropPick(pick) || pick.propIsAlt ? "alt" : "main",
        gate: "qualified_main",
        reason: "Sim+edge qualifies — optional holistic signals missing or thin",
      };
    }
    const holisticFail = !propQualifiesForTicketFill(pick, score.propHolistic, {
      edgePct: score.edgePct,
      simHit: score.simHit,
      odds: pick.odds,
    });
    if (holisticFail) {
      return {
        qualifies: false,
        role: null,
        gate: "holistic_not_recommended",
        reason: "Prop holistic form/matchup gate failed",
      };
    }
  }

  if (isMainBoardPick(pick) && !pickIsAiRecommended(pick, score)) {
    const core = coreSimEdgeChecks(pick, score);
    if (core) return core;
    return {
      qualifies: false,
      role: null,
      gate: "not_ai_recommended",
      reason: "Main line failed AI recommendation (recommends flag off)",
    };
  }
  if (isAltBoardPick(pick) && !qualifiesAltPick(pick, score)) {
    const core = coreSimEdgeChecks(pick, score);
    if (core) return core;
    return {
      qualifies: false,
      role: null,
      gate: "not_ai_recommended",
      reason: "Alternate line failed alt qualification gates",
    };
  }

  if (pick.isProp) {
    if (propSimEdgeStagingQualifies(pick, score)) {
      return {
        qualifies: false,
        role: null,
        gate: "not_staged",
        reason: "Sim+edge passed but holistic staging gate not met",
      };
    }
    const core = coreSimEdgeChecks(pick, score);
    if (core) return core;
  } else {
    const core = coreSimEdgeChecks(pick, score);
    if (core) return core;
  }

  return {
    qualifies: false,
    role: null,
    gate: "not_ai_recommended",
    reason: "Did not pass board staging gates",
  };
}

export function pickLabelForManifest(pick: ParsedPick): string {
  if (pick.isProp && pick.player) {
    return `${pick.player} ${pick.pick}`;
  }
  return String(pick.pick ?? pick.market ?? "—");
}

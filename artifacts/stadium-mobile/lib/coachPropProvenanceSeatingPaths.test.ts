/**
 * Option C — unsupported historical fallback cannot enter Coach tickets via
 * ALT, recovery, top-up, reserved fill, partial, or final output paths.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  exactMarket10kProvenance,
  historicalModelProvenance,
  insufficientPropProvenance,
  VALIDATED_HISTORICAL_MODEL_ALLOWLIST,
  withExactMarket10kProvenance,
} from "./coachPropProbabilityProvenance.ts";
import {
  evaluateCoachQualification,
  withCoachQualification,
} from "./coach/qualifyCoachCandidate.ts";
import { boardLegPoolRole } from "./ticketStaging.ts";
import { fillReservedPropSlots } from "./boardScanPropDelivery.ts";
import {
  filterTicketPicksPreservingTicket,
  propSimEdgeStagingQualifies,
  propsOnlyTicketCleared,
  qualifiesAltPick,
  pickIsAiRecommended,
} from "./pickRecommendation.ts";
import { legQualifiesAtMinGrade } from "./coachTicketQualityTiers.ts";
import { scoredLegFromQualifiedCandidate } from "./postLeanFinalFill.ts";
import { propQualifiesForTicketFill } from "./propHolisticRecommendation.ts";
import { stageFootballPropsOnlyLegs } from "./coachFootballPropsOnly.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";

const SEDRICK = {
  isProp: true as const,
  sport: "ncaaf",
  market: "Anytime TD",
  propMarketKey: "player_anytime_td",
  propSide: "Over" as const,
  propLine: 0.5,
  odds: -120,
  player: "Sedrick Alexander",
  athleteId: "5030333",
  game: "Arkansas @ Vanderbilt",
  pick: "Sedrick Alexander Over 0.5 Anytime TD",
  propsOnlyTicket: true,
};

function scoreWith(opts: {
  provenance: ReturnType<typeof historicalModelProvenance>;
  simHit: number | null;
  grade?: string;
  confidencePct?: number;
  edgePct?: number;
  propIsAlt?: boolean;
  recommends?: boolean;
}) {
  const grade = opts.grade ?? "B";
  const confidencePct = opts.confidencePct ?? 58;
  const edgePct = opts.edgePct ?? 4;
  const simHit = opts.simHit;
  return {
    ...SEDRICK,
    propIsAlt: opts.propIsAlt,
    propProbabilityProvenance: opts.provenance,
    finalAiScore: {
      grade,
      confidencePct,
      simHit,
      edgePct,
      simAligned: simHit != null && simHit > 0.01,
      recommends: opts.recommends ?? true,
      composite: 7.2,
      propProbabilityProvenance: opts.provenance,
      propHolistic: {
        grade,
        confidencePct,
        composite: 7.2,
        missingCount: 2,
        factors: [
          {
            key: "simulation" as const,
            label: "Historical Model",
            score: 7,
            applicable: true,
            present: false,
          },
          {
            key: "sportsbookValue" as const,
            label: "Expected Value",
            score: 7,
            applicable: true,
            present: true,
          },
        ],
      },
    },
  };
}

function scored(pick: ReturnType<typeof scoreWith>): BoardScoredLeg {
  return {
    pick: pick as never,
    evPct: pick.finalAiScore.edgePct,
    edgePct: pick.finalAiScore.edgePct,
    confidencePct: pick.finalAiScore.confidencePct,
    impliedProbPct: null,
    lineShoppingScore: 5,
    grade: pick.finalAiScore.grade,
    simHit: pick.finalAiScore.simHit,
    composite: pick.finalAiScore.composite,
    rankScore: 90,
  };
}

test("allowlist remains empty — no auto-approved historical markets", () => {
  assert.equal(VALIDATED_HISTORICAL_MODEL_ALLOWLIST.length, 0);
});

test("BEFORE→AFTER: history ATD (Sedrick-class) rejects at qualify", () => {
  const hist = historicalModelProvenance({
    hitProbability: 0.572,
    sport: "ncaaf",
    marketKey: "player_anytime_td",
    hitReliability: 0.6,
  });
  // Before Option C, a bare simHit of 0.572 would clear #711 floors.
  // After: provenance is insufficient_evidence → reject.
  assert.equal(hist.source, "insufficient_evidence");
  const q = evaluateCoachQualification(
    {
      ...SEDRICK,
      grade: "B",
      confidencePct: 52,
      edgePct: 0.6,
      simHit: 0.5515,
      propProbabilityProvenance: hist,
    },
    { requestStyle: "props_only", isProp: true },
  );
  assert.equal(q.status, "rejected");
  assert.equal(q.reason, "insufficient_sim_provenance");
});

test("exact 10k still seats at #711 floors", () => {
  const prov = exactMarket10kProvenance({
    hitProbability: 0.58,
    simulations: 10_000,
    sport: "ncaaf",
    marketKey: "player_anytime_td",
  });
  const pick = scoreWith({ provenance: prov, simHit: 0.58, confidencePct: 52 });
  assert.equal(
    evaluateCoachQualification(pick, { requestStyle: "props_only", isProp: true }).status,
    "qualified",
  );
  assert.equal(boardLegPoolRole(pick as never, pick.finalAiScore as never), "main");
});

test("unsupported fallback blocked on ALT path", () => {
  const hist = historicalModelProvenance({
    hitProbability: 0.62,
    sport: "nfl",
    marketKey: "player_anytime_td",
  });
  const alt = scoreWith({
    provenance: hist,
    simHit: 0.62,
    propIsAlt: true,
    grade: "B+",
    confidencePct: 60,
    edgePct: 5,
  });
  assert.equal(qualifiesAltPick(alt as never, alt.finalAiScore as never), false);
  assert.equal(boardLegPoolRole(alt as never, alt.finalAiScore as never), null);
  assert.equal(
    propQualifiesForTicketFill(alt as never, alt.finalAiScore.propHolistic as never, {
      edgePct: 5,
      simHit: 0.62,
      odds: -120,
    }),
    false,
  );
});

test("unsupported fallback blocked on reserved fill / top-up", () => {
  const hist = historicalModelProvenance({
    hitProbability: 0.6,
    sport: "ncaaf",
    marketKey: "player_reception_yds",
  });
  const weak = scoreWith({ provenance: hist, simHit: 0.6, grade: "A", confidencePct: 70 });
  const filled = fillReservedPropSlots(
    [],
    [{ pick: weak as never, simHit: 0.6, rankScore: 99 }],
    8,
  );
  assert.equal(filled.length, 0);
});

test("unsupported fallback blocked on recovery / preserving filter", () => {
  const hist = historicalModelProvenance({
    hitProbability: 0.65,
    sport: "nfl",
    marketKey: "player_pass_yds",
  });
  const pick = withCoachQualification(
    scoreWith({ provenance: hist, simHit: 0.65 }) as never,
    { requestStyle: "props_only", isProp: true },
  );
  assert.equal(pick.qualificationStatus, "rejected");
  assert.equal(pick.qualificationReason, "insufficient_sim_provenance");
  assert.equal(filterTicketPicksPreservingTicket([pick as never]).length, 0);
  assert.equal(propsOnlyTicketCleared(pick as never, pick.finalAiScore as never), false);
  assert.equal(propSimEdgeStagingQualifies(pick as never, pick.finalAiScore as never), false);
  assert.equal(pickIsAiRecommended(pick as never, pick.finalAiScore as never), false);
});

test("unsupported fallback blocked on tiered quality / post-lean final", () => {
  const hist = historicalModelProvenance({
    hitProbability: 0.7,
    sport: "ncaaf",
    marketKey: "player_rush_yds",
  });
  const pick = scoreWith({ provenance: hist, simHit: 0.7, grade: "A", confidencePct: 75 });
  assert.equal(legQualifiesAtMinGrade(pick as never, pick.finalAiScore as never, "B"), false);
  assert.equal(scoredLegFromQualifiedCandidate(pick as never), null);
});

test("unsupported fallback blocked on props-only staging / partial / final", () => {
  const hist = historicalModelProvenance({
    hitProbability: 0.55,
    sport: "ncaaf",
    marketKey: "player_anytime_td",
  });
  const leg = scored(scoreWith({ provenance: hist, simHit: 0.55, confidencePct: 52 }));
  const staged = stageFootballPropsOnlyLegs([leg], 8);
  assert.equal(staged.length, 0);

  const missing = scoreWith({
    provenance: insufficientPropProvenance({
      sport: "ncaaf",
      marketKey: "player_anytime_td",
      nullReason: "stat_mapping_failed",
    }),
    simHit: 0.55,
  });
  // Even with a manufactured simHit, missing/failed provenance cannot seat.
  assert.equal(
    evaluateCoachQualification(
      { ...missing, simHit: 0.55 },
      { requestStyle: "props_only", isProp: true },
    ).status,
    "rejected",
  );
});

test("authorized exact 10k still clears ALT + reserved fill + final", () => {
  const prov = exactMarket10kProvenance({
    hitProbability: 0.6,
    simulations: 10_000,
    sport: "nfl",
    marketKey: "player_reception_yds",
  });
  const pick = withExactMarket10kProvenance(
    scoreWith({
      provenance: prov,
      simHit: 0.6,
      grade: "B+",
      confidencePct: 60,
      edgePct: 5,
      propIsAlt: true,
    }),
  );
  const tagged = withCoachQualification(pick as never, {
    requestStyle: "normal",
    isProp: true,
  });
  assert.equal(tagged.qualificationStatus, "qualified");
  assert.ok(boardLegPoolRole(tagged as never, tagged.finalAiScore as never) != null);
  const filled = fillReservedPropSlots(
    [],
    [{ pick: tagged as never, simHit: 0.6, rankScore: 99 }],
    8,
  );
  assert.equal(filled.length, 1);
  assert.ok(scoredLegFromQualifiedCandidate(tagged as never) != null);
});

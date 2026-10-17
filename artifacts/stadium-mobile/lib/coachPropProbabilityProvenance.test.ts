/**
 * Option C — hybrid allowlist provenance unit tests.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  EXACT_MARKET_10K_MIN_SIMULATIONS,
  VALIDATED_HISTORICAL_MODEL_ALLOWLIST,
  exactMarket10kProvenance,
  historicalModelProvenance,
  insufficientPropProvenance,
  isValidatedHistoricalMarket,
  preferPropProvenance,
  propProvenanceAllowsSeating,
  seatingHitFromProvenance,
  simulationFactorLabelForSource,
  SIM_FACTOR_LABEL_EXACT_10K,
  SIM_FACTOR_LABEL_HISTORICAL,
  validatedHistoricalAllowlistEvidence,
} from "./coachPropProbabilityProvenance.ts";
import { evaluateCoachQualification } from "./coach/qualifyCoachCandidate.ts";
import { buildFinalAiScore } from "./finalAiScore.ts";
import { COACH_SIM_MIN_CONFIDENCE, COACH_SIM_MIN_GRADE } from "./gameSimQualityGates.ts";

test("floors unchanged (#711)", () => {
  assert.equal(COACH_SIM_MIN_CONFIDENCE, 52);
  assert.equal(COACH_SIM_MIN_GRADE, "C+");
});

test("allowlist starts empty — no NFL/NCAAF ATD auto-approval", () => {
  assert.equal(VALIDATED_HISTORICAL_MODEL_ALLOWLIST.length, 0);
  assert.equal(validatedHistoricalAllowlistEvidence().length, 0);
  assert.equal(isValidatedHistoricalMarket("ncaaf", "player_anytime_td"), false);
  assert.equal(isValidatedHistoricalMarket("nfl", "player_anytime_td"), false);
  assert.equal(isValidatedHistoricalMarket("nfl", "player_first_td"), false);
  assert.equal(isValidatedHistoricalMarket("ncaaf", "player_reception_yds"), false);
});

test("exact_market_10k only when simulations >= 10000 and hit finite", () => {
  const ok = exactMarket10kProvenance({
    hitProbability: 0.62,
    simulations: EXACT_MARKET_10K_MIN_SIMULATIONS,
    sport: "ncaaf",
    marketKey: "player_reception_yds",
  });
  assert.equal(ok.source, "exact_market_10k");
  assert.equal(ok.hitProbability, 0.62);
  assert.equal(ok.simulations, 10_000);
  assert.equal(propProvenanceAllowsSeating(ok), true);
  assert.equal(simulationFactorLabelForSource(ok.source), SIM_FACTOR_LABEL_EXACT_10K);

  const partial = exactMarket10kProvenance({
    hitProbability: 0.9,
    simulations: 9999,
    sport: "nfl",
    marketKey: "player_pass_yds",
  });
  assert.equal(partial.source, "insufficient_evidence");
  assert.equal(partial.hitProbability, null);
  assert.equal(propProvenanceAllowsSeating(partial), false);

  const failed = exactMarket10kProvenance({
    hitProbability: null,
    simulations: 0,
    nullReason: "stat_mapping_failed",
    sport: "ncaaf",
    marketKey: "player_anytime_td",
  });
  assert.equal(failed.source, "insufficient_evidence");
  assert.equal(failed.nullReason, "stat_mapping_failed");
  assert.equal(seatingHitFromProvenance(failed), null);
});

test("historical model without allowlist is insufficient — never seats", () => {
  const hist = historicalModelProvenance({
    hitProbability: 0.572,
    sport: "ncaaf",
    marketKey: "player_anytime_td",
    hitReliability: 0.6,
  });
  assert.equal(hist.source, "insufficient_evidence");
  assert.equal(hist.nullReason, "unapproved_historical_model");
  assert.equal(hist.hitProbability, null);
  assert.equal(propProvenanceAllowsSeating(hist), false);
  assert.equal(simulationFactorLabelForSource(hist.source), null);
});

test("Sedrick-class history ATD rejects at #711 without exact 10k", () => {
  const hist = historicalModelProvenance({
    hitProbability: 0.572,
    sport: "ncaaf",
    marketKey: "player_anytime_td",
    hitReliability: 0.6,
  });
  const q = evaluateCoachQualification(
    {
      market: "Anytime TD",
      sport: "ncaaf",
      isProp: true,
      odds: -120,
      propsOnlyTicket: true,
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

test("exact 10k ATD can qualify at floors; missing provenance rejects", () => {
  const prov = exactMarket10kProvenance({
    hitProbability: 0.58,
    simulations: 10_000,
    sport: "ncaaf",
    marketKey: "player_anytime_td",
  });
  const ok = evaluateCoachQualification(
    {
      market: "Anytime TD",
      sport: "ncaaf",
      isProp: true,
      odds: -120,
      propsOnlyTicket: true,
      grade: "B",
      confidencePct: 52,
      edgePct: 3.5,
      simHit: 0.58,
      propProbabilityProvenance: prov,
    },
    { requestStyle: "props_only", isProp: true },
  );
  assert.equal(ok.status, "qualified");

  const missing = evaluateCoachQualification(
    {
      market: "Anytime TD",
      sport: "ncaaf",
      isProp: true,
      odds: -120,
      propsOnlyTicket: true,
      grade: "B",
      confidencePct: 60,
      edgePct: 5,
      simHit: 0.6,
    },
    { requestStyle: "props_only", isProp: true },
  );
  assert.equal(missing.status, "rejected");
  assert.equal(missing.reason, "insufficient_sim_provenance");
});

test("rejected stamps stay rejected", () => {
  const prov = exactMarket10kProvenance({
    hitProbability: 0.7,
    simulations: 10_000,
    sport: "nfl",
    marketKey: "player_pass_yds",
  });
  const q = evaluateCoachQualification(
    {
      market: "Pass Yards",
      sport: "nfl",
      isProp: true,
      odds: -110,
      grade: "A",
      confidencePct: 80,
      edgePct: 8,
      simHit: 0.7,
      propProbabilityProvenance: prov,
      qualificationStatus: "rejected",
      qualificationReason: "sim_invalid",
    },
    { requestStyle: "props_only", isProp: true },
  );
  assert.equal(q.status, "rejected");
  assert.equal(q.reason, "sim_invalid");
});

test("holistic labels: 10K Simulation vs Historical Model vs no success", () => {
  const pick = {
    player: "Test",
    propMarketKey: "player_reception_yds",
    market: "Reception Yards",
    propSide: "Over",
    propLine: 49.5,
    odds: -120,
    sport: "ncaaf",
    isProp: true,
    pick: "Test Over 49.5",
    game: "A @ B",
  };
  const exact = buildFinalAiScore({
    pick: pick as never,
    rubricScores: {
      matchup: null,
      trend: null,
      lineValue: 7,
      injury: null,
      lineShopping: 5,
      simulation: 7,
    } as never,
    edgePct: 4,
    odds: -120,
    propSimHit: 0.62,
    propProbabilityProvenance: exactMarket10kProvenance({
      hitProbability: 0.62,
      simulations: 10_000,
      sport: "ncaaf",
      marketKey: "player_reception_yds",
    }),
  });
  const simExact = exact.propHolistic?.factors.find((f) => f.key === "simulation");
  assert.equal(simExact?.label, SIM_FACTOR_LABEL_EXACT_10K);
  assert.equal(simExact?.present, true);

  const insuff = buildFinalAiScore({
    pick: pick as never,
    rubricScores: {
      matchup: null,
      trend: null,
      lineValue: 7,
      injury: null,
      lineShopping: 5,
      simulation: 7,
    } as never,
    edgePct: 4,
    odds: -120,
    propSimHit: 0.62,
    propProbabilityProvenance: insufficientPropProvenance({
      sport: "ncaaf",
      marketKey: "player_anytime_td",
      nullReason: "stat_mapping_failed",
    }),
  });
  const simBad = insuff.propHolistic?.factors.find((f) => f.key === "simulation");
  assert.notEqual(simBad?.label, SIM_FACTOR_LABEL_EXACT_10K);
  assert.equal(simBad?.present, false);

  // Label helper for historical (when allowlisted in future).
  assert.equal(
    simulationFactorLabelForSource("validated_historical_model"),
    SIM_FACTOR_LABEL_HISTORICAL,
  );
});

test("preferPropProvenance never promotes insufficient over exact 10k", () => {
  const exact = exactMarket10kProvenance({
    hitProbability: 0.55,
    simulations: 10_000,
    sport: "nfl",
    marketKey: "player_rush_yds",
  });
  const bad = insufficientPropProvenance({
    sport: "nfl",
    marketKey: "player_rush_yds",
    nullReason: "stat_mapping_failed",
  });
  assert.equal(preferPropProvenance(exact, bad).source, "exact_market_10k");
  assert.equal(preferPropProvenance(bad, exact).source, "exact_market_10k");
});

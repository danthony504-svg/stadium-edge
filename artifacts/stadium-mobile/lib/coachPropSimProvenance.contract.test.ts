/**
 * Props sim provenance contract — Option C enforced (P0).
 *
 * Historical-only hits cannot seat (empty allowlist). Exact-market 10k requires
 * trusted registry evidence. Display labels follow provenance source.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { gradeFootballPropFromHistory } from "./coachFootballPropsOnlyGrade.ts";
import { evaluateCoachQualification } from "./coach/qualifyCoachCandidate.ts";
import { buildFinalAiScore } from "./finalAiScore.ts";
import {
  simEdgeFromHit,
  COACH_SIM_MIN_CONFIDENCE,
  COACH_SIM_MIN_GRADE,
} from "./gameSimQualityGates.ts";
import { scoreLineValue, scoreSimulation, scoreLineShopping } from "./pickScore.ts";
import {
  clearTrustedExactEvidenceForTests,
  exactMarket10kProvenance,
  historicalModelProvenance,
  propProvenanceAllowsSeating,
  SIM_FACTOR_LABEL_EXACT_10K,
  SIM_FACTOR_LABEL_HISTORICAL,
  VALIDATED_HISTORICAL_MODEL_ALLOWLIST,
} from "./coachPropProbabilityProvenance.ts";

const ROOT = dirname(fileURLToPath(import.meta.url));

function sedrickHistory() {
  const games = [
    { rushingTouchdowns: "0", receivingTouchdowns: "0", passingTouchdowns: "0" },
    { rushingTouchdowns: "1", receivingTouchdowns: "0", passingTouchdowns: "0" },
    { rushingTouchdowns: "1", receivingTouchdowns: "0", passingTouchdowns: "0" },
    { rushingTouchdowns: "0", receivingTouchdowns: "1", passingTouchdowns: "0" },
    { rushingTouchdowns: "1", receivingTouchdowns: "0", passingTouchdowns: "0" },
    { rushingTouchdowns: "1", receivingTouchdowns: "0", passingTouchdowns: "0" },
  ];
  return {
    sport: "ncaaf",
    athleteId: "5030333",
    labels: ["CAR", "YDS", "TD", "REC", "YDS", "TD"],
    recent: games.map((stats, i) => ({
      eventId: `e${i}`,
      date: `2026-09-${String(5 + i).padStart(2, "0")}T12:00:00.000Z`,
      stats,
    })),
  };
}

const sedrickPick = {
  player: "Sedrick Alexander",
  propMarketKey: "player_anytime_td",
  market: "Anytime TD",
  propSide: "Over" as const,
  propLine: 0.5,
  odds: -120,
  sport: "ncaaf",
  isProp: true,
  athleteId: "5030333",
  eventId: "evt-ark-van",
  game: "Arkansas @ Vanderbilt",
  pick: "Sedrick Alexander Over 0.5 Anytime TD",
};

test.beforeEach(() => {
  clearTrustedExactEvidenceForTests();
});

test("floors unchanged (#711)", () => {
  assert.equal(COACH_SIM_MIN_CONFIDENCE, 52);
  assert.equal(COACH_SIM_MIN_GRADE, "C+");
  assert.equal(VALIDATED_HISTORICAL_MODEL_ALLOWLIST.length, 0);
});

test("Option C: history-model ATD is NOT seating-eligible under empty allowlist", () => {
  const graded = gradeFootballPropFromHistory(sedrickPick as never, sedrickHistory() as never);
  assert.equal(
    propProvenanceAllowsSeating(graded.probabilityProvenance, {
      athleteId: sedrickPick.athleteId,
      eventId: sedrickPick.eventId,
      propMarketKey: sedrickPick.propMarketKey,
      propSide: sedrickPick.propSide,
      propLine: sedrickPick.propLine,
    }),
    false,
  );

  const hist = historicalModelProvenance({
    hitProbability: 0.5515,
    sport: "ncaaf",
    marketKey: "player_anytime_td",
    hitReliability: 0.6,
    athleteId: "5030333",
    eventId: "evt-ark-van",
    side: "Over",
    line: 0.5,
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
      athleteId: "5030333",
      eventId: "evt-ark-van",
      propMarketKey: "player_anytime_td",
      propSide: "Over",
      propLine: 0.5,
      propProbabilityProvenance: hist,
    },
    { requestStyle: "props_only", isProp: true },
  );
  assert.equal(q.status, "rejected");
  assert.equal(q.reason, "insufficient_sim_provenance");
});

test("Option C: exact-market 10k ATD qualifies; missing provenance rejects", () => {
  const prov = exactMarket10kProvenance({
    hitProbability: 0.58,
    simulations: 10_000,
    sport: "ncaaf",
    marketKey: "player_anytime_td",
    athleteId: "5030333",
    eventId: "evt-ark-van",
    side: "Over",
    line: 0.5,
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
      athleteId: "5030333",
      eventId: "evt-ark-van",
      propMarketKey: "player_anytime_td",
      propSide: "Over",
      propLine: 0.5,
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
      athleteId: "5030333",
      eventId: "evt-ark-van",
      propMarketKey: "player_anytime_td",
      propSide: "Over",
      propLine: 0.5,
    },
    { requestStyle: "props_only", isProp: true },
  );
  assert.equal(missing.status, "rejected");
  assert.equal(missing.reason, "insufficient_sim_provenance");
});

test("Option C: holistic labels follow provenance — never fake 10k for history", () => {
  const hist = historicalModelProvenance({
    hitProbability: 0.58,
    sport: "ncaaf",
    marketKey: "player_anytime_td",
  });
  const score = buildFinalAiScore({
    pick: sedrickPick as never,
    rubricScores: {
      matchup: null,
      trend: null,
      lineValue: scoreLineValue(4),
      injury: null,
      lineShopping: scoreLineShopping(8.1),
      simulation: scoreSimulation(0.58),
    } as never,
    edgePct: 4,
    odds: -120,
    propSimHit: 0.58,
    propProbabilityProvenance: hist,
    propHolisticContext: {
      sport: "ncaaf",
      marketKey: "player_anytime_td",
      propSide: "Over",
      probabilitySource: hist.source,
      minutesTrend: null,
      vsOpponentGames: 0,
      rushDefense: null,
      footballOppDefense: null,
      footballOwnPack: null,
      mlbPlatoon: null,
      mlbGameEnv: null,
    },
  });
  const simFactor = score.propHolistic?.factors.find((f) => f.key === "simulation");
  assert.notEqual(simFactor?.label, SIM_FACTOR_LABEL_EXACT_10K);
  assert.notEqual(simFactor?.label, "10k Simulation");

  const exact = exactMarket10kProvenance({
    hitProbability: 0.58,
    simulations: 10_000,
    sport: "ncaaf",
    marketKey: "player_anytime_td",
    athleteId: "5030333",
    eventId: "evt-ark-van",
    side: "Over",
    line: 0.5,
  });
  const score10k = buildFinalAiScore({
    pick: sedrickPick as never,
    rubricScores: {
      matchup: null,
      trend: null,
      lineValue: scoreLineValue(4),
      injury: null,
      lineShopping: scoreLineShopping(8.1),
      simulation: scoreSimulation(0.58),
    } as never,
    edgePct: 4,
    odds: -120,
    propSimHit: 0.58,
    propProbabilityProvenance: exact,
    propHolisticContext: {
      sport: "ncaaf",
      marketKey: "player_anytime_td",
      propSide: "Over",
      probabilitySource: "exact_market_10k",
      minutesTrend: null,
      vsOpponentGames: 0,
      rushDefense: null,
      footballOppDefense: null,
      footballOwnPack: null,
      mlbPlatoon: null,
      mlbGameEnv: null,
    },
  });
  assert.equal(
    score10k.propHolistic?.factors.find((f) => f.key === "simulation")?.label,
    SIM_FACTOR_LABEL_EXACT_10K,
  );
  assert.equal(SIM_FACTOR_LABEL_HISTORICAL, "Historical Model");
});

test("Option C: rejected stamps stay rejected; conf 51 fails after provenance clears", () => {
  const prov = exactMarket10kProvenance({
    hitProbability: 0.5515,
    simulations: 10_000,
    sport: "ncaaf",
    marketKey: "player_anytime_td",
    athleteId: "5030333",
    eventId: "evt-ark-van",
    side: "Over",
    line: 0.5,
  });
  const low = evaluateCoachQualification(
    {
      market: "Anytime TD",
      sport: "ncaaf",
      isProp: true,
      odds: -120,
      propsOnlyTicket: true,
      grade: "B",
      confidencePct: 51,
      edgePct: 0.6,
      simHit: 0.5515,
      athleteId: "5030333",
      eventId: "evt-ark-van",
      propMarketKey: "player_anytime_td",
      propSide: "Over",
      propLine: 0.5,
      propProbabilityProvenance: prov,
    },
    { requestStyle: "props_only", isProp: true },
  );
  assert.equal(low.status, "rejected");
  assert.equal(low.reason, "confidence_floor");

  const terminal = evaluateCoachQualification(
    {
      market: "Anytime TD",
      sport: "ncaaf",
      isProp: true,
      odds: -120,
      propsOnlyTicket: true,
      grade: "B",
      confidencePct: 80,
      edgePct: 5,
      simHit: 0.7,
      qualificationStatus: "rejected",
      qualificationReason: "sim_invalid",
    },
    { requestStyle: "props_only", isProp: true },
  );
  assert.equal(terminal.status, "rejected");
  assert.equal(terminal.reason, "sim_invalid");
});

test("Option C: props-only deep-sim path for unauthorized provenance (not history overwrite)", () => {
  const src = readFileSync(join(ROOT, "coachFootballPropsOnlyTicket.ts"), "utf8");
  assert.match(src, /needsDeep/);
  assert.match(src, /exactMarket10kProvenance/);
  assert.match(src, /propProvenanceAllowsSeating/);
  assert.match(src, /enforceSeatedPropProviderProvenance/);
  assert.match(src, /gradeFootballPropsOnlyFromHistory/);
});

test("server propStatValue lacks ATD composite (deep stat_mapping_failed root)", () => {
  const server = readFileSync(
    join(ROOT, "../../api-server/src/lib/propStatValue.ts"),
    "utf8",
  );
  assert.doesNotMatch(
    server,
    /market === \"player_anytime_td\"/,
    "server mapping gap: no player_anytime_td composite",
  );
  const mobile = readFileSync(join(ROOT, "propStats.ts"), "utf8");
  assert.match(mobile, /player_anytime_td/);
  // Edge used only to keep simEdge import live for characterization.
  assert.ok(simEdgeFromHit(0.58, -120)! > 0);
});

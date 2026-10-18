/**
 * Stage 2 device-acceptance → P0 provenance enforcement regressions.
 *
 * Locks the three screenshot failures and proves historical-only ATD cannot
 * seat once Option C + #773 shared qualification is enforced.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  askAllowsNcaafPlayerProps,
  askIsCollegeFootballOnly,
  propsOnlySportLabelFromAsk,
} from "./boardScanPropDelivery.ts";
import {
  propsOnlyTerminalShortNote,
  type PropsOnlyFailDiag,
} from "./coachPropsOnlyFailReason.ts";
import {
  gradeFootballPropFromHistory,
  normalizePropsOnlyPick,
  propsOnlyEffectiveLine,
} from "./coachFootballPropsOnlyGrade.ts";
import {
  checkPropProviderProvenance,
  enforceSeatedPropProviderProvenance,
  UNVERIFIED_RELEASE_EVIDENCE_PROPS,
} from "./propProviderProvenance.ts";
import { buildPropHolisticScore } from "./propHolisticRecommendation.ts";
import { scoreSimulation } from "./pickScore.ts";
import {
  COACH_SIM_MIN_CONFIDENCE,
  COACH_SIM_MIN_GRADE,
} from "./gameSimQualityGates.ts";
import {
  clearTrustedExactEvidenceForTests,
  exactMarket10kProvenance,
  historicalModelProvenance,
  propProvenanceAllowsSeating,
  SIM_FACTOR_LABEL_EXACT_10K,
  VALIDATED_HISTORICAL_MODEL_ALLOWLIST,
} from "./coachPropProbabilityProvenance.ts";
import {
  evaluateCoachQualification,
  withCoachQualification,
} from "./coach/qualifyCoachCandidate.ts";
import {
  explicitFootballPropsSportScope,
  filterPoolByAllowedSports,
  resolveImmutableAskSportScope,
} from "./coachAskSportScope.ts";
import type { ParsedPick } from "../components/PickCard.tsx";

function baseDiag(over: Partial<PropsOnlyFailDiag> = {}): PropsOnlyFailDiag {
  return {
    code: "PROPS_ONLY_CONFIDENCE_FLOOR",
    target: 5,
    pool: 40,
    athleteLinked: 30,
    candidates: 20,
    historyLoaded: 18,
    graded: 12,
    bestEvSides: 8,
    oddsCleared: 6,
    staged: 3,
    nullReasons: {},
    ...over,
  };
}

test.beforeEach(() => {
  clearTrustedExactEvidenceForTests();
});

test("P0: NFL player props shortfall label is NFL, not college football", () => {
  const ask = "5 leg NFL player props";
  assert.equal(askIsCollegeFootballOnly(ask), false);
  // Option C: NFL-only asks do not authorize NCAAF via the CFB props gate.
  assert.equal(askAllowsNcaafPlayerProps(ask), false);
  assert.equal(propsOnlySportLabelFromAsk(ask), "NFL");
  assert.equal(explicitFootballPropsSportScope(ask), "nfl");
  assert.deepEqual(
    resolveImmutableAskSportScope({ askText: ask, boardSports: ["nfl", "ncaaf"] }),
    ["nfl"],
  );
  const note = propsOnlyTerminalShortNote(baseDiag({ staged: 3, target: 5 }), {
    sportLabel: propsOnlySportLabelFromAsk(ask),
    confidenceFloor: COACH_SIM_MIN_CONFIDENCE,
  });
  assert.match(note, /3 qualified NFL player props/i);
  assert.doesNotMatch(note, /college football/i);
});

test("P0: college football player props sportLabel + NCAAF-only scope", () => {
  const ask = "7 leg college football player props";
  assert.equal(askAllowsNcaafPlayerProps(ask), true);
  assert.equal(askIsCollegeFootballOnly(ask), true);
  assert.equal(propsOnlySportLabelFromAsk(ask), "college football");
  assert.deepEqual(
    resolveImmutableAskSportScope({ askText: ask, boardSports: ["nfl", "ncaaf"] }),
    ["ncaaf"],
  );
});

test("P0: NFL scope strips NCAAF pool rows (Anderson-class seat isolation)", () => {
  const scope = { allowedSports: ["nfl"] as const };
  const mixed = [
    { player: "Will Anderson Jr.", sport: "nfl", marketKey: "player_sacks" },
    { player: "Anthony Colandrea", sport: "ncaaf", marketKey: "player_anytime_td" },
  ];
  const out = filterPoolByAllowedSports(mixed, scope);
  assert.deepEqual(
    out.map((r) => r.player),
    ["Will Anderson Jr."],
  );
});

test("P0: Anderson history-backed 92% never labeled verified 10K", () => {
  assert.equal(scoreSimulation(0.92), 9.3);
  const hist = historicalModelProvenance({
    hitProbability: 0.92,
    sport: "nfl",
    marketKey: "player_sacks",
    athleteId: "4685724",
    eventId: "57418b2c-anderson",
    side: "Over",
    line: 0.5,
  });
  // Empty allowlist → historical cannot seat or claim 10K.
  assert.equal(VALIDATED_HISTORICAL_MODEL_ALLOWLIST.length, 0);
  assert.equal(propProvenanceAllowsSeating(hist), false);
  assert.equal(hist.source, "insufficient_evidence");

  const localOnly = buildPropHolisticScore({
    sport: "nfl",
    marketKey: "player_sacks",
    propSide: "Over",
    propLine: 0.5,
    odds: -156,
    rubricScores: {
      trend: 7,
      matchup: null,
      lineValue: 8,
      injury: null,
      lineShopping: null,
      simulation: scoreSimulation(0.92),
    },
    edgePct: 31.1,
    simHit: 0.92,
    probabilitySource: hist.source,
  });
  const simFactor = localOnly.factors.find((f) => f.key === "simulation");
  assert.notEqual(simFactor?.label, SIM_FACTOR_LABEL_EXACT_10K);
  assert.equal(simFactor?.present, false);
});

test("P0: Colandrea historical-only ATD rejected for seating", () => {
  const raw = {
    isProp: true,
    player: "Anthony Colandrea",
    pick: "Anthony Colandrea Anytime TD",
    market: "Anytime TD",
    propMarketKey: "player_anytime_td",
    propSide: "Over" as const,
    propLine: undefined as number | undefined,
    odds: 145,
    sportsbook: "FanDuel",
    eventId: "5d147fefd2182aa2f5573ac03700a775",
    athleteId: "5044387",
    sport: "ncaaf",
    game: "Away @ Home",
  } as unknown as ParsedPick;

  assert.equal(propsOnlyEffectiveLine(raw), 0.5);
  const norm = normalizePropsOnlyPick(raw);
  assert.equal(norm.propLine, 0.5);

  // Null-line normalize can satisfy #773 field presence — must NOT authorize sim seat.
  assert.equal(checkPropProviderProvenance(raw).ok, false);
  assert.equal(checkPropProviderProvenance(norm).ok, true);

  const graded = gradeFootballPropFromHistory(norm, {
    recent: [
      { stats: { rushingTouchdowns: "1", receivingTouchdowns: "0", passingTouchdowns: "0" } },
      { stats: { rushingTouchdowns: "0", receivingTouchdowns: "0", passingTouchdowns: "0" } },
      { stats: { rushingTouchdowns: "0", receivingTouchdowns: "0", passingTouchdowns: "0" } },
      { stats: { rushingTouchdowns: "1", receivingTouchdowns: "0", passingTouchdowns: "0" } },
      { stats: { rushingTouchdowns: "0", receivingTouchdowns: "0", passingTouchdowns: "0" } },
      { stats: { rushingTouchdowns: "1", receivingTouchdowns: "0", passingTouchdowns: "0" } },
    ],
  });
  assert.ok(graded.probabilityProvenance);
  assert.equal(
    propProvenanceAllowsSeating(graded.probabilityProvenance, {
      athleteId: norm.athleteId,
      eventId: norm.eventId,
      propMarketKey: norm.propMarketKey,
      propSide: norm.propSide,
      propLine: norm.propLine,
    }),
    false,
    "historical ATD must not seat under empty allowlist",
  );

  // Screenshot path: confidence/grade/edge look strong, but provenance is historical-only.
  const hist = historicalModelProvenance({
    hitProbability: 0.694,
    sport: "ncaaf",
    marketKey: "player_anytime_td",
    hitReliability: 0.6,
    athleteId: "5044387",
    eventId: "5d147fefd2182aa2f5573ac03700a775",
    side: "Over",
    line: 0.5,
  });
  assert.equal(hist.source, "insufficient_evidence");
  const q = evaluateCoachQualification(
    {
      ...norm,
      propsOnlyTicket: true,
      grade: "A",
      confidencePct: 64,
      edgePct: 28.6,
      simHit: 0.694,
      propProbabilityProvenance: hist,
    },
    { requestStyle: "props_only", isProp: true },
  );
  assert.equal(q.status, "rejected");
  assert.equal(q.reason, "insufficient_sim_provenance");

  const stamped = withCoachQualification(
    {
      ...norm,
      propsOnlyTicket: true,
      grade: "A",
      confidencePct: 64,
      edgePct: 28.6,
      simHit: 0.694,
      propProbabilityProvenance: hist,
    } as never,
    { isProp: true },
  );
  assert.equal(stamped.qualificationStatus, "rejected");
});

test("P0: valid exact-market 10k eligible when quality floors pass", () => {
  const provenance = exactMarket10kProvenance({
    hitProbability: 0.62,
    simulations: 10_000,
    sport: "nfl",
    marketKey: "player_sacks",
    athleteId: "4685724",
    eventId: "57418b2c-anderson",
    side: "Over",
    line: 0.5,
  });
  const q = evaluateCoachQualification(
    {
      isProp: true,
      sport: "nfl",
      market: "Player Sacks",
      propMarketKey: "player_sacks",
      propSide: "Over",
      propLine: 0.5,
      odds: -110,
      propsOnlyTicket: true,
      grade: "B",
      confidencePct: 58,
      edgePct: 8,
      simHit: 0.62,
      athleteId: "4685724",
      eventId: "57418b2c-anderson",
      propProbabilityProvenance: provenance,
    },
    { requestStyle: "props_only", isProp: true },
  );
  assert.equal(q.status, "qualified");
  assert.equal(q.reason, "ok");

  const holistic = buildPropHolisticScore({
    sport: "nfl",
    marketKey: "player_sacks",
    propSide: "Over",
    propLine: 0.5,
    odds: -110,
    rubricScores: {
      trend: 7,
      matchup: 7,
      lineValue: 7,
      injury: null,
      lineShopping: null,
      simulation: scoreSimulation(0.62),
    },
    edgePct: 8,
    simHit: 0.62,
    probabilitySource: "exact_market_10k",
  });
  assert.equal(
    holistic.factors.find((f) => f.key === "simulation")?.label,
    SIM_FACTOR_LABEL_EXACT_10K,
  );
});

test("P0: wrong athlete/event/side/line evidence rejected", () => {
  const provenance = exactMarket10kProvenance({
    hitProbability: 0.7,
    simulations: 10_000,
    sport: "nfl",
    marketKey: "player_sacks",
    athleteId: "4685724",
    eventId: "evt-hou-jax",
    side: "Over",
    line: 0.5,
  });
  assert.equal(
    propProvenanceAllowsSeating(provenance, {
      athleteId: "9999999",
      eventId: "evt-hou-jax",
      propMarketKey: "player_sacks",
      propSide: "Over",
      propLine: 0.5,
    }),
    false,
  );
  assert.equal(
    propProvenanceAllowsSeating(provenance, {
      athleteId: "4685724",
      eventId: "evt-other",
      propMarketKey: "player_sacks",
      propSide: "Over",
      propLine: 0.5,
    }),
    false,
  );
  assert.equal(
    propProvenanceAllowsSeating(provenance, {
      athleteId: "4685724",
      eventId: "evt-hou-jax",
      propMarketKey: "player_sacks",
      propSide: "Under",
      propLine: 0.5,
    }),
    false,
  );
  assert.equal(
    propProvenanceAllowsSeating(provenance, {
      athleteId: "4685724",
      eventId: "evt-hou-jax",
      propMarketKey: "player_sacks",
      propSide: "Over",
      propLine: 1.5,
    }),
    false,
  );
});

test("P0: forged exact_market_10k object without registry cannot seat", () => {
  const forged = {
    source: "exact_market_10k" as const,
    hitProbability: 0.92,
    simulations: 10_000,
    nullReason: null,
    hitReliability: 1,
    sport: "nfl",
    marketKey: "player_sacks",
    athleteId: "4685724",
    eventId: "evt-hou-jax",
    side: "Over" as const,
    line: 0.5,
    evidenceId: "forged-token",
  };
  assert.equal(propProvenanceAllowsSeating(forged), false);
});

test("P0: keep 52/C+ floors, empty historical allowlist, #773 strip incomplete", () => {
  assert.equal(COACH_SIM_MIN_CONFIDENCE, 52);
  assert.equal(COACH_SIM_MIN_GRADE, "C+");
  assert.equal(VALIDATED_HISTORICAL_MODEL_ALLOWLIST.length, 0);
  assert.equal(UNVERIFIED_RELEASE_EVIDENCE_PROPS.length, 2);

  const incomplete = {
    isProp: true,
    player: "X",
    pick: "X Over 0.5",
    market: "Sacks",
    propMarketKey: "player_sacks",
    propSide: "Over",
    propLine: 0.5,
    odds: -110,
    athleteId: "1",
    // missing eventId + sportsbook
  } as unknown as ParsedPick;
  const { picks, stripped } = enforceSeatedPropProviderProvenance([incomplete]);
  assert.equal(picks.length, 0);
  assert.equal(stripped.length, 1);
});

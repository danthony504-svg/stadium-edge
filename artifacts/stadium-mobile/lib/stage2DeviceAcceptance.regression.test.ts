/**
 * Stage 2 device-acceptance regressions (iPhone screenshot failures).
 *
 * Locks the contracts that failed on preview OTA 01a14ce1 / tip 4718cfb7
 * against live API 0f600211. Does not implement Stage 3 Option C.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  askAllowsNcaafPlayerProps,
  askIsCollegeFootballOnly,
  propsSportLabelForAsk,
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
import {
  buildPropHolisticScore,
  propSimulationFactorLabel,
} from "./propHolisticRecommendation.ts";
import { scoreSimulation } from "./pickScore.ts";
import {
  COACH_SIM_MIN_CONFIDENCE,
  COACH_SIM_MIN_GRADE,
} from "./gameSimQualityGates.ts";
import { impliedProb } from "./format.ts";
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

test("Stage2: NFL player props ask allows CFB-props gate but sportLabel must be NFL", () => {
  const ask = "5 leg NFL player props";
  // Root cause of screenshot #1: allows-gate is true for any "player props".
  assert.equal(askAllowsNcaafPlayerProps(ask), true);
  assert.equal(askIsCollegeFootballOnly(ask), false);
  assert.equal(propsSportLabelForAsk(ask), "NFL");
  const note = propsOnlyTerminalShortNote(baseDiag({ staged: 3, target: 5 }), {
    sportLabel: propsSportLabelForAsk(ask),
    confidenceFloor: COACH_SIM_MIN_CONFIDENCE,
  });
  assert.match(note, /3 qualified NFL player props/i);
  assert.doesNotMatch(note, /college football/i);
});

test("Stage2: college football player props sportLabel stays college football", () => {
  const ask = "7 leg college football player props";
  assert.equal(askAllowsNcaafPlayerProps(ask), true);
  assert.equal(askIsCollegeFootballOnly(ask), true);
  assert.equal(propsSportLabelForAsk(ask), "college football");
});

test("Stage2: Anderson-style 9.3 display maps to ~92% hit, not proof of 10k MC", () => {
  // UI "10k Simulation 9.3 (92% hit)" inverts scoreSimulation.
  assert.equal(scoreSimulation(0.92), 9.3);
  assert.equal(Math.round(0.92 * 100), 92);
  // Local perfect sample caps at 0.98 → 9.8 / 98%, not 9.3.
  assert.equal(scoreSimulation(0.98), 9.8);
  // Deep ~0.79 would display 8.1 / 79% — also not the screenshot.
  assert.equal(scoreSimulation(0.79), 8.1);
});

test("Stage2: simulation factor must not claim 10k without monteCarloDraws===10000", () => {
  assert.equal(propSimulationFactorLabel(null), "Hit probability");
  assert.equal(propSimulationFactorLabel(undefined), "Hit probability");
  assert.equal(propSimulationFactorLabel(1000), "Hit probability");
  assert.equal(propSimulationFactorLabel(10_000), "10k Simulation");

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
    // no monteCarloDraws — props-only local history path
  });
  const simFactor = localOnly.factors.find((f) => f.key === "simulation");
  assert.equal(simFactor?.label, "Hit probability");
  assert.equal(simFactor?.display, "92% hit");
  assert.notEqual(simFactor?.label, "10k Simulation");

  const exact10k = buildPropHolisticScore({
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
    monteCarloDraws: 10_000,
  });
  assert.equal(
    exact10k.factors.find((f) => f.key === "simulation")?.label,
    "10k Simulation",
  );
});

test("Stage2: null-line NCAAF ATD normalizes to 0.5 and passes #773-lite provenance", () => {
  // Colandrea seat: event 5d147fef… / athlete 5044387 / +145 FanDuel.
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
  assert.equal(norm.propSide, "Over");

  // Raw null line fails provenance; normalized 0.5 passes — historical ATD path.
  assert.equal(checkPropProviderProvenance(raw).ok, false);
  assert.ok(checkPropProviderProvenance(raw).missing.includes("propLine"));
  assert.equal(checkPropProviderProvenance(norm).ok, true);

  const seated = enforceSeatedPropProviderProvenance([norm]);
  assert.equal(seated.picks.length, 1);
  assert.equal(seated.stripped.length, 0);

  // Historical binary series grades without deep MC (props-only never overwrites).
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
  assert.ok(graded.hitProbability != null && graded.hitProbability > 0);
  assert.equal(graded.nullReason, null);
  // No Option C / monteCarloDraws on tip — seating uses historical hit only.
  const implied = impliedProb(145);
  const edgeApprox = Math.round((graded.hitProbability! - implied) * 1000) / 10;
  assert.ok(Number.isFinite(edgeApprox));
});

test("Stage2: keep 52/C+ floors and empty historical allowlist unchanged", () => {
  assert.equal(COACH_SIM_MIN_CONFIDENCE, 52);
  assert.equal(COACH_SIM_MIN_GRADE, "C+");
  assert.equal(UNVERIFIED_RELEASE_EVIDENCE_PROPS.length, 2);
  assert.ok(
    UNVERIFIED_RELEASE_EVIDENCE_PROPS.every((r) => r.status === "UNVERIFIED"),
  );
});

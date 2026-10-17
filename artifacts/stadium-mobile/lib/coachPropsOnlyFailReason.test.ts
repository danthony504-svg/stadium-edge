import assert from "node:assert/strict";
import test from "node:test";

import { COACH_SIM_MIN_CONFIDENCE } from "./gameSimQualityGates.ts";
import {
  buildPropsOnlyFailDiag,
  derivePropsOnlyFailCode,
  formatPropsOnlyFailTrace,
  preferPropsOnlyFailDiag,
  propsOnlyFailNote,
  propsOnlyTerminalEmptyNote,
  reconcileCoachTerminalNote,
} from "./coachPropsOnlyFailReason.ts";
import type { PropsOnlyFailDiag } from "./coachPropsOnlyFailReason.ts";

function confGateDiag(oddsCleared = 11): PropsOnlyFailDiag {
  return buildPropsOnlyFailDiag({
    target: 7,
    pool: 6982,
    athleteLinked: 6982,
    candidates: 42,
    historyLoaded: 14,
    graded: 42,
    bestEvSides: 22,
    oddsCleared,
    staged: 0,
    nullReasons: {},
    stageRejects: {
      qualifyFail: { confidence_floor: oddsCleared },
      rareFail: 0,
      anytimeFail: 0,
      ladderDedupe: 0,
      perGameCap: 0,
      marketSideCap: 0,
      rareFamilyCap: 0,
    },
  });
}

function oddsGateDiag(): PropsOnlyFailDiag {
  return buildPropsOnlyFailDiag({
    target: 7,
    pool: 400,
    athleteLinked: 80,
    candidates: 48,
    historyLoaded: 20,
    graded: 42,
    bestEvSides: 22,
    oddsCleared: 0,
    staged: 0,
    nullReasons: {},
  });
}

function gradeGateDiag(): PropsOnlyFailDiag {
  return buildPropsOnlyFailDiag({
    target: 7,
    pool: 6982,
    athleteLinked: 6982,
    candidates: 42,
    historyLoaded: 14,
    graded: 42,
    bestEvSides: 22,
    oddsCleared: 11,
    staged: 0,
    nullReasons: {},
    stageRejects: {
      qualifyFail: { grade_floor: 11, confidence_floor: 2 },
      rareFail: 0,
      anytimeFail: 0,
      ladderDedupe: 0,
      perGameCap: 0,
      marketSideCap: 0,
      rareFamilyCap: 0,
    },
  });
}

test("derivePropsOnlyFailCode picks the earliest actionable bottleneck", () => {
  assert.equal(
    derivePropsOnlyFailCode({
      target: 9,
      pool: 0,
      athleteLinked: 0,
      candidates: 0,
      historyLoaded: 0,
      graded: 0,
      bestEvSides: 0,
      oddsCleared: 0,
      staged: 0,
      nullReasons: {},
    }),
    "PROPS_ONLY_POOL_EMPTY",
  );
  assert.equal(
    derivePropsOnlyFailCode({
      target: 9,
      pool: 400,
      athleteLinked: 0,
      candidates: 0,
      historyLoaded: 0,
      graded: 0,
      bestEvSides: 0,
      oddsCleared: 0,
      staged: 0,
      nullReasons: {},
    }),
    "PROPS_ONLY_NO_CANDIDATES",
  );
  assert.equal(
    derivePropsOnlyFailCode({
      target: 9,
      pool: 400,
      athleteLinked: 80,
      candidates: 48,
      historyLoaded: 0,
      graded: 0,
      bestEvSides: 0,
      oddsCleared: 0,
      staged: 0,
      nullReasons: { no_player_history: 48 },
    }),
    "PROPS_ONLY_NO_HISTORY",
  );
  assert.equal(
    derivePropsOnlyFailCode({
      target: 9,
      pool: 400,
      athleteLinked: 80,
      candidates: 48,
      historyLoaded: 20,
      graded: 0,
      bestEvSides: 0,
      oddsCleared: 0,
      staged: 0,
      nullReasons: { insufficient_mapped_stats: 40 },
    }),
    "PROPS_ONLY_NO_GRADE",
  );
  assert.equal(
    derivePropsOnlyFailCode({
      target: 9,
      pool: 400,
      athleteLinked: 80,
      candidates: 48,
      historyLoaded: 20,
      graded: 12,
      bestEvSides: 10,
      oddsCleared: 0,
      staged: 0,
      nullReasons: {},
    }),
    "PROPS_ONLY_ODDS_GATE",
  );
  assert.equal(
    derivePropsOnlyFailCode({
      target: 7,
      pool: 6982,
      athleteLinked: 6982,
      candidates: 42,
      historyLoaded: 14,
      graded: 42,
      bestEvSides: 22,
      oddsCleared: 11,
      staged: 0,
      nullReasons: {},
      stageRejects: {
        qualifyFail: { confidence_floor: 11 },
        rareFail: 0,
        anytimeFail: 0,
        ladderDedupe: 0,
        perGameCap: 0,
        marketSideCap: 0,
        rareFamilyCap: 0,
      },
    }),
    "PROPS_ONLY_CONFIDENCE_GATE",
  );
});

test("phone empty note includes code + counters so OTA can diagnose", () => {
  const diag = buildPropsOnlyFailDiag({
    target: 9,
    pool: 412,
    athleteLinked: 90,
    candidates: 48,
    historyLoaded: 2,
    graded: 0,
    bestEvSides: 0,
    oddsCleared: 0,
    staged: 0,
    nullReasons: { no_player_history: 40, insufficient_mapped_stats: 6 },
    sports: { nfl: 50, wnba: 362 },
  });
  assert.equal(diag.code, "PROPS_ONLY_NO_HISTORY");
  const trace = formatPropsOnlyFailTrace(diag);
  assert.match(trace, /PROPS_ONLY_NO_HISTORY/);
  assert.match(trace, /pool=412/);
  assert.match(trace, /cand=48/);
  assert.match(trace, /hist=2/);
  assert.match(trace, /nulls=no_player_history:40/);
  assert.match(trace, /sports=wnba:362/);

  const note = propsOnlyFailNote(
    "You asked for 9 legs — no AI-backed player props cleared the quality bar. No ungraded filler was added.",
    diag,
  );
  assert.match(note, /quality bar/);
  assert.doesNotMatch(note, /\[PROPS_ONLY_NO_HISTORY:/);
  assert.doesNotMatch(note, /graded=0/);
  // Machine trace still available for logs — just not in the chat bubble.
  assert.match(formatPropsOnlyFailTrace(diag), /PROPS_ONLY_NO_HISTORY/);
});

test("oddsCleared=11 confidence rejects → confidence-floor message (not recovery odds)", () => {
  assert.equal(COACH_SIM_MIN_CONFIDENCE, 52);
  const diag = confGateDiag(11);
  assert.equal(diag.code, "PROPS_ONLY_CONFIDENCE_GATE");
  const note = propsOnlyTerminalEmptyNote(diag, {
    sportLabel: "college football",
    confidenceFloor: COACH_SIM_MIN_CONFIDENCE,
    recoveryGraded: { preferred: 42, skill: 42 },
  });
  assert.match(note, /I found 11 college football player props within the allowed odds range/);
  assert.match(note, /none met the 52% confidence floor/);
  assert.match(note, /did not use another sport/);
  assert.doesNotMatch(note, /none cleared recovery odds/i);
});

test("oddsCleared=0 → odds-gate / recovery-odds message", () => {
  const diag = oddsGateDiag();
  assert.equal(diag.code, "PROPS_ONLY_ODDS_GATE");
  const note = propsOnlyTerminalEmptyNote(diag, {
    sportLabel: "college football",
    recoveryGraded: { preferred: 42, skill: 42 },
  });
  assert.match(note, /none cleared recovery odds/i);
  assert.doesNotMatch(note, /confidence floor/i);
});

test("grade dominates → generic grade empty message, not confidence", () => {
  const diag = gradeGateDiag();
  assert.equal(diag.code, "PROPS_ONLY_EMPTY");
  const note = propsOnlyTerminalEmptyNote(diag, {
    sportLabel: "college football",
    confidenceFloor: COACH_SIM_MIN_CONFIDENCE,
  });
  assert.match(note, /grade floor/i);
  assert.doesNotMatch(note, /confidence floor/i);
  assert.doesNotMatch(note, /none cleared recovery odds/i);
});

test("softPreferred ODDS_GATE must not wipe skill-board CONFIDENCE_GATE", () => {
  const skill = confGateDiag(11);
  const soft = oddsGateDiag();
  const preferred = preferPropsOnlyFailDiag(skill, soft);
  assert.equal(preferred?.code, "PROPS_ONLY_CONFIDENCE_GATE");
  assert.equal(preferred?.oddsCleared, 11);
  const note = propsOnlyTerminalEmptyNote(preferred!, {
    sportLabel: "college football",
    confidenceFloor: COACH_SIM_MIN_CONFIDENCE,
    recoveryGraded: { preferred: 42, skill: 42 },
  });
  assert.match(note, /52% confidence floor/);
  assert.doesNotMatch(note, /recovery odds/i);
});

test("duplicate partial/final publish → one coherent terminal response", () => {
  const conf = confGateDiag(11);
  const odds = oddsGateDiag();
  const partial =
    "Graded 42 locked-market props and 42 skill alts (yards / receptions / sacks) — none cleared recovery odds. No ungraded filler was added.";
  const finalWrong = partial;
  const reconciled = reconcileCoachTerminalNote({
    priorText: partial,
    nextText: finalWrong,
    priorFailDiag: odds,
    nextFailDiag: conf,
    sportLabel: "college football",
    confidenceFloor: COACH_SIM_MIN_CONFIDENCE,
    recoveryGraded: { preferred: 42, skill: 42 },
  });
  assert.match(reconciled, /I found 11 college football player props/);
  assert.match(reconciled, /52% confidence floor/);
  assert.doesNotMatch(reconciled, /recovery odds/i);
  // Must not concatenate two empty leads.
  assert.equal(
    (reconciled.match(/I found \d+ college football player props/g) ?? []).length,
    1,
  );
  assert.doesNotMatch(reconciled, /none cleared recovery odds[\s\S]*confidence floor/i);
});

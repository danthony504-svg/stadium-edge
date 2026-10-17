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
  propsOnlyTerminalShortNote,
  reconcileCoachTerminalNote,
} from "./coachPropsOnlyFailReason.ts";
import type { PropsOnlyFailDiag, PropsOnlyStageRejects } from "./coachPropsOnlyFailReason.ts";

function emptyStageRejects(
  overrides?: Partial<PropsOnlyStageRejects> & {
    qualifyFail?: Record<string, number>;
  },
): PropsOnlyStageRejects {
  return {
    qualifyFail: overrides?.qualifyFail ?? {},
    rareFail: overrides?.rareFail ?? 0,
    anytimeFail: overrides?.anytimeFail ?? 0,
    ladderDedupe: overrides?.ladderDedupe ?? 0,
    perGameCap: overrides?.perGameCap ?? 0,
    marketSideCap: overrides?.marketSideCap ?? 0,
    rareFamilyCap: overrides?.rareFamilyCap ?? 0,
  };
}

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

function shortDiag(opts: {
  staged: number;
  target?: number;
  oddsCleared: number;
  uniqueGames?: number;
  graded?: number;
  bestEvSides?: number;
  stageRejects?: PropsOnlyStageRejects;
}): PropsOnlyFailDiag {
  const target = opts.target ?? 7;
  return buildPropsOnlyFailDiag({
    target,
    pool: 4239,
    athleteLinked: 4239,
    candidates: 42,
    historyLoaded: 17,
    graded: opts.graded ?? 36,
    bestEvSides: opts.bestEvSides ?? 19,
    oddsCleared: opts.oddsCleared,
    staged: opts.staged,
    uniqueGames: opts.uniqueGames,
    nullReasons: {},
    sports: { ncaaf: 4239 },
    stageRejects: opts.stageRejects ?? emptyStageRejects(),
  });
}

test("staged 2/7 + remaining confidence rejects → confidence-shortfall copy", () => {
  assert.equal(COACH_SIM_MIN_CONFIDENCE, 52);
  const diag = shortDiag({
    staged: 2,
    oddsCleared: 12,
    uniqueGames: 2,
    stageRejects: emptyStageRejects({
      qualifyFail: { confidence_floor: 10 },
    }),
  });
  assert.equal(diag.code, "PROPS_ONLY_STAGED_SHORT");
  const note = propsOnlyTerminalShortNote(diag, {
    sportLabel: "college football",
    confidenceFloor: COACH_SIM_MIN_CONFIDENCE,
  });
  assert.match(note, /I found 2 qualified college football player props for your 7-leg request/);
  assert.match(note, /remaining odds-cleared props did not meet the 52% confidence floor/i);
  assert.match(note, /left the ticket short/i);
  assert.match(note, /lowering the quality bar or adding another sport/i);
  assert.doesNotMatch(note, /thin-slate/i);
  assert.doesNotMatch(note, /too thin/i);
});

test("staged 1/7 + confidence rejects → confidence-shortfall copy", () => {
  const diag = shortDiag({
    staged: 1,
    oddsCleared: 12,
    uniqueGames: 3,
    stageRejects: emptyStageRejects({
      qualifyFail: { confidence_floor: 11 },
    }),
  });
  assert.equal(diag.code, "PROPS_ONLY_STAGED_SHORT");
  const note = propsOnlyTerminalShortNote(diag, {
    sportLabel: "college football",
    confidenceFloor: COACH_SIM_MIN_CONFIDENCE,
  });
  assert.match(note, /I found 1 qualified college football player props for your 7-leg request/);
  assert.match(note, /52% confidence floor/);
  assert.doesNotMatch(note, /thin-slate/i);
  // Reconcile must prefer short failDiag authority over a stale thin-slate lead.
  const reconciled = reconcileCoachTerminalNote({
    priorText:
      "You asked for 7 legs — only 1 player props fit after thin-slate fill (3 games, 12 cleared odds). No ungraded filler was added.",
    nextText: note,
    priorFailDiag: diag,
    nextFailDiag: diag,
    sportLabel: "college football",
    confidenceFloor: COACH_SIM_MIN_CONFIDENCE,
  });
  assert.match(reconciled, /52% confidence floor/);
  assert.doesNotMatch(reconciled, /thin-slate/i);
});

test("genuine candidate scarcity → thin-slate copy", () => {
  const diag = shortDiag({
    staged: 2,
    oddsCleared: 2,
    uniqueGames: 1,
    graded: 2,
    bestEvSides: 2,
    stageRejects: emptyStageRejects(),
  });
  assert.equal(diag.code, "PROPS_ONLY_STAGED_SHORT");
  const note = propsOnlyTerminalShortNote(diag, {
    sportLabel: "college football",
    confidenceFloor: COACH_SIM_MIN_CONFIDENCE,
  });
  assert.match(note, /I found 2 qualified college football player props/);
  assert.match(note, /posted slate was too thin/);
  assert.match(note, /1 game/);
  assert.match(note, /2 cleared odds/);
  assert.doesNotMatch(note, /confidence floor/i);
  assert.doesNotMatch(note, /thin-slate fill/i);
});

test("genuine odds wipe after staged legs → odds-related shortfall copy", () => {
  const diag = shortDiag({
    staged: 2,
    oddsCleared: 2,
    uniqueGames: 4,
    graded: 36,
    bestEvSides: 19,
    stageRejects: emptyStageRejects(),
  });
  assert.equal(diag.code, "PROPS_ONLY_STAGED_SHORT");
  const note = propsOnlyTerminalShortNote(diag, {
    sportLabel: "college football",
    confidenceFloor: COACH_SIM_MIN_CONFIDENCE,
  });
  assert.match(note, /I found 2 qualified college football player props/);
  assert.match(note, /did not clear the ticket odds bar/i);
  assert.doesNotMatch(note, /confidence floor/i);
  assert.doesNotMatch(note, /thin-slate/i);
  assert.doesNotMatch(note, /too thin/i);
});

test("cap/correlation constraint → appropriate constraint copy", () => {
  const diag = shortDiag({
    staged: 3,
    oddsCleared: 12,
    uniqueGames: 1,
    stageRejects: emptyStageRejects({
      perGameCap: 9,
      qualifyFail: { confidence_floor: 1 },
    }),
  });
  assert.equal(diag.code, "PROPS_ONLY_STAGED_SHORT");
  const note = propsOnlyTerminalShortNote(diag, {
    sportLabel: "college football",
    confidenceFloor: COACH_SIM_MIN_CONFIDENCE,
  });
  assert.match(note, /I found 3 qualified college football player props/);
  assert.match(note, /per-game seat caps/i);
  assert.match(note, /stacking correlated seats/i);
  assert.doesNotMatch(note, /confidence floor/i);
  assert.doesNotMatch(note, /thin-slate/i);
});

test("7 qualified candidates → no shortfall note", () => {
  const diag = shortDiag({
    staged: 7,
    oddsCleared: 12,
    uniqueGames: 5,
    stageRejects: emptyStageRejects(),
  });
  // Full ticket is not STAGED_SHORT.
  assert.notEqual(diag.code, "PROPS_ONLY_STAGED_SHORT");
  const note = propsOnlyTerminalShortNote(diag, {
    sportLabel: "college football",
    confidenceFloor: COACH_SIM_MIN_CONFIDENCE,
  });
  assert.equal(note, "");
});

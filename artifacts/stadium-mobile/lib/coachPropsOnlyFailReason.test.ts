import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPropsOnlyFailDiag,
  derivePropsOnlyFailCode,
  formatPropsOnlyFailTrace,
  propsOnlyFailNote,
} from "./coachPropsOnlyFailReason.ts";

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
    "You asked for **9** legs — no AI-backed player props cleared the quality bar. No ungraded filler was added.",
    diag,
  );
  assert.match(note, /quality bar/);
  assert.match(note, /\[PROPS_ONLY_NO_HISTORY:/);
  assert.match(note, /graded=0/);
});

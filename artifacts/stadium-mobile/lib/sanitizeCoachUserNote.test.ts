import assert from "node:assert/strict";
import test from "node:test";

import {
  COACH_MACHINE_TRACE_CODES,
  coachUserNoteHasMachineTrace,
  sanitizeCoachUserNote,
} from "./sanitizeCoachUserNote.ts";
import {
  deriveCoachScanFailureReason,
  formatCoachScanFailureTrace,
  type CoachScanFailureCode,
} from "./coachScanFailureReason.ts";
import {
  buildPropsOnlyFailDiag,
  formatPropsOnlyFailTrace,
  propsOnlyFailNote,
} from "./coachPropsOnlyFailReason.ts";
import { buildFinalCoachParlayNote } from "./boardScanPropDelivery.ts";
import { buildFixedLegCountShortfallLead } from "./coachScanPolicy.ts";
import { coachPropsAskGameLineMismatchNote } from "./coach/parseAsk.ts";

test("sanitizeCoachUserNote strips every known Coach machine CODE", () => {
  for (const code of COACH_MACHINE_TRACE_CODES) {
    const dirty =
      `You asked for **8** legs — no AI-backed picks cleared. [${code}: internal detail here]`;
    assert.ok(coachUserNoteHasMachineTrace(dirty), code);
    const clean = sanitizeCoachUserNote(dirty);
    assert.equal(
      clean,
      "You asked for **8** legs — no AI-backed picks cleared.",
      code,
    );
    assert.ok(!coachUserNoteHasMachineTrace(clean), code);
    assert.doesNotMatch(clean, new RegExp(code));
  }
});

test("sanitizeCoachUserNote strips multiple traces and leaves human copy", () => {
  const dirty =
    "Shortfall. [PROP_POOL_EMPTY: empty pool] Extra. [POST_FILTER_EMPTY: built=4 afterTeamOrMarketFilter=0]";
  const clean = sanitizeCoachUserNote(dirty);
  assert.equal(clean, "Shortfall. Extra.");
  assert.ok(!coachUserNoteHasMachineTrace(clean));
});

test("sanitizeCoachUserNote is a no-op on clean human notes", () => {
  const clean =
    "You asked for **8** legs — no AI-backed picks cleared the quality bar. No ungraded filler was added.";
  assert.equal(sanitizeCoachUserNote(clean), clean);
});

test("formatCoachScanFailureTrace codes are covered by the sanitizer list", () => {
  const scanCodes: CoachScanFailureCode[] = [
    "SCAN_THREW",
    "NO_ODDS_GAMES",
    "TEAM_ID_MAP_EMPTY",
    "TEAM_IDS_UNRESOLVED",
    "GAME_SIMS_TIMED_OUT",
    "GAME_SIMS_FETCH_EMPTY",
    "GAME_SIMS_ALL_NULL",
    "GAME_LINES_NO_SIM_GRADE",
    "PROP_POOL_EMPTY",
    "PROP_PHASE_INCOMPLETE",
    "PROP_ALL_NO_SIM_GRADE",
    "SCORED_BUT_NOT_STAGED",
    "ABSOLUTE_BUDGET",
    "QUALITY_BAR_EMPTY",
  ];
  for (const code of scanCodes) {
    assert.ok(
      (COACH_MACHINE_TRACE_CODES as readonly string[]).includes(code),
      `missing sanitizer coverage for ${code}`,
    );
  }
});

test("buildFinalCoachParlayNote never leaks any scan failure CODE", () => {
  for (const code of [
    "PROP_POOL_EMPTY",
    "TEAM_IDS_UNRESOLVED",
    "SCAN_THREW",
    "ABSOLUTE_BUDGET",
    "QUALITY_BAR_EMPTY",
    "PROP_PHASE_INCOMPLETE",
  ] as const) {
    const note = buildFinalCoachParlayNote({
      target: 8,
      picks: [],
      propPoolSize: 0,
      propsPending: false,
      shortfallLead: buildFixedLegCountShortfallLead(8, 0),
      failureReason: { code, detail: "internal only" },
    });
    assert.ok(!coachUserNoteHasMachineTrace(note), code);
    assert.doesNotMatch(note, new RegExp(code));
  }
});

test("propsOnlyFailNote never leaks PROPS_ONLY_* codes", () => {
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
    nullReasons: { no_player_history: 40 },
    sports: { nfl: 50 },
  });
  const lead =
    "You asked for **9** legs — no AI-backed player props cleared the quality bar.";
  // Even if a caller concatenates the log trace, sanitize must win.
  const dirty = `${lead}${formatPropsOnlyFailTrace(diag)}`;
  assert.ok(coachUserNoteHasMachineTrace(dirty));
  const note = propsOnlyFailNote(dirty, diag);
  assert.ok(!coachUserNoteHasMachineTrace(note));
  assert.doesNotMatch(note, /PROPS_ONLY_/);
});

test("props mismatch notes never leak PROPS_ASK / PROPS_ONLY_LEAKED codes", () => {
  const note = coachPropsAskGameLineMismatchNote({
    askText: "9 lag NFL player prop",
    propsOnly: false,
    picks: [
      { isProp: false, market: "Spread" },
      { isProp: false, market: "Total" },
    ],
  });
  assert.match(note, /You asked for player props/);
  assert.ok(!coachUserNoteHasMachineTrace(note));
  assert.doesNotMatch(note, /PROPS_ASK_GOT_GAME_LINES|PROPS_ONLY_LEAKED/);
});

test("derive + format traces still work for logs (not wiped from formatters)", () => {
  const reason = deriveCoachScanFailureReason({
    stagedPickCount: 0,
    oddsGameCount: 8,
    gameEntryCount: 8,
    propPoolSize: 0,
    gameLegsScored: 0,
    requirePropMix: true,
  });
  assert.equal(reason?.code, "PROP_POOL_EMPTY");
  assert.match(formatCoachScanFailureTrace(reason!), /PROP_POOL_EMPTY/);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runNflDriveSim } from "../src/lib/sportSim/nflDriveSim.ts";
import {
  CLOSE_ARCHIVE_SOFT_GATES,
  DOG_COHORT_COVER_MAX,
  DOG_COHORT_HI,
  DOG_COHORT_LO,
  FOOTBALL_CALIBRATION_PRIMARY_SEED,
  FOOTBALL_CALIBRATION_SEEDS,
  FOOTBALL_PRIOR_GAME_COMPLETE_MS,
  PRIOR_E2B_SOFT_GATE_CLAIM,
  dogCohort,
  evaluateCloseArchiveSoftGates,
  evaluateClosingLines,
  credibleFootballCompletionMs,
  footballFormMayIncludePriorGame,
  footballPriorAvailableAt,
  loadClosingLineArchive,
  mulberry32,
} from "../src/lib/sportSim/footballCalibration.ts";

test("precommitted seeds stay in declaration order", () => {
  assert.equal(FOOTBALL_CALIBRATION_PRIMARY_SEED, 20241015);
  assert.deepEqual(
    [...FOOTBALL_CALIBRATION_SEEDS],
    [20241015, 7, 42, 99, 123456789],
  );
  assert.equal(DOG_COHORT_LO, 0.45);
  assert.equal(DOG_COHORT_HI, 0.55);
  assert.equal(DOG_COHORT_COVER_MAX, 0.7);
});

test("the same drive seed replays the same projected scores", () => {
  const input = {
    sport: "nfl" as const,
    simulations: 400,
    home: { ptsFor: 24, ptsAgainst: null },
    away: { ptsFor: 17, ptsAgainst: null },
    retainOutcomes: false,
  };
  const a = runNflDriveSim({ ...input, random: mulberry32(20241015) });
  const b = runNflDriveSim({ ...input, random: mulberry32(20241015) });
  const c = runNflDriveSim({ ...input, random: mulberry32(7) });
  assert.equal(a?.homeProjectedScore, b?.homeProjectedScore);
  assert.equal(a?.awayProjectedScore, b?.awayProjectedScore);
  assert.notEqual(a?.homeProjectedScore, c?.homeProjectedScore);
});

test("dog cohort uses the open interval around one half", () => {
  const rows = [
    { eventId: "a", pHome: 0.45, yHome: 1, awayCovered75: 1 },
    { eventId: "b", pHome: 0.5, yHome: 0, awayCovered75: 1 },
    { eventId: "c", pHome: 0.55, yHome: 1, awayCovered75: 0 },
    { eventId: "d", pHome: 0.5, yHome: 0, awayCovered75: 0 },
  ];
  const cohort = dogCohort(rows);
  assert.equal(cohort.n, 2);
  assert.equal(cohort.awayCoverRate, 0.5);
});

test("missing closing-line archive is an empty inventory", () => {
  const loaded = loadClosingLineArchive(join(tmpdir(), "ncaaf-phase-e-closing-lines-absent.json"));
  assert.equal(loaded.present, false);
  assert.equal(loaded.rows.length, 0);
  const verdict = evaluateClosingLines([]);
  assert.equal(verdict.verdict, "INSUFFICIENT_DATA");
  assert.equal(verdict.n, 0);
});

test("a populated closing join stays open until a tolerance exists", () => {
  const dir = mkdtempSync(join(tmpdir(), "closing-"));
  const path = join(dir, "ncaaf-phase-e-closing-lines.json");
  writeFileSync(
    path,
    JSON.stringify({
      rows: [{ eventId: "1", closeSpreadHome: -3.5, closeMlHome: -150, book: "fixture" }],
    }),
  );
  const loaded = loadClosingLineArchive(path);
  assert.equal(loaded.rows.length, 1);
  const joins = Array.from({ length: 200 }, (_, i) => ({
    eventId: String(i),
    pHome: 0.6,
    yHome: i % 2,
    closeSpreadHome: -3,
    closeMlHome: -140,
    pHomeCoverClose: 0.52,
    homeCoveredClose: i % 2,
  }));
  const verdict = evaluateClosingLines(joins);
  assert.equal(verdict.verdict, "OPEN_NEEDS_AGREED_TOLERANCE");
  assert.equal(verdict.n, 200);
  assert.ok(verdict.engineBrier != null && verdict.marketBrier != null);
  const aligned = joins.map((row) => ({ ...row, pHome: 0.62, yHome: 1, closeMlHome: -160 }));
  const soft = evaluateCloseArchiveSoftGates(aligned);
  assert.equal(soft.verdict, "PASS_SOFT_GATES_ONLY");
  assert.equal(CLOSE_ARCHIVE_SOFT_GATES.meanEngineMinusMarketAbsMax, 0.15);
  const miss = evaluateCloseArchiveSoftGates(
    joins.map((row) => ({ ...row, pHome: 0.9, yHome: 0, closeMlHome: -110 })),
  );
  assert.equal(miss.verdict, "FAIL_SOFT_GATES");
});

test("PR 737 closing archive uses gameId and keeps the old PASS unrestored", () => {
  const loaded = loadClosingLineArchive(
    join(dirname(fileURLToPath(import.meta.url)), "fixtures/ncaaf-phase-e-closing-lines.json"),
  );
  assert.equal(loaded.present, true);
  assert.equal(loaded.rows.length, 774);
  assert.equal(loaded.dropped, 68);
  assert.equal(loaded.rows.some((row) => row.eventId === "401635525"), true);
  assert.equal(PRIOR_E2B_SOFT_GATE_CLAIM.verdict, "PASS");
  assert.equal(PRIOR_E2B_SOFT_GATE_CLAIM.restored, false);
  assert.equal(PRIOR_E2B_SOFT_GATE_CLAIM.coachPickClv, "COMPUTED_NO_PASS_LABEL");
});

test("form includes a prior game only after kickoff plus four hours", () => {
  assert.equal(FOOTBALL_PRIOR_GAME_COMPLETE_MS, 4 * 60 * 60 * 1000);
  assert.equal(
    footballFormMayIncludePriorGame("2024-09-07T16:00:00Z", "2024-09-07T18:00:00Z"),
    false,
  );
  assert.equal(
    footballFormMayIncludePriorGame("2024-09-07T16:00:00Z", "2024-09-07T20:00:00Z"),
    true,
  );
  assert.equal(footballFormMayIncludePriorGame("", "2024-09-07T20:00:00Z"), false);
});

test("a credible last-play stamp replaces the four-hour assumption", () => {
  const kickoff = "2024-09-07T16:00:00Z";
  const finished = "2024-09-07T19:12:00Z";
  assert.ok(credibleFootballCompletionMs(kickoff, finished) != null);
  assert.equal(
    footballPriorAvailableAt(
      { kickoffIso: kickoff, completedAtIso: finished },
      "2024-09-07T19:30:00Z",
    ),
    "completedAt",
  );
  assert.equal(
    footballPriorAvailableAt({ kickoffIso: kickoff, completedAtIso: finished }, "2024-09-07T18:00:00Z"),
    null,
  );
  assert.equal(
    footballPriorAvailableAt(
      { kickoffIso: kickoff, completedAtIso: "2024-09-07T17:10:00Z" },
      "2024-09-07T19:30:00Z",
    ),
    null,
  );
  assert.equal(
    footballPriorAvailableAt(
      { kickoffIso: kickoff, completedAtIso: "2024-09-07T21:30:00Z" },
      "2024-09-07T20:00:00Z",
    ),
    null,
  );
  assert.equal(
    footballPriorAvailableAt(
      { kickoffIso: kickoff, completedAtIso: "2024-09-06T20:00:00Z" },
      "2024-09-07T20:00:00Z",
    ),
    "kickoffPlusFourHours",
  );
  assert.equal(
    footballPriorAvailableAt(
      { kickoffIso: kickoff, completedAtIso: "2024-09-06T20:00:00Z" },
      "2024-09-07T20:00:00Z",
      { credibleCompletionOnly: true },
    ),
    null,
  );
});

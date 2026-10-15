import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runNflDriveSim } from "../src/lib/sportSim/nflDriveSim.ts";
import {
  DOG_COHORT_COVER_MAX,
  DOG_COHORT_HI,
  DOG_COHORT_LO,
  FOOTBALL_CALIBRATION_PRIMARY_SEED,
  FOOTBALL_CALIBRATION_SEEDS,
  dogCohort,
  evaluateClosingLines,
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
});

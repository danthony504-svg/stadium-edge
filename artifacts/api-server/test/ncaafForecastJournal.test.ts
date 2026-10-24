import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  prepareForwardForecast,
  type ForecastInput,
} from "../src/lib/ncaafForecastJournal.js";
const now = "2026-10-23T12:00:00Z",
  raw = JSON.stringify({ injuries: [] });
function fixture(): ForecastInput {
  return {
    version: 1,
    target: {
      season: 2026,
      eventId: "999",
      homeId: "1",
      awayId: "2",
      kickoff: "2026-10-24T18:00:00Z",
      ruleset: "fixture",
    },
    games: Array.from({ length: 36 }, (_, i) => ({
      season: 2026,
      eventId: String(i + 10),
      homeId: i < 3 ? "1" : i < 6 ? "2" : String(100 + i),
      awayId: String(200 + i),
      kickoff: "2026-09-01T12:00:00Z",
      completedAt: "2026-09-01T16:00:00Z",
      observedAt: "2026-09-01T17:00:00Z",
      source: "fixture",
      ruleset: "fixture",
      homePoints: i < 6 ? 28 : 31,
      awayPoints: i < 6 ? 21 : 28,
      overtime: i >= 6,
      regulationHomePoints: i < 6 ? 28 : 21,
      regulationAwayPoints: 21,
    })),
    quotes: [
      {
        season: 2026,
        eventId: "999",
        bookmaker: "fixture",
        market: "spread",
        line: -3.5,
        firstPrice: -110,
        secondPrice: -110,
        observedAt: now,
        settlement: "full_game_including_overtime",
      },
    ],
    injuryEvidence: {
      key: "research:ncaaf:injuries:2026-10-23T11:59",
      observedAt: now,
      sha256: createHash("sha256").update(raw).digest("hex"),
      rawResponse: raw,
      absentTeamStatus: "unknown",
    },
  };
}
test("freezes deterministic probabilities with exact quote and inputs; never grants release", () => {
  const f = fixture(),
    r = prepareForwardForecast(f, now);
  assert.deepEqual(r, prepareForwardForecast(f, now));
  assert.equal(r.simulations, 10000);
  assert.equal(r.markets[0].line, -3.5);
  assert.equal(r.markets[0].firstPrice, -110);
  assert.ok(
    r.markets[0].winProbability >= 0 && r.markets[0].winProbability <= 1,
  );
  assert.equal(r.productionReady, false);
  assert.equal(r.validationReady, false);
  assert.equal(r.automaticUnlock, false);
  assert.equal(r.absentTeamStatus, "unknown");
  assert.deepEqual(r.input, f);
});
test("late forecasts, future history/quotes/injuries and tampered injury bytes fail", () => {
  assert.throws(() =>
    prepareForwardForecast(fixture(), "2026-10-24T18:00:00Z"),
  );
  for (const mutate of [
    (f: ForecastInput) => {
      f.games[0].observedAt = "2026-10-25T12:00:00Z";
    },
    (f: ForecastInput) => {
      f.quotes[0].observedAt = "2026-10-25T12:00:00Z";
    },
    (f: ForecastInput) => {
      f.injuryEvidence.observedAt = "2026-10-25T12:00:00Z";
    },
    (f: ForecastInput) => {
      f.injuryEvidence.rawResponse = "{}";
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(() => prepareForwardForecast(f, now));
  }
});
test("insufficient history and duplicated overtime cannot manufacture evidence", () => {
  const f = fixture();
  f.games = f.games.slice(0, 6);
  assert.throws(() => prepareForwardForecast(f, now), /insufficient_candidate/);
  const g = fixture();
  g.games = Array(36).fill(g.games[0]);
  assert.throws(() => prepareForwardForecast(g, now), /thin_team/);
});
test("quote identity, malformed prices and duplicate quote rows fail", () => {
  for (const patch of [
    { eventId: "998" },
    { line: null },
    { firstPrice: 0 },
    { market: "first_half" },
  ]) {
    const f = fixture();
    Object.assign(f.quotes[0], patch);
    assert.throws(() => prepareForwardForecast(f, now));
  }
  const f = fixture();
  f.quotes.push({ ...f.quotes[0] });
  assert.throws(() => prepareForwardForecast(f, now), /duplicate_quote/);
});

test("settlement scores frozen probabilities and excludes pushes; mismatched and late records reject", async () => {
  const { scoreRecordedForecast } =
    await import("../src/lib/ncaafForecastJournal.js");
  const input = fixture();
  input.quotes[0].line = -7;
  const record = {
    ...prepareForwardForecast(input, now),
    recordedAt: "2026-10-23T12:00:01Z",
  };
  const outcome = {
    ...input.games[0],
    ...input.target,
    homePoints: 28,
    awayPoints: 21,
    overtime: false,
    regulationHomePoints: 28,
    regulationAwayPoints: 21,
    completedAt: "2026-10-24T22:00:00Z",
    observedAt: "2026-10-24T22:01:00Z",
  };
  assert.equal(scoreRecordedForecast(record, outcome)[0].modelBrier, null);
  record.markets[0].conditionalWinProbability = 0.8;
  const win = { ...outcome, homePoints: 35, regulationHomePoints: 35 };
  assert.ok(
    Math.abs(scoreRecordedForecast(record, win)[0].modelBrier! - 0.04) < 1e-12,
  );
  assert.throws(() =>
    scoreRecordedForecast({ ...record, recordedAt: input.target.kickoff }, win),
  );
  assert.throws(() =>
    scoreRecordedForecast(record, { ...win, eventId: "888" }),
  );
});

import {
  overtimeSupportFromArchive,
  verifyOvertimeSupportArchive,
  OT_TRANSFER_MODEL_VERSION,
} from "../src/lib/ncaafOvertimeTransfer.js";
function transferFixture() {
  const f = fixture();
  f.target.ruleset = "ncaa-football-season-2026-unverified";
  const all = f.games.map((g) => ({ ...g, ruleset: f.target.ruleset }));
  f.games = all.slice(0, 22);
  const old = all
    .slice(6, 20)
    .map((g) => ({
      ...g,
      season: 2025,
      ruleset: "ncaa-football-season-2025-unverified",
      kickoff: "2025-09-01T12:00:00Z",
      completedAt: "2025-09-01T16:00:00Z",
    }));
  f.overtimeSupport = overtimeSupportFromArchive(
    "research:ncaaf:history-summary:2025:fixture",
    { games: old },
  );
  return f;
}
test("OT transfer is a separate forward research model with the same 30-unique-record floor", () => {
  const f = transferFixture();
  const r = prepareForwardForecast(f, now);
  assert.equal(r.modelVersion, OT_TRANSFER_MODEL_VERSION);
  assert.equal(r.productionReady, false);
  assert.equal(r.validationReady, false);
  assert.equal(r.automaticUnlock, false);
  assert.equal(r.overtimeTransferReview?.transferCalibrationVerified, false);
  assert.equal(r.input.games.length, 22);
  assert.equal(r.input.overtimeSupport?.games.length, 14);
  const thin = structuredClone(f);
  thin.overtimeSupport!.games.pop();
  assert.throws(
    () => prepareForwardForecast(thin, now),
    /insufficient_candidate_evidence/,
  );
  const dup = structuredClone(f);
  dup.overtimeSupport!.games = Array(14).fill(dup.overtimeSupport!.games[0]);
  assert.throws(
    () => prepareForwardForecast(dup, now),
    /insufficient_candidate_evidence/,
  );
});
test("unreviewed years, mismatched archive references, and future OT observations reject", () => {
  for (const change of [
    (f: ForecastInput) => {
      f.overtimeSupport!.games[0].season = 2024;
    },
    (f: ForecastInput) => {
      f.target.season = 2027;
    },
    (f: ForecastInput) => {
      f.overtimeSupport!.sourceKey = "research:ncaaf:history-summary:2024:x";
    },
    (f: ForecastInput) => {
      f.overtimeSupport!.games[0].observedAt = f.target.kickoff;
    },
  ]) {
    const f = transferFixture();
    change(f);
    assert.throws(() => prepareForwardForecast(f, now));
  }
  const f = transferFixture();
  const value = { games: f.overtimeSupport!.games };
  const valid = overtimeSupportFromArchive(f.overtimeSupport!.sourceKey, value);
  verifyOvertimeSupportArchive(valid, value);
  assert.throws(
    () =>
      verifyOvertimeSupportArchive(
        { ...valid, sourceSha256: "0".repeat(64) },
        value,
      ),
    /archive_mismatch/,
  );
});

test("transfer settlements score frozen probabilities without re-running the simulator", async () => {
  const { scoreRecordedForecast } =
    await import("../src/lib/ncaafForecastJournal.js");
  const f = transferFixture();
  const record = { ...prepareForwardForecast(f, now), recordedAt: now };
  record.markets[0].conditionalWinProbability = 0.8;
  const outcome = {
    ...f.games[0],
    ...f.target,
    homePoints: 35,
    awayPoints: 21,
    regulationHomePoints: 35,
    regulationAwayPoints: 21,
    overtime: false,
    completedAt: "2026-10-24T22:00:00Z",
    observedAt: "2026-10-24T23:00:00Z",
  };
  assert.ok(
    Math.abs(scoreRecordedForecast(record, outcome)[0].modelBrier! - 0.04) <
      1e-12,
  );
  assert.throws(() =>
    scoreRecordedForecast(
      { ...record, modelVersion: "unreviewed-version" },
      outcome,
    ),
  );
});

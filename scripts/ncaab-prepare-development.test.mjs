import test from "node:test";
import assert from "node:assert/strict";
import {
  authenticateDevelopmentExample,
  buildContextInput,
  buildOddsFeatures,
  canonical,
  hash,
  selectPrimaryQuotes,
} from "./ncaab-prepare-development.mjs";

test("selectPrimaryQuotes and odds features require complete market pairs", () => {
  const primary = selectPrimaryQuotes(
    [
      {
        book: "draftkings",
        market: "h2h",
        name: "Duke",
        price: -130,
        sourceUpdatedAt: "2026-10-01T12:00:00Z",
      },
      {
        book: "draftkings",
        market: "h2h",
        name: "Kansas",
        price: 110,
        sourceUpdatedAt: "2026-10-01T12:00:00Z",
      },
      {
        book: "draftkings",
        market: "spreads",
        name: "Duke",
        price: -110,
        point: -4.5,
        sourceUpdatedAt: "2026-10-01T12:00:00Z",
      },
      {
        book: "draftkings",
        market: "spreads",
        name: "Kansas",
        price: -110,
        point: 4.5,
        sourceUpdatedAt: "2026-10-01T12:00:00Z",
      },
      {
        book: "draftkings",
        market: "totals",
        name: "Over",
        price: -110,
        point: 148.5,
        sourceUpdatedAt: "2026-10-01T12:00:00Z",
      },
      {
        book: "draftkings",
        market: "totals",
        name: "Under",
        price: -110,
        point: 148.5,
        sourceUpdatedAt: "2026-10-01T12:00:00Z",
      },
    ],
    "Duke",
    "Kansas",
  );
  const { missing, features } = buildOddsFeatures(primary);
  assert.deepEqual(missing, []);
  assert.equal(features.home.values.length, 7);
  assert.equal(buildOddsFeatures({ ml: null, spread: null, total: null }).missing.length, 3);
});

test("buildContextInput is development_only and refuses post-kickoff capture", () => {
  const matched = {
    homeTeam: "Duke",
    awayTeam: "Kansas",
    quotes: [
      {
        book: "draftkings",
        market: "h2h",
        name: "Duke",
        price: -130,
        sourceUpdatedAt: "2026-10-01T12:00:00Z",
      },
      {
        book: "draftkings",
        market: "h2h",
        name: "Kansas",
        price: 110,
        sourceUpdatedAt: "2026-10-01T12:00:00Z",
      },
      {
        book: "draftkings",
        market: "spreads",
        name: "Duke",
        price: -110,
        point: -4.5,
        sourceUpdatedAt: "2026-10-01T12:00:00Z",
      },
      {
        book: "draftkings",
        market: "spreads",
        name: "Kansas",
        price: -110,
        point: 4.5,
        sourceUpdatedAt: "2026-10-01T12:00:00Z",
      },
      {
        book: "draftkings",
        market: "totals",
        name: "Over",
        price: -110,
        point: 148.5,
        sourceUpdatedAt: "2026-10-01T12:00:00Z",
      },
      {
        book: "draftkings",
        market: "totals",
        name: "Under",
        price: -110,
        point: 148.5,
        sourceUpdatedAt: "2026-10-01T12:00:00Z",
      },
    ],
    target: {
      eventId: "401900001",
      season: 2027,
      homeId: "150",
      awayId: "151",
      kickoff: "2026-10-02T00:00:00Z",
      oddsEventId: "odds1",
    },
  };
  const input = buildContextInput({
    matched,
    liveArchiveKey: "research:ncaab:live-inputs:2026-10-01T12:00:00.000Z",
    liveArchive: { odds: { sha256: "abc" } },
    capturedAt: "2026-10-01T12:00:00.000Z",
  });
  assert.equal(input.datasetRole, "development_only");
  assert.equal(input.releaseEligible, false);
  assert.equal(input.featureComplete, true);
  assert.throws(
    () =>
      buildContextInput({
        matched,
        liveArchiveKey: "research:ncaab:live-inputs:x",
        liveArchive: { odds: { sha256: "abc" } },
        capturedAt: "2026-10-02T00:00:01.000Z",
      }),
    /ncaab_dev_invalid_target_or_late_capture/,
  );
});

test("authenticateDevelopmentExample binds immutable input hash to final", () => {
  const input = {
    version: 1,
    sport: "ncaab",
    featureVersion: "ncaab-odds-score-features-v1",
    datasetRole: "development_only",
    featureComplete: true,
    target: {
      eventId: "401900001",
      season: 2027,
      homeId: "150",
      awayId: "151",
      kickoff: "2026-10-02T00:00:00Z",
    },
  };
  const inputKey = "research:ncaab:context-input:v1:2027:401900001";
  const label = {
    datasetRole: "development_only",
    inputKey,
    inputSha256: hash(input),
    sourceSha256: "deadbeef",
    outcome: {
      homePoints: 80,
      awayPoints: 70,
      regulationHomePoints: 80,
      regulationAwayPoints: 70,
      overtime: false,
    },
  };
  const finalArchive = {
    sha256: "deadbeef",
    games: [
      {
        eventId: "401900001",
        season: 2027,
        homeId: "150",
        awayId: "151",
        kickoff: "2026-10-02T00:00:00Z",
        homePoints: 80,
        awayPoints: 70,
        regulationHomePoints: 80,
        regulationAwayPoints: 70,
        overtime: false,
      },
    ],
  };
  const example = authenticateDevelopmentExample(
    inputKey,
    input,
    label,
    finalArchive,
  );
  assert.equal(example.featureComplete, true);
  assert.equal(example.inputSha256, hash(input));
  assert.equal(canonical({ a: 1, b: 2 }), canonical({ b: 2, a: 1 }));
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  NCAAB_ADJUSTED_FEATURE_NAMES,
  NCAAB_MIN_ADJUSTED_DEVELOPMENT_GAMES,
  americanToImplied,
  contextScoreFeaturesFromPrimary,
  fitNcaabAdjustedModel,
  ncaabConditionalWinProbability,
  predictNcaabAdjustedMeans,
  selectPrimaryNcaabQuotes,
  validateNcaabAdjustedModel,
} from "../src/lib/ncaabAdjustedModel.js";

test("primary quote selection prefers book priority and pairs markets", () => {
  const primary = selectPrimaryNcaabQuotes(
    [
      {
        book: "draftkings",
        market: "h2h",
        name: "Duke",
        price: -140,
        sourceUpdatedAt: "2026-10-30T12:00:00Z",
      },
      {
        book: "draftkings",
        market: "h2h",
        name: "Kansas",
        price: 120,
        sourceUpdatedAt: "2026-10-30T12:00:00Z",
      },
      {
        book: "fanduel",
        market: "spreads",
        name: "Duke",
        price: -110,
        point: -3.5,
        sourceUpdatedAt: "2026-10-30T12:00:00Z",
      },
      {
        book: "fanduel",
        market: "spreads",
        name: "Kansas",
        price: -110,
        point: 3.5,
        sourceUpdatedAt: "2026-10-30T12:00:00Z",
      },
      {
        book: "fanduel",
        market: "totals",
        name: "Over",
        price: -105,
        point: 150.5,
        sourceUpdatedAt: "2026-10-30T12:00:00Z",
      },
      {
        book: "fanduel",
        market: "totals",
        name: "Under",
        price: -115,
        point: 150.5,
        sourceUpdatedAt: "2026-10-30T12:00:00Z",
      },
    ],
    "Duke",
    "Kansas",
  );
  assert.equal(primary.spread?.bookmaker, "fanduel");
  assert.equal(primary.spread?.line, -3.5);
  assert.equal(primary.total?.line, 150.5);
  assert.equal(primary.ml?.bookmaker, "draftkings");
});

test("feature builder marks incomplete markets and builds 7-length vectors", () => {
  const incomplete = contextScoreFeaturesFromPrimary({
    ml: null,
    spread: null,
    total: null,
  });
  assert.ok(incomplete.missing.includes("ml_pair_missing"));
  const primary = {
    ml: { firstPrice: -140, secondPrice: 120 },
    spread: { line: -3.5, firstPrice: -110, secondPrice: -110 },
    total: { line: 150.5 },
  };
  const { missing, features } = contextScoreFeaturesFromPrimary(primary);
  assert.deepEqual(missing, []);
  assert.equal(features.home.values.length, NCAAB_ADJUSTED_FEATURE_NAMES.length);
  assert.equal(features.home.values[0], 1);
  assert.ok(Math.abs(features.home.baseline - (150.5 + 3.5) / 2) < 1e-9);
  assert.ok(Math.abs(americanToImplied(-140) - 0.5833333333) < 1e-6);
});

test("fit requires identifiable market variation and never sets Coach flags", () => {
  const games = Array.from(
    { length: NCAAB_MIN_ADJUSTED_DEVELOPMENT_GAMES },
    (_, i) => {
      const spread = -2 - i * 0.5;
      const total = 140 + i;
      const primary = {
        ml: { firstPrice: -120 - i, secondPrice: 100 + i },
        spread: { line: spread, firstPrice: -110, secondPrice: -110 },
        total: { line: total },
      };
      const { features } = contextScoreFeaturesFromPrimary(primary);
      return {
        id: `2026:${4000 + i}`,
        inputSha256: "a".repeat(64),
        labelSha256: "b".repeat(64),
        observedAt: "2026-10-30T12:00:00.000Z",
        regulationHome: 70 + (i % 5),
        regulationAway: 65 + (i % 4),
        features,
      };
    },
  );
  const fitted = fitNcaabAdjustedModel(games, {
    now: "2026-10-30T12:00:00.000Z",
    implementationCommit: "d".repeat(40),
    implementationSha256: "e".repeat(64),
    manifestSha256: "f".repeat(64),
  });
  assert.equal(fitted.state, "fitted_research_candidate");
  assert.ok(fitted.model);
  assert.equal(fitted.model!.releaseEligible, false);
  assert.equal(fitted.model!.coachEnabled, false);
  assert.equal(fitted.model!.researchOnly, true);
  assert.ok(!fitted.model!.limitations.some((l) => l.includes("ncaaf")));
  validateNcaabAdjustedModel(fitted.model!, fitted.modelSha256!);
  const means = predictNcaabAdjustedMeans(
    fitted.model!,
    fitted.modelSha256!,
    games[0].features,
  );
  assert.ok(means.home > 0 && means.away > 0);
  const p = ncaabConditionalWinProbability("ml", null, means.home, means.away);
  assert.ok(p >= 0 && p <= 1);
});

test("homogeneous lines wait for signal variation instead of inventing a freeze", () => {
  const games = Array.from(
    { length: NCAAB_MIN_ADJUSTED_DEVELOPMENT_GAMES },
    (_, i) => {
      const primary = {
        ml: { firstPrice: -110, secondPrice: -110 },
        spread: { line: -3.5, firstPrice: -110, secondPrice: -110 },
        total: { line: 150.5 },
      };
      const { features } = contextScoreFeaturesFromPrimary(primary);
      return {
        id: `2026:${5000 + i}`,
        inputSha256: "a".repeat(64),
        labelSha256: "b".repeat(64),
        observedAt: "2026-10-30T12:00:00.000Z",
        regulationHome: 70,
        regulationAway: 68,
        features,
      };
    },
  );
  const fitted = fitNcaabAdjustedModel(games, {
    now: "2026-10-30T12:00:00.000Z",
    implementationCommit: "d".repeat(40),
    implementationSha256: "e".repeat(64),
    manifestSha256: "f".repeat(64),
  });
  assert.equal(fitted.state, "waiting_for_signal_variation");
  assert.equal(fitted.model, undefined);
});

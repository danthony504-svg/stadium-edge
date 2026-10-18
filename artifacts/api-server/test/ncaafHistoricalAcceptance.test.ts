import assert from "node:assert/strict";
import test from "node:test";
import { evaluateHistoricalNcaafAcceptance } from "../src/lib/sportSim/ncaafHistoricalAcceptance.ts";

test("no historical closing-line data never approves NCAAF release", () => {
 const verdict = evaluateHistoricalNcaafAcceptance([]);
 assert.equal(verdict.eligible, false);
 assert.ok(verdict.reasons.includes("insufficient_independent_holdout"));
 assert.ok(verdict.reasons.includes("missing_independent_market_baseline"));
});
test("synthetic one-season sample cannot satisfy multi-season release acceptance", () => {
 const game = { gameId: "synthetic-not-provider-data", season: 2025, playedAt: "2025-10-01T00:00:00Z",
 homeScore: 28, awayScore: 21, closingHomeSpread: -7, closingHomePrice: -110,
 closingAwayPrice: -110, predictedHomeCoverProbability: 0.6, predictedHomeWinProbability: 0.7,
 predictedHomeScore: 28, predictedAwayScore: 21, injurySourceTimestamp: null, source: "test-fixture" };
 const verdict = evaluateHistoricalNcaafAcceptance([game], { marketBaselineBrier: 0.24 });
 assert.equal(verdict.eligible, false);
 assert.ok(verdict.reasons.includes("multi_season_holdout_required"));
 assert.ok(verdict.reasons.includes("missing_injury_provenance"));
 assert.ok(verdict.reasons.includes("no_settled_spread_games")); // exact push, not win/loss
});

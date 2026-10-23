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

test("release rejects regulation-only/postgame evidence and cannot lower the sample floor",()=>{
 const g={gameId:"1",season:2025,playedAt:"2025-10-04T18:00:00Z",homeScore:28,awayScore:21,closingHomeSpread:-3.5,closingHomePrice:-110,closingAwayPrice:-110,predictedHomeCoverProbability:.6,predictedHomeWinProbability:.7,predictedHomeScore:27,predictedAwayScore:20,injurySourceTimestamp:"2025-10-03T18:00:00Z",source:"fixture",forecastAt:"2025-10-04T16:00:00Z",inputCutoffAt:"2025-10-04T15:00:00Z",quoteObservedAt:"2025-10-04T14:00:00Z",settlement:"full_game_including_overtime" as const,modelVersion:"fixture"};
 const o={minimumHoldoutGames:1,marketBaselineBrier:.25,independentHoldoutVerified:true,exactLineBindingVerified:true,injuryConservatismVerified:true,humanSignoff:true};
 assert.ok(evaluateHistoricalNcaafAcceptance([g],o).reasons.includes("insufficient_independent_holdout"));
 for(const patch of [{forecastAt:g.playedAt},{inputCutoffAt:"2025-10-05T00:00:00Z"},{injurySourceTimestamp:"2025-10-04T17:00:00Z"},{quoteObservedAt:"2025-10-04T17:00:00Z"}])assert.ok(evaluateHistoricalNcaafAcceptance([{...g,...patch}],o).reasons.includes("pregame_evidence_timing_unverified"));
 assert.ok(evaluateHistoricalNcaafAcceptance([{...g,settlement:"regulation_only"}],o).reasons.includes("full_game_settlement_unverified"));
 assert.ok(evaluateHistoricalNcaafAcceptance([{...g,closingHomePrice:0}],o).reasons.includes("invalid_prices_or_projections"));
});

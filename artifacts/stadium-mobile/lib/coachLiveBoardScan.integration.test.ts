/**
 * Integration: 5-leg live board scan against production API with full prop pool.
 * Run: EXPO_PUBLIC_DOMAIN=stadium-edge.onrender.com node --import ./scripts/resolver.mjs --test lib/coachLiveBoardScan.integration.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { tryReachFullBoardScan } from "./boardMarketScanner.ts";
import { raceBoardScanWithBudget } from "./coachBuildLifecycle.ts";
import { deliverCoachBoardScanTicket } from "./coachBoardScanDelivery.ts";
import { positiveEdgeScoredLegs } from "./coachDeliverySalvage.ts";
import { fetchCoachLiveBoardFeeds } from "./coachLiveBoardFeeds.ts";
import {
  beginCoachLiveBoardTrace,
  resetCoachLiveBoardTrace,
  snapshotCoachLiveBoardTrace,
} from "./coachLiveBoardTrace.ts";
import { buildGameTeamIdMap } from "./coachGameMonteCarlo.ts";
import { coachLiveScanSports } from "./coachSlateFreshness.ts";
import { coachFlashEnrichFromBuilt } from "./pickScoreContext.ts";
import { impliedProb } from "./format.ts";
import { simEdgeFromHit, simEvPct } from "./gameSimQualityGates.ts";
import type { BuiltChatContext } from "./api.ts";
import { fetchFullBoardPropPool } from "./api.ts";

const TARGET = 5;
const BUDGET_MS = 180_000;

function emptyBuilt(): BuiltChatContext {
  return {
    context: {
      realOdds: [],
      realProps: [],
      realGames: [],
      matchupHistory: {},
      matchupInjuries: {},
      playerHistory: {},
    },
    propPool: [],
    gameMeta: [],
  };
}

test(
  "5-leg live board scan production trace",
  { timeout: 240_000 },
  async () => {
    const requestId = `integration-5leg-${Date.now()}`;
    resetCoachLiveBoardTrace();
    beginCoachLiveBoardTrace(requestId);

    const scanSports = coachLiveScanSports();
    const { espnGames, oddsGames, liveFeed } = await fetchCoachLiveBoardFeeds(scanSports);
    const built = emptyBuilt();
    built.context.realOdds = oddsGames.flatMap((g) => {
      const game = `${g.awayTeam} @ ${g.homeTeam}`;
      const rows: BuiltChatContext["context"]["realOdds"] = [];
      if (g.mlHome != null) {
        rows.push({
          sport: g.sport,
          game,
          market: "Moneyline",
          pick: g.homeTeam,
          odds: g.mlHome,
          startsAt: g.startsAt,
        });
      }
      if (g.mlAway != null) {
        rows.push({
          sport: g.sport,
          game,
          market: "Moneyline",
          pick: g.awayTeam,
          odds: g.mlAway,
          startsAt: g.startsAt,
        });
      }
      return rows;
    });

    const propPool = await fetchFullBoardPropPool(oddsGames, espnGames, built.propPool);
    built.propPool = propPool;
    const enrich = coachFlashEnrichFromBuilt(built);

    const scanPromise = tryReachFullBoardScan({
      target: TARGET,
      oddsGames,
      propPool,
      realOdds: built.context.realOdds,
      liveOdds: liveFeed.odds,
      espnGames,
      gameMeta: built.gameMeta,
      teamIdMap: buildGameTeamIdMap(espnGames),
      requestId,
    });

    const raced = await raceBoardScanWithBudget(scanPromise, BUDGET_MS, { requestId });
    let scan = raced.timedResult;
    if (!scan) scan = await raced.awaitCompletion();
    else await raced.awaitCompletion();

    assert.ok(scan, "scan should complete");
    assert.equal(scan.scanComplete, true, "scan should be marked complete");

    const delivered = deliverCoachBoardScanTicket(scan, enrich, TARGET);
    const manifest = delivered.manifest;
    const scored = scan.scoredPool ?? [];
    const positive = positiveEdgeScoredLegs(scored);

    const withOdds = scored.filter(
      (leg) => leg.pick.odds != null && Number.isFinite(leg.pick.odds) && leg.pick.odds !== 0,
    );
    const withModel = scored.filter((leg) => leg.pick.finalAiScore?.simHit != null);
    const withEdge = scored.filter((leg) => (leg.pick.finalAiScore?.edgePct ?? 0) !== 0);
    const edgePositive = scored.filter((leg) => (leg.pick.finalAiScore?.edgePct ?? 0) > 0);

    console.log("\n=== SCAN MANIFEST SUMMARY ===");
    console.log(`games loaded: ${manifest.gamesLoaded}`);
    console.log(`markets/props loaded: ${manifest.marketsFound} / ${manifest.propsFound}`);
    console.log(`markets with valid odds: ${withOdds.length}`);
    console.log(`markets with model probability: ${withModel.length}`);
    console.log(`markets with calculated edge: ${withEdge.length}`);
    console.log(`edge > 0%: ${edgePositive.length}`);
    console.log(`rejected low edge: ${manifest.rejectedLowEdge}`);
    console.log(`rejected low confidence: ${manifest.rejectedLowConfidence}`);
    console.log(`rejected missing stats: ${manifest.rejectedMissingStats}`);
    console.log(`rejected correlation: ${manifest.rejectedCorrelation}`);
    console.log(`positive edge pool: ${positive.length}`);
    console.log(`delivered picks: ${delivered.picks.length}`);

    const rejections = [...(manifest.pipelineRejections ?? [])]
      .filter((r) => (r.edge ?? 0) > 0 || (r.simulation ?? 0) > 0)
      .sort((a, b) => (b.edge ?? 0) - (a.edge ?? 0))
      .slice(0, 20);
    console.log("\n=== TOP REJECTED (by edge) ===");
    for (const r of rejections) {
      console.log(
        `${r.entity} | ${r.market} | edge=${r.edge}% conf=${r.confidence}% ev=${r.ev}% sim=${r.simulation}% | ${r.reason}`,
      );
    }

    // Edge formula spot-check
    const sample = positive[0]?.pick;
    if (sample?.odds != null && sample.finalAiScore?.simHit != null) {
      const implied = impliedProb(sample.odds);
      const expected = simEdgeFromHit(sample.finalAiScore.simHit, sample.odds);
      assert.equal(sample.finalAiScore.edgePct, expected);
      const ev = simEvPct(sample.finalAiScore.simHit, sample.odds);
      assert.ok(ev != null && ev > 0);
      console.log(
        `\nEdge verify: odds=${sample.odds} implied=${(implied * 100).toFixed(1)}% model=${(sample.finalAiScore.simHit * 100).toFixed(1)}% edge=${expected}%`,
      );
    }

    assert.equal(impliedProb(150), 100 / 250);
    assert.equal(impliedProb(-110), 110 / 210);

    const snap = snapshotCoachLiveBoardTrace();
    assert.ok(snap);
    assert.ok(manifest.propsFound > 0, "props should load on production slate");
    assert.ok(scored.length > 0, "scored pool should not be empty after full scan");

    if (positive.length > 0) {
      assert.ok(delivered.picks.length > 0, "should deliver when positive-edge markets exist");
      for (const pick of delivered.picks) {
        assert.ok(pick.odds != null && pick.odds !== 0, "every pick needs posted odds");
      }
    }
  },
);

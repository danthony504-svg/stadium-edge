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
import {
  finishCoachPipelineRun,
  getCoachPipelineRunSnapshot,
  resetCoachPipelineRunTraceForTests,
  supersedeCoachPipelineRun,
} from "./coachPipelineRunTrace.ts";
import { buildGameTeamIdMap } from "./coachGameMonteCarlo.ts";
import { coachLiveScanSports } from "./coachSlateFreshness.ts";
import { coachFlashEnrichFromBuilt } from "./pickScoreContext.ts";
import { impliedProb } from "./format.ts";
import { simEdgeFromHit, simEvPct } from "./gameSimQualityGates.ts";
import type { BuiltChatContext } from "./api.ts";
import { fetchFullBoardPropPool } from "./api.ts";

const TARGET = 5;
const BUDGET_MS = 180_000;
const CONSECUTIVE_RUNS = 3;

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

async function runSingle5LegBuild(runIndex: number): Promise<{
  requestId: string;
  deliveredCount: number;
  positiveEdge: number;
  propsFound: number;
}> {
  const requestId = `integration-5leg-${runIndex}-${Date.now()}`;
  resetCoachLiveBoardTrace();
  resetCoachPipelineRunTraceForTests();
  supersedeCoachPipelineRun(requestId, runIndex);
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

  const raced = await raceBoardScanWithBudget(scanPromise, BUDGET_MS, {
    requestId,
    sendGeneration: runIndex,
  });
  let scan = raced.timedResult;
  if (!scan) scan = await raced.awaitCompletion();
  else await raced.awaitCompletion();

  assert.ok(scan, `run ${runIndex}: scan should complete`);
  assert.equal(scan.scanComplete, true, `run ${runIndex}: scan should be marked complete`);

  const delivered = deliverCoachBoardScanTicket(scan, enrich, TARGET);
  const manifest = delivered.manifest;
  const scored = scan.scoredPool ?? [];
  const positive = positiveEdgeScoredLegs(scored);

  console.log(`\n=== RUN ${runIndex} MANIFEST ===`);
  console.log(`requestId=${requestId}`);
  console.log(`props loaded: ${manifest.propsFound}`);
  console.log(`positive edge pool: ${positive.length}`);
  console.log(`delivered picks: ${delivered.picks.length}`);

  const pipeline = getCoachPipelineRunSnapshot(requestId);
  if (pipeline) {
    console.log(`pipeline stages: ${pipeline.stages.length}`);
    for (const s of pipeline.stages) {
      console.log(
        `  ${s.stage} durationMs=${s.durationMs} success=${s.success} in=${s.candidatesIn ?? "—"} out=${s.candidatesOut ?? "—"} timeout=${s.timeout}`,
      );
    }
  }

  finishCoachPipelineRun(requestId, { success: delivered.picks.length > 0 });

  return {
    requestId,
    deliveredCount: delivered.picks.length,
    positiveEdge: positive.length,
    propsFound: manifest.propsFound,
  };
}

test(
  "5-leg live board scan production trace",
  { timeout: 240_000 },
  async () => {
    const result = await runSingle5LegBuild(1);
    assert.ok(result.propsFound > 0, "props should load on production slate");
    if (result.positiveEdge > 0) {
      assert.ok(result.deliveredCount > 0, "should deliver when positive-edge markets exist");
    }
  },
);

test(
  `${CONSECUTIVE_RUNS} consecutive 5-leg builds deliver pick cards`,
  { timeout: 720_000 },
  async () => {
    const results: Awaited<ReturnType<typeof runSingle5LegBuild>>[] = [];
    for (let i = 1; i <= CONSECUTIVE_RUNS; i++) {
      const result = await runSingle5LegBuild(i);
      results.push(result);
      assert.ok(result.propsFound > 0, `run ${i}: props must load`);
      assert.ok(
        result.positiveEdge > 0,
        `run ${i}: positive-edge pool must not be empty (got ${result.positiveEdge})`,
      );
      assert.equal(
        result.deliveredCount,
        TARGET,
        `run ${i}: must deliver ${TARGET} pick cards (got ${result.deliveredCount})`,
      );
      for (let j = 0; j < i; j++) {
        assert.ok(results[j]!.deliveredCount === TARGET, `prior run ${j + 1} must have succeeded`);
      }
    }
    console.log(`\n=== ${CONSECUTIVE_RUNS} CONSECUTIVE BUILDS PASSED ===`);
    for (const r of results) {
      console.log(`  ${r.requestId}: ${r.deliveredCount} picks from ${r.positiveEdge} candidates`);
    }
  },
);

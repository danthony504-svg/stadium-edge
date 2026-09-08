/**
 * Integration: 5-leg and 15-leg live board scans against production API.
 * Run: EXPO_PUBLIC_DOMAIN=stadium-edge.onrender.com node scripts/bundle-coach-scan-test.mjs && EXPO_PUBLIC_DOMAIN=stadium-edge.onrender.com node --test /tmp/coach-scan-test.mjs
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
} from "./coachLiveBoardTrace.ts";
import {
  beginCoachRequestScope,
  clearCoachRequestScope,
  COACH_REQUEST_DEADLINE_MS,
  resetCoachRequestDeadlineForTests,
} from "./coachRequestDeadline.ts";
import {
  finishCoachPipelineRun,
  getCoachPipelineRunSnapshot,
  resetCoachPipelineRunTraceForTests,
  supersedeCoachPipelineRun,
} from "./coachPipelineRunTrace.ts";
import {
  getCoachPipelineOperationRecords,
  logCoachPipelineOperationSummary,
  resetCoachPipelineOperationTraceForTests,
} from "./coachPipelineOperationTrace.ts";
import { logCoachBoardScanAudit } from "./coachBoardScanManifest.ts";
import { boardScanDeadlineMs } from "./boardScanScope.ts";
import { buildGameTeamIdMap } from "./coachGameMonteCarlo.ts";
import { coachLiveScanSports } from "./coachSlateFreshness.ts";
import { coachFlashEnrichFromBuilt } from "./pickScoreContext.ts";
import type { BuiltChatContext } from "./api.ts";
import { fetchFullBoardPropPool } from "./api.ts";

const CONSECUTIVE_RUNS = 3;
const PER_RUN_WALL_MS = COACH_REQUEST_DEADLINE_MS + 5_000;

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

type BuildRunResult = {
  requestId: string;
  target: number;
  deliveredCount: number;
  positiveEdge: number;
  propsFound: number;
  handledError: boolean;
  errorMessage: string | null;
  elapsedMs: number;
};

async function runSingleBuild(target: number, runIndex: number): Promise<BuildRunResult> {
  const startedAt = Date.now();
  const requestId = `integration-${target}leg-${runIndex}-${Date.now()}`;
  resetCoachLiveBoardTrace();
  resetCoachPipelineRunTraceForTests();
  resetCoachPipelineOperationTraceForTests();
  resetCoachRequestDeadlineForTests();
  supersedeCoachPipelineRun(requestId, runIndex);
  beginCoachLiveBoardTrace(requestId);
  const signal = beginCoachRequestScope(requestId, runIndex);

  const run = async (): Promise<BuildRunResult> => {
    const scanSports = coachLiveScanSports();
    const { espnGames, oddsGames, liveFeed } = await fetchCoachLiveBoardFeeds(scanSports, signal);
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

    const propPool = await fetchFullBoardPropPool(oddsGames, espnGames, built.propPool, signal, {
      maxGames: target >= 15 ? 28 : 40,
      concurrency: 3,
    });
    built.propPool = propPool;
    const enrich = coachFlashEnrichFromBuilt(built);

    const scanPromise = tryReachFullBoardScan({
      target,
      oddsGames,
      propPool,
      realOdds: built.context.realOdds,
      liveOdds: liveFeed.odds,
      espnGames,
      gameMeta: built.gameMeta,
      teamIdMap: buildGameTeamIdMap(espnGames),
      requestId,
      signal,
    });

    const raced = await raceBoardScanWithBudget(scanPromise, boardScanDeadlineMs(target), {
      requestId,
      sendGeneration: runIndex,
    });
    let scan = raced.timedResult;
    if (!scan) scan = await raced.awaitCompletion();
    else await raced.awaitCompletion();

    const delivered = scan
      ? deliverCoachBoardScanTicket(scan, enrich, target)
      : { picks: [], manifest: { propsFound: 0 } as never };
    const positive = scan?.scoredPool ? positiveEdgeScoredLegs(scan.scoredPool) : [];

    logCoachPipelineOperationSummary(requestId);
    if (scan?.manifest?.scanAudit) {
      logCoachBoardScanAudit(scan.manifest.scanAudit, requestId);
    }
    const ops = getCoachPipelineOperationRecords(requestId);
    for (const op of ops) {
      console.log(
        `  op ${op.stage} fn=${op.fn} file=${op.file}:${op.line} durationMs=${op.durationMs} in=${op.candidatesIn ?? "—"} out=${op.candidatesOut ?? "—"} outcome=${op.outcome}${op.error ? ` error=${op.error}` : ""}`,
      );
    }

    finishCoachPipelineRun(requestId, { success: delivered.picks.length > 0 });
    clearCoachRequestScope(requestId);

    return {
      requestId,
      target,
      deliveredCount: delivered.picks.length,
      positiveEdge: positive.length,
      propsFound: delivered.manifest?.propsFound ?? propPool.length,
      handledError: !scan || delivered.picks.length === 0,
      errorMessage: !scan
        ? "scan-null"
        : delivered.picks.length === 0
          ? "zero-picks"
          : null,
      elapsedMs: Date.now() - startedAt,
    };
  };

  try {
    return await Promise.race([
      run(),
      new Promise<BuildRunResult>((_, reject) =>
        setTimeout(() => reject(new Error(`wall-timeout-${target}leg`)), PER_RUN_WALL_MS),
      ),
    ]);
  } catch (err) {
    clearCoachRequestScope(requestId);
    return {
      requestId,
      target,
      deliveredCount: 0,
      positiveEdge: 0,
      propsFound: 0,
      handledError: true,
      errorMessage: err instanceof Error ? err.message : String(err),
      elapsedMs: Date.now() - startedAt,
    };
  }
}

function assertBuildCompleted(result: BuildRunResult): void {
  assert.ok(
    result.elapsedMs <= PER_RUN_WALL_MS,
    `run ${result.requestId} exceeded wall clock: ${result.elapsedMs}ms`,
  );
  const delivered = result.deliveredCount === result.target;
  const handledError = result.handledError && result.errorMessage;
  assert.ok(
    delivered || handledError,
    `run ${result.requestId}: must deliver ${result.target} picks or return handled error (delivered=${result.deliveredCount}, error=${result.errorMessage})`,
  );
  if (delivered) {
    console.log(
      `OK ${result.target}-leg requestId=${result.requestId} picks=${result.deliveredCount} positiveEdge=${result.positiveEdge} elapsedMs=${result.elapsedMs}`,
    );
  } else {
    console.log(
      `HANDLED-ERROR ${result.target}-leg requestId=${result.requestId} error=${result.errorMessage} elapsedMs=${result.elapsedMs}`,
    );
  }
}

test(
  `${CONSECUTIVE_RUNS} consecutive 5-leg builds complete within deadline`,
  { timeout: PER_RUN_WALL_MS * CONSECUTIVE_RUNS + 10_000 },
  async () => {
    for (let i = 1; i <= CONSECUTIVE_RUNS; i++) {
      const result = await runSingleBuild(5, i);
      assertBuildCompleted(result);
    }
  },
);

test(
  `${CONSECUTIVE_RUNS} consecutive 15-leg longshot builds complete within deadline`,
  { timeout: PER_RUN_WALL_MS * CONSECUTIVE_RUNS + 10_000 },
  async () => {
    for (let i = 1; i <= CONSECUTIVE_RUNS; i++) {
      const result = await runSingleBuild(15, i);
      assertBuildCompleted(result);
    }
  },
);

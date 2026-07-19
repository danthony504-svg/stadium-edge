/**
 * Integration: 5-leg live board scan against production API.
 * Run: EXPO_PUBLIC_DOMAIN=stadium-edge.onrender.com pnpm exec tsx --test lib/coachLiveBoardScan.integration.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { tryReachFullBoardScan } from "./boardMarketScanner.ts";
import { raceBoardScanWithBudget } from "./coachBuildLifecycle.ts";
import { deliverCoachBoardScanTicket } from "./coachBoardScanDelivery.ts";
import { fetchCoachLiveBoardFeeds } from "./coachLiveBoardFeeds.ts";
import {
  beginCoachLiveBoardTrace,
  resetCoachLiveBoardTrace,
  snapshotCoachLiveBoardTrace,
} from "./coachLiveBoardTrace.ts";
import { buildGameTeamIdMap } from "./coachGameMonteCarlo.ts";
import { coachLiveScanSports } from "./coachSlateFreshness.ts";
import { coachFlashEnrichFromBuilt } from "./pickScoreContext.ts";
import type { BuiltChatContext } from "./api.ts";

const TARGET = 5;
const BUDGET_MS = 120_000;
const captured: string[] = [];
const origLog = console.log;
console.log = (...args: unknown[]) => {
  const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  if (msg.includes("[coach-live-board]")) captured.push(msg);
  origLog(...args);
};

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
  { timeout: 180_000 },
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
      if (g.mlHome != null) rows.push({ sport: g.sport, game, market: "Moneyline", pick: g.homeTeam, odds: g.mlHome, startsAt: g.startsAt });
      if (g.mlAway != null) rows.push({ sport: g.sport, game, market: "Moneyline", pick: g.awayTeam, odds: g.mlAway, startsAt: g.startsAt });
      return rows;
    });
    const enrich = coachFlashEnrichFromBuilt(built);

    const scanPromise = tryReachFullBoardScan({
      target: TARGET,
      oddsGames,
      propPool: built.propPool,
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
    deliverCoachBoardScanTicket(scan, enrich, TARGET);

    const snap = snapshotCoachLiveBoardTrace();
    assert.ok(snap);

    origLog("\n=== CAPTURED [coach-live-board] ===");
    for (const line of captured) origLog(line);

    // Always pass — this test is for trace capture
    assert.ok(captured.some((l) => l.includes("Live board request started")));
  },
);

/**
 * Headless 5-leg Coach live-board scan — prints [coach-live-board] lines only.
 * Usage: EXPO_PUBLIC_DOMAIN=stadium-edge.onrender.com node scripts/run-coach-5leg-scan.mjs
 */
process.env.EXPO_PUBLIC_DOMAIN =
  process.env.EXPO_PUBLIC_DOMAIN || "stadium-edge.onrender.com";

const lines = [];
const orig = console.log;
console.log = (...args) => {
  const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  if (msg.includes("[coach-live-board]")) lines.push(msg);
  orig(...args);
};

const TARGET = 5;
const BUDGET_MS = 120_000;

const { buildCompactParlayContext } = await import("../lib/api.ts");
const { beginCoachLiveBoardTrace, resetCoachLiveBoardTrace } = await import(
  "../lib/coachLiveBoardTrace.ts"
);
const { fetchCoachLiveBoardFeeds } = await import("../lib/coachLiveBoardFeeds.ts");
const { coachLiveScanSports } = await import("../lib/coachSlateFreshness.ts");
const { tryReachFullBoardScan } = await import("../lib/boardMarketScanner.ts");
const { deliverCoachBoardScanTicket } = await import("../lib/coachBoardScanDelivery.ts");
const { coachFlashEnrichFromBuilt } = await import("../lib/pickScoreContext.ts");
const { buildGameTeamIdMap } = await import("../lib/coachGameMonteCarlo.ts");
const { raceBoardScanWithBudget } = await import("../lib/coachBuildLifecycle.ts");

const requestId = `headless-5leg-${Date.now()}`;
resetCoachLiveBoardTrace();
beginCoachLiveBoardTrace(requestId);

const built = await buildCompactParlayContext(TARGET);
const scanSports = coachLiveScanSports();
const { espnGames, oddsGames, liveFeed } = await fetchCoachLiveBoardFeeds(scanSports);
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
  matchupHistory: built.context.matchupHistory,
  matchupInjuries: built.context.matchupInjuries,
  playerHistory: built.context.playerHistory,
  mlbPlatoon: built.context.mlbPlatoon,
  mlbGameEnv: built.context.mlbGameEnv,
  requestId,
});

const raced = await raceBoardScanWithBudget(scanPromise, BUDGET_MS, { requestId });
let scan = raced.timedResult;
if (!scan) {
  scan = await raced.awaitCompletion();
} else {
  await raced.awaitCompletion();
}

if (scan) {
  deliverCoachBoardScanTicket(scan, enrich, TARGET);
}

orig("\n--- [coach-live-board] lines ---");
for (const l of lines) orig(l);

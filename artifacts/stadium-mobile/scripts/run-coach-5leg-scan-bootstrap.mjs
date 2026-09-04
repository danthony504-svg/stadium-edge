import { register } from "tsx/esm/api";

const unregister = register({
  esbuildOptions: {
    jsx: "automatic",
  },
});

process.env.EXPO_PUBLIC_DOMAIN =
  process.env.EXPO_PUBLIC_DOMAIN || "stadium-edge.onrender.com";

const captured = [];
const origLog = console.log;
console.log = (...args) => {
  const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  if (msg.includes("[coach-live-board]")) captured.push(msg);
  origLog(...args);
};

const TARGET = 5;
const BUDGET_MS = 120_000;

const { fetchCoachLiveBoardFeeds } = await import("../lib/coachLiveBoardFeeds.ts");
const { tryReachFullBoardScan } = await import("../lib/boardMarketScanner.ts");
const { raceBoardScanWithBudget } = await import("../lib/coachBuildLifecycle.ts");
const { deliverCoachBoardScanTicket } = await import("../lib/coachBoardScanDelivery.ts");
const {
  beginCoachLiveBoardTrace,
  resetCoachLiveBoardTrace,
} = await import("../lib/coachLiveBoardTrace.ts");
const { buildGameTeamIdMap } = await import("../lib/coachGameMonteCarlo.ts");
const { coachLiveScanSports } = await import("../lib/coachSlateFreshness.ts");
const { coachFlashEnrichFromBuilt } = await import("../lib/pickScoreContext.ts");

const requestId = `headless-5leg-${Date.now()}`;
resetCoachLiveBoardTrace();
beginCoachLiveBoardTrace(requestId);

const scanSports = coachLiveScanSports();
const { espnGames, oddsGames, liveFeed } = await fetchCoachLiveBoardFeeds(scanSports);
const built = {
  context: { realOdds: [], realProps: [], realGames: [], matchupHistory: {}, matchupInjuries: {}, playerHistory: {} },
  propPool: [],
  gameMeta: [],
};
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

if (scan) deliverCoachBoardScanTicket(scan, enrich, TARGET);

origLog("\n=== [coach-live-board] capture ===");
for (const line of captured) origLog(line);

unregister();

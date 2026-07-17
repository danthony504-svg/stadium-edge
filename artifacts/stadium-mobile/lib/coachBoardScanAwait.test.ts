import test from "node:test";
import assert from "node:assert/strict";
import { awaitBoardScanUntilComplete } from "./coachBoardScanAwait.ts";
import { deriveBoardScanLiveProgress } from "./coachBoardScanProgress.ts";

test("awaitBoardScanUntilComplete waits for the scan promise without timing out", async () => {
  let resolved = false;
  const scan = new Promise<{ scanComplete: boolean; picks: never[] } | null>((resolve) => {
    setTimeout(() => {
      resolved = true;
      resolve({ scanComplete: true, picks: [] });
    }, 40);
  });
  const result = await awaitBoardScanUntilComplete(scan);
  assert.equal(resolved, true);
  assert.equal(result?.scanComplete, true);
});

test("awaitBoardScanUntilComplete respects abort signal", async () => {
  const controller = new AbortController();
  const scan = new Promise<null>((resolve) => setTimeout(() => resolve(null), 200));
  controller.abort();
  const result = await awaitBoardScanUntilComplete(scan, controller.signal);
  assert.equal(result, null);
});

test("deriveBoardScanLiveProgress maps manifest fields for loading UI", () => {
  const progress = deriveBoardScanLiveProgress({
    picks: [],
    evalLinesByGame: new Map([["g1", []]]),
    gameSimulations: new Map(),
    totalScanned: 1842,
    totalQualified: 0,
    staging: { mainQualified: 0, altQualified: 0, mainOnTicket: 0, altOnTicket: 0 },
    note: "",
    scanComplete: false,
    requestedLegs: 5,
    manifest: {
      scanComplete: false,
      boardExhausted: false,
      requestedLegs: 5,
      deliveredLegs: 0,
      gameSimDraws: 10_000,
      propSimDraws: 10_000,
      propSimTier: "deep",
      marketsFound: 2000,
      marketsFoundByFamily: {} as never,
      propsFound: 1842,
      propsEligibleForSim: 1800,
      propsSkippedUnsupported: 0,
      alternateGameLinesFound: 0,
      alternatePropsFound: 0,
      marketsSimulated: 1842,
      gameLinesSimulated: 15,
      propsSimulated: 1200,
      propsSimBatches: 2,
      propsSimTimeouts: 0,
      preScoreEvaluated: 0,
      totalEvaluated: 0,
      totalQualified: 0,
      qualifiedMain: 0,
      qualifiedAlt: 0,
      qualifiedByCategory: { props: 0, gameLines: 0, teamTotals: 0, alternateLines: 0 },
      gateFailureCounts: {},
      rejectedSamples: [],
    },
  } as never);
  assert.equal(progress.gamesLoaded, 1);
  assert.equal(progress.propsAnalyzed, 1200);
  assert.equal(progress.marketsScanned, 1842);
  assert.equal(progress.scanComplete, false);
});

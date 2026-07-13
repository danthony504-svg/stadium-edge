import assert from "node:assert/strict";
import test from "node:test";
import {
  createCoachBoardScanManifestRecorder,
  formatCoachBoardScanManifest,
} from "./coachBoardScanManifest.ts";
import { coachBoardScanManifestForMessage, coachReplyHasScanManifest } from "./coachBoardScanDelivery.ts";
import type { FullBoardScanResult } from "./boardMarketScanner.ts";

test("formatCoachBoardScanManifest lists coverage and gate failures", () => {
  const recorder = createCoachBoardScanManifestRecorder(8);
  recorder.recordMarketFound({
    game: "A @ B",
    market: "Points",
    pick: "Star Over 24.5",
    odds: -110,
    isProp: true,
    player: "Star",
    sport: "nba",
    propLine: 24.5,
    propSide: "Over",
  });
  recorder.recordPropSimBatch(1, false);
  recorder.recordPreScoreGateFailure(
    {
      game: "A @ B",
      market: "Points",
      pick: "Star Over 24.5",
      odds: -110,
      isProp: true,
      player: "Star",
      sport: "nba",
      propLine: 24.5,
      propSide: "Over",
    },
    { simHit: null },
  );
  recorder.recomputeQualificationFromScored([]);
  const manifest = recorder.finalize({
    scanComplete: true,
    boardExhausted: true,
    deliveredLegs: 0,
  });
  const text = formatCoachBoardScanManifest(manifest);
  assert.match(text, /Scan manifest/i);
  assert.match(text, /Markets found/i);
  assert.match(text, /single delivery/i);
  assert.match(text, /0 legs delivered/i);
  assert.match(text, /Candidates evaluated \(with sim\): \*\*1\*\*/);
  assert.match(text, /No sim grade/i);
});

test("recomputeQualificationFromScored does not double-count evaluated candidates", () => {
  const recorder = createCoachBoardScanManifestRecorder(6);
  recorder.recordPreScoreGateFailure(
    {
      game: "A @ B",
      market: "Points",
      pick: "Star Over 24.5",
      odds: -110,
      isProp: true,
      player: "Star",
      sport: "nba",
      propLine: 24.5,
      propSide: "Over",
    },
    { simHit: null },
  );
  const scoredLeg = {
    pick: {
      game: "C @ D",
      market: "Spread",
      pick: "C -3.5",
      odds: -110,
      isProp: false,
      sport: "nba",
      finalAiScore: {
        simHit: 0.55,
        edgePct: -1,
        grade: "C",
        confidencePct: 50,
        simAligned: true,
        composite: 40,
        recommends: false,
      },
    },
    evPct: -1,
    edgePct: -1,
    confidencePct: 50,
    impliedProbPct: 52.4,
    lineShoppingScore: null,
    grade: "C",
    simHit: 0.55,
    composite: 40,
    rankScore: 1,
  };
  recorder.recomputeQualificationFromScored([scoredLeg]);
  assert.equal(recorder.totalEvaluated, 2);
  assert.equal(recorder.preScoreEvaluated, 1);
});

test("finalize reconciles simulated markets missing from evaluated tally", () => {
  const recorder = createCoachBoardScanManifestRecorder(8);
  recorder.recordPropSimBatch(120, false);
  recorder.recomputeQualificationFromScored([]);
  const manifest = recorder.finalize({
    scanComplete: true,
    boardExhausted: true,
    deliveredLegs: 0,
  });
  assert.equal(manifest.marketsSimulated, 120);
  assert.equal(manifest.totalEvaluated, 120);
  assert.equal(manifest.gateFailureCounts.no_sim_grade, 120);
});

test("createCoachBoardScanManifestRecorder tracks prop pool rows", () => {
  const recorder = createCoachBoardScanManifestRecorder(6);
  recorder.recordPropPoolRow({
    game: "A @ B",
    market: "Points",
    pick: "Star Over 20.5 Points",
    odds: -110,
    isProp: true,
    player: "Star",
    sport: "nba",
    propLine: 20.5,
    propSide: "Over",
  });
  assert.equal(recorder.propsFound, 1);
  assert.ok(recorder.propsEligibleForSim + recorder.propsSkippedUnsupported === 1);
});

test("coachBoardScanManifestForMessage returns manifest when scan staged zero legs", () => {
  const scan: FullBoardScanResult = {
    picks: [],
    evalLinesByGame: new Map(),
    gameSimulations: new Map(),
    totalScanned: 1200,
    totalQualified: 0,
    staging: { mainQualified: 0, altQualified: 0, mainOnTicket: 0, altOnTicket: 0 },
    note: "",
    scanComplete: true,
    manifest: createCoachBoardScanManifestRecorder(8).finalize({
      scanComplete: true,
      boardExhausted: true,
      deliveredLegs: 0,
    }),
  };
  const text = coachBoardScanManifestForMessage(scan, { realOdds: [], propPool: [], gameMeta: [] }, 8);
  assert.match(text, /Scan manifest/i);
  assert.match(text, /0 legs delivered/i);
});

test("coachReplyHasScanManifest detects manifest heading in detail notes", () => {
  assert.equal(coachReplyHasScanManifest("### Scan manifest\n\nfoo", ""), true);
  assert.equal(coachReplyHasScanManifest("", "### Scan manifest\n\nbar"), true);
  assert.equal(coachReplyHasScanManifest("", "no manifest here"), false);
});

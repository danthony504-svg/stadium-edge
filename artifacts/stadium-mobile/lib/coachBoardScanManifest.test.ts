import assert from "node:assert/strict";
import test from "node:test";
import {
  createCoachBoardScanManifestRecorder,
  formatCoachBoardScanManifest,
} from "./coachBoardScanManifest.ts";
import { coachBoardScanManifestForMessage, coachReplyHasScanManifest, resolveCoachBoardScanManifestDetail } from "./coachBoardScanDelivery.ts";
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

test("resolveCoachBoardScanManifestDetail uses recorded manifest when leg-target match fails", () => {
  const manifest = createCoachBoardScanManifestRecorder(15).finalize({
    scanComplete: true,
    boardExhausted: true,
    deliveredLegs: 1,
  });
  const mismatched: FullBoardScanResult = {
    picks: [
      {
        game: "Sabah FK @ Manchester United",
        market: "Alt Total",
        pick: "Under 5.5",
        odds: -290,
      } as FullBoardScanResult["picks"][number],
    ],
    evalLinesByGame: new Map(),
    gameSimulations: new Map(),
    totalScanned: 900,
    totalQualified: 1,
    staging: { mainQualified: 0, altQualified: 1, mainOnTicket: 0, altOnTicket: 1 },
    note: "board note",
    scanComplete: true,
    // Staged for 15 — must not match an 8-leg ask via preferFinal, but still
    // carry the recorder so More ticket detail can show Coverage → Delivery.
    requestedLegs: 15,
    manifest: {
      ...manifest,
      marketsFound: 900,
      totalEvaluated: 400,
      totalQualified: 1,
      gateFailureCounts: { negative_edge: 120, grade_below_minimum: 40 },
      rejectedSamples: [
        {
          game: "A @ B",
          market: "Points",
          pick: "Star Over 24.5",
          category: "props",
          family: "playerProps",
          gate: "negative_edge",
          reason: "Edge ≤ 0",
        },
      ],
      marketsFoundByFamily: {
        ...manifest.marketsFoundByFamily,
        playerProps: 200,
        moneyline: 40,
        spread: 40,
        total: 30,
        teamTotal: 10,
        altTotal: 20,
      },
    },
  };
  const text = resolveCoachBoardScanManifestDetail(
    8,
    { realOdds: [], propPool: [], gameMeta: [] },
    null,
    mismatched,
  );
  assert.match(text, /### Scan manifest/i);
  assert.match(text, /\*\*Coverage\*\*/i);
  assert.match(text, /\*\*Market families discovered\*\*/i);
  assert.match(text, /\*\*Qualification\*\*/i);
  assert.match(text, /\*\*Gate failures\*\*/i);
  assert.match(text, /\*\*Sample rejections\*\*/i);
  assert.match(text, /\*\*Delivery\*\*/i);
  assert.match(text, /Markets found: \*\*900\*\*/);
});

test("coachBoardScanManifestForMessage prefers scan.manifest over empty delivery staging", () => {
  const manifest = createCoachBoardScanManifestRecorder(8).finalize({
    scanComplete: true,
    boardExhausted: true,
    deliveredLegs: 1,
  });
  const scan: FullBoardScanResult = {
    picks: [],
    evalLinesByGame: new Map(),
    gameSimulations: new Map(),
    totalScanned: 100,
    totalQualified: 0,
    staging: { mainQualified: 0, altQualified: 0, mainOnTicket: 0, altOnTicket: 0 },
    note: "",
    scanComplete: true,
    requestedLegs: 8,
    manifest: { ...manifest, marketsFound: 100, deliveredLegs: 1 },
  };
  const text = coachBoardScanManifestForMessage(scan, { realOdds: [], propPool: [], gameMeta: [] }, 8);
  assert.match(text, /### Scan manifest/i);
  assert.match(text, /Markets found: \*\*100\*\*/);
  assert.match(text, /Delivered \*\*1\*\*/);
});

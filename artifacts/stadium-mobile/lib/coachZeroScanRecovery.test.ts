/**
 * Completed-zero-scan recovery contract (post-#432 residual).
 *
 * Lifecycle must recognize a completed same-request board scan even when
 * scan.picks.length === 0, stash it, and deliver an honest empty result with
 * the scan manifest — never the "may still be scoring" dead-end.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ParsedPick } from "../components/PickCard.tsx";
import type { FullBoardScanResult } from "./boardMarketScanner.ts";
import {
  COACH_EMPTY_BOARD_SCAN_LEAD,
  coachReplyHasScanManifest,
  deliverCoachBoardScanTicket,
} from "./coachBoardScanDelivery.ts";
import { createCoachBoardScanManifestRecorder } from "./coachBoardScanManifest.ts";
import {
  boardScanAppliesToRequest,
  boardScanRecoverableForRequest,
} from "./coachRequestLifecycle.ts";
import {
  boardScanIsComplete,
  boardScanMatchesLegTarget,
  boardScanReadyForDelivery,
  preferFinalBoardScanForDelivery,
} from "./coachScanPolicy.ts";
import { coerceCoachDisplayPicks } from "./coachTicketKernel.ts";
import { filterCoachDeliveredPicks } from "./pickRecommendation.ts";

const enrich = { realOdds: [], propPool: [], gameMeta: [] };

function validPropLeg(i: number): ParsedPick {
  const kickoff = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
  const edge = 2.5 + i * 0.1;
  return {
    game: `Away${i} @ Home${i}`,
    market: "Hits",
    pick: `Player${i} Under 0.5 Hits`,
    odds: 134,
    isProp: true,
    player: `Player${i}`,
    sport: "mlb",
    startsAt: kickoff,
    ticketRole: "main" as const,
    finalAiScore: {
      composite: 5.9,
      grade: "C+",
      confidencePct: 52,
      edgePct: edge,
      simHit: 0.52,
      simAligned: true,
      highRiskValuePlay: false,
      recommends: false,
      factors: [],
      rubric: {
        composite: 5.9,
        grade: "C+",
        confidencePct: 52,
        edgePct: edge,
        scores: {} as never,
      },
      propHolistic: {
        composite: 5.7,
        grade: "C+",
        confidencePct: 46,
        coveragePct: 20,
        missingCount: 6,
        applicableCount: 8,
        recommends: false,
        factors: [],
      },
    },
  } as ParsedPick;
}

function mockScan(
  picks: ParsedPick[],
  opts: { requestedLegs: number; scanComplete?: boolean; requestId?: string },
): FullBoardScanResult {
  const scanComplete = opts.scanComplete ?? true;
  const manifest = createCoachBoardScanManifestRecorder(opts.requestedLegs).finalize({
    scanComplete,
    boardExhausted: scanComplete,
    deliveredLegs: picks.length,
  });
  return {
    picks,
    evalLinesByGame: new Map(),
    gameSimulations: new Map(),
    totalScanned: 1000,
    totalQualified: picks.length,
    staging: {
      mainQualified: picks.length,
      altQualified: 0,
      mainOnTicket: picks.length,
      altOnTicket: 0,
    },
    note: "",
    requestedLegs: opts.requestedLegs,
    requestId: opts.requestId,
    scanComplete,
    manifest: {
      ...manifest,
      marketsFound: 1000,
      deliveredLegs: picks.length,
      totalQualified: picks.length,
    },
  };
}

/** Mimic onBoardScanPartial stash gate + finally / tryStashedDelivery recovery. */
function recoverStashedScan(opts: {
  scan: FullBoardScanResult | null;
  legTarget: number;
  sendGeneration: number;
  activeSendGeneration: number;
  requestId: string;
}) {
  const { scan, legTarget, sendGeneration, activeSendGeneration, requestId } = opts;
  if (
    !boardScanAppliesToRequest(
      scan,
      legTarget,
      sendGeneration,
      activeSendGeneration,
      requestId,
    )
  ) {
    return { stashed: false as const, delivered: null };
  }
  // Stash accepted (latestBoardScanRef = scan).
  if (!scan || !boardScanIsComplete(scan)) {
    return { stashed: true as const, delivered: null };
  }
  if (!boardScanReadyForDelivery(scan, legTarget)) {
    return { stashed: true as const, delivered: null };
  }
  const delivered = deliverCoachBoardScanTicket(scan, enrich, legTarget);
  const messagePicks = delivered.picks;
  const rendered = coerceCoachDisplayPicks(messagePicks, enrich);
  const honestZeroUi =
    delivered.scanComplete &&
    messagePicks.length === 0 &&
    coachReplyHasScanManifest(undefined, delivered.coachDetailNote) &&
    !/may still be scoring/i.test(delivered.coachDetailNote);
  return {
    stashed: true as const,
    delivered,
    messageCount: messagePicks.length,
    renderedCount: rendered.length,
    honestZeroUi,
  };
}

test("req8 + completed scan0 → applies → scanComplete true → manifest → picks 0 → honest UI", () => {
  const scan = mockScan([], { requestedLegs: 8, requestId: "req-8", scanComplete: true });
  assert.equal(boardScanIsComplete(scan), true);
  assert.equal(boardScanReadyForDelivery(scan, 8), true);

  const recovered = recoverStashedScan({
    scan,
    legTarget: 8,
    sendGeneration: 4,
    activeSendGeneration: 4,
    requestId: "req-8",
  });
  assert.equal(recovered.stashed, true);
  assert.ok(recovered.delivered);
  assert.equal(recovered.delivered.scanComplete, true);
  assert.equal(recovered.delivered.manifest.scanComplete, true);
  assert.equal(recovered.delivered.manifest.deliveredLegs, 0);
  assert.equal(recovered.messageCount, 0);
  assert.equal(recovered.renderedCount, 0);
  assert.equal(recovered.honestZeroUi, true);
  assert.ok(
    coachReplyHasScanManifest(undefined, recovered.delivered.coachDetailNote),
    "manifest must attach",
  );
  assert.match(recovered.delivered.coachDetailNote, /0 legs delivered/i);
  assert.doesNotMatch(
    recovered.delivered.coachDetailNote,
    /may still be scoring/i,
  );
});

test("req8 + scan6 → 6 picks preserved through message/cards", () => {
  const picks = Array.from({ length: 6 }, (_, i) => validPropLeg(i));
  const scan = mockScan(picks, { requestedLegs: 8, requestId: "req-8" });
  const recovered = recoverStashedScan({
    scan,
    legTarget: 8,
    sendGeneration: 1,
    activeSendGeneration: 1,
    requestId: "req-8",
  });
  assert.equal(recovered.stashed, true);
  assert.equal(recovered.messageCount, 6);
  assert.equal(recovered.renderedCount, 6);
  assert.equal(filterCoachDeliveredPicks(recovered.delivered!.picks, enrich).length, 6);
});

test("req6 + scan2 → 2 picks preserved", () => {
  const picks = Array.from({ length: 2 }, (_, i) => validPropLeg(i));
  const scan = mockScan(picks, { requestedLegs: 6, requestId: "req-6" });
  const recovered = recoverStashedScan({
    scan,
    legTarget: 6,
    sendGeneration: 1,
    activeSendGeneration: 1,
    requestId: "req-6",
  });
  assert.equal(recovered.messageCount, 2);
  assert.equal(recovered.renderedCount, 2);
});

test("req8 + scan8 → 8 preserved", () => {
  const picks = Array.from({ length: 8 }, (_, i) => validPropLeg(i));
  const scan = mockScan(picks, { requestedLegs: 8, requestId: "req-8" });
  const recovered = recoverStashedScan({
    scan,
    legTarget: 8,
    sendGeneration: 1,
    activeSendGeneration: 1,
    requestId: "req-8",
  });
  assert.equal(recovered.messageCount, 8);
  assert.equal(recovered.renderedCount, 8);
});

test("mismatched/foreign scan → rejected (not stashed)", () => {
  const foreign = mockScan(Array.from({ length: 15 }, (_, i) => validPropLeg(i)), {
    requestedLegs: 15,
    requestId: "req-8",
  });
  const recovered = recoverStashedScan({
    scan: foreign,
    legTarget: 8,
    sendGeneration: 1,
    activeSendGeneration: 1,
    requestId: "req-8",
  });
  assert.equal(recovered.stashed, false);
  assert.equal(boardScanMatchesLegTarget(foreign, 8), false);
  assert.equal(boardScanReadyForDelivery(foreign, 8), false);

  const wrongRequest = mockScan([], {
    requestedLegs: 8,
    requestId: "req-other",
    scanComplete: true,
  });
  assert.equal(
    recoverStashedScan({
      scan: wrongRequest,
      legTarget: 8,
      sendGeneration: 1,
      activeSendGeneration: 1,
      requestId: "req-8",
    }).stashed,
    false,
  );
});

test("late completed zero-pick after budget timeout still recoverable for same request", () => {
  // Promise.race budget returned null; onPartial later delivers the completed zero scan.
  const timedOutResult: FullBoardScanResult | null = null;
  assert.equal(preferFinalBoardScanForDelivery(8, timedOutResult), null);

  const lateComplete = mockScan([], {
    requestedLegs: 8,
    requestId: "req-8",
    scanComplete: true,
  });
  // onBoardScanPartial stash gate must accept the late complete before finally/tryStash.
  assert.equal(
    boardScanAppliesToRequest(lateComplete, 8, 9, 9, "req-8"),
    true,
  );
  const fromRef = preferFinalBoardScanForDelivery(8, timedOutResult, lateComplete);
  assert.equal(fromRef, lateComplete);
  assert.equal(boardScanReadyForDelivery(fromRef, 8), true);

  const recovered = recoverStashedScan({
    scan: lateComplete,
    legTarget: 8,
    sendGeneration: 9,
    activeSendGeneration: 9,
    requestId: "req-8",
  });
  assert.equal(recovered.stashed, true);
  assert.equal(recovered.honestZeroUi, true);
  assert.equal(recovered.messageCount, 0);
  assert.ok(coachReplyHasScanManifest(undefined, recovered.delivered!.coachDetailNote));
});

test("coach.tsx recovery paths no longer require picks.length > 0 for completed scans", () => {
  const coachPath = join(dirname(fileURLToPath(import.meta.url)), "../app/(tabs)/coach.tsx");
  const src = readFileSync(coachPath, "utf8");

  // freshBoardScanComplete must not require picks.length
  assert.match(
    src,
    /freshBoardScanComplete = !!\(\s*preBoardScan &&\s*boardScanIsComplete\(preBoardScan\) &&\s*boardScanReadyForDelivery\(preBoardScan, reachTargetPreScan\)\s*\)/,
  );

  // finally / abort must re-validate request identity before consuming stash
  assert.match(src, /boardScanRecoverableForRequest/);
  assert.match(
    src,
    /Establish request identity BEFORE any await/,
  );

  // tryStashedDelivery must keep recovering through the "still scoring" placeholder
  assert.match(src, /stillScoringPlaceholder/);
  assert.match(src, /board scan may still be scoring/i);

  // Honest completed-zero lead must be wired
  assert.match(src, /COACH_EMPTY_BOARD_SCAN_LEAD/);
  assert.ok(COACH_EMPTY_BOARD_SCAN_LEAD.toLowerCase().includes("no legs cleared"));
});

test("Request A (8) then Request B (8): late completed zero-pick from A is rejected", () => {
  const lateFromA = mockScan([], {
    requestedLegs: 8,
    requestId: "req-A",
    scanComplete: true,
  });
  assert.equal(
    boardScanAppliesToRequest(lateFromA, 8, 2, 2, "req-B"),
    false,
  );
  assert.equal(
    boardScanRecoverableForRequest(lateFromA, 8, 2, 2, "req-B"),
    false,
  );
  assert.equal(
    recoverStashedScan({
      scan: lateFromA,
      legTarget: 8,
      sendGeneration: 2,
      activeSendGeneration: 2,
      requestId: "req-B",
    }).stashed,
    false,
  );
});

test("Request A (6) then Request B (8): late result from A is rejected", () => {
  const lateFromA = mockScan([], {
    requestedLegs: 6,
    requestId: "req-A",
    scanComplete: true,
  });
  assert.equal(boardScanMatchesLegTarget(lateFromA, 8), false);
  assert.equal(
    boardScanRecoverableForRequest(lateFromA, 8, 2, 2, "req-B"),
    false,
  );
  const shortfallFromA = mockScan(Array.from({ length: 2 }, (_, i) => validPropLeg(i)), {
    requestedLegs: 6,
    requestId: "req-A",
  });
  assert.equal(
    boardScanRecoverableForRequest(shortfallFromA, 8, 2, 2, "req-B"),
    false,
  );
});

test("zero-pick scan with missing requestId rejected from cross-request recovery", () => {
  const missingId = mockScan([], {
    requestedLegs: 8,
    scanComplete: true,
  });
  delete (missingId as { requestId?: string }).requestId;
  assert.equal(
    boardScanAppliesToRequest(missingId, 8, 1, 1, "req-B"),
    false,
    "missing scan.requestId must not recover",
  );
  assert.equal(
    boardScanAppliesToRequest(missingId, 8, 1, 1, null),
    false,
    "missing activeRequestId must not recover zero-pick",
  );
  assert.equal(
    boardScanRecoverableForRequest(missingId, 8, 1, 1, "req-B"),
    false,
  );
});

test("current-request zero-pick scan still recovers correctly", () => {
  const scan = mockScan([], {
    requestedLegs: 8,
    requestId: "req-B",
    scanComplete: true,
  });
  const recovered = recoverStashedScan({
    scan,
    legTarget: 8,
    sendGeneration: 3,
    activeSendGeneration: 3,
    requestId: "req-B",
  });
  assert.equal(recovered.stashed, true);
  assert.equal(recovered.honestZeroUi, true);
  assert.equal(recovered.messageCount, 0);
  assert.ok(coachReplyHasScanManifest(undefined, recovered.delivered!.coachDetailNote));
});

test("current-request non-empty shortfall still preserves its picks", () => {
  const picks = Array.from({ length: 6 }, (_, i) => validPropLeg(i));
  const scan = mockScan(picks, { requestedLegs: 8, requestId: "req-B" });
  const recovered = recoverStashedScan({
    scan,
    legTarget: 8,
    sendGeneration: 3,
    activeSendGeneration: 3,
    requestId: "req-B",
  });
  assert.equal(recovered.stashed, true);
  assert.equal(recovered.messageCount, 6);
  assert.equal(recovered.renderedCount, 6);
});

test("Try Again starts a fresh request and rejects previous generation results", () => {
  const prevGenZero = mockScan([], {
    requestedLegs: 8,
    requestId: "req-A",
    scanComplete: true,
  });
  // Fresh send bumps generation 1 → 2 and issues a new requestId.
  assert.equal(
    boardScanRecoverableForRequest(prevGenZero, 8, 1, 2, "req-B"),
    false,
    "previous sendGeneration must not recover into Try Again",
  );
  assert.equal(
    boardScanRecoverableForRequest(prevGenZero, 8, 2, 2, "req-B"),
    false,
    "previous requestId must not recover into Try Again",
  );
  const freshCurrent = mockScan([], {
    requestedLegs: 8,
    requestId: "req-B",
    scanComplete: true,
  });
  assert.equal(
    boardScanRecoverableForRequest(freshCurrent, 8, 2, 2, "req-B"),
    true,
  );

  const coachPath = join(dirname(fileURLToPath(import.meta.url)), "../app/(tabs)/coach.tsx");
  const src = readFileSync(coachPath, "utf8");
  const marker = '<Feather name="refresh-cw"';
  const featherIdx = src.indexOf(marker);
  assert.ok(featherIdx > 0);
  const slice = src.slice(Math.max(0, featherIdx - 1600), featherIdx + 400);
  assert.match(slice, /freshThread:\s*true/);
  assert.match(slice, /abortRef\.current\?\.abort/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ParsedPick } from "../components/PickCard.tsx";
import type { FullBoardScanResult } from "./boardMarketScanner.ts";
import { createCoachBoardScanManifestRecorder } from "./coachBoardScanManifest.ts";
import {
  coachReplyHasScanManifest,
  deliverCoachBoardScanTicket,
} from "./coachBoardScanDelivery.ts";
import {
  boardScanMatchesLegTarget,
  boardScanReadyForDelivery,
} from "./coachScanPolicy.ts";
import {
  filterCoachDeliveredPicks,
  finalizeBoardBuiltCoachTicket,
} from "./pickRecommendation.ts";
import { coerceCoachDisplayPicks } from "./coachTicketKernel.ts";

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
  opts: { requestedLegs: number; scanComplete?: boolean },
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
    scanComplete,
    manifest: {
      ...manifest,
      marketsFound: 1000,
      deliveredLegs: picks.length,
      totalQualified: picks.length,
    },
  };
}

/** scan.picks → deliver → filter → message.picks → rendered pickCards */
function pipelineCounts(scan: FullBoardScanResult, requestedLegs: number) {
  const scanCount = scan.picks.length;
  const delivered = deliverCoachBoardScanTicket(scan, enrich, requestedLegs);
  const deliverCount = delivered.picks.length;
  const filtered = filterCoachDeliveredPicks(delivered.picks, enrich);
  const filterCount = filtered.length;
  const messagePicks = delivered.picks;
  const messageCount = messagePicks.length;
  const rendered = coerceCoachDisplayPicks(messagePicks, enrich);
  const renderedCount = rendered.length;
  return {
    scanCount,
    deliverCount,
    filterCount,
    messageCount,
    renderedCount,
    delivered,
    messagePicks,
    rendered,
  };
}

test("requested 8, scan has 6 valid picks → deliver 6, not 0", () => {
  const picks = Array.from({ length: 6 }, (_, i) => validPropLeg(i));
  const scan = mockScan(picks, { requestedLegs: 8 });
  assert.equal(boardScanMatchesLegTarget(scan, 8), true);
  assert.equal(boardScanReadyForDelivery(scan, 8), true);

  const c = pipelineCounts(scan, 8);
  assert.deepEqual(
    [c.scanCount, c.deliverCount, c.filterCount, c.messageCount, c.renderedCount],
    [6, 6, 6, 6, 6],
    `expected 6→6→6→6→6, got ${c.scanCount}→${c.deliverCount}→${c.filterCount}→${c.messageCount}→${c.renderedCount}`,
  );
  assert.equal(c.delivered.scanComplete, true);
  assert.equal(c.delivered.manifest.deliveredLegs, 6);
  assert.equal(c.delivered.manifest.requestedLegs, 8);
  assert.match(c.delivered.coachDetailNote, /### Scan manifest/i);
});

test("requested 6, scan has 2 valid picks → deliver 2, not 0", () => {
  const picks = Array.from({ length: 2 }, (_, i) => validPropLeg(i));
  const scan = mockScan(picks, { requestedLegs: 6 });
  const c = pipelineCounts(scan, 6);
  assert.deepEqual(
    [c.scanCount, c.deliverCount, c.filterCount, c.messageCount, c.renderedCount],
    [2, 2, 2, 2, 2],
  );
  assert.equal(c.delivered.scanComplete, true);
  assert.equal(c.delivered.manifest.deliveredLegs, 2);
});

test("requested 8, scan has 0 picks and scanComplete=true → attach manifest, completed zero-pick", () => {
  const scan = mockScan([], { requestedLegs: 8, scanComplete: true });
  assert.equal(boardScanReadyForDelivery(scan, 8), true);
  assert.equal(boardScanMatchesLegTarget(scan, 8), true);

  const c = pipelineCounts(scan, 8);
  assert.deepEqual(
    [c.scanCount, c.deliverCount, c.filterCount, c.messageCount, c.renderedCount],
    [0, 0, 0, 0, 0],
  );
  assert.equal(c.delivered.scanComplete, true);
  assert.equal(c.delivered.manifest.deliveredLegs, 0);
  assert.equal(c.delivered.manifest.scanComplete, true);
  assert.ok(
    coachReplyHasScanManifest(undefined, c.delivered.coachDetailNote),
    "completed zero-pick must attach scan manifest (not 'may still be scoring')",
  );
  assert.match(c.delivered.coachDetailNote, /0 legs delivered/i);
});

test("non-empty scan.picks survive delivery/finalization except invalid-pick filtering", () => {
  const good = Array.from({ length: 4 }, (_, i) => validPropLeg(i));
  const badBase = validPropLeg(99);
  const invalid = {
    ...badBase,
    finalAiScore: {
      ...badBase.finalAiScore!,
      edgePct: -2,
      recommends: false,
      highRiskValuePlay: false,
      simAligned: false,
    },
  } as ParsedPick;
  const scan = mockScan([...good, invalid], { requestedLegs: 8 });
  const c = pipelineCounts(scan, 8);
  assert.equal(c.scanCount, 5);
  assert.equal(c.deliverCount, 4, "only the negative-edge invalid leg may be stripped");
  assert.equal(c.filterCount, 4);
  assert.equal(c.messageCount, 4);
  assert.equal(c.renderedCount, 4);
  for (const g of good) {
    assert.ok(
      c.messagePicks.some((p) => p.player === g.player && p.pick === g.pick),
      `valid staged leg ${g.player} must survive`,
    );
  }
});

test("filterCoachDeliveredPicks does not strip valid legs solely because count < requested", () => {
  const picks = Array.from({ length: 3 }, (_, i) => validPropLeg(i));
  assert.equal(filterCoachDeliveredPicks(picks, enrich).length, 3);
  assert.equal(finalizeBoardBuiltCoachTicket(picks, enrich).picks.length, 3);
});

test("legacy shortfall without requestedLegs still delivers (not wiped to 0)", () => {
  const picks = Array.from({ length: 6 }, (_, i) => validPropLeg(i));
  const scan = mockScan(picks, { requestedLegs: 8 });
  delete scan.requestedLegs;
  assert.equal(boardScanMatchesLegTarget(scan, 8), true);
  assert.equal(boardScanReadyForDelivery(scan, 8), true);
  const delivered = deliverCoachBoardScanTicket(scan, enrich, 8);
  assert.equal(delivered.picks.length, 6);
  assert.equal(delivered.scanComplete, true);
});

test("oversized foreign scan still refuses delivery (no prefix reuse)", () => {
  const picks = Array.from({ length: 15 }, (_, i) => validPropLeg(i));
  const scan = mockScan(picks, { requestedLegs: 15 });
  assert.equal(boardScanReadyForDelivery(scan, 8), false);
  const delivered = deliverCoachBoardScanTicket(scan, enrich, 8);
  assert.equal(delivered.picks.length, 0);
  assert.equal(delivered.scanComplete, true);
});

test("Try again still launches a fresh scan via freshThread: true", () => {
  const coachPath = join(dirname(fileURLToPath(import.meta.url)), "../app/(tabs)/coach.tsx");
  const src = readFileSync(coachPath, "utf8");
  const marker = '<Feather name="refresh-cw"';
  const featherIdx = src.indexOf(marker);
  assert.ok(featherIdx > 0, "Try again refresh icon must exist");
  // Include the onPress handler above the Feather icon (style block is long).
  const slice = src.slice(Math.max(0, featherIdx - 1600), featherIdx + 400);
  assert.match(slice, /Try again/, "refresh control must label Try again");
  assert.match(slice, /freshThread:\s*true/, "Try again must send with freshThread: true");
  assert.match(slice, /abortRef\.current\?\.abort/, "Try again must abort the in-flight scan");
  assert.match(slice, /parlayShowRetryButton/, "Try again must stay gated on parlayShowRetryButton");
});

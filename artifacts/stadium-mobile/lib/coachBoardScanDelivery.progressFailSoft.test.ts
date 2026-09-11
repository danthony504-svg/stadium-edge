import assert from "node:assert/strict";
import test from "node:test";

import type { ParsedPick } from "../components/PickCard.tsx";
import type { FullBoardScanResult } from "./boardMarketScanner.ts";
import { createCoachBoardScanManifestRecorder } from "./coachBoardScanManifest.ts";
import { deliverCoachBoardScanProgress } from "./coachBoardScanDelivery.ts";

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
  const scanComplete = opts.scanComplete ?? false;
  const manifest = createCoachBoardScanManifestRecorder(opts.requestedLegs).finalize({
    scanComplete,
    boardExhausted: scanComplete,
    deliveredLegs: picks.length,
  });
  return {
    picks,
    note: "",
    totalScanned: 1200,
    evalLinesByGame: new Map(),
    scanComplete,
    boardExhausted: scanComplete,
    requestedLegs: opts.requestedLegs,
    manifest,
  } as FullBoardScanResult;
}

test("progress fail-soft: full stash still flashes cards when gates strip the ticket", () => {
  const stash = Array.from({ length: 6 }, (_, i) => validPropLeg(i));
  const scan = mockScan(stash, { requestedLegs: 6, scanComplete: false });
  const progress = deliverCoachBoardScanProgress(scan, enrich, 6);
  assert.ok(
    progress.picks.length >= 6,
    `expected fail-soft full ticket, got ${progress.picks.length}`,
  );
});

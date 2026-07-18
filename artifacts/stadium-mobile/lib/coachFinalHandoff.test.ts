import assert from "node:assert/strict";
import test from "node:test";

import type { ParsedPick } from "../components/PickCard.tsx";
import type { FullBoardScanResult } from "./boardMarketScanner.ts";
import {
  auditPropLabelNormalization,
  buildCoachFinalHandoffSnapshot,
  deriveCoachEmptyReason,
  resetCoachHandoffDeliveryAttempt,
} from "./coachFinalHandoff.ts";

function mockPropPick(player: string, marketKey: string): ParsedPick {
  return {
    game: "Sparks @ Dream",
    player,
    market: marketKey,
    propMarketKey: marketKey,
    marketLabel: marketKey,
    pick: `${player} Over 1.5`,
    isProp: true,
    odds: -110,
    sport: "wnba",
  } as ParsedPick;
}

function fiveLegScan(requestId = "req-5-handoff"): FullBoardScanResult {
  const picks = [
    mockPropPick("Allisha Gray", "player_points"),
    mockPropPick("Natasha Howard", "player_assists"),
    mockPropPick("Jordin Canada", "player_rebounds"),
    mockPropPick("Kahleah Copper", "player_points_rebounds"),
    mockPropPick("Ariel Atkins", "player_rebounds"),
  ];
  return {
    picks,
    evalLinesByGame: new Map(),
    gameSimulations: new Map(),
    totalScanned: 120,
    totalQualified: 8,
    staging: {
      mainQualified: 5,
      altQualified: 2,
      mainPool: 5,
      altPool: 2,
    } as FullBoardScanResult["staging"],
    note: "5-leg board scan",
    requestedLegs: 5,
    requestId,
    scanComplete: true,
  };
}

test("propMarketLabel normalization audit does not flag labeled prop candidates", () => {
  const scan = fiveLegScan();
  const audit = auditPropLabelNormalization(scan.picks);
  assert.equal(audit.propCandidates, 5);
  assert.equal(audit.missingLabel, 0);
});

test("5-leg complete scan handoff snapshot reports final delivery values", () => {
  resetCoachHandoffDeliveryAttempt("req-5-handoff");
  const scan = fiveLegScan();
  const snapshot = buildCoachFinalHandoffSnapshot({
    requestId: scan.requestId,
    scan,
    pickCount: scan.picks.length,
    rendered: true,
    legTarget: 5,
    deliveryAttempt: 1,
  });

  assert.equal(snapshot.requestId, "req-5-handoff");
  assert.equal(snapshot.scanComplete, true);
  assert.equal(snapshot.source, "final");
  assert.equal(snapshot.candidateCount, 5);
  assert.equal(snapshot.pickCount, 5);
  assert.equal(snapshot.rendered, true);
  assert.equal(snapshot.emptyReason, null);
  assert.equal(snapshot["delivery-attempt"], 1);

  console.log("[coach-final-handoff]", JSON.stringify(snapshot));
});

test("deriveCoachEmptyReason keeps scan-in-progress separate from finished empty", () => {
  const partial = fiveLegScan();
  partial.scanComplete = false;
  assert.equal(
    deriveCoachEmptyReason({
      scan: partial,
      legTarget: 5,
      candidateCount: partial.picks.length,
      pickCount: 0,
    }),
    "scan-in-progress",
  );
  assert.equal(
    deriveCoachEmptyReason({
      scan: { ...fiveLegScan(), picks: [], totalQualified: 0 },
      legTarget: 5,
      candidateCount: 0,
      pickCount: 0,
    }),
    "board-exhausted-zero-qualified",
  );
  assert.equal(
    deriveCoachEmptyReason({
      scan: fiveLegScan(),
      legTarget: 5,
      candidateCount: 5,
      pickCount: 0,
    }),
    "delivery-gates-stripped-candidates",
  );
});

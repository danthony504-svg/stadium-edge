import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { coachV2PickToParsedPick, coachV2SnapshotToLegacy } from "./coachV2Adapter.ts";
import type { CoachV2Snapshot } from "./coachV2Types.ts";

const snapshot: CoachV2Snapshot = {
  at: 1_752_955_473_000,
  fingerprint: "ctx:mlb:test",
  manifest: {
    contextFingerprint: "ctx:mlb:test",
    scanComplete: true,
    deepSimComplete: true,
    candidatesEvaluated: 100,
    gatesPassed: 5,
    gatesRejected: 95,
  },
  activeSports: ["mlb"],
  deepSimComplete: true,
  serveable: true,
  propsQualified: 4,
  gameLinesQualified: 1,
  tickets: {
    global: {
      5: {
        requestedLegs: 5,
        deliveredLegs: 3,
        propCount: 2,
        gameLineCount: 1,
        assembledAt: "2026-07-12T20:00:00.000Z",
        picks: [
          {
            game: "NYY @ BOS",
            market: "Hits",
            pick: "Over 1.5",
            odds: -110,
            sport: "mlb",
            isProp: true,
            startsAt: "2026-07-12T23:00:00.000Z",
            player: "Aaron Judge",
            propLine: 1.5,
            propSide: "Over",
            edgePct: 3.5,
            evPct: 4.2,
            simHitPct: 56,
            confidencePct: 58,
            grade: "B+",
            compositeScore: 78,
          },
        ],
      },
    },
    bySport: {},
  },
};

describe("coachV2Adapter", () => {
  it("maps v2 pick display to ParsedPick with positive edge", () => {
    const pick = coachV2PickToParsedPick(snapshot.tickets.global[5]!.picks[0]!);
    assert.equal(pick.game, "NYY @ BOS");
    assert.equal(pick.edge, "+3.5%");
    assert.equal(pick.finalAiScore?.grade, "B+");
  });

  it("adapts v2 snapshot into legacy slate cache shape", () => {
    const legacy = coachV2SnapshotToLegacy(snapshot);
    assert.equal(legacy.fingerprint, snapshot.fingerprint);
    assert.equal(legacy.deepSimComplete, true);
    assert.ok(legacy.tickets?.global?.[5]);
    assert.equal(legacy.boardScan?.picks.length, 1);
    assert.match(legacy.boardScan?.note ?? "", /Only 3 legs/);
  });
});

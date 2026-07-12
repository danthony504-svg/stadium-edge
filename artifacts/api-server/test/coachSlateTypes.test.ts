import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeSlateFingerprint,
  isSlateSnapshotFresh,
  SLATE_PRE_ANALYSIS_MAX_MS,
  type BuiltChatContext,
} from "../src/lib/coachSlateTypes.ts";

function minimalBuilt(overrides?: Partial<BuiltChatContext>): BuiltChatContext {
  return {
    context: {
      selectedSports: ["mlb"],
      currentSlip: [],
      realGames: [],
      realOdds: [
        {
          sport: "mlb",
          game: "A @ B",
          market: "Moneyline",
          pick: "A ML",
          odds: 150,
          startsAt: "2026-07-12T20:00:00Z",
        },
      ],
      realProps: [],
    },
    propPool: [{ sport: "mlb", game: "A @ B", marketLabel: "Hits", player: "P", line: 1, side: "Over", odds: -110 }],
    gameMeta: [],
    upsetSpots: [],
    todayOnly: false,
    tomorrowOnly: false,
    ...overrides,
  };
}

describe("coachSlateTypes", () => {
  it("computeSlateFingerprint is stable for same inputs", () => {
    const built = minimalBuilt();
    assert.equal(computeSlateFingerprint(built), computeSlateFingerprint(built));
  });

  it("computeSlateFingerprint changes when odds change", () => {
    const a = minimalBuilt();
    const b = minimalBuilt({
      context: {
        ...a.context,
        realOdds: [{ ...a.context.realOdds[0]!, odds: 160 }],
      },
    });
    assert.notEqual(computeSlateFingerprint(a), computeSlateFingerprint(b));
  });

  it("isSlateSnapshotFresh respects max age", () => {
    const snap = {
      at: Date.now() - SLATE_PRE_ANALYSIS_MAX_MS - 1,
      fingerprint: "x",
      built: minimalBuilt(),
      propSimulations: [],
      boardScan: null,
      deepSimComplete: true,
    };
    assert.equal(isSlateSnapshotFresh(snap), false);
    snap.at = Date.now();
    assert.equal(isSlateSnapshotFresh(snap), true);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeSlateFingerprint,
  isSlateSnapshotFresh,
  nearestSlateParlaySize,
  resolveSlateBoardScan,
  SLATE_PRE_ANALYSIS_MAX_MS,
  type BuiltChatContext,
  type SlatePreAnalysisSnapshot,
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

  it("resolveSlateBoardScan picks exact precomputed ticket size", () => {
    const fiveLeg = {
      picks: Array.from({ length: 5 }, (_, i) => ({
        game: `G${i} @ H${i}`,
        market: "Moneyline",
        pick: `Team ML`,
        odds: -110,
        sport: "mlb",
      })),
      evalLinesByGame: {},
      gameSimulations: {},
      totalScanned: 100,
      totalQualified: 20,
      staging: { mainQualified: 10, altQualified: 10, mainOnTicket: 5, altOnTicket: 0 },
      note: "5-leg ticket",
    };
    const snap: SlatePreAnalysisSnapshot = {
      at: Date.now(),
      fingerprint: "x",
      built: minimalBuilt(),
      propSimulations: [],
      boardScan: null,
      tickets: { global: { 5: fiveLeg }, bySport: {} },
      deepSimComplete: true,
    };
    const resolved = resolveSlateBoardScan(snap, { legs: 5 });
    assert.equal(resolved?.picks.length, 5);
    assert.equal(resolved?.note, "5-leg ticket");
    assert.equal(nearestSlateParlaySize(7), 6);
    assert.equal(nearestSlateParlaySize(4), 3);
  });
});

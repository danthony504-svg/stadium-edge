import assert from "node:assert/strict";
import test from "node:test";

import {
  cachedSeedMatchesBuilt,
  computeInjuryDigest,
  markBoardScanAsPreview,
  slateFingerprintFromBuilt,
} from "./coachSlateFreshness.ts";
import type { BuiltChatContext } from "./api.ts";

function minimalBuilt(overrides?: Partial<BuiltChatContext>): BuiltChatContext {
  return {
    context: {
      realOdds: [
        {
          game: "Away @ Home",
          market: "Spread",
          pick: "Away +3.5",
          odds: -110,
          startsAt: "2026-07-13T20:00:00Z",
        },
      ],
      realProps: [],
      realGames: [],
      matchupInjuries: {},
      ...overrides?.context,
    },
    propPool: [
      {
        game: "Away @ Home",
        player: "Player A",
        marketLabel: "Points",
        line: 20.5,
        side: "Over",
        odds: -110,
        marketKey: "player_points",
        sport: "nba",
      },
    ],
    gameMeta: [],
    todayOnly: false,
    ...overrides,
  } as BuiltChatContext;
}

test("slateFingerprintFromBuilt changes when odds move", () => {
  const a = slateFingerprintFromBuilt(minimalBuilt());
  const b = slateFingerprintFromBuilt(
    minimalBuilt({
      context: {
        realOdds: [
          {
            game: "Away @ Home",
            market: "Spread",
            pick: "Away +3.5",
            odds: -105,
            startsAt: "2026-07-13T20:00:00Z",
          },
        ],
        realProps: [],
        realGames: [],
      },
    } as Partial<BuiltChatContext>),
  );
  assert.notEqual(a, b);
});

test("cachedSeedMatchesBuilt is false after meaningful injury change", () => {
  const built = minimalBuilt();
  const fp = slateFingerprintFromBuilt(built);
  const seed = {
    built,
    propSimulations: new Map(),
    boardScan: null,
    fingerprint: fp,
  };
  assert.equal(cachedSeedMatchesBuilt(seed, built), true);
  const injured = minimalBuilt({
    context: {
      ...built.context,
      matchupInjuries: {
        "Away @ Home": {
          game: "Away @ Home",
          edge: "home healthier",
          sides: [
            {
              team: "Home",
              keyPlayers: [{ name: "Star", impact: "high" as const }],
            },
            { team: "Away", keyPlayers: [] },
          ],
        },
      },
    },
  } as Partial<BuiltChatContext>);
  assert.equal(cachedSeedMatchesBuilt(seed, injured), false);
});

test("markBoardScanAsPreview never finalizes cached scans", () => {
  const scan = markBoardScanAsPreview({ scanComplete: true, picks: [{ pick: "x" }] as never[] });
  assert.equal(scan.scanComplete, false);
});

test("computeInjuryDigest is stable for same input", () => {
  const injuries = {
    "A @ B": {
      game: "A @ B",
      edge: "neutral",
      sides: [{ team: "A", keyPlayers: [] }, { team: "B", keyPlayers: [] }],
    },
  };
  assert.equal(computeInjuryDigest(injuries), computeInjuryDigest(injuries));
});

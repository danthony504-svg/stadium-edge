import assert from "node:assert/strict";
import test from "node:test";

import {
  cachedSeedMatchesBuilt,
  computeInjuryDigest,
  markBoardScanAsPreview,
  slateFingerprintFromBuilt,
} from "./coachSlateFreshness.ts";
import type { BuiltChatContext } from "./api.ts";
import type { GameInjuryReport } from "./injuries.ts";

function minimalBuilt(
  overrides?: Omit<Partial<BuiltChatContext>, "context"> & {
    context?: Partial<BuiltChatContext["context"]>;
  },
): BuiltChatContext {
  const { context: contextOverrides, ...builtOverrides } = overrides ?? {};
  return {
    context: {
      selectedSports: ["nba"],
      currentSlip: [],
      realOdds: [
        {
          sport: "nba",
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
      ...contextOverrides,
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
    upsetSpots: [],
    todayOnly: false,
    tomorrowOnly: false,
    ...builtOverrides,
  };
}

test("slateFingerprintFromBuilt changes when odds move", () => {
  const a = slateFingerprintFromBuilt(minimalBuilt());
  const b = slateFingerprintFromBuilt(
    minimalBuilt({
      context: {
        realOdds: [
          {
            sport: "nba",
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
    }),
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
  const matchupInjuries = {
    "Away @ Home": {
      edge: "home healthier",
      sides: [
        {
          team: "Home",
          keyPlayers: [{ player: "Star", position: null, status: "Out", impact: "high" as const }],
          groups: [],
        },
        { team: "Away", keyPlayers: [], groups: [] },
      ],
    },
  } satisfies Record<string, GameInjuryReport>;
  const injured = minimalBuilt({
    context: {
      ...built.context,
      matchupInjuries,
    },
  });
  assert.equal(cachedSeedMatchesBuilt(seed, injured), false);
});

test("markBoardScanAsPreview never finalizes cached scans", () => {
  const scan = markBoardScanAsPreview({ scanComplete: true, picks: [{ pick: "x" }] as never[] });
  assert.equal(scan.scanComplete, false);
});

test("computeInjuryDigest is stable for same input", () => {
  const injuries = {
    "A @ B": {
      edge: "neutral",
      sides: [
        { team: "A", keyPlayers: [], groups: [] },
        { team: "B", keyPlayers: [], groups: [] },
      ],
    },
  } satisfies Record<string, GameInjuryReport>;
  assert.equal(computeInjuryDigest(injuries), computeInjuryDigest(injuries));
});

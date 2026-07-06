import assert from "node:assert/strict";
import test from "node:test";
import {
  clearParlayVarietyMemory,
  parlayLegKey,
  parlayLegKeyFromPool,
  recentParlayLegKeys,
  recentParlayPlayerKeys,
  recentPlayerAppearanceCounts,
  rememberParlayBuild,
  rotateParlayDisplayOrder,
  deprioritizePropPoolEntries,
} from "./parlayVarietyMemory.ts";

test("rememberParlayBuild feeds recentParlayLegKeys", () => {
  clearParlayVarietyMemory();
  rememberParlayBuild([
    {
      game: "Cardinals @ Cubs",
      market: "Hits",
      pick: "Alec Burleson Over 1.5 Hits",
      player: "Alec Burleson",
      odds: 220,
      isProp: true,
    },
  ]);
  const keys = recentParlayLegKeys();
  assert.ok(keys.has(parlayLegKey({ game: "Cardinals @ Cubs", market: "Hits", player: "Alec Burleson" })));
});

test("rememberParlayBuild feeds recentParlayPlayerKeys", () => {
  clearParlayVarietyMemory();
  rememberParlayBuild([
    {
      game: "Cardinals @ Cubs",
      market: "Hits",
      pick: "Alec Burleson Over 1.5 Hits",
      player: "Alec Burleson",
      odds: 220,
      isProp: true,
    },
    {
      game: "Yankees @ Red Sox",
      market: "Home Runs",
      pick: "Aaron Judge Over 0.5 Home Runs",
      player: "Aaron Judge",
      odds: 350,
      isProp: true,
    },
  ]);
  const players = recentParlayPlayerKeys();
  assert.ok(players.has("alec burleson"));
  assert.ok(players.has("aaron judge"));
});

test("rememberParlayBuild feeds recentPlayerAppearanceCounts", () => {
  clearParlayVarietyMemory();
  rememberParlayBuild([
    {
      game: "Yankees @ Red Sox",
      market: "Home Runs",
      pick: "Aaron Judge Over 0.5 Home Runs",
      player: "Aaron Judge",
      odds: 350,
      isProp: true,
    },
  ]);
  rememberParlayBuild([
    {
      game: "Yankees @ Red Sox",
      market: "Hits",
      pick: "Aaron Judge Over 1.5 Hits",
      player: "Aaron Judge",
      odds: 200,
      isProp: true,
    },
  ]);
  const counts = recentPlayerAppearanceCounts();
  assert.equal(counts.get("aaron judge"), 2);
});

test("rotateParlayDisplayOrder changes lead leg per seed", () => {
  const picks = [{ pick: "a" }, { pick: "b" }, { pick: "c" }];
  const a = rotateParlayDisplayOrder(picks, "seed-a");
  const b = rotateParlayDisplayOrder(picks, "seed-b");
  assert.notEqual(a[0]!.pick, b[0]!.pick);
});

test("deprioritizePropPoolEntries pushes avoided legs to the end", () => {
  const pool = [
    {
      game: "Cardinals @ Cubs",
      player: "Alec Burleson",
      marketLabel: "Hits",
      line: 1.5,
      side: "Over" as const,
      odds: 220,
      sport: "mlb",
      marketKey: "hits",
      headshot: null,
      teamAbbr: "STL",
      athleteId: "1",
      startsAt: null,
    },
    {
      game: "Yankees @ Red Sox",
      player: "Aaron Judge",
      marketLabel: "Hits",
      line: 1.5,
      side: "Over" as const,
      odds: 200,
      sport: "mlb",
      marketKey: "hits",
      headshot: null,
      teamAbbr: "NYY",
      athleteId: "2",
      startsAt: null,
    },
  ];
  const avoid = new Set([parlayLegKeyFromPool(pool[0]!)]);
  const out = deprioritizePropPoolEntries(pool, avoid);
  assert.equal(out[0]!.player, "Aaron Judge");
});

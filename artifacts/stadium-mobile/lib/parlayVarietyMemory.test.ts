import assert from "node:assert/strict";
import test from "node:test";
import {
  clearParlayVarietyMemory,
  MAX_PARLAY_BUILD_HISTORY,
  parlayLegKey,
  parlayLegKeyFromPool,
  parlayPlayerKey,
  recentParlayLegKeys,
  recentParlayVarietyContext,
  rememberParlayBuild,
  rotateParlayDisplayOrder,
  deprioritizePropPoolEntries,
  ticketOverlapRatio,
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

test("rotateParlayDisplayOrder changes lead leg per seed", () => {
  const picks = [{ pick: "a" }, { pick: "b" }, { pick: "c" }];
  const a = rotateParlayDisplayOrder(picks, "seed-a");
  const b = rotateParlayDisplayOrder(picks, "seed-b");
  assert.notEqual(a[0]!.pick, b[0]!.pick);
});

test("ticketOverlapRatio measures shared legs", () => {
  const a = ["g1|p1|pts", "g2|p2|reb"];
  const b = ["g1|p1|pts", "g3|p3|ast"];
  assert.equal(ticketOverlapRatio(a, b), 0.5);
});

test("rememberParlayBuild tracks lead player for variety context", () => {
  clearParlayVarietyMemory();
  rememberParlayBuild([
    {
      game: "Sparks @ Dream",
      market: "Assists",
      pick: "Allisha Gray Under 3.5 Assists",
      player: "Allisha Gray",
      odds: -110,
      isProp: true,
    },
    {
      game: "Mercury @ Lynx",
      market: "Pts+Reb",
      pick: "Kahleah Copper Over 23.5 Pts+Reb",
      player: "Kahleah Copper",
      odds: -114,
      isProp: true,
    },
  ]);
  const ctx = recentParlayVarietyContext();
  assert.equal(ctx.recentLeadPlayers[0], parlayPlayerKey({ player: "Allisha Gray" }));
  assert.equal(ctx.recentTickets[0]!.length, 2);
});

test("recentParlayVarietyContext caps history at MAX_PARLAY_BUILD_HISTORY", () => {
  clearParlayVarietyMemory();
  for (let i = 0; i < MAX_PARLAY_BUILD_HISTORY + 5; i++) {
    rememberParlayBuild([
      {
        game: `G${i} @ H${i}`,
        market: "Points",
        pick: `Player ${i} Over 1.5 Points`,
        player: `Player ${i}`,
        odds: -110,
        isProp: true,
      },
    ]);
  }
  const ctx = recentParlayVarietyContext();
  assert.equal(ctx.recentTickets.length, MAX_PARLAY_BUILD_HISTORY);
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

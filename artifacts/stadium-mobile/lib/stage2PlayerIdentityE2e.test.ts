import assert from "node:assert/strict";
import { test } from "node:test";
import { propPoolFromRealProps, type RealPropEntry } from "./api.ts";
import { parsedPickFromPoolEntry } from "./propSelection.ts";
import { hasCompletePropProviderProvenance } from "./propProviderProvenance.ts";

test("propPoolFromRealProps copies athleteId/eventId/sportsbook/playerTeamId (no force-null)", () => {
  const props: RealPropEntry[] = [
    {
      sport: "nba",
      game: "Boston Celtics @ Detroit Pistons",
      startsAt: "2026-10-18T23:00:00Z",
      player: "Jayson Tatum",
      athleteId: "4065648",
      playerTeamId: "2",
      eventId: "26b036ff107f3c658258eaf4a6f26228",
      overBook: "FanDuel",
      underBook: "DraftKings",
      market: "player_assists",
      line: 5.5,
      over: -122,
      under: 113,
      alt: false,
    },
    {
      sport: "nfl",
      game: "Houston Texans @ Jacksonville Jaguars",
      startsAt: "2026-10-19T17:00:00Z",
      player: "Woody Marks",
      athleteId: "4429059",
      playerTeamId: "34",
      eventId: "57418b2cf5aca558b3c98eafac1e264a",
      overBook: "DraftKings",
      underBook: null,
      market: "player_rushing_yards",
      line: 45.5,
      over: -115,
      under: -105,
      alt: true,
    },
  ];

  const pool = propPoolFromRealProps(props);
  assert.equal(pool.length, 4);

  const tatumOver = pool.find((e) => e.player === "Jayson Tatum" && e.side === "Over");
  assert.ok(tatumOver);
  assert.equal(tatumOver!.athleteId, "4065648");
  assert.equal(tatumOver!.eventId, "26b036ff107f3c658258eaf4a6f26228");
  assert.equal(tatumOver!.sportsbook, "FanDuel");
  assert.equal(tatumOver!.playerTeamId, "2");

  const tatumUnder = pool.find((e) => e.player === "Jayson Tatum" && e.side === "Under");
  assert.equal(tatumUnder!.sportsbook, "DraftKings");

  const marksAlt = pool.find((e) => e.player === "Woody Marks" && e.side === "Over");
  assert.equal(marksAlt!.alt, true);
  assert.equal(marksAlt!.line, 45.5);
  assert.equal(marksAlt!.eventId, "57418b2cf5aca558b3c98eafac1e264a");

  const seat = parsedPickFromPoolEntry(tatumOver!);
  assert.equal(hasCompletePropProviderProvenance(seat), true);
});

test("propPoolFromRealProps leaves nulls when source omitted (fail-closed, no invention)", () => {
  const pool = propPoolFromRealProps([
    {
      sport: "mlb",
      game: "A @ B",
      startsAt: "2026-10-18T23:00:00Z",
      player: "Mystery",
      market: "batter_hits",
      line: 1.5,
      over: -110,
      under: -110,
      alt: false,
    },
  ]);
  assert.equal(pool[0]!.eventId, null);
  assert.equal(pool[0]!.sportsbook, null);
  assert.equal(pool[0]!.athleteId, null);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { prioritizePlayerHistoryTargets } from "./chatContextPriority.ts";

type Target = { sport: string; game: string; player: string };

// Build N players across the named game, the named sport, MLB, and other sports
// so the 40-player cap is well overflowed — mirroring a busy in-season slate.
function makeBusySlate(): Target[] {
  const targets: Target[] = [];
  // A big MLB slate iterates first in the real flow, so put it first here to
  // prove the focal float beats original ordering (not just luck).
  for (let i = 0; i < 60; i++) {
    targets.push({ sport: "mlb", game: `Mets @ Braves ${i}`, player: `MLB Player ${i}` });
  }
  // The focal NBA game the user named, buried AFTER the MLB flood.
  for (let i = 0; i < 5; i++) {
    targets.push({ sport: "nba", game: "Knicks @ Celtics", player: `Focal Player ${i}` });
  }
  // Other NBA games (named sport but not the named game).
  for (let i = 0; i < 10; i++) {
    targets.push({ sport: "nba", game: `Heat @ Magic ${i}`, player: `Other NBA ${i}` });
  }
  // Unrelated sports.
  for (let i = 0; i < 10; i++) {
    targets.push({ sport: "nhl", game: `Rangers @ Bruins ${i}`, player: `NHL Player ${i}` });
  }
  return targets;
}

test("focal game's players survive the 40-player cap on a busy slate", () => {
  const targets = makeBusySlate();
  assert.ok(targets.length > 40, "precondition: more than 40 targets so the cap actually bites");

  const result = prioritizePlayerHistoryTargets(targets, "build me a Knicks Celtics parlay", 40);

  assert.equal(result.length, 40, "trims to the cap");

  // Every focal-game player must be present (they were buried past slot 60).
  const focalPlayers = targets.filter((t) => t.game === "Knicks @ Celtics");
  for (const fp of focalPlayers) {
    assert.ok(
      result.some((r) => r.player === fp.player),
      `focal player "${fp.player}" must survive the cap`,
    );
  }

  // The focal-game players must lead the list (tier 3 ahead of everything).
  const leading = result.slice(0, focalPlayers.length);
  assert.ok(
    leading.every((r) => r.game === "Knicks @ Celtics"),
    "focal-game players are floated to the very front",
  );

  // The named sport (NBA) outranks MLB even though MLB iterated first.
  const firstMlbIdx = result.findIndex((r) => r.sport === "mlb");
  const lastNbaIdx = result.map((r) => r.sport).lastIndexOf("nba");
  assert.ok(
    firstMlbIdx === -1 || lastNbaIdx < firstMlbIdx,
    "all named-sport (NBA) players rank ahead of any MLB player",
  );
});

test("with no focal game, MLB players keep priority (platoon coverage preserved)", () => {
  // No focal text at all: a generic "give me a 40-leg parlay" style ask.
  const targets: Target[] = [];
  // Non-MLB sports iterate first and would otherwise hog the cap.
  for (let i = 0; i < 40; i++) {
    targets.push({ sport: "nba", game: `Heat @ Magic ${i}`, player: `NBA ${i}` });
  }
  for (let i = 0; i < 25; i++) {
    targets.push({ sport: "mlb", game: `Mets @ Braves ${i}`, player: `MLB ${i}` });
  }

  const result = prioritizePlayerHistoryTargets(targets, null, 40);

  assert.equal(result.length, 40, "trims to the cap");

  // Every MLB player must survive even though they were added last — MLB is the
  // only sport with batter-vs-pitcher platoon coverage, so it must not starve.
  const mlbTargets = targets.filter((t) => t.sport === "mlb");
  for (const m of mlbTargets) {
    assert.ok(
      result.some((r) => r.player === m.player),
      `MLB player "${m.player}" must survive the cap so platoon coverage is preserved`,
    );
  }

  // MLB players lead the list (tier 1 ahead of tier 0).
  const leadingMlb = result.slice(0, mlbTargets.length);
  assert.ok(
    leadingMlb.every((r) => r.sport === "mlb"),
    "MLB players are floated ahead of other sports when there's no focal game",
  );
});

test("named sport with no specific game floats that sport ahead of MLB", () => {
  const targets: Target[] = [];
  for (let i = 0; i < 50; i++) {
    targets.push({ sport: "mlb", game: `Mets @ Braves ${i}`, player: `MLB ${i}` });
  }
  for (let i = 0; i < 8; i++) {
    targets.push({ sport: "nhl", game: `Rangers @ Bruins ${i}`, player: `NHL ${i}` });
  }

  const result = prioritizePlayerHistoryTargets(targets, "any good NHL props tonight?", 40);

  const nhlTargets = targets.filter((t) => t.sport === "nhl");
  for (const n of nhlTargets) {
    assert.ok(
      result.some((r) => r.player === n.player),
      `named-sport NHL player "${n.player}" must survive the cap`,
    );
  }
  const leadingNhl = result.slice(0, nhlTargets.length);
  assert.ok(
    leadingNhl.every((r) => r.sport === "nhl"),
    "named sport floats ahead of MLB",
  );
});

test("stable within a tier: original order preserved among equal-rank targets", () => {
  const targets: Target[] = [
    { sport: "nba", game: "A @ B", player: "first" },
    { sport: "nba", game: "C @ D", player: "second" },
    { sport: "nba", game: "E @ F", player: "third" },
  ];
  const result = prioritizePlayerHistoryTargets(targets, null, 40);
  assert.deepEqual(
    result.map((r) => r.player),
    ["first", "second", "third"],
  );
});

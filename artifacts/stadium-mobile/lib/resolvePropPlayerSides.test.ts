import assert from "node:assert/strict";
import test from "node:test";

import { resolvePropPlayerSides } from "./resolvePropPlayerSides.ts";

test("resolves from full player team name without game-log history", () => {
  const r = resolvePropPlayerSides({
    awayName: "Chicago White Sox",
    homeName: "Houston Astros",
    playerTeam: "Chicago White Sox",
  });
  assert.equal(r.teamName, "Chicago White Sox");
  assert.equal(r.oppName, "Houston Astros");
});

test("resolves from CHW abbr against White Sox @ Astros", () => {
  const r = resolvePropPlayerSides({
    awayName: "Chicago White Sox",
    homeName: "Houston Astros",
    teamAbbr: "CHW",
  });
  assert.equal(r.teamName, "Chicago White Sox");
  assert.equal(r.oppName, "Houston Astros");
});

test("resolves from HOU abbr when player is home", () => {
  const r = resolvePropPlayerSides({
    awayName: "Chicago White Sox",
    homeName: "Houston Astros",
    teamAbbr: "HOU",
  });
  assert.equal(r.teamName, "Houston Astros");
  assert.equal(r.oppName, "Chicago White Sox");
});

test("game-log opponents fall back with teamNameMatches (not sox nick collision)", () => {
  const r = resolvePropPlayerSides({
    awayName: "Boston Red Sox",
    homeName: "New York Yankees",
    recentOpponents: ["Yankees", "Rays", "Blue Jays"],
  });
  assert.equal(r.teamName, "Boston Red Sox");
  assert.equal(r.oppName, "New York Yankees");
});

test("ambiguous / missing identity stays undefined (never guesses)", () => {
  const r = resolvePropPlayerSides({
    awayName: "Chicago White Sox",
    homeName: "Houston Astros",
  });
  assert.equal(r.teamName, undefined);
  assert.equal(r.oppName, undefined);
});

/**
 * Incident-derived: greenfield 0/5 missing_sim when MLB abbr picks
 * (TB ML / CLE +1.5) failed cover-query bind → empty slate draws / ALL_NULL.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildGameCoverQuery,
  gameSimHitForPick,
} from "./gameSimScoring.ts";
import { coachTeamNickname } from "./coachTeamIdResolve.ts";

test("incident-derived: MLB abbr ML/spread bind onto Rays @ Guardians", () => {
  const ml = buildGameCoverQuery({
    game: "Tampa Bay Rays @ Cleveland Guardians",
    market: "Moneyline",
    pick: "TB ML",
    odds: -110,
    isProp: false,
    sport: "mlb",
  });
  assert.ok(ml);
  assert.equal(ml!.kind, "ml");
  assert.equal(ml!.teamSide, "away");

  const spread = buildGameCoverQuery({
    game: "Rays @ Guardians",
    market: "Spread",
    pick: "CLE +1.5",
    odds: -110,
    isProp: false,
    sport: "mlb",
  });
  assert.ok(spread);
  assert.equal(spread!.kind, "spread");
  assert.equal(spread!.teamSide, "home");
  assert.equal(spread!.line, 1.5);
});

test("incident-derived: abbr ML grades from win probs when cover map empty", () => {
  const sim = {
    sport: "mlb",
    simulations: 10_000,
    homeWinProbability: 0.55,
    awayWinProbability: 0.45,
    tieProbability: 0,
    homeProjectedScore: 4,
    awayProjectedScore: 3.5,
    mostLikelyWinner: "home" as const,
    mostLikelyWinnerPct: 0.55,
    confidenceScore: 50,
    engineVersion: "sport-sim-v1",
  };
  const hit = gameSimHitForPick(
    {
      game: "Tampa Bay Rays @ Cleveland Guardians",
      market: "Moneyline",
      pick: "TB ML",
      odds: -110,
      isProp: false,
      sport: "mlb",
    },
    sim,
  );
  assert.equal(hit, 0.45);
});

test("incident-derived: MLB sport-aware nick TB→rays (NFL keeps bay)", () => {
  assert.equal(coachTeamNickname("TB", "mlb"), "rays");
  assert.equal(coachTeamNickname("tampa bay", "mlb"), "rays");
  assert.equal(coachTeamNickname("Tampa Bay Rays", "mlb"), "rays");
  assert.equal(coachTeamNickname("TB", "nfl"), "bay");
  assert.equal(coachTeamNickname("Tampa Bay Buccaneers", "nfl"), "buccaneers");
});

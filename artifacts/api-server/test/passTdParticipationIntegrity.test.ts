import assert from "node:assert/strict";
import { test } from "node:test";

import {
  diagnosePropSimNullReason,
  gameHasParticipationForMarket,
  isPassTdCountMarket,
  simulateProp,
  type GameSimContext,
  type PlayerHistoryShape,
} from "../src/lib/monteCarloBuild.ts";

const emptyGame: GameSimContext = {
  sport: "nfl",
  playerHistories: new Map(),
};

function historyFrom(
  rows: Array<{ passingTouchdowns: number; passingAttempts: number }>,
): PlayerHistoryShape {
  return {
    labels: ["passingTouchdowns", "passingAttempts"],
    recent: rows.map((r) => ({
      stats: {
        passingTouchdowns: String(r.passingTouchdowns),
        passingAttempts: String(r.passingAttempts),
      },
    })),
    vsOpponent: [],
  };
}

test("isPassTdCountMarket: pass_tds yes, anytime_td no", () => {
  assert.equal(isPassTdCountMarket("player_pass_tds"), true);
  assert.equal(isPassTdCountMarket("player_pass_tds_alternate"), true);
  assert.equal(isPassTdCountMarket("player_anytime_td"), false);
});

test("gameHasParticipationForMarket: pass TDs require ≥5 attempts", () => {
  assert.equal(
    gameHasParticipationForMarket("player_pass_tds", {
      passingAttempts: "4",
      passingTouchdowns: "0",
    }),
    false,
  );
  assert.equal(
    gameHasParticipationForMarket("player_pass_tds", {
      passingAttempts: "18",
      passingTouchdowns: "0",
    }),
    true,
  );
});

test("T6 Bagent: backup-sized attempts → unreliable / null sim", () => {
  const hist = historyFrom([
    { passingTouchdowns: 0, passingAttempts: 4 },
    { passingTouchdowns: 0, passingAttempts: 0 },
    { passingTouchdowns: 0, passingAttempts: 0 },
  ]);
  const req = {
    player: "Tyson Bagent",
    market: "player_pass_tds",
    line: 1.5,
    side: "Under" as const,
    athleteId: "4434153",
    sport: "nfl",
  };
  assert.equal(diagnosePropSimNullReason(req, hist), "unreliable_participation_history");
  const result = simulateProp(req, hist, emptyGame, 2000);
  assert.equal(result.hitProbability, null);
  assert.equal(result.nullReason, "unreliable_participation_history");
});

test("T7 legitimate starter Under 1.5 still grades (extreme OK)", () => {
  const hist = historyFrom([
    { passingTouchdowns: 0, passingAttempts: 28 },
    { passingTouchdowns: 1, passingAttempts: 32 },
    { passingTouchdowns: 0, passingAttempts: 25 },
    { passingTouchdowns: 0, passingAttempts: 30 },
    { passingTouchdowns: 1, passingAttempts: 27 },
  ]);
  const req = {
    player: "Starter QB",
    market: "player_pass_tds",
    line: 1.5,
    side: "Under" as const,
    athleteId: "1",
    sport: "nfl",
  };
  const result = simulateProp(req, hist, emptyGame, 3000);
  assert.ok(result.hitProbability != null, "starter participation must remain gradeable");
  assert.ok(result.hitProbability! > 0.5);
  assert.ok((result.validParticipatingGames ?? 0) >= 5);
});

test("yardage participation: rush needs ≥1 attempt", () => {
  assert.equal(
    gameHasParticipationForMarket("player_rush_yds", { rushingAttempts: "0", rushingYards: "0" }),
    false,
  );
  assert.equal(
    gameHasParticipationForMarket("player_rush_yds", { rushingAttempts: "2", rushingYards: "7" }),
    true,
  );
});

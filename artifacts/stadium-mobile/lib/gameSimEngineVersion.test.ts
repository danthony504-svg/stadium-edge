import assert from "node:assert/strict";
import test from "node:test";
import { gameSimHitForPick } from "./gameSimScoring.ts";
import { gameDrawEngineAccepted, slateSnapshotEngineAccepted } from "./gameSimEngineVersion.ts";

const pick = {
  game: "Away @ Home",
  market: "Moneyline",
  pick: "Home",
  odds: -110,
  isProp: false,
  sport: "nfl",
};

const draw = {
  sport: "nfl",
  simulations: 100,
  homeWinProbability: 0.6,
  awayWinProbability: 0.4,
  tieProbability: 0,
  mostLikelyWinner: "home" as const,
  mostLikelyWinnerPct: 0.6,
  confidenceScore: 60,
};

test("an NFL draw without engineVersion is not graded", () => {
  assert.equal(gameDrawEngineAccepted(draw, "nfl"), false);
  assert.equal(gameSimHitForPick(pick, draw), null);
});

test("a mismatched football stamp is not graded", () => {
  const stamped = { ...draw, engineVersion: "sport-sim-v1" };
  assert.equal(gameDrawEngineAccepted(stamped, "nfl"), false);
  assert.equal(gameSimHitForPick(pick, stamped), null);
});

test("ppg-per-drive-v1.1 is the football stamp and sport-sim-v1 is the other stamp", () => {
  assert.equal(gameDrawEngineAccepted({ ...draw, engineVersion: "ppg-per-drive-v1.1" }, "nfl"), true);
  assert.equal(
    gameDrawEngineAccepted({ sport: "nba", engineVersion: "sport-sim-v1" }, "nba"),
    true,
  );
  assert.equal(gameDrawEngineAccepted({ sport: "nba", engineVersion: "ppg-per-drive-v1.1" }, "nba"), false);
});

test("hydration rejects a fingerprint prefix that has no writer stamp or a bad draw", () => {
  const base = {
    fingerprint: "ppg-per-drive-v1.1:1:0:::",
    boardScan: {
      gameSimulations: {
        "A @ B": { sport: "nfl", engineVersion: "ppg-per-drive-v1.1" },
      },
    },
    tickets: {
      global: {
        "3": {
          gameSimulations: {
            "C @ D": { sport: "nba", engineVersion: "sport-sim-v1" },
          },
        },
      },
    },
  };
  assert.equal(slateSnapshotEngineAccepted(base), false);
  assert.equal(slateSnapshotEngineAccepted({ ...base, simEngineStamp: "ppg-per-drive-v1.1" }), true);
  const unstamped = {
    ...base,
    simEngineStamp: "ppg-per-drive-v1.1",
    boardScan: { gameSimulations: { "A @ B": { sport: "nfl" } } },
  };
  assert.equal(slateSnapshotEngineAccepted(unstamped), false);
  const wrongFootball = {
    ...base,
    simEngineStamp: "ppg-per-drive-v1.1",
    boardScan: {
      gameSimulations: { "A @ B": { sport: "nfl", engineVersion: "sport-sim-v1" } },
    },
  };
  assert.equal(slateSnapshotEngineAccepted(wrongFootball), false);
  const roundTrip = JSON.parse(
    JSON.stringify({ ...base, simEngineStamp: "ppg-per-drive-v1.1" }),
  );
  assert.equal(slateSnapshotEngineAccepted(roundTrip), true);
  assert.equal(roundTrip.boardScan.gameSimulations["A @ B"].engineVersion, "ppg-per-drive-v1.1");
});

import assert from "node:assert/strict";
import { test } from "node:test";

import type { ParsedPick } from "../components/PickCard.tsx";
import { explainBoardLegQualification } from "./boardLegQualification.ts";
import {
  isUnsupportedQbRushOverHalf,
  propIntegrityBlocksCandidate,
  yardageTicketSampleFails,
  YARDS_TICKET_MIN_PARTICIPATING_GAMES,
} from "./coachPropIntegrityGates.ts";

function score(overrides: Record<string, unknown> = {}) {
  return {
    composite: 7.2,
    grade: "B",
    confidencePct: 58,
    edgePct: 4.2,
    simHit: 0.58,
    simAligned: true,
    highRiskValuePlay: false,
    recommends: true,
    factors: [],
    rubric: {
      composite: 7.2,
      grade: "B",
      confidencePct: 58,
      edgePct: 4.2,
      scores: {} as never,
    },
    ...overrides,
  };
}

test("T8 Goff: QB rush Over ≤0.5 blocked; higher QB and RB Over 0.5 ok", () => {
  assert.equal(
    isUnsupportedQbRushOverHalf({
      sport: "nfl",
      isProp: true,
      propMarketKey: "player_rush_yds",
      propSide: "Over",
      propLine: 0.5,
      position: "QB",
    }),
    true,
  );
  assert.equal(
    isUnsupportedQbRushOverHalf({
      sport: "nfl",
      isProp: true,
      propMarketKey: "player_rush_yds",
      propSide: "Over",
      propLine: 15.5,
      position: "QB",
    }),
    false,
  );
  assert.equal(
    isUnsupportedQbRushOverHalf({
      sport: "nfl",
      isProp: true,
      propMarketKey: "player_rush_yds",
      propSide: "Over",
      propLine: 0.5,
      position: "RB",
    }),
    false,
  );
  assert.equal(
    isUnsupportedQbRushOverHalf({
      sport: "nfl",
      isProp: true,
      propMarketKey: "player_rush_yds",
      propSide: "Under",
      propLine: 0.5,
      position: "QB",
    }),
    false,
  );
  // Unknown position: do not blanket-block.
  assert.equal(
    isUnsupportedQbRushOverHalf({
      sport: "nfl",
      isProp: true,
      propMarketKey: "player_rush_yds",
      propSide: "Over",
      propLine: 0.5,
      position: null,
    }),
    false,
  );
});

test("T8 Goff: board qualification rejects QB rush Over 0.5", () => {
  const pick: ParsedPick = {
    game: "Detroit Lions @ Kansas City Chiefs",
    market: "Rush Yds",
    pick: "Jared Goff Over 0.5 Rush Yds",
    odds: -130,
    sport: "nfl",
    isProp: true,
    player: "Jared Goff",
    propLine: 0.5,
    propSide: "Over",
    propMarketKey: "player_rush_yds",
    position: "QB",
  };
  const q = explainBoardLegQualification(pick, score({ simHit: 0.84, edgePct: 20 }));
  assert.equal(q.qualifies, false);
  assert.equal(q.gate, "unsupported_settlement_model");
});

test("T9 Harvey: yards sample <5 fails; =5 does not fail sample gate", () => {
  assert.equal(YARDS_TICKET_MIN_PARTICIPATING_GAMES, 5);
  assert.equal(
    yardageTicketSampleFails({
      isProp: true,
      propMarketKey: "player_reception_yds",
      validParticipatingGames: 3,
    }),
    true,
  );
  assert.equal(
    yardageTicketSampleFails({
      isProp: true,
      propMarketKey: "player_reception_yds",
      validParticipatingGames: 5,
    }),
    false,
  );
  const thin: ParsedPick = {
    game: "Denver Broncos @ New York Jets",
    market: "Rec Yds",
    pick: "RJ Harvey Over 26.5 Rec Yds",
    odds: -115,
    sport: "nfl",
    isProp: true,
    player: "RJ Harvey",
    propLine: 26.5,
    propSide: "Over",
    propMarketKey: "player_reception_yds",
    validParticipatingGames: 3,
    sampleGames: 3,
  };
  const q = explainBoardLegQualification(thin, score({ simHit: 0.71 }));
  assert.equal(q.qualifies, false);
  assert.equal(q.gate, "insufficient_yardage_sample");
});

test("T11: NCAAF reception yards uses min-5; NBA points unaffected", () => {
  assert.equal(
    yardageTicketSampleFails({
      isProp: true,
      propMarketKey: "player_reception_yds",
      validParticipatingGames: 4,
    }),
    true,
  );
  assert.equal(
    propIntegrityBlocksCandidate({
      game: "A @ B",
      market: "Points",
      pick: "Player Over 24.5 Points",
      odds: -110,
      sport: "nba",
      isProp: true,
      propMarketKey: "player_points",
      propSide: "Over",
      propLine: 24.5,
      sampleGames: 3,
      validParticipatingGames: 3,
    }).blocked,
    false,
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  dedupeServerCoachGameLinePicks,
  enforceServerConsistentGameSides,
} from "../src/lib/coachSlateGameSideConsistency.js";
import type { CoachGameSimEntry, ParsedPick } from "../src/lib/coachSlateTypes.js";

function mlPick(team: string, game: string, odds: number, score = 60): ParsedPick {
  return {
    game,
    market: "Moneyline",
    pick: `${team} ML`,
    odds,
    finalAiScore: { composite: score },
  };
}

test("enforceServerConsistentGameSides drops Spain ML and France ML on same game", () => {
  // France has higher composite — keep France even without relying on win-prob alone.
  const picks = [
    mlPick("Spain", "Spain @ France", 238, 53),
    mlPick("France", "Spain @ France", 135, 55),
  ];
  const kept = enforceServerConsistentGameSides(picks, {
    simByGame: new Map<string, CoachGameSimEntry>([
      [
        "Spain @ France",
        { winProbHome: 0.58, winProbAway: 0.42 },
      ],
    ]),
  });
  assert.equal(kept.length, 1);
  assert.match(kept[0]!.pick, /France/i);
});

test("enforceServerConsistentGameSides keeps underdog with better Final AI over win-prob favorite", () => {
  const game = "Detroit Lions @ Kansas City Chiefs";
  const picks: ParsedPick[] = [
    {
      game,
      market: "Spread",
      pick: "Chiefs -6.5",
      odds: -110,
      sport: "nfl",
      finalAiScore: { composite: 6.6, edgePct: 0.3, simHit: 0.5 },
    },
    {
      game,
      market: "Spread",
      pick: "Lions +6.5",
      odds: -110,
      sport: "nfl",
      finalAiScore: { composite: 8.1, edgePct: 3.8, simHit: 0.57 },
    },
  ];
  const kept = enforceServerConsistentGameSides(picks, {
    simByGame: new Map<string, CoachGameSimEntry>([
      [
        game,
        {
          winProbHome: 0.63,
          winProbAway: 0.37,
          coverProbs: {
            [`${game}|spread|chiefs -6.5`.toLowerCase()]: 0.5,
            [`${game}|spread|lions +6.5`.toLowerCase()]: 0.57,
          },
        },
      ],
    ]),
  });
  assert.equal(kept.length, 1);
  assert.match(kept[0]!.pick, /Lions/i);
});

test("dedupeServerCoachGameLinePicks is no-op for props-only tickets", () => {
  const picks: ParsedPick[] = [
    {
      game: "Spain @ France",
      market: "Player Points",
      pick: "Over 1.5",
      odds: -110,
      isProp: true,
      player: "Pedri",
    },
  ];
  assert.deepEqual(dedupeServerCoachGameLinePicks(picks), picks);
});

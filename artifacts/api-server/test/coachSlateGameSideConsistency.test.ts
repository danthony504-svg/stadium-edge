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

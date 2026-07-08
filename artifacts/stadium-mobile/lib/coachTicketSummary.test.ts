import assert from "node:assert/strict";
import { test } from "node:test";

import { summarizeCoachTicket } from "./coachTicketSummary.ts";

test("summarizeCoachTicket counts picks and game lines", () => {
  const picks = [
    {
      game: "A @ B",
      market: "Alt Spread",
      pick: "Team A -2",
      odds: 165,
      sport: "mlb",
      isProp: false,
      finalAiScore: {
        grade: "B+",
        confidencePct: 58,
        edgePct: 3.2,
        simHit: 0.51,
        composite: 7,
      },
    },
    {
      game: "C @ D",
      market: "Points",
      pick: "Player Over 25.5",
      odds: -110,
      sport: "nba",
      isProp: true,
      finalAiScore: {
        grade: "A-",
        confidencePct: 62,
        edgePct: 4,
        simHit: 0.55,
        composite: 8,
      },
    },
  ];

  const s = summarizeCoachTicket(picks);
  assert.equal(s.pickCount, 2);
  assert.equal(s.gameLineCount, 1);
  assert.equal(s.simulations, 10_000);
  assert.equal(s.avgConfidence, 60);
  assert.equal(s.gameLines.length, 1);
  assert.equal(s.gameLines[0].grade, "B+");
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { dedupeTicketGameLines, summarizeCoachTicket } from "./coachTicketSummary.ts";

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
  assert.equal(s.avgConfidence, 66);
  assert.equal(s.avgEdge, 3.6);
  assert.equal(s.gameLines.length, 1);
  assert.equal(s.gameLines[0].grade, "B+");
  assert.equal(s.gameLines[0].fairOdds, -104);
});

test("dedupeTicketGameLines keeps one team-sided line per game", () => {
  const picks = [
    {
      game: "Atlanta Braves @ Pittsburgh Pirates",
      market: "Alt Spread",
      pick: "Braves -1",
      odds: 131,
      sport: "mlb",
      isProp: false,
      finalAiScore: { composite: 7, simHit: 0.5 },
    },
    {
      game: "Atlanta Braves @ Pittsburgh Pirates",
      market: "Alt Spread",
      pick: "Pirates +1",
      odds: -158,
      sport: "mlb",
      isProp: false,
      finalAiScore: { composite: 5, simHit: 0.5 },
    },
  ];

  const s = summarizeCoachTicket(picks);
  assert.equal(s.gameLineCount, 1);
  assert.equal(s.gameLines[0].pick.pick, "Braves -1");
});

test("summarizeCoachTicket aligns avg confidence with composite grade", () => {
  const picks = Array.from({ length: 4 }, (_, i) => ({
    game: `A${i} @ B${i}`,
    market: "Spread",
    pick: `Team ${i}`,
    odds: -110,
    sport: "mlb",
    isProp: false,
    finalAiScore: {
      grade: "C+",
      confidencePct: 33,
      edgePct: 2,
      simHit: 0.54,
      composite: 6.2,
    },
  }));
  const s = summarizeCoachTicket(picks);
  assert.equal(s.overallGrade, "C+");
  assert.ok((s.avgConfidence ?? 0) >= 52, `expected C+ aligned confidence, got ${s.avgConfidence}`);
});

test("summarizeCoachTicket omits blank avg stats", () => {
  const s = summarizeCoachTicket([
    {
      game: "A @ B",
      market: "Points",
      pick: "Player Over 1.5",
      odds: 120,
      sport: "mlb",
      isProp: true,
    },
  ]);
  assert.equal(s.avgConfidence, null);
  assert.equal(s.avgEdge, null);
  assert.equal(s.overallGrade, null);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  assertFrozenTicketConsistency,
  buildFrozenGameLineSummaryNote,
  frozenGameLineHeader,
  frozenLegSurfaceLabels,
  parseFrozenSummaryGamePicks,
} from "./frozenGameLineConsistency.ts";

const GAMES = [
  "Indiana Fever @ Las Vegas Aces",
  "Boston Red Sox @ Los Angeles Angels",
  "New York Yankees @ Tampa Bay Rays",
  "San Diego Padres @ Los Angeles Dodgers",
  "Philadelphia Phillies @ Kansas City Royals",
];

const PICKS = [
  "Fever +1.5",
  "Angels +1.5",
  "Rays +1.5",
  "Dodgers -2",
  "Royals +2.5",
];

type MockPick = Parameters<typeof buildFrozenGameLineSummaryNote>[0][number];

function mockFrozenGameLine(gameIdx: number, pickLabel: string, rng: () => number): MockPick {
  const game = GAMES[gameIdx % GAMES.length]!;
  const simHit = 0.5 + rng() * 0.15;
  const edge = 1 + rng() * 8;
  const ev = edge + rng() * 3;
  return {
    game,
    market: rng() > 0.5 ? "Spread" : "Alt Spread",
    pick: pickLabel,
    odds: -110 + Math.floor(rng() * 250),
    isProp: false,
    gameLineFrozen: true,
    finalAiScore: {
      composite: 6,
      grade: "B+",
      confidencePct: 55,
      edgePct: edge,
      simHit,
      simAligned: simHit >= 0.52,
      highRiskValuePlay: false,
      recommends: true,
      factors: [],
      rubric: { scores: {}, composite: 6, grade: "B+", confidencePct: 55, edgePct: edge },
    },
    gameLineFinal: {
      reason: "fuzz",
      finalScore: 6,
      frozenAt: 1,
      display: {
        pick: pickLabel,
        market: "Alt Spread",
        odds: 115,
        game,
        grade: "B+",
        confidencePct: 55,
        edgePct: edge,
        evPct: ev,
        simHit,
        simPct: Math.round(simHit * 100),
      },
      bullets: ["fuzz"],
    },
  };
}

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("3000 random frozen parlays keep summary, cards, slip, and breakdown aligned", () => {
  const rng = mulberry32(0xdecafbad);
  for (let n = 0; n < 3000; n++) {
    const legCount = 1 + Math.floor(rng() * 5);
    const gameIdxs = new Set<number>();
    while (gameIdxs.size < legCount) {
      gameIdxs.add(Math.floor(rng() * GAMES.length));
    }
    const picks: MockPick[] = [];
    for (const gi of gameIdxs) {
      picks.push(mockFrozenGameLine(gi, PICKS[gi]!, rng));
    }

    const summary = buildFrozenGameLineSummaryNote(picks);
    assertFrozenTicketConsistency(picks, summary);

    for (const pick of picks) {
      const header = frozenGameLineHeader(pick);
      const surfaces = frozenLegSurfaceLabels(pick);
      assert.equal(surfaces.card, surfaces.slip);
      assert.equal(surfaces.breakdown, surfaces.share);
      if (summary) {
        const parsed = parseFrozenSummaryGamePicks(summary);
        const key = header.game
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        const summaryPick = parsed.get(key);
        if (summaryPick != null) {
          assert.equal(summaryPick, header.pick.toLowerCase().replace(/\s+/g, " ").trim());
        }
      }
    }
  }
});

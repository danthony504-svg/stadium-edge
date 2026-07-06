import assert from "node:assert/strict";
import test from "node:test";
import {
  assertFrozenGameLineSummaryClean,
  assertFrozenTicketConsistency,
  buildFrozenGameLineSummaryNote,
  frozenGameLineHeader,
  frozenLegSurfaceLabels,
  parseFrozenSummaryGamePicks,
  validateFrozenTicketForRender,
} from "./frozenGameLineConsistency.ts";

const GAMES = [
  "Indiana Fever @ Las Vegas Aces",
  "Boston Red Sox @ Los Angeles Angels",
  "New York Yankees @ Tampa Bay Rays",
  "San Diego Padres @ Los Angeles Dodgers",
  "Philadelphia Phillies @ Kansas City Royals",
  "Houston Astros @ Washington Nationals",
  "New York Mets @ Atlanta Braves",
  "Chicago Cubs @ Milwaukee Brewers",
];

const PICKS = [
  "Fever +1.5",
  "Angels +1.5",
  "Rays +1.5",
  "Dodgers -2",
  "Royals +2.5",
  "Nationals -1.5",
  "Braves -1.5",
  "Cubs +1.5",
];

type MockPick = Parameters<typeof buildFrozenGameLineSummaryNote>[0][number];

function mockFrozenGameLine(gameIdx: number, pickLabel: string, rng: () => number): MockPick {
  const game = GAMES[gameIdx % GAMES.length]!;
  const simHit = 0.52 + rng() * 0.12;
  const edge = 3 + rng() * 6;
  const ev = edge + rng() * 3;
  const confidence = 50 + Math.floor(rng() * 20);
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
      confidencePct: confidence,
      edgePct: edge,
      simHit,
      simAligned: simHit >= 0.52,
      highRiskValuePlay: false,
      recommends: true,
      factors: [],
      rubric: {
        scores: {},
        composite: 6,
        grade: "B+",
        confidencePct: confidence,
        edgePct: edge,
      },
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
        confidencePct: confidence,
        edgePct: edge,
        evPct: ev,
        simHit,
        simPct: Math.round(simHit * 100),
      },
      bullets: ["fuzz"],
    },
  };
}

function mockProp(gameIdx: number, rng: () => number): MockPick {
  const game = GAMES[gameIdx % GAMES.length]!;
  const simHit = 0.52 + rng() * 0.12;
  const edge = 1 + rng() * 6;
  return {
    game,
    market: "Player Prop",
    pick: "Over 24.5 Points",
    odds: -115 + Math.floor(rng() * 80),
    isProp: true,
    player: `Player ${gameIdx}`,
    propLine: 24.5,
    propSide: "over",
    finalAiScore: {
      composite: 6.5,
      grade: "B",
      confidencePct: 55,
      edgePct: edge,
      simHit,
      simAligned: true,
      highRiskValuePlay: false,
      recommends: true,
      factors: [],
      rubric: { scores: {}, composite: 6.5, grade: "B", confidencePct: 55, edgePct: edge },
    },
    scores: { scores: {}, composite: 6.5, grade: "B", confidencePct: 55, edgePct: edge },
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

function normGameKey(game: string): string {
  return game
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function assertTicketSurfacesAligned(picks: MockPick[], summary: string): void {
  if (summary) assertFrozenGameLineSummaryClean(summary);
  validateFrozenTicketForRender(picks, summary || undefined);
  assertFrozenTicketConsistency(picks, summary);

  for (const pick of picks) {
    if (pick.isProp) continue;
    const header = frozenGameLineHeader(pick);
    const surfaces = frozenLegSurfaceLabels(pick);
    assert.equal(surfaces.card, surfaces.slip);
    assert.equal(surfaces.card, surfaces.breakdown);
    assert.equal(surfaces.card, surfaces.share);
    if (summary) {
      const parsed = parseFrozenSummaryGamePicks(summary);
      const key = normGameKey(header.game);
      const summaryPick = parsed.get(key);
      if (summaryPick != null) {
        assert.equal(summaryPick, header.pick.toLowerCase().replace(/\s+/g, " ").trim());
      }
    }
  }
}

function randomMixedTicket(legCount: number, rng: () => number): MockPick[] {
  const picks: MockPick[] = [];
  const gameLineGames = new Set<number>();
  let guard = 0;
  while (picks.length < legCount && guard++ < legCount * 20) {
    const gi = Math.floor(rng() * GAMES.length);
    const wantGameLine = rng() > 0.45 && gameLineGames.size < GAMES.length;
    if (wantGameLine && !gameLineGames.has(gi)) {
      gameLineGames.add(gi);
      picks.push(mockFrozenGameLine(gi, PICKS[gi % PICKS.length]!, rng));
      continue;
    }
    picks.push(mockProp(gi, rng));
  }
  return picks;
}

const TARGET_LEG_COUNTS = [6, 8, 9, 12, 15] as const;

for (const legCount of TARGET_LEG_COUNTS) {
  test(`${legCount}-leg mixed parlays keep summary, cards, slip, and breakdown aligned (${200} cases)`, () => {
    const rng = mulberry32(0xfeed0000 + legCount);
    for (let n = 0; n < 200; n++) {
      const picks = randomMixedTicket(legCount, rng);
      const summary = buildFrozenGameLineSummaryNote(picks);
      assertTicketSurfacesAligned(picks, summary);
    }
  });
}

test("3000 random frozen game-line parlays keep every surface aligned", () => {
  const rng = mulberry32(0xdecafbad);
  for (let n = 0; n < 3000; n++) {
    const legCount = 1 + Math.floor(rng() * 5);
    const gameIdxs = new Set<number>();
    while (gameIdxs.size < legCount) {
      gameIdxs.add(Math.floor(rng() * GAMES.length));
    }
    const picks: MockPick[] = [];
    for (const gi of gameIdxs) {
      picks.push(mockFrozenGameLine(gi, PICKS[gi % PICKS.length]!, rng));
    }

    const summary = buildFrozenGameLineSummaryNote(picks);
    assertTicketSurfacesAligned(picks, summary);
  }
});

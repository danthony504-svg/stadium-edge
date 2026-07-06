import assert from "node:assert/strict";
import test from "node:test";
import {
  assertProductionCoachTicketIntegrity,
  buildFrozenGameLineSummaryNote,
  frozenGameLineHeader,
  frozenLegSurfaceLabels,
  parseFrozenSummaryGamePicks,
  textHasPlaceholderGameLineMetrics,
} from "./frozenGameLineConsistency.ts";
import { assertGameLineProductionMetadataComplete } from "./gameLineFrozenQual.ts";
import type { ParsedPick } from "../components/PickCard.tsx";

const GAMES = [
  "Indiana Fever @ Las Vegas Aces",
  "Boston Red Sox @ Los Angeles Angels",
  "New York Yankees @ Tampa Bay Rays",
  "San Diego Padres @ Los Angeles Dodgers",
  "Philadelphia Phillies @ Kansas City Royals",
  "Houston Astros @ Washington Nationals",
  "New York Mets @ Atlanta Braves",
  "Chicago Cubs @ Milwaukee Brewers",
  "Seattle Mariners @ Texas Rangers",
  "Toronto Blue Jays @ Baltimore Orioles",
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
  "Mariners -1.5",
  "Blue Jays +2",
];

type MockPick = ParsedPick;

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

function mockFrozenGameLine(gameIdx: number, pickLabel: string, rng: () => number): MockPick {
  const game = GAMES[gameIdx % GAMES.length]!;
  const simHit = 0.5 + rng() * 0.14;
  const edge = simHit < 0.5 ? 4.5 + rng() * 4 : 3 + rng() * 6;
  const ev = edge + rng() * 3;
  const confidence = 50 + Math.floor(rng() * 20);
  const oddsRaw = -200 + Math.floor(rng() * 380);
  const odds = oddsRaw === 0 ? -110 : oddsRaw;
  const market = rng() > 0.5 ? "Spread" : "Alt Spread";
  return {
    game,
    market,
    pick: pickLabel,
    odds,
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
        market,
        odds,
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

function randomCoachTicket(legCount: number, rng: () => number): MockPick[] {
  const picks: MockPick[] = [];
  const gameLineGames = new Set<number>();
  let guard = 0;
  while (picks.length < legCount && guard++ < legCount * 30) {
    const gi = Math.floor(rng() * GAMES.length);
    const wantGameLine = rng() > 0.4 && gameLineGames.size < GAMES.length;
    if (wantGameLine && !gameLineGames.has(gi)) {
      gameLineGames.add(gi);
      picks.push(mockFrozenGameLine(gi, PICKS[gi % PICKS.length]!, rng));
      continue;
    }
    picks.push(mockProp(gi, rng));
  }
  return picks;
}

function assertProductionTicketIntegrity(picks: MockPick[]): void {
  const canonical = assertProductionCoachTicketIntegrity(picks, undefined);
  const summary = buildFrozenGameLineSummaryNote(canonical);
  const hasGameLines = canonical.some((p) => !p.isProp && p.gameLineFinal?.frozenAt != null);

  if (hasGameLines) {
    assert.ok(summary.trim(), "game-line ticket must have frozen summary");
    assert.equal(textHasPlaceholderGameLineMetrics(summary), false);
    assertProductionCoachTicketIntegrity(canonical, summary);
    assert.equal(summary.trim(), buildFrozenGameLineSummaryNote(canonical).trim());
  }

  const summaryPicks = parseFrozenSummaryGamePicks(summary);
  const seenGames = new Set<string>();

  for (const pick of canonical) {
    if (pick.isProp) continue;
    assertGameLineProductionMetadataComplete(pick);

    const header = frozenGameLineHeader(pick);
    const surfaces = frozenLegSurfaceLabels(pick);
    assert.equal(surfaces.card, surfaces.slip, "card must match slip");
    assert.equal(surfaces.card, surfaces.breakdown, "card must match breakdown");
    assert.equal(surfaces.card, surfaces.share, "card must match share");

    const gameKey = normGameKey(header.game);
    assert.ok(!seenGames.has(gameKey), `duplicate game ${header.game}`);
    seenGames.add(gameKey);

    const summaryPick = summaryPicks.get(gameKey);
    assert.ok(summaryPick, `summary missing ${header.game}`);
    assert.equal(
      summaryPick,
      header.pick.toLowerCase().replace(/\s+/g, " ").trim(),
      "summary pick must match card",
    );
    assert.ok(header.market.trim(), "market required");
    assert.ok(Number.isFinite(header.odds) && header.odds !== 0, "odds required");
  }
}

test("10,000 AI Coach tickets: summary == cards == slip, no placeholders, complete metadata", () => {
  const rng = mulberry32(0xc0acf00d);
  for (let n = 0; n < 10_000; n++) {
    const legCount = 1 + Math.floor(rng() * 15);
    const picks = randomCoachTicket(legCount, rng);
    assertProductionTicketIntegrity(picks);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { reachSelectQualifiedToTarget } from "./parlaySelectReach.ts";
import type { ParsedPick } from "../components/PickCard.tsx";

function qualifiedGameLine(overrides: Partial<ParsedPick> = {}): ParsedPick {
  const game = overrides.game ?? "A @ B";
  const pick = overrides.pick ?? "A +1.5";
  const market = overrides.market ?? "Spread";
  const odds = overrides.odds ?? -110;
  return {
    game,
    market,
    pick,
    odds,
    isProp: false,
    sport: "mlb",
    gameLineFrozen: true,
    gameLineFinal: {
      reason: "test",
      finalScore: 6.5,
      frozenAt: 1,
      isBestEv: true,
      display: {
        pick: String(pick),
        market: String(market),
        odds: Number(odds),
        game: String(game),
        grade: "B+",
        confidencePct: 62,
        edgePct: 2.1,
        evPct: 3.2,
        simHit: 0.55,
        simPct: 55,
      },
    },
    finalAiScore: {
      grade: "B+",
      simHit: 0.55,
      edgePct: 2.1,
      confidencePct: 62,
      composite: 7.5,
      simAligned: true,
      highRiskValuePlay: false,
      recommends: true,
      factors: [],
      rubric: {
        scores: {},
        composite: 7.5,
        grade: "B+",
        confidencePct: 62,
        edgePct: 2.1,
      },
    },
    scores: {
      scores: {},
      composite: 7.5,
      grade: "B+",
      confidencePct: 62,
      edgePct: 2.1,
    },
    ...overrides,
  };
}

function qualifiedProp(
  player: string,
  game: string,
  overrides: Partial<ParsedPick> = {},
): ParsedPick {
  return {
    game,
    market: "Hits",
    pick: `${player} Over 1.5 Hits`,
    odds: -110,
    isProp: true,
    player,
    teamAbbr: "bos",
    finalAiScore: {
      grade: "B+",
      simHit: 0.55,
      edgePct: 2.1,
      confidencePct: 62,
      composite: 7.5,
      simAligned: true,
      highRiskValuePlay: false,
      recommends: true,
      factors: [],
      rubric: {
        scores: {},
        composite: 7.5,
        grade: "B+",
        confidencePct: 62,
        edgePct: 2.1,
      },
    },
    scores: {
      scores: {},
      composite: 7.5,
      grade: "B+",
      confidencePct: 62,
      edgePct: 2.1,
    },
    ...overrides,
  };
}

test("reachSelectQualifiedToTarget fills mixed tickets to target", () => {
  const candidates: ParsedPick[] = [];
  for (let i = 0; i < 10; i++) {
    const game = `Team${i} A @ Team${i} B`;
    candidates.push(
      qualifiedGameLine({
        game,
        pick: `Team${i} A +1.5`,
      }),
      qualifiedProp(`Player ${i}`, game),
      qualifiedGameLine({
        game,
        market: "Total",
        pick: "Over 8.5",
      }),
    );
  }
  const out = reachSelectQualifiedToTarget(candidates, 12, { maxPerGame: 2, maxGameLegs: 6 });
  assert.equal(out.length, 12);
});

test("reachSelectQualifiedToTarget never adds unqualified legs", () => {
  const good = qualifiedGameLine();
  const bad = qualifiedGameLine({
    game: "C @ D",
    finalAiScore: {
      ...qualifiedGameLine().finalAiScore!,
      edgePct: -1,
      simAligned: false,
    },
  });
  const out = reachSelectQualifiedToTarget([good, bad], 2);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.game, good.game);
});

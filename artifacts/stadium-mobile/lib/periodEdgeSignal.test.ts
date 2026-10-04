/**
 * Period markets must not replace book/no-vig edge with uncalibrated
 * simHit−implied (phone: 1H +2.5 @ +110 → Edge +52.3% Grade A).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { scoreGameLinePick } from "./pickScoreContext.ts";
import type { ParsedPick } from "../components/PickCard.tsx";
import type { RealOddsEntry } from "./api.ts";
import type { CoachGameSimEntry } from "./gameSimScoring.ts";

function periodPick(overrides: Partial<ParsedPick> = {}): ParsedPick {
  return {
    game: "Indianapolis Colts @ Washington Commanders",
    market: "1H Spread",
    pick: "Commanders +2.5",
    odds: 110,
    isProp: false,
    sport: "nfl",
    ...overrides,
  };
}

test("period game-line Edge prefers book/no-vig over inflated sim hit", () => {
  const pick = periodPick();
  const realOdds: RealOddsEntry[] = [
    {
      sport: "nfl",
      game: pick.game,
      market: "1H Spread",
      pick: "Commanders +2.5",
      odds: 110,
      // Honest-ish no-vig edge for a +110 period dog — not +52%.
      edge: 3.2,
      noVigFair: 0.51,
    } as RealOddsEntry,
  ];

  const gameSim: CoachGameSimEntry = {
    sport: "nfl",
    simulations: 10_000,
    homeWinProbability: 0.55,
    awayWinProbability: 0.45,
    tieProbability: 0,
    homeProjectedScore: 24,
    awayProjectedScore: 21,
    mostLikelyWinner: "home",
    mostLikelyWinnerPct: 0.55,
    confidenceScore: 60,
    // Old cancel-draw pathology: near-certain period cover.
    coverHitRates: {
      "indianapolis colts @ washington commanders|1h spread|commanders +2.5": 1.0,
    },
  };

  const scored = scoreGameLinePick(pick, realOdds, undefined, undefined, gameSim);
  assert.ok(scored);
  // Must keep book edge (~3.2), not simEdgeFromHit(1.0, +110) ≈ +52.4.
  assert.ok(
    scored!.edgePct != null && scored!.edgePct < 15,
    `period edgePct ${scored!.edgePct} still looks like raw sim−implied`,
  );
  assert.ok(
    Math.abs((scored!.edgePct ?? 0) - 3.2) < 0.01,
    `expected book edge 3.2, got ${scored!.edgePct}`,
  );
});

test("full-game still prefers sim edge when present", () => {
  const pick = periodPick({ market: "Spread", pick: "Commanders +2.5", odds: -110 });
  const realOdds: RealOddsEntry[] = [
    {
      sport: "nfl",
      game: pick.game,
      market: "Spread",
      pick: "Commanders +2.5",
      odds: -110,
      edge: 1.5,
      noVigFair: 0.52,
    } as RealOddsEntry,
  ];
  const gameSim: CoachGameSimEntry = {
    sport: "nfl",
    simulations: 10_000,
    homeWinProbability: 0.55,
    awayWinProbability: 0.45,
    tieProbability: 0,
    homeProjectedScore: 24,
    awayProjectedScore: 21,
    mostLikelyWinner: "home",
    mostLikelyWinnerPct: 0.55,
    confidenceScore: 60,
    coverHitRates: {
      "indianapolis colts @ washington commanders|spread|commanders +2.5": 0.58,
    },
  };
  const scored = scoreGameLinePick(pick, realOdds, undefined, undefined, gameSim);
  assert.ok(scored);
  // simEdgeFromHit(0.58, -110) ≈ 5.7 — should win over book 1.5 for FG.
  assert.ok(
    (scored!.edgePct ?? 0) > 4,
    `FG should use sim edge, got ${scored!.edgePct}`,
  );
});

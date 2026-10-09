/**
 * Tennis game-handicap fail-closed: never grade match-win as cover;
 * Struff +3.5 @ +160 pathology (sim match strength vs book consensus).
 *
 * Run: node --experimental-strip-types --test lib/tennisHandicapSim.test.ts
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { ParsedPick } from "../components/PickCard.tsx";
import type { RealOddsEntry } from "./api.ts";
import { scoreGameLinePick } from "./pickScoreContext.ts";
import { gameSimHitForPick, type CoachGameSimEntry } from "./gameSimScoring.ts";
import { simEdgeFromHit } from "./gameSimQualityGates.ts";
import {
  gateTennisCoverHit,
  resolveTennisSimHit,
  tennisHandicapFailsClosed,
  tennisVerifiedCoverHit,
  TENNIS_HANDICAP_MAX_BOOK_GAP,
} from "./tennisHandicapSim.ts";

const STRUFF_GAME = "Jan-Lennard Struff @ Holger Rune";

function struffHandicap(overrides: Partial<ParsedPick> = {}): ParsedPick {
  return {
    game: STRUFF_GAME,
    market: "Spread",
    pick: "Jan-Lennard Struff +3.5",
    odds: 160,
    isProp: false,
    sport: "tennis",
    ...overrides,
  };
}

function struffSim(coverHit: number, awayWin = 0.877): CoachGameSimEntry {
  const id = `${STRUFF_GAME}|spread|jan-lennard struff +3.5`.toLowerCase();
  return {
    sport: "tennis",
    simulations: 10_000,
    homeWinProbability: 1 - awayWin,
    awayWinProbability: awayWin,
    tieProbability: 0,
    homeProjectedScore: 18,
    awayProjectedScore: 22,
    mostLikelyWinner: "away",
    mostLikelyWinnerPct: awayWin,
    confidenceScore: 70,
    coverHitRates: { [id]: coverHit },
  };
}

test("Struff +3.5 @ +160: match-win substituted as cover fails closed", () => {
  const pick = struffHandicap();
  // Exact pathology: coverHitRates holds match-win (~0.877).
  const sim = struffSim(0.877, 0.877);
  assert.equal(tennisVerifiedCoverHit(pick, sim), null, "ML substitute rejected");
  assert.equal(resolveTennisSimHit(pick, sim, null), null);
  assert.equal(gameSimHitForPick(pick, sim), null);
});

test("Struff +3.5 @ +160: inflated cover vs book price fails closed", () => {
  const pick = struffHandicap();
  // Distinct from match-win but still absurd vs +160 implied (~38.5%).
  const sim = struffSim(0.92, 0.877);
  assert.equal(tennisVerifiedCoverHit(pick, sim), 0.92);
  assert.equal(
    tennisHandicapFailsClosed(pick, 0.92, sim),
    true,
    "uncalibrated cover must fail closed",
  );
  assert.equal(resolveTennisSimHit(pick, sim, null), null);
  assert.equal(gameSimHitForPick(pick, sim), null);

  const edge = simEdgeFromHit(0.877, 160);
  assert.ok(edge != null && edge > 45, `sanity: raw ML edge was ${edge}`);
  assert.ok(
    Math.abs(0.92 - 100 / 260) > TENNIS_HANDICAP_MAX_BOOK_GAP,
    "gap exceeds calibration ceiling",
  );
});

test("Struff +3.5: sim match strength vs book ML consensus fails closed", () => {
  const pick = struffHandicap();
  // Cover looks plausible vs +160 (~0.50) but sim says 88% match-win while
  // book ML prices Struff as a dog (~+250 → 28.6%).
  const sim = struffSim(0.5, 0.877);
  const realOdds: RealOddsEntry[] = [
    {
      sport: "tennis",
      game: STRUFF_GAME,
      market: "Moneyline",
      pick: "Jan-Lennard Struff ML",
      odds: 250,
    } as RealOddsEntry,
    {
      sport: "tennis",
      game: STRUFF_GAME,
      market: "Moneyline",
      pick: "Holger Rune ML",
      odds: -300,
    } as RealOddsEntry,
    {
      sport: "tennis",
      game: STRUFF_GAME,
      market: "Spread",
      pick: "Jan-Lennard Struff +3.5",
      odds: 160,
    } as RealOddsEntry,
  ];
  assert.equal(resolveTennisSimHit(pick, sim, null, realOdds), null);
  // Scoring path must not invent a sim-backed extreme edge either.
  const scored = scoreGameLinePick(pick, realOdds, undefined, undefined, sim, undefined, undefined);
  if (scored) {
    assert.ok(
      scored.edgePct == null || scored.edgePct < 20,
      `expected fail-closed edge, got ${scored.edgePct}`,
    );
  }
});

test("calibrated tennis handicap cover still grades", () => {
  const pick = struffHandicap({ odds: -110 });
  // Cover ~58% at -110 → ~5.7pp edge — well inside calibration gap.
  const sim = struffSim(0.58, 0.55);
  const realOdds: RealOddsEntry[] = [
    {
      sport: "tennis",
      game: STRUFF_GAME,
      market: "Moneyline",
      pick: "Jan-Lennard Struff ML",
      odds: -120,
    } as RealOddsEntry,
    {
      sport: "tennis",
      game: STRUFF_GAME,
      market: "Spread",
      pick: "Jan-Lennard Struff +3.5",
      odds: -110,
    } as RealOddsEntry,
  ];
  const hit = resolveTennisSimHit(pick, sim, null, realOdds);
  assert.equal(hit, 0.58);
  assert.equal(gateTennisCoverHit(pick, 0.58, sim, realOdds), 0.58);
});

test("tennis moneyline may still use match-win probability", () => {
  const pick: ParsedPick = {
    game: STRUFF_GAME,
    market: "Moneyline",
    pick: "Jan-Lennard Struff ML",
    odds: 250,
    isProp: false,
    sport: "tennis",
  };
  const sim = struffSim(0.5, 0.42);
  const hit = resolveTennisSimHit(pick, sim, null);
  assert.equal(hit, 0.42);
});

test("missing coverHitRates fails closed for tennis handicap (no ML fallback)", () => {
  const pick = struffHandicap();
  const sim: CoachGameSimEntry = {
    sport: "tennis",
    simulations: 10_000,
    homeWinProbability: 0.6,
    awayWinProbability: 0.4,
    tieProbability: 0,
    homeProjectedScore: 20,
    awayProjectedScore: 18,
    mostLikelyWinner: "home",
    mostLikelyWinnerPct: 0.6,
    confidenceScore: 60,
    // No coverHitRates — must not fall back to awayWinProbability.
  };
  assert.equal(resolveTennisSimHit(pick, sim, null), null);
  assert.equal(gameSimHitForPick(pick, sim), null);
});

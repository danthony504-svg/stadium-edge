/**
 * Period sim must preserve FG Monte Carlo variance.
 *
 * The old algebra used homeFull * (hExp / homeFull) ≈ hExp, which cancelled
 * every draw and invented ~50% "edges" on ordinary -110/+110 period spreads
 * (phone: Commanders 1H +2.5 @ +110 → Edge +52.3%).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { periodScoresForDraw } from "./gamePeriodScoring.ts";
import {
  buildPeriodOffenseDefenseProfile,
  deriveCoverHitRatesFromOutcomes,
  fgExpectedFromPeriodAverages,
} from "./gameSimScoring.ts";
import { simEdgeFromHit } from "./gameSimQualityGates.ts";
import type { GameCoverQuery } from "./gameSimScoring.ts";

function sampleVariance(xs: number[]): number {
  const n = xs.length;
  assert.ok(n > 1);
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  return xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
}

test("fgExpectedFromPeriodAverages sums quarters or halves", () => {
  assert.equal(
    fgExpectedFromPeriodAverages({ q1: 6, q2: 7, q3: 5, q4: 6 }),
    24,
  );
  assert.equal(fgExpectedFromPeriodAverages({ h1: 12.3, h2: 11.7 }), 24);
  assert.equal(fgExpectedFromPeriodAverages({ h1: 12.3 }), null);
});

test("periodScoresForDraw with stable FG ref preserves draw variance", () => {
  const periodHomes: number[] = [];
  for (let homeFull = 14; homeFull <= 34; homeFull += 1) {
    const { home } = periodScoresForDraw("nfl", "h1", homeFull, 21, {
      homePeriodExpected: 12.3,
      awayPeriodExpected: 9.3,
      homeFgExpected: 24.6,
      awayFgExpected: 21.0,
    });
    periodHomes.push(home);
  }
  // Broken cancel-draw path variance is only ±7% noise around 12.3 (var ≲ 1).
  // Variance-preserving path scales with homeFull (14→34) → much larger spread.
  assert.ok(
    sampleVariance(periodHomes) > 4,
    `expected draw-driven variance, got ${sampleVariance(periodHomes)}`,
  );
  // Monotone-ish: higher FG draws should tend to higher period scores.
  assert.ok(periodHomes[periodHomes.length - 1]! > periodHomes[0]!);
});

test("missing FG ref falls back to flat frac (still variance-preserving)", () => {
  const a = periodScoresForDraw("nfl", "h1", 30, 20, {
    homePeriodExpected: 12,
    awayPeriodExpected: 10,
    // no homeFgExpected / awayFgExpected → flat 0.5 share
  });
  const b = periodScoresForDraw("nfl", "h1", 20, 20, {
    homePeriodExpected: 12,
    awayPeriodExpected: 10,
  });
  // Both paths keep homeFull in the product; stronger FG draw → higher period mean.
  // Allow noise: compare midpoints over a few samples.
  let sumHigh = 0;
  let sumLow = 0;
  for (let i = 0; i < 40; i++) {
    sumHigh += periodScoresForDraw("nfl", "h1", 30, 20, {
      homePeriodExpected: 12,
      awayPeriodExpected: 10,
    }).home;
    sumLow += periodScoresForDraw("nfl", "h1", 20, 20, {
      homePeriodExpected: 12,
      awayPeriodExpected: 10,
    }).home;
  }
  assert.ok(sumHigh / 40 > sumLow / 40);
  assert.ok(Number.isFinite(a.home) && Number.isFinite(b.home));
});

test("period profile cover rates do not invent ~100% hit / +50% edge on -110 spreads", () => {
  // Synthetic FG draws with real variance (not collapsed period means).
  const homeScores: number[] = [];
  const awayScores: number[] = [];
  for (let i = 0; i < 4000; i++) {
    // Independent-ish FG scoring — real games have wide period residuals.
    const u = ((i * 997) % 1000) / 1000;
    const v = ((i * 991) % 1000) / 1000;
    homeScores.push(14 + u * 22); // 14–36
    awayScores.push(12 + v * 22); // 12–34
  }

  const profile = buildPeriodOffenseDefenseProfile(
    {
      h1: { scored: 13.0, allowed: 10.0 },
      h2: { scored: 11.6, allowed: 11.0 },
      q1: { scored: 6.5, allowed: 5.0 },
      q2: { scored: 6.5, allowed: 5.0 },
      q3: { scored: 5.8, allowed: 5.5 },
      q4: { scored: 5.8, allowed: 5.5 },
    },
    {
      h1: { scored: 9.5, allowed: 12.5 },
      h2: { scored: 11.5, allowed: 12.0 },
      q1: { scored: 4.7, allowed: 6.2 },
      q2: { scored: 4.8, allowed: 6.3 },
      q3: { scored: 5.7, allowed: 6.0 },
      q4: { scored: 5.8, allowed: 6.0 },
    },
  );
  assert.ok(profile);

  const h1Query: GameCoverQuery = {
    id: "colts @ commanders|1h spread|commanders +2.5",
    kind: "spread",
    teamSide: "home",
    line: 2.5,
    period: "h1",
  };

  const fixedRates = deriveCoverHitRatesFromOutcomes(
    { homeScores, awayScores },
    [h1Query],
    "nfl",
    profile,
  );
  const fixedHit = fixedRates[h1Query.id]!;
  assert.ok(fixedHit != null);

  // Reproduce the BROKEN cancel-draw algebra on the same draws:
  // home = homeFull * (hExp/homeFull) ≈ hExp (±noise only).
  const hExp = profile.homeByPeriod.h1!;
  const aExp = profile.awayByPeriod.h1!;
  let brokenHits = 0;
  for (let i = 0; i < homeScores.length; i++) {
    const noiseH = 1 + ((((i * 13) % 100) / 100) - 0.5) * 0.14;
    const noiseA = 1 + ((((i * 17) % 100) / 100) - 0.5) * 0.14;
    const hs = hExp * noiseH;
    const as = aExp * noiseA;
    if (hs + 2.5 > as) brokenHits += 1;
  }
  const brokenHit = brokenHits / homeScores.length;

  assert.ok(
    brokenHit > 0.97,
    `sanity: broken cancel-draw path should be near-certain, got ${brokenHit}`,
  );
  // Fixed path must not collapse to deterministic ~100% cover.
  assert.ok(
    fixedHit < 0.95,
    `fixed hit ${fixedHit} must not stay near-deterministic like broken ${brokenHit}`,
  );
  assert.ok(
    fixedHit < brokenHit - 0.05,
    `fixed hit ${fixedHit} must drop below broken ${brokenHit}`,
  );
  assert.ok(fixedHit > 0.35, `fixed 1H cover hit ${fixedHit} unrealistically low`);

  const brokenEdge = simEdgeFromHit(brokenHit, 110)!;
  const fixedEdge = simEdgeFromHit(fixedHit, 110)!;
  // Phone: +52.3% from broken path (hit≈1.0 @ +110).
  assert.ok(brokenEdge > 45, `sanity: broken edge ${brokenEdge}`);
  assert.ok(
    fixedEdge < brokenEdge - 5,
    `fixed edge ${fixedEdge}% must drop below broken ${brokenEdge}%`,
  );
});

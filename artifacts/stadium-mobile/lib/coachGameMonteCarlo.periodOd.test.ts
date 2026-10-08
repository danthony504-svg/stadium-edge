/**
 * Regression: pick-supplement and board-scan must share period-OD cover re-derive.
 * Explains PR #649 Q2 +3.5 claimed 0.954 vs frac-only independent check ~0.86.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { applyPeriodOffenseDefenseCoverRates } from "./coachGameMonteCarlo.ts";
import {
  buildPeriodOffenseDefenseProfile,
  deriveCoverHitRatesFromOutcomes,
  type CoachGameSimEntry,
  type GameCoverQuery,
} from "./gameSimScoring.ts";

function synthFgOutcomes(n = 8000): { homeScores: number[]; awayScores: number[] } {
  const homeScores: number[] = [];
  const awayScores: number[] = [];
  for (let i = 0; i < n; i++) {
    // Correlated FG draws (shared total + margin) — matches game-sim structure
    // better than independent uniforms, which overstate period-OD certainty.
    const u = ((i * 997) % 1000) / 1000;
    const v = ((i * 991) % 1000) / 1000;
    const total = 48 + u * 40; // 48–88
    const margin = -20 + v * 40; // away − home ∈ [-20, +20]
    const home = Math.max(0, (total - margin) / 2);
    const away = Math.max(0, (total + margin) / 2);
    homeScores.push(home);
    awayScores.push(away);
  }
  return { homeScores, awayScores };
}

test("applyPeriodOffenseDefenseCoverRates overwrites Q2 spread when away Q2 share > home", () => {
  const outcomes = synthFgOutcomes();
  const q2: GameCoverQuery = {
    id: "tampa bay buccaneers @ dallas cowboys|q2 spread|buccaneers +3.5",
    kind: "spread",
    teamSide: "away",
    line: 3.5,
    period: "q2",
  };
  const fg: GameCoverQuery = {
    id: "tampa bay buccaneers @ dallas cowboys|alt spread|buccaneers +18.5",
    kind: "spread",
    teamSide: "away",
    line: 18.5,
  };

  const fracRates = deriveCoverHitRatesFromOutcomes(outcomes, [q2, fg], "nfl", null);
  const fracQ2 = fracRates[q2.id]!;
  const fracFg = fracRates[fg.id]!;

  // Asymmetric Q2 shares (live TB@DAL shape: awayShare ~0.28, homeShare ~0.23)
  const homeAvgs = {
    q1: { scored: 7.5, allowed: 5.5 },
    q2: { scored: 5.0, allowed: 8.3 },
    q3: { scored: 7.0, allowed: 6.0 },
    q4: { scored: 8.0, allowed: 6.5 },
    h1: { scored: 12.5, allowed: 13.8 },
    h2: { scored: 15.0, allowed: 12.5 },
  };
  const awayAvgs = {
    q1: { scored: 5.5, allowed: 7.0 },
    q2: { scored: 5.0, allowed: 7.5 },
    q3: { scored: 6.0, allowed: 7.0 },
    q4: { scored: 7.0, allowed: 8.0 },
    h1: { scored: 10.5, allowed: 14.5 },
    h2: { scored: 13.0, allowed: 15.0 },
  };
  const profile = buildPeriodOffenseDefenseProfile(homeAvgs, awayAvgs);
  assert.ok(profile);
  assert.ok((profile.awayByPeriod.q2 ?? 0) > (profile.homeByPeriod.q2 ?? 0));

  const entry: CoachGameSimEntry = {
    simulations: outcomes.homeScores.length,
    homeWinProbability: 0.45,
    awayWinProbability: 0.52,
    tieProbability: 0.03,
    homeProjectedScore: 42,
    awayProjectedScore: 43,
    mostLikelyWinner: "away",
    mostLikelyWinnerPct: 0.52,
    confidenceScore: 60,
    coverHitRates: { ...fracRates },
    outcomes,
  };

  const applied = applyPeriodOffenseDefenseCoverRates(
    entry,
    [q2, fg],
    "nfl",
    homeAvgs,
    awayAvgs,
  );

  const odQ2 = applied.coverHitRates?.[q2.id]!;
  const odFg = applied.coverHitRates?.[fg.id]!;

  // FG must stay on server/frac rate (period OD only overwrites period queries).
  assert.equal(odFg, fracFg);

  // Away-favoring Q2 share must lift Bucs +3.5 vs flat 0.24 frac — the
  // ~8pp gap seen in PR #649 live verification (frac ~0.86 → period-OD ~0.95).
  assert.ok(
    odQ2 > fracQ2 + 0.04,
    `expected period-OD lift, frac=${fracQ2} od=${odQ2}`,
  );
  assert.ok(
    odQ2 < 0.985,
    `correlated FG draws: period-OD should stay below cancel-draw certainty, got ${odQ2}`,
  );
  assert.ok(fracQ2 > 0.7 && fracQ2 < 0.95, `frac baseline sanity, got ${fracQ2}`);
});

test("applyPeriodOffenseDefenseCoverRates is a no-op without period averages", () => {
  const outcomes = synthFgOutcomes(500);
  const q2: GameCoverQuery = {
    id: "a @ b|q2 spread|away +3.5",
    kind: "spread",
    teamSide: "away",
    line: 3.5,
    period: "q2",
  };
  const frac = deriveCoverHitRatesFromOutcomes(outcomes, [q2], "nfl", null);
  const entry: CoachGameSimEntry = {
    simulations: 500,
    homeWinProbability: 0.5,
    awayWinProbability: 0.5,
    tieProbability: 0,
    homeProjectedScore: 20,
    awayProjectedScore: 20,
    mostLikelyWinner: "home",
    mostLikelyWinnerPct: 0.5,
    confidenceScore: 50,
    coverHitRates: { ...frac },
    outcomes,
  };
  const out = applyPeriodOffenseDefenseCoverRates(entry, [q2], "nfl", null, null);
  assert.equal(out.coverHitRates?.[q2.id], frac[q2.id]);
});

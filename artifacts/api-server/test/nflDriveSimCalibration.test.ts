import assert from "node:assert/strict";
import test from "node:test";

import { expectedPoints, leagueProfileForSport, runNflDriveSim } from "../src/lib/sportSim/nflDriveSim.ts";
import type { SportSimContext } from "../src/lib/sportSim/types.ts";

const scores = (n: number, mean: number) => Array.from({ length: n }, () => mean);

function sim(
  sport: string,
  home: { ptsFor: number | null; ptsAgainst: number | null; games?: number },
  away: { ptsFor: number | null; ptsAgainst: number | null; games?: number },
  simulations = 20_000,
) {
  const ctx: SportSimContext = {
    sport,
    simulations,
    home: {
      ptsFor: home.ptsFor,
      ptsAgainst: home.ptsAgainst,
      recentScores: scores(home.games ?? 10, home.ptsFor ?? 0),
    },
    away: {
      ptsFor: away.ptsFor,
      ptsAgainst: away.ptsAgainst,
      recentScores: scores(away.games ?? 10, away.ptsFor ?? 0),
    },
    retainOutcomes: true,
  };
  const r = runNflDriveSim(ctx);
  assert.ok(r, `${sport} sim returned null`);
  return r!;
}

test("strong offence vs weak defence projects far more than weak vs strong", () => {
  const strong = sim("nfl", { ptsFor: 31, ptsAgainst: 18 }, { ptsFor: 17, ptsAgainst: 29 });
  const weak = sim("nfl", { ptsFor: 17, ptsAgainst: 29 }, { ptsFor: 31, ptsAgainst: 18 });

  assert.ok(
    strong.homeProjectedScore - weak.homeProjectedScore > 10,
    `expected a >10 point gap, got ${strong.homeProjectedScore} vs ${weak.homeProjectedScore}`,
  );
  assert.ok(strong.homeWinProbability > 0.8, `strong side win prob ${strong.homeWinProbability}`);
  assert.ok(weak.homeWinProbability < 0.2, `weak side win prob ${weak.homeWinProbability}`);
});

test("a weak offence facing a strong defence projects below a weak offence facing a weak one", () => {
  const vsStrongD = sim("nfl", { ptsFor: 16, ptsAgainst: 25 }, { ptsFor: 24, ptsAgainst: 14 });
  const vsWeakD = sim("nfl", { ptsFor: 16, ptsAgainst: 25 }, { ptsFor: 24, ptsAgainst: 30 });

  assert.ok(
    vsWeakD.homeProjectedScore - vsStrongD.homeProjectedScore > 4,
    `opponent defence barely moved the projection: ${vsStrongD.homeProjectedScore} vs ${vsWeakD.homeProjectedScore}`,
  );
});

test("projected score tracks the points-per-game the real inputs imply", () => {
  const league = leagueProfileForSport("nfl");
  for (const [pf, pa] of [
    [17, 22.5],
    [24, 22.5],
    [31, 22.5],
  ] as const) {
    const target = expectedPoints(pf, pa, 10, league);
    const r = sim("nfl", { ptsFor: pf, ptsAgainst: 22.5 }, { ptsFor: 22.5, ptsAgainst: pa });
    assert.ok(
      Math.abs(r.homeProjectedScore - target) < 2.5,
      `input ${pf} implied ${target.toFixed(1)} but simulated ${r.homeProjectedScore}`,
    );
  }
});

test("league-average NFL matchups produce a realistic total distribution", () => {
  const r = sim("nfl", { ptsFor: 22.5, ptsAgainst: 22.5 }, { ptsFor: 22.5, ptsAgainst: 22.5 });
  const total = r.homeProjectedScore + r.awayProjectedScore;
  assert.ok(total > 38 && total < 52, `league-average NFL total out of range: ${total}`);

  const draws = r.outcomes!.homeScores.map((h, i) => h + r.outcomes!.awayScores[i]!);
  const sorted = [...draws].sort((a, b) => a - b);
  const p05 = sorted[Math.floor(sorted.length * 0.05)]!;
  const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
  assert.ok(p05 >= 14 && p05 <= 32, `5th pct total ${p05} is unrealistic`);
  assert.ok(p95 >= 52 && p95 <= 82, `95th pct total ${p95} is unrealistic`);
  assert.ok(Math.max(...draws) < 120, `simulated a ${Math.max(...draws)}-point game`);
});

test("no NFL matchup collapses onto the same ~84-point total", () => {
  const totals = (
    [
      [31, 18, 17, 29],
      [24, 22, 24, 22],
      [14, 28, 20, 24],
      [35, 20, 30, 25],
      [12, 30, 15, 26],
    ] as const
  ).map(([hf, ha, af, aa]) => {
    const r = sim("nfl", { ptsFor: hf, ptsAgainst: ha }, { ptsFor: af, ptsAgainst: aa }, 10_000);
    return r.homeProjectedScore + r.awayProjectedScore;
  });

  const spread = Math.max(...totals) - Math.min(...totals);
  assert.ok(spread > 8, `totals barely moved across matchups: ${totals.map((t) => t.toFixed(1)).join(", ")}`);
  for (const t of totals) assert.ok(t < 70, `total ${t.toFixed(1)} is above any realistic football game`);
});

test("NCAAF scores higher than the NFL for the same relative strength", () => {
  const nfl = sim("nfl", { ptsFor: 22.5, ptsAgainst: 22.5 }, { ptsFor: 22.5, ptsAgainst: 22.5 });
  const ncaaf = sim("ncaaf", { ptsFor: 27.5, ptsAgainst: 27.5 }, { ptsFor: 27.5, ptsAgainst: 27.5 });
  assert.ok(
    ncaaf.homeProjectedScore > nfl.homeProjectedScore + 2,
    `NCAAF ${ncaaf.homeProjectedScore} should outscore NFL ${nfl.homeProjectedScore}`,
  );
  const total = ncaaf.homeProjectedScore + ncaaf.awayProjectedScore;
  assert.ok(total > 45 && total < 70, `league-average NCAAF total out of range: ${total}`);
});

test("an extreme NCAAF mismatch does not simulate as a near coin flip", () => {
  const r = sim("ncaaf", { ptsFor: 48, ptsAgainst: 13 }, { ptsFor: 14, ptsAgainst: 41 });
  assert.ok(r.homeWinProbability > 0.93, `blowout only reached ${r.homeWinProbability}`);
  assert.ok(
    r.homeProjectedScore - r.awayProjectedScore > 20,
    `blowout margin only ${(r.homeProjectedScore - r.awayProjectedScore).toFixed(1)}`,
  );
});

test("tie probability is realistic: rare in the NFL, impossible in NCAAF", () => {
  const nfl = sim("nfl", { ptsFor: 22.5, ptsAgainst: 22.5 }, { ptsFor: 22.5, ptsAgainst: 22.5 });
  assert.ok(nfl.tieProbability > 0, "the NFL can still tie after overtime");
  assert.ok(nfl.tieProbability < 0.015, `NFL tie probability ${nfl.tieProbability} is far above reality`);

  const ncaaf = sim("ncaaf", { ptsFor: 27.5, ptsAgainst: 27.5 }, { ptsFor: 27.5, ptsAgainst: 27.5 });
  assert.equal(ncaaf.tieProbability, 0, "college football always plays to a result");
});

test("the two teams do not run an identical number of drives every draw", () => {
  const r = sim("nfl", { ptsFor: 22.5, ptsAgainst: 22.5 }, { ptsFor: 22.5, ptsAgainst: 22.5 }, 5000);
  // Drive counts are internal, so assert on the observable consequence: the two
  // score distributions must not be locked together.
  const home = r.outcomes!.homeScores;
  const away = r.outcomes!.awayScores;
  assert.ok(home.some((h, i) => h !== away[i]), "home and away scores are identical every draw");
  const distinct = new Set(home).size;
  assert.ok(distinct > 12, `only ${distinct} distinct home scores — the model is not varying drives`);
});

test("win probability moves monotonically with the strength gap", () => {
  const probs = [12, 18, 24, 30, 36].map(
    (pf) => sim("nfl", { ptsFor: pf, ptsAgainst: 22.5 }, { ptsFor: 22.5, ptsAgainst: 22.5 }, 10_000).homeWinProbability,
  );
  for (let i = 1; i < probs.length; i++) {
    assert.ok(probs[i]! > probs[i - 1]!, `win prob did not rise at step ${i}: ${probs.join(", ")}`);
  }
  assert.ok(probs[0]! < 0.25, `worst offence still won ${probs[0]}`);
  assert.ok(probs[probs.length - 1]! > 0.75, `best offence only won ${probs[probs.length - 1]}`);
});

test("thin samples shrink toward the plain average instead of trusting one blowout", () => {
  const league = leagueProfileForSport("ncaaf");
  const oneGame = expectedPoints(52, 0, 1, league);
  const tenGames = expectedPoints(52, 0, 10, league);
  assert.ok(oneGame > tenGames, "a one-game sample must be shrunk toward the plain average");
  assert.ok(oneGame > league.avgPoints * 0.25, "shrinkage should keep it off the clamp floor");
});

test("expectedPoints degrades safely when scoring form is missing", () => {
  const league = leagueProfileForSport("nfl");
  assert.equal(expectedPoints(null, null, 0, league), league.avgPoints);
  assert.equal(expectedPoints(24, null, 5, league), 24);
  assert.equal(expectedPoints(null, 19, 5, league), 19);
  assert.ok(Number.isFinite(expectedPoints(Number.NaN, 19, 5, league)));
});

test("a matchup with no scoring form still simulates a plausible league-average game", () => {
  const r = sim("nfl", { ptsFor: null, ptsAgainst: null, games: 0 }, { ptsFor: null, ptsAgainst: null, games: 0 });
  const total = r.homeProjectedScore + r.awayProjectedScore;
  assert.ok(total > 38 && total < 52, `fallback total out of range: ${total}`);
});

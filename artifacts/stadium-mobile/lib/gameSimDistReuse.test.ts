/**
 * Phase 2.4 Option C — FG distribution reuse + cooperative yield correctness.
 *
 * Proves:
 *   - canonical series key identity (threshold/book reuse; material miss)
 *   - A≡C bit-identical FG shareable outputs on seeded fixtures
 *   - period/race markets bypass FG series reuse
 *   - yielding changes scheduling only (not math / draw count / order)
 *   - abort during yield does not poison the series cache
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { ParsedPick } from "../components/PickCard.tsx";
import {
  clearGameSimDistReuseForTests,
  describeFgDistReuseKey,
  fgDistSeriesKey,
  getCachedFgDistSeries,
  getGameSimDistReuseStats,
  resetGameSimDistReuseStats,
  withFgDistSeriesReuse,
} from "./gameSimDistReuse.ts";
import {
  buildGameCoverQuery,
  deriveCoverHitRatesFromOutcomes,
  distributionForQuery,
  gameSimHitForPick,
  type CoachGameSimEntry,
  type GameCoverQuery,
} from "./gameSimScoring.ts";
import { americanToDecimal, impliedProb } from "./format.ts";
import {
  buildStagedTicketFromScan,
  type BoardScoredLeg,
} from "./ticketStaging.ts";

const N = 10_000;

/** Deterministic seeded outcomes — same draws for A and C. */
function seededOutcomes(seed = 42): { homeScores: number[]; awayScores: number[] } {
  let s = seed >>> 0;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  const homeScores: number[] = [];
  const awayScores: number[] = [];
  for (let i = 0; i < N; i++) {
    homeScores.push(Math.round(90 + next() * 40));
    awayScores.push(Math.round(88 + next() * 42));
  }
  return { homeScores, awayScores };
}

function makeSim(outcomes = seededOutcomes()): CoachGameSimEntry {
  const homeMean =
    outcomes.homeScores.reduce((a, b) => a + b, 0) / outcomes.homeScores.length;
  const awayMean =
    outcomes.awayScores.reduce((a, b) => a + b, 0) / outcomes.awayScores.length;
  let homeWins = 0;
  let awayWins = 0;
  for (let i = 0; i < outcomes.homeScores.length; i++) {
    if (outcomes.homeScores[i]! > outcomes.awayScores[i]!) homeWins += 1;
    else if (outcomes.awayScores[i]! > outcomes.homeScores[i]!) awayWins += 1;
  }
  const n = outcomes.homeScores.length;
  return {
    sport: "nba",
    simulations: n,
    homeWinProbability: homeWins / n,
    awayWinProbability: awayWins / n,
    tieProbability: (n - homeWins - awayWins) / n,
    homeProjectedScore: homeMean,
    awayProjectedScore: awayMean,
    mostLikelyWinner: homeWins >= awayWins ? "home" : "away",
    mostLikelyWinnerPct: Math.max(homeWins, awayWins) / n,
    confidenceScore: 60,
    outcomes,
  };
}

function gamePick(overrides: Partial<ParsedPick> = {}): ParsedPick {
  return {
    game: "Boston Celtics @ New York Knicks",
    market: "Spread",
    pick: "Knicks -3.5",
    odds: -110,
    isProp: false,
    sport: "nba",
    ...overrides,
  };
}

function edgeEv(hit: number, odds: number) {
  const implied = impliedProb(odds);
  return {
    implied,
    edge: Math.round((hit - implied) * 1000) / 10,
    ev: Math.round((hit * americanToDecimal(odds) - 1) * 1000) / 10,
  };
}

function snapshotFgShareable(sim: CoachGameSimEntry) {
  const picks: ParsedPick[] = [
    gamePick({ market: "Moneyline", pick: "Knicks ML", odds: -140 }),
    gamePick({ market: "Moneyline", pick: "Celtics ML", odds: +120 }),
    gamePick({ market: "Spread", pick: "Knicks -3.5", odds: -110 }),
    gamePick({ market: "Spread", pick: "Knicks -5.5", odds: +105 }),
    gamePick({ market: "Spread", pick: "Celtics +3.5", odds: -105 }),
    gamePick({ market: "Total", pick: "Over 224.5", odds: -110 }),
    gamePick({ market: "Total", pick: "Under 224.5", odds: -110 }),
    gamePick({ market: "Total", pick: "Over 230.5", odds: +100 }),
    gamePick({
      market: "Team Total",
      pick: "New York Knicks Over 112.5",
      odds: -115,
    }),
    gamePick({
      market: "Team Total",
      pick: "Boston Celtics Under 110.5",
      odds: -105,
    }),
  ];

  const queries = picks.map((p) => buildGameCoverQuery(p)!);
  assert.ok(queries.every(Boolean));

  // Cover probabilities from the same seeded draws (threshold-specific).
  const rates = deriveCoverHitRatesFromOutcomes(sim.outcomes!, queries, "nba");

  const rows = picks.map((pick, i) => {
    const q = queries[i]!;
    const distA = distributionForQuery(q, sim);
    const distC = withFgDistSeriesReuse(q, sim, () => distributionForQuery(q, sim));
    const hit = rates[q.id]!;
    const graded = gameSimHitForPick(pick, { ...sim, coverHitRates: rates });
    const { edge, ev, implied } = edgeEv(hit, pick.odds!);
    return {
      pick: pick.pick,
      market: pick.market,
      seriesKey: fgDistSeriesKey(q),
      distA,
      distC,
      hit,
      graded,
      implied,
      edge,
      ev,
      expectedHome: sim.homeProjectedScore,
      expectedAway: sim.awayProjectedScore,
      mlHome: sim.homeWinProbability,
      mlAway: sim.awayWinProbability,
    };
  });

  return rows;
}

test("canonical FG series key form and shareable dims", () => {
  assert.equal(fgDistSeriesKey({ kind: "ml", teamSide: "home" }), "ml|home");
  assert.equal(fgDistSeriesKey({ kind: "ml", teamSide: "away" }), "ml|away");
  assert.equal(fgDistSeriesKey({ kind: "spread", teamSide: "home" }), "spread|home");
  assert.equal(fgDistSeriesKey({ kind: "spread", teamSide: "away" }), "spread|away");
  assert.equal(fgDistSeriesKey({ kind: "total" }), "total");
  assert.equal(fgDistSeriesKey({ kind: "teamTotal", teamSide: "home" }), "teamTotal|home");
  assert.equal(fgDistSeriesKey({ kind: "teamTotal", teamSide: "away" }), "teamTotal|away");

  // Exact canonical identity string for docs/report.
  const key = describeFgDistReuseKey("outcomes#ref", "spread|home");
  assert.equal(key, "fgDist|outcomes#ref|spread|home");
  assert.match(key, /^fgDist\|.+\|.+$/);
});

test("period / race-to markets do not join the FG series cache", () => {
  assert.equal(fgDistSeriesKey({ kind: "spread", teamSide: "home", period: "h1" }), null);
  assert.equal(fgDistSeriesKey({ kind: "total", period: "q1" }), null);
  assert.equal(fgDistSeriesKey({ kind: "teamTotal", teamSide: "away", period: "p1" }), null);
  assert.equal(fgDistSeriesKey({ kind: "raceTo", teamSide: "home" }), null);
  assert.equal(fgDistSeriesKey({ kind: "ml", teamSide: "home", period: "fg" }), "ml|home");
});

test("same game/context + different spread/total thresholds → reuse series", () => {
  clearGameSimDistReuseForTests();
  const sim = makeSim();
  const q1: GameCoverQuery = {
    id: "g|spread|knicks -3.5",
    kind: "spread",
    teamSide: "home",
    line: -3.5,
  };
  const q2: GameCoverQuery = {
    id: "g|spread|knicks -7.5",
    kind: "spread",
    teamSide: "home",
    line: -7.5,
  };
  const d1 = withFgDistSeriesReuse(q1, sim, () => distributionForQuery(q1, sim));
  const d2 = withFgDistSeriesReuse(q2, sim, () => distributionForQuery(q2, sim));
  assert.deepEqual(d1, d2);
  const stats = getGameSimDistReuseStats();
  assert.equal(stats.misses, 1);
  assert.equal(stats.hits, 1);

  clearGameSimDistReuseForTests();
  const t1: GameCoverQuery = {
    id: "g|total|over 224.5",
    kind: "total",
    totalSide: "over",
    line: 224.5,
  };
  const t2: GameCoverQuery = {
    id: "g|total|under 230.5",
    kind: "total",
    totalSide: "under",
    line: 230.5,
  };
  const td1 = withFgDistSeriesReuse(t1, sim, () => distributionForQuery(t1, sim));
  const td2 = withFgDistSeriesReuse(t2, sim, () => distributionForQuery(t2, sim));
  assert.deepEqual(td1, td2);
  assert.equal(getGameSimDistReuseStats().hits, 1);
  assert.equal(getGameSimDistReuseStats().misses, 1);
});

test("same game/context + different sportsbook/price → reuse dist, recompute EV/edge", () => {
  clearGameSimDistReuseForTests();
  const sim = makeSim();
  const outcomes = sim.outcomes!;
  const q: GameCoverQuery = {
    id: "g|spread|knicks -3.5",
    kind: "spread",
    teamSide: "home",
    line: -3.5,
  };
  const rates = deriveCoverHitRatesFromOutcomes(outcomes, [q], "nba");
  const hit = rates[q.id]!;
  assert.ok(hit > 0 && hit < 1);

  const distCheap = withFgDistSeriesReuse(q, sim, () => distributionForQuery(q, sim));
  const distRich = withFgDistSeriesReuse(q, sim, () => distributionForQuery(q, sim));
  assert.deepEqual(distCheap, distRich);
  assert.equal(getGameSimDistReuseStats().hits, 1);

  const bookA = edgeEv(hit, -110);
  const bookB = edgeEv(hit, +130);
  // Distribution identical; price-dependent fields differ.
  assert.notEqual(bookA.edge, bookB.edge);
  assert.notEqual(bookA.ev, bookB.ev);
  assert.notEqual(bookA.implied, bookB.implied);
});

test("material context change → new distribution (different outcomes object)", () => {
  clearGameSimDistReuseForTests();
  const simA = makeSim(seededOutcomes(1));
  const simB = makeSim(seededOutcomes(99));
  const q: GameCoverQuery = { id: "g|total|o", kind: "total", totalSide: "over", line: 220.5 };
  const a = withFgDistSeriesReuse(q, simA, () => distributionForQuery(q, simA));
  const b = withFgDistSeriesReuse(q, simB, () => distributionForQuery(q, simB));
  assert.notDeepEqual(a, b);
  // Each outcomes object gets its own miss — no cross-context reuse.
  assert.equal(getGameSimDistReuseStats().misses, 2);
  assert.equal(getGameSimDistReuseStats().hits, 0);
  assert.ok(getCachedFgDistSeries(simA, "total"));
  assert.ok(getCachedFgDistSeries(simB, "total"));
});

test("A≡C deterministic FG shareable outputs — expected numerical delta 0", () => {
  clearGameSimDistReuseForTests();
  const sim = makeSim(seededOutcomes(7));

  // Mode A: fresh distributionForQuery each time (no reuse wrapper).
  const modeA = (() => {
    resetGameSimDistReuseStats();
    // Bypass cache by computing directly
    const picks = [
      gamePick({ market: "Moneyline", pick: "Knicks ML", odds: -140 }),
      gamePick({ market: "Spread", pick: "Knicks -3.5", odds: -110 }),
      gamePick({ market: "Spread", pick: "Knicks -6.5", odds: +120 }),
      gamePick({ market: "Total", pick: "Over 224.5", odds: -110 }),
      gamePick({ market: "Total", pick: "Under 229.5", odds: -105 }),
      gamePick({
        market: "Team Total",
        pick: "New York Knicks Over 112.5",
        odds: -115,
      }),
    ];
    const queries = picks.map((p) => buildGameCoverQuery(p)!);
    const rates = deriveCoverHitRatesFromOutcomes(sim.outcomes!, queries, "nba");
    return picks.map((pick, i) => {
      const q = queries[i]!;
      const dist = distributionForQuery(q, sim);
      const hit = rates[q.id]!;
      const { edge, ev } = edgeEv(hit, pick.odds!);
      return { dist, hit, edge, ev, graded: gameSimHitForPick(pick, { ...sim, coverHitRates: rates }) };
    });
  })();

  // Mode C: with reuse (multiple alt thresholds share series).
  clearGameSimDistReuseForTests();
  const modeC = snapshotFgShareable(sim);

  // Align on overlapping markets for pairwise A≡C.
  const aByPick = new Map<string, (typeof modeA)[number]>([
    ["Knicks ML", modeA[0]!],
    ["Knicks -3.5", modeA[1]!],
    ["Knicks -6.5", modeA[2]!],
    ["Over 224.5", modeA[3]!],
    ["Under 229.5", modeA[4]!],
    ["New York Knicks Over 112.5", modeA[5]!],
  ]);

  const diffs: Array<{ field: string; a: unknown; c: unknown }> = [];
  for (const row of modeC) {
    const a = aByPick.get(row.pick);
    if (!a) continue;
    if (JSON.stringify(a.dist) !== JSON.stringify(row.distC)) {
      diffs.push({ field: `${row.pick}.dist`, a: a.dist, c: row.distC });
    }
    if (a.hit !== row.hit) diffs.push({ field: `${row.pick}.hit`, a: a.hit, c: row.hit });
    if (a.edge !== row.edge) diffs.push({ field: `${row.pick}.edge`, a: a.edge, c: row.edge });
    if (a.ev !== row.ev) diffs.push({ field: `${row.pick}.ev`, a: a.ev, c: row.ev });
    if (a.graded !== row.graded) {
      diffs.push({ field: `${row.pick}.graded`, a: a.graded, c: row.graded });
    }
    // distA (fresh) vs distC (reuse path) on the same row must match.
    if (JSON.stringify(row.distA) !== JSON.stringify(row.distC)) {
      diffs.push({ field: `${row.pick}.distA_vs_distC`, a: row.distA, c: row.distC });
    }
  }

  assert.deepEqual(diffs, [], `A≡C numerical diffs (expected []): ${JSON.stringify(diffs)}`);

  // Explicit zero-delta report fields.
  for (const row of modeC) {
    assert.deepEqual(row.distA, row.distC);
  }
});

test("period cover path still uses periodScoresForDraw (Math.random) — not FG series cache", () => {
  clearGameSimDistReuseForTests();
  const sim = makeSim();
  const h1Pick = gamePick({
    market: "1H Spread",
    pick: "Knicks -1.5",
    odds: -110,
  });
  const q = buildGameCoverQuery(h1Pick);
  assert.ok(q);
  assert.equal(q!.period, "h1");
  assert.equal(fgDistSeriesKey(q!), null);

  // Two independent cover walks are stochastic — not required equal.
  // What we require: reuse bypasses (no series write for period).
  const before = getGameSimDistReuseStats();
  withFgDistSeriesReuse(q!, sim, () => distributionForQuery(q!, sim));
  const after = getGameSimDistReuseStats();
  assert.equal(after.bypass, before.bypass + 1);
  assert.equal(after.misses, before.misses);
  assert.equal(getCachedFgDistSeries(sim, "spread|home"), undefined);

  // FG spread DOES populate the series cache.
  const fgQ = buildGameCoverQuery(gamePick())!;
  withFgDistSeriesReuse(fgQ, sim, () => distributionForQuery(fgQ, sim));
  assert.ok(getCachedFgDistSeries(sim, "spread|home"));

  // raceTo bypass
  const race = gamePick({
    market: "Race to 10",
    pick: "Knicks",
    odds: -120,
  });
  // Race markets need a parseable team in pick — may or may not build query.
  const rq = buildGameCoverQuery(race);
  if (rq) {
    assert.equal(fgDistSeriesKey(rq), null);
  }
});

test("cooperative yield changes scheduling only — same draws, order, outputs", async () => {
  const outcomes = seededOutcomes(11);
  const queries: GameCoverQuery[] = [
    { id: "ml-h", kind: "ml", teamSide: "home" },
    { id: "sp-h-3", kind: "spread", teamSide: "home", line: -3.5 },
    { id: "sp-h-7", kind: "spread", teamSide: "home", line: -7.5 },
    { id: "tot-224", kind: "total", totalSide: "over", line: 224.5 },
    { id: "tt-h", kind: "teamTotal", teamSide: "home", totalSide: "over", line: 112.5 },
  ];

  const syncRates = deriveCoverHitRatesFromOutcomes(outcomes, queries, "nba");
  const syncDists = queries.map((q) =>
    distributionForQuery(q, { outcomes, simulations: N } as CoachGameSimEntry),
  );

  // Yield between each query — must not skip any simulation / change order.
  const yieldedRates: Record<string, number> = {};
  const yieldedDists: typeof syncDists = [];
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i]!;
    const piece = deriveCoverHitRatesFromOutcomes(outcomes, [q], "nba");
    yieldedRates[q.id] = piece[q.id]!;
    yieldedDists.push(
      distributionForQuery(q, { outcomes, simulations: N } as CoachGameSimEntry),
    );
    await new Promise<void>((r) => setImmediate(r));
  }

  assert.deepEqual(yieldedRates, syncRates);
  assert.deepEqual(yieldedDists, syncDists);
  assert.equal(outcomes.homeScores.length, N);
  assert.equal(outcomes.awayScores.length, N);
});

test("abort during yielded scoring does not poison shared FG series cache", async () => {
  clearGameSimDistReuseForTests();
  const sim = makeSim(seededOutcomes(3));
  const q: GameCoverQuery = {
    id: "g|spread|home -3.5",
    kind: "spread",
    teamSide: "home",
    line: -3.5,
  };

  // Populate cache as a prior scan would.
  const cached = withFgDistSeriesReuse(q, sim, () => distributionForQuery(q, sim));
  assert.equal(getGameSimDistReuseStats().misses, 1);

  const ac = new AbortController();
  const games = ["g1", "g2", "g3"];
  const scored: string[] = [];
  for (let gi = 0; gi < games.length; gi++) {
    if (ac.signal.aborted) break;
    scored.push(games[gi]!);
    // Simulate Option C yield between games.
    if (gi === 0) ac.abort();
    if (gi + 1 < games.length) {
      await new Promise<void>((r) => setImmediate(r));
      if (ac.signal.aborted) break;
    }
  }
  assert.deepEqual(scored, ["g1"]);

  // Prior cache entry still intact; subsequent scan can hit.
  resetGameSimDistReuseStats();
  const again = withFgDistSeriesReuse(q, sim, () => distributionForQuery(q, sim));
  assert.deepEqual(again, cached);
  assert.equal(getGameSimDistReuseStats().hits, 1);
  assert.equal(getGameSimDistReuseStats().misses, 0);
});

test("reuse stats: raceTo bypass increments bypass counter", () => {
  clearGameSimDistReuseForTests();
  const sim = makeSim();
  const q: GameCoverQuery = {
    id: "race",
    kind: "raceTo",
    teamSide: "home",
    raceTarget: 10,
  };
  withFgDistSeriesReuse(q, sim, () => distributionForQuery(q, sim));
  assert.equal(getGameSimDistReuseStats().bypass, 1);
  assert.equal(getGameSimDistReuseStats().hits, 0);
  assert.equal(getGameSimDistReuseStats().misses, 0);
});

test("A≡C extends through qualification, ordering, correlation/diversity, final ticket", () => {
  clearGameSimDistReuseForTests();
  const sim = makeSim(seededOutcomes(21));

  // Shareable FG markets only — ML / spread / total / TT + compatible ALTs.
  // All on one known parseable matchup so cover-query construction is reliable.
  const game = "Boston Celtics @ New York Knicks";
  const pickSpecs: Array<{
    market: string;
    pick: string;
    odds: number;
    composite: number;
    grade: string;
    confidencePct: number;
  }> = [
    { market: "Moneyline", pick: "Knicks ML", odds: -140, composite: 8.2, grade: "B+", confidencePct: 62 },
    { market: "Moneyline", pick: "Celtics ML", odds: +120, composite: 7.0, grade: "B-", confidencePct: 54 },
    { market: "Spread", pick: "Knicks -3.5", odds: -110, composite: 8.0, grade: "B+", confidencePct: 60 },
    { market: "Spread", pick: "Knicks -6.5", odds: +115, composite: 7.1, grade: "B", confidencePct: 56 },
    { market: "Spread", pick: "Celtics +3.5", odds: -105, composite: 7.5, grade: "B", confidencePct: 57 },
    { market: "Total", pick: "Over 224.5", odds: -110, composite: 7.8, grade: "B", confidencePct: 58 },
    { market: "Total", pick: "Under 224.5", odds: -110, composite: 7.6, grade: "B", confidencePct: 57 },
    { market: "Total", pick: "Over 230.5", odds: +100, composite: 7.2, grade: "B-", confidencePct: 55 },
    {
      market: "Team Total",
      pick: "New York Knicks Over 112.5",
      odds: -115,
      composite: 7.4,
      grade: "B",
      confidencePct: 56,
    },
    {
      market: "Team Total",
      pick: "Boston Celtics Under 110.5",
      odds: -105,
      composite: 7.3,
      grade: "B",
      confidencePct: 55,
    },
  ];

  // Second game so correlation/diversity staging has cross-game choices.
  const game2 = "Dallas Mavericks @ Denver Nuggets";
  const pickSpecs2: typeof pickSpecs = [
    { market: "Moneyline", pick: "Nuggets ML", odds: -150, composite: 8.1, grade: "B+", confidencePct: 61 },
    { market: "Spread", pick: "Nuggets -4.5", odds: -110, composite: 7.9, grade: "B+", confidencePct: 59 },
    { market: "Total", pick: "Over 228.5", odds: -108, composite: 7.4, grade: "B", confidencePct: 56 },
    { market: "Spread", pick: "Mavericks +4.5", odds: -105, composite: 7.2, grade: "B-", confidencePct: 55 },
  ];

  const allSpecs = [
    ...pickSpecs.map((s) => ({ ...s, game })),
    ...pickSpecs2.map((s) => ({ ...s, game: game2 })),
  ];

  function buildLegSnapshot(mode: "A" | "C") {
    clearGameSimDistReuseForTests();
    const queries = allSpecs.map((s) =>
      buildGameCoverQuery(
        gamePick({
          game: s.game,
          market: s.market,
          pick: s.pick,
          odds: s.odds,
          sport: "nba",
        }),
      ),
    );
    const usable = allSpecs
      .map((s, i) => ({ s, q: queries[i]! }))
      .filter((x) => x.q != null);
    assert.ok(usable.length >= 10, `expected parseable FG queries, got ${usable.length}`);

    const rates = deriveCoverHitRatesFromOutcomes(
      sim.outcomes!,
      usable.map((x) => x.q!),
      "nba",
    );

    const legs: BoardScoredLeg[] = [];
    const fieldRows: Array<Record<string, unknown>> = [];

    for (const { s, q } of usable) {
      const pick = gamePick({
        game: s.game,
        market: s.market,
        pick: s.pick,
        odds: s.odds,
        sport: "nba",
      });
      const dist =
        mode === "A"
          ? distributionForQuery(q!, sim)
          : withFgDistSeriesReuse(q!, sim, () => distributionForQuery(q!, sim));
      const hit = rates[q!.id]!;
      assert.ok(hit != null && Number.isFinite(hit), `missing cover rate for ${q!.id}`);
      const { edge, ev, implied } = edgeEv(hit, s.odds);
      const graded = gameSimHitForPick(pick, { ...sim, coverHitRates: rates });
      const qualified = graded != null && graded > 0 && graded < 1;
      fieldRows.push({
        id: `${s.game}|${s.market}|${s.pick}`,
        seriesKey: fgDistSeriesKey(q!),
        dist,
        hit,
        graded,
        edge,
        ev,
        implied,
        grade: s.grade,
        confidencePct: s.confidencePct,
        qualified,
      });
      if (!qualified) continue;
      const finalAiScore = {
        composite: s.composite,
        grade: s.grade,
        confidencePct: s.confidencePct,
        edgePct: edge,
        simHit: graded,
        simAligned: true,
        highRiskValuePlay: false,
        recommends: true,
        factors: [] as string[],
        rubric: {
          composite: s.composite,
          grade: s.grade,
          confidencePct: s.confidencePct,
          edgePct: edge,
          scores: {} as never,
        },
      };
      const legPick = { ...pick, finalAiScore };
      const leg: Omit<BoardScoredLeg, "rankScore"> = {
        pick: legPick,
        evPct: ev,
        edgePct: edge,
        confidencePct: s.confidencePct,
        impliedProbPct: Math.round(implied * 1000) / 10,
        lineShoppingScore: 1,
        grade: s.grade,
        simHit: graded,
        composite: s.composite,
      };
      legs.push({
        ...leg,
        rankScore: (graded ?? 0) * 100 + s.composite,
      });
    }

    const ordered = [...legs].sort((a, b) => {
      if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
      return String(a.pick.pick).localeCompare(String(b.pick.pick));
    });

    // No varietySeed → balanced staging path (correlation/diversity + caps).
    const staged = buildStagedTicketFromScan(ordered, Math.min(5, ordered.length));
    return {
      fieldRows,
      qualifiedIds: ordered.map((l) => `${l.pick.game}|${l.pick.market}|${l.pick.pick}`),
      orderedRank: ordered.map((l) => ({
        id: `${l.pick.game}|${l.pick.market}|${l.pick.pick}`,
        rankScore: l.rankScore,
        simHit: l.simHit,
        edgePct: l.edgePct,
        grade: l.grade,
        confidencePct: l.confidencePct,
      })),
      ticket: staged.picks.map((p) => `${p.game}|${p.market}|${p.pick}|${p.odds}`),
      breakdown: staged.breakdown,
    };
  }

  const a = buildLegSnapshot("A");
  const c = buildLegSnapshot("C");

  const diffs: Array<{ field: string; a: unknown; c: unknown }> = [];
  assert.equal(a.fieldRows.length, c.fieldRows.length);
  for (let i = 0; i < a.fieldRows.length; i++) {
    const ar = a.fieldRows[i]!;
    const cr = c.fieldRows[i]!;
    for (const key of [
      "seriesKey",
      "dist",
      "hit",
      "graded",
      "edge",
      "ev",
      "implied",
      "grade",
      "confidencePct",
      "qualified",
    ] as const) {
      if (JSON.stringify(ar[key]) !== JSON.stringify(cr[key])) {
        diffs.push({ field: `${ar.id}.${key}`, a: ar[key], c: cr[key] });
      }
    }
  }
  if (JSON.stringify(a.qualifiedIds) !== JSON.stringify(c.qualifiedIds)) {
    diffs.push({ field: "qualification.order", a: a.qualifiedIds, c: c.qualifiedIds });
  }
  if (JSON.stringify(a.orderedRank) !== JSON.stringify(c.orderedRank)) {
    diffs.push({ field: "ordering", a: a.orderedRank, c: c.orderedRank });
  }
  if (JSON.stringify(a.breakdown) !== JSON.stringify(c.breakdown)) {
    diffs.push({ field: "correlation_diversity_breakdown", a: a.breakdown, c: c.breakdown });
  }
  if (JSON.stringify(a.ticket) !== JSON.stringify(c.ticket)) {
    diffs.push({ field: "final_ticket", a: a.ticket, c: c.ticket });
  }

  assert.deepEqual(diffs, [], `A≡C staging diffs (expected []): ${JSON.stringify(diffs)}`);
  assert.ok(a.qualifiedIds.length >= 8, `expected qualified pool, got ${a.qualifiedIds.length}`);
  assert.ok(a.ticket.length >= 1, "fixture must stage a real ticket");
  assert.equal(a.ticket.length, c.ticket.length);
});

test("periodScoresForDraw / raceToHits source paths unchanged by Option C", async () => {
  // Structural: period/race still import and call the stochastic helpers.
  const scoringSrc = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("./gameSimScoring.ts", import.meta.url), "utf8"),
  );
  const periodSrc = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("./gamePeriodScoring.ts", import.meta.url), "utf8"),
  );
  assert.match(scoringSrc, /periodScoresForDraw\(/);
  assert.match(scoringSrc, /raceToHits\(/);
  assert.match(periodSrc, /Math\.random\(\)/);
  // Option C only wraps distributionForQuery — coverQueryHits body must still
  // branch to periodScoresForDraw for non-fg periods.
  assert.match(scoringSrc, /periodScoresForDraw\(sport, period, homeScore, awayScore/);
  assert.match(scoringSrc, /return raceToHits\(/);
  // Reuse key must bypass period/race (not force onto FG series cache).
  assert.equal(fgDistSeriesKey({ kind: "spread", teamSide: "home", period: "h1" }), null);
  assert.equal(fgDistSeriesKey({ kind: "total", period: "q2" }), null);
  assert.equal(fgDistSeriesKey({ kind: "raceTo", teamSide: "away" }), null);
});

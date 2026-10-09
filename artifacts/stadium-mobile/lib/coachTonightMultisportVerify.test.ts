/**
 * Final verification for PR #663 — slate-aware multi-sport + tennis fail-closed.
 *
 * Run:
 *   node --import ./test/register-hooks.mjs --experimental-strip-types \
 *     --test lib/coachTonightMultisportVerify.test.ts
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { ParsedPick } from "../components/PickCard.tsx";
import type { RealOddsEntry } from "./api.ts";
import {
  enforceMultiSportFloorOnTicket,
  injectPrioritySportsIntoTicket,
  interleaveEntriesBySport,
  slateAwarePrioritySports,
  sportsPresentOnSlate,
} from "./coachPrioritySports.ts";
import { buildFinalAiScore } from "./finalAiScore.ts";
import { simEdgeFromHit } from "./gameSimQualityGates.ts";
import {
  gameSimHitForPick,
  type CoachGameSimEntry,
} from "./gameSimScoring.ts";
import { scoreGameLinePick } from "./pickScoreContext.ts";
import {
  resolveTennisSimHit,
  tennisVerifiedCoverHit,
  TENNIS_HANDICAP_MAX_BOOK_GAP,
  TENNIS_MATCH_STRENGTH_MAX_ML_GAP,
} from "./tennisHandicapSim.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";
import { maxLegsPerGame, maxPropsPerGame } from "./parlayCorrelationScore.ts";
import { p0UnvalidatedSimDecision } from "./coachP0UnvalidatedTotals.ts";

type SportCounts = {
  available: number;
  simulated: number;
  qualified: number;
  seated: number;
};

function makePick(opts: {
  sport: string;
  game: string;
  pick: string;
  composite: number;
  isProp?: boolean;
  market?: string;
  odds?: number;
  book?: string;
}): ParsedPick {
  return {
    game: opts.game,
    market: opts.market ?? (opts.isProp ? "Passing Yards" : "Spread"),
    pick: opts.pick,
    odds: opts.odds ?? -110,
    sport: opts.sport,
    isProp: opts.isProp ?? false,
    book: opts.book ?? "DraftKings",
    finalAiScore: {
      composite: opts.composite,
      grade: "A",
      confidencePct: 70,
      edgePct: 10,
      simHit: 0.7,
      simAligned: true,
      highRiskValuePlay: false,
      recommends: true,
      factors: [],
      rubric: {
        composite: opts.composite,
        grade: "A",
        confidencePct: 70,
        edgePct: 10,
        scores: {} as never,
      },
    },
  } as ParsedPick;
}

function scored(pick: ParsedPick, rankScore: number): BoardScoredLeg {
  return { pick, rankScore, edgePct: 10, confidencePct: 70 };
}

function countBySport(picks: { sport?: string | null }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of picks) {
    const s = String(p.sport ?? "").toLowerCase();
    if (!s) continue;
    out[s] = (out[s] ?? 0) + 1;
  }
  return out;
}

/** Deterministic thin tonight slate: tennis-heavy + NHL/WNBA/NCAAF/NBA games. */
function buildMixedSlate(target: number) {
  const tennisGames = Array.from({ length: Math.max(target, 8) }, (_, i) => ({
    game: `T${i}a @ T${i}b`,
    sport: "tennis",
  }));
  const otherGames = [
    { game: "Rangers @ Caps", sport: "nhl" },
    { game: "Devils @ Panthers", sport: "nhl" },
    { game: "Sky @ Sun", sport: "wnba" },
    { game: "Aces @ Liberty", sport: "wnba" },
    { game: "Alabama @ Georgia", sport: "ncaaf" },
    { game: "Lakers @ Celtics", sport: "nba" },
  ];
  const allGames = [...tennisGames, ...otherGames];

  // Available = games with odds on the slate (by sport).
  const available = countBySport(allGames);

  // Simulation order: interleaved — first `budget` entries are "simulated".
  const evalEntries: Array<[string, { sport: string }[]]> = allGames.map((g) => [
    g.game,
    [{ sport: g.sport }],
  ]);
  const interleaved = interleaveEntriesBySport(
    evalEntries,
    (_g, lines) => lines[0]!.sport,
  );
  // Budget scales with leg ask — mirrors thin-slate batch pressure.
  const simBudget = Math.min(interleaved.length, Math.max(8, target + 2));
  const simulatedLabels = new Set(
    interleaved.slice(0, simBudget).map(([g]) => g),
  );
  const simulated: Record<string, number> = {};
  for (const [game, lines] of interleaved) {
    if (!simulatedLabels.has(game)) continue;
    const s = lines[0]!.sport;
    simulated[s] = (simulated[s] ?? 0) + 1;
  }

  // Qualified pool: tennis mains + one qualified leg per other sport.
  const tennisPicks = tennisGames.slice(0, target).map((g, i) =>
    makePick({
      sport: "tennis",
      game: g.game,
      pick: `T${i}a +2.5`,
      composite: 9 - i * 0.05,
      odds: -110,
      book: "FanDuel",
    }),
  );
  const extras = [
    makePick({
      sport: "nhl",
      game: "Rangers @ Caps",
      pick: "Rangers ML",
      market: "Moneyline",
      composite: 7.5,
      odds: -105,
      book: "DraftKings",
    }),
    makePick({
      sport: "wnba",
      game: "Sky @ Sun",
      pick: "Sky +4.5",
      composite: 7.4,
      odds: -110,
      book: "BetMGM",
    }),
    makePick({
      sport: "ncaaf",
      game: "Alabama @ Georgia",
      pick: "J. Milroe Over 224.5 Pass Yds",
      composite: 7.3,
      isProp: true,
      odds: -115,
      book: "DraftKings",
    }),
    makePick({
      sport: "nba",
      game: "Lakers @ Celtics",
      pick: "Lakers +3.5",
      composite: 7.2,
      odds: 100,
      book: "Caesars",
    }),
  ];
  const pool = [
    ...tennisPicks.map((p, i) => scored(p, 100 - i)),
    ...extras.map((p, i) => scored(p, 80 - i)),
  ];
  const qualified = countBySport(pool.map((l) => l.pick));

  const priority = slateAwarePrioritySports(
    ["nfl", "ncaaf"],
    sportsPresentOnSlate(allGames),
  );

  // BEFORE: NFL/NCAAF-only priority on a football-empty-ish slate still had
  // ncaaf when present, but ignored NHL/WNBA when ask priority stayed football-only.
  const beforePriority = ["nfl", "ncaaf"] as const;
  const beforeTicket = injectPrioritySportsIntoTicket(
    tennisPicks,
    pool,
    target,
    beforePriority,
  );
  const beforeSeated = countBySport(beforeTicket);

  const afterInject = injectPrioritySportsIntoTicket(
    tennisPicks,
    pool,
    target,
    priority,
  );
  const afterTicket =
    target >= 6
      ? enforceMultiSportFloorOnTicket(afterInject, pool, target, priority)
      : afterInject;
  const seated = countBySport(afterTicket);

  return {
    available,
    simulated,
    qualified,
    beforeSeated,
    seated,
    beforeTicket,
    afterTicket,
    priority,
    interleaved,
    simBudget,
    pool,
    tennisPicks,
  };
}

test("duplicate priority seats: sole seat protected, duplicates evicted, length preserved", () => {
  // Ticket: 1 NHL (sole priority) + 5 tennis duplicates (also priority on thin slate).
  const ticket = [
    makePick({
      sport: "nhl",
      game: "Bruins @ Leafs",
      pick: "Bruins +1.5",
      composite: 8.5,
    }),
    ...Array.from({ length: 5 }, (_, i) =>
      makePick({
        sport: "tennis",
        game: `P${i} @ Q${i}`,
        pick: `P${i} +3.5`,
        composite: 7 - i * 0.1,
      }),
    ),
  ];
  const wnba = makePick({
    sport: "wnba",
    game: "Aces @ Liberty",
    pick: "Aces -3.5",
    composite: 7.4,
  });
  const pool = [...ticket.map((p, i) => scored(p, 90 - i)), scored(wnba, 88)];
  const priority = ["nhl", "wnba", "tennis"] as const;
  const out = injectPrioritySportsIntoTicket(ticket, pool, 6, priority);

  assert.equal(out.length, 6, "must not drop or invent slots");
  assert.equal(
    out.filter((p) => p.sport === "nhl").length,
    1,
    "sole NHL priority seat must survive",
  );
  assert.ok(
    out.some((p) => p.sport === "wnba"),
    "WNBA must take a duplicate tennis seat",
  );
  assert.ok(
    out.filter((p) => p.sport === "tennis").length >= 1,
    "tennis may remain but duplicates are the eviction source",
  );
  // Fingerprints unique — no wasted duplicate seats of the same leg.
  const fps = out.map((p) => `${p.game}|${p.market}|${p.pick}`);
  assert.equal(new Set(fps).size, fps.length);
});

test("inject does not waste slots when every seat is a sole priority sport", () => {
  const ticket = [
    makePick({ sport: "nhl", game: "A @ B", pick: "A ML", market: "Moneyline", composite: 8 }),
    makePick({ sport: "wnba", game: "C @ D", pick: "C +3.5", composite: 7.8 }),
    makePick({ sport: "tennis", game: "E @ F", pick: "E +2.5", composite: 7.6 }),
    makePick({ sport: "nba", game: "G @ H", pick: "G +1.5", composite: 7.4 }),
    makePick({ sport: "mlb", game: "I @ J", pick: "I -1.5", composite: 7.2 }),
    makePick({ sport: "soccer", game: "K @ L", pick: "K ML", market: "Moneyline", composite: 7.0 }),
  ];
  const ncaaf = makePick({
    sport: "ncaaf",
    game: "Alabama @ Georgia",
    pick: "J. Milroe Over 224.5 Pass Yds",
    isProp: true,
    composite: 7.1,
  });
  const pool = [...ticket.map((p, i) => scored(p, 90 - i)), scored(ncaaf, 89)];
  const priority = ["nhl", "wnba", "tennis", "nba", "mlb", "soccer", "ncaaf"];
  const out = injectPrioritySportsIntoTicket(ticket, pool, 6, priority);
  assert.equal(out.length, 6);
  // All seats already sole priority — ncaaf cannot steal without inventing a 7th slot.
  assert.ok(!out.some((p) => p.sport === "ncaaf"));
  assert.deepEqual(
    new Set(out.map((p) => p.sport)).size,
    6,
    "original sole-priority mix preserved",
  );
});

for (const n of [5, 9, 15] as const) {
  test(`${n}-leg all-sports: sim coverage + seated counts by sport (before/after)`, () => {
    const r = buildMixedSlate(n);

    // Simulation coverage reaches ≥3 eligible sports within the budget window.
    const simSports = Object.keys(r.simulated).filter((s) => (r.simulated[s] ?? 0) > 0);
    assert.ok(
      simSports.length >= 3,
      `${n}-leg sim sports=${simSports} budget=${r.simBudget}`,
    );
    assert.ok(r.simulated.nhl || r.simulated.wnba || r.simulated.ncaaf);

    // First batch of interleaved entries must not be tennis-only.
    const firstBatch = r.interleaved.slice(0, 4).map(([, lines]) => lines[0]!.sport);
    assert.ok(
      new Set(firstBatch).size >= 2,
      `${n}-leg first sim batch must mix sports, got ${firstBatch}`,
    );

    const report: Record<string, SportCounts> = {};
    const sports = new Set([
      ...Object.keys(r.available),
      ...Object.keys(r.qualified),
      ...Object.keys(r.seated),
      ...Object.keys(r.beforeSeated),
    ]);
    for (const s of sports) {
      report[s] = {
        available: r.available[s] ?? 0,
        simulated: r.simulated[s] ?? 0,
        qualified: r.qualified[s] ?? 0,
        seated: r.seated[s] ?? 0,
      };
    }
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          legs: n,
          priority: r.priority,
          beforeSeated: r.beforeSeated,
          afterSeated: r.seated,
          bySport: report,
        },
        null,
        2,
      ),
    );

    assert.equal(r.afterTicket.length, n);
    // AFTER must seat a non-tennis sport when those sports qualify.
    const afterSports = new Set(Object.keys(r.seated).filter((s) => (r.seated[s] ?? 0) > 0));
    assert.ok(
      [...afterSports].some((s) => s !== "tennis"),
      `${n}-leg after seated must include non-tennis, got ${[...afterSports]}`,
    );
    // BEFORE with football-only priority: may only pull ncaaf prop, not NHL/WNBA.
    const beforeNonTennis = Object.entries(r.beforeSeated)
      .filter(([s, c]) => s !== "tennis" && c > 0)
      .map(([s]) => s);
    const afterNonTennis = Object.entries(r.seated)
      .filter(([s, c]) => s !== "tennis" && c > 0)
      .map(([s]) => s);
    assert.ok(
      afterNonTennis.length >= beforeNonTennis.length,
      `${n}-leg after non-tennis ${afterNonTennis} should not shrink vs before ${beforeNonTennis}`,
    );
    if (n >= 9) {
      assert.ok(
        afterNonTennis.length >= 2,
        `${n}-leg should seat ≥2 non-tennis sports, got ${afterNonTennis}`,
      );
    }
  });
}

const STRUFF_GAME = "Jan-Lennard Struff @ Holger Rune";

function struffPick(overrides: Partial<ParsedPick> = {}): ParsedPick {
  return {
    game: STRUFF_GAME,
    market: "Spread",
    pick: "Jan-Lennard Struff +3.5",
    odds: 160,
    isProp: false,
    sport: "tennis",
    book: "DraftKings",
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

test("Struff +3.5 @ +160: no unsupported A grade or +49.2% edge", () => {
  const pick = struffPick();
  const sim = struffSim(0.877, 0.877);
  const realOdds: RealOddsEntry[] = [
    {
      sport: "tennis",
      game: STRUFF_GAME,
      market: "Spread",
      pick: "Jan-Lennard Struff +3.5",
      odds: 160,
      book: "DraftKings",
    } as RealOddsEntry,
    {
      sport: "tennis",
      game: STRUFF_GAME,
      market: "Moneyline",
      pick: "Jan-Lennard Struff ML",
      odds: 250,
      book: "DraftKings",
    } as RealOddsEntry,
  ];

  const rawEdge = simEdgeFromHit(0.877, 160);
  assert.ok(rawEdge != null && rawEdge > 45, `pathology edge was ${rawEdge}`);

  assert.equal(tennisVerifiedCoverHit(pick, sim), null);
  assert.equal(resolveTennisSimHit(pick, sim, null, realOdds), null);
  assert.equal(gameSimHitForPick(pick, sim), null);

  const rubric = scoreGameLinePick(pick, realOdds, undefined, undefined, sim);
  const finalAi = buildFinalAiScore({
    pick,
    rubricScores: rubric?.scores ?? {
      matchup: null,
      trend: null,
      lineValue: null,
      injury: null,
      lineShopping: null,
      simulation: null,
    },
    edgePct: rubric?.edgePct ?? null,
    odds: pick.odds,
    gameSim: sim,
  });
  assert.equal(finalAi.simHit, null);
  assert.equal(finalAi.recommends, false);
  assert.ok(
    finalAi.edgePct == null || finalAi.edgePct < 20,
    `edge must not be ~49.2, got ${finalAi.edgePct}`,
  );
  // Grade may be null/low without sim — never an A from the match-win path.
  if (finalAi.grade) {
    assert.ok(
      !/^A/.test(finalAi.grade),
      `unsupported A grade from unvalidated handicap: ${finalAi.grade}`,
    );
  }
});

test("tennis handicap cover is independent of match-win (spread / strength / format)", () => {
  const mk = (cover: number, awayWin: number, line: number) => {
    const pick = struffPick({
      pick: `Jan-Lennard Struff ${line > 0 ? "+" : ""}${line}`,
      odds: -110,
    });
    const id = `${STRUFF_GAME}|spread|jan-lennard struff ${line > 0 ? "+" : ""}${line}`.toLowerCase();
    const sim: CoachGameSimEntry = {
      sport: "tennis",
      simulations: 10_000,
      homeWinProbability: 1 - awayWin,
      awayWinProbability: awayWin,
      tieProbability: 0,
      homeProjectedScore: 19,
      awayProjectedScore: 20,
      mostLikelyWinner: awayWin >= 0.5 ? "away" : "home",
      mostLikelyWinnerPct: Math.max(awayWin, 1 - awayWin),
      confidenceScore: 65,
      coverHitRates: { [id]: cover },
    };
    return { pick, sim, hit: resolveTennisSimHit(pick, sim, null) };
  };

  // Stronger player → higher cover on same +3.5 (when cover ≠ match-win).
  const weak = mk(0.55, 0.42, 3.5);
  const strong = mk(0.62, 0.58, 3.5);
  assert.equal(weak.hit, 0.55);
  assert.equal(strong.hit, 0.62);
  assert.ok((strong.hit ?? 0) > (weak.hit ?? 0));

  // Wider game spread cushion → higher cover for same match strength.
  const tight = mk(0.54, 0.5, 1.5);
  const wide = mk(0.61, 0.5, 4.5);
  assert.ok((wide.hit ?? 0) > (tight.hit ?? 0));

  // Match-win must never be returned as cover when equal (best-of-3/5 irrelevant —
  // client grades posted cover rates only; format is a remaining calibration limit).
  const mlSub = mk(0.58, 0.58, 3.5);
  assert.equal(mlSub.hit, null, "cover==match-win fails closed");

  // Document calibration ceilings used in production gates.
  assert.equal(TENNIS_HANDICAP_MAX_BOOK_GAP, 0.22);
  assert.equal(TENNIS_MATCH_STRENGTH_MAX_ML_GAP, 0.25);

  // Remaining calibration limits (honest):
  // - Tennis MC still derives game margins from match-win + form totals; best-of-3
  //   vs best-of-5 is not modeled as a separate format factor on the client.
  // - Cover rates must be posted in coverHitRates; outcomes-only fuzzy bind is
  //   not accepted by resolveTennisSimHit (fail closed).
  // - Gates reject |cover−implied|>22pp and |simML−bookML|>25pp — legitimate
  //   large edges against a mispriced book are also discarded.
});

test("tennis scoring preserves exact book/event/market/side/line/odds", () => {
  const pick = struffPick({ odds: -110, book: "DraftKings" });
  const sim = struffSim(0.58, 0.52);
  const realOdds: RealOddsEntry[] = [
    {
      sport: "tennis",
      game: STRUFF_GAME,
      market: "Spread",
      pick: "Jan-Lennard Struff +3.5",
      odds: -110,
      book: "DraftKings",
    } as RealOddsEntry,
    {
      sport: "tennis",
      game: STRUFF_GAME,
      market: "Moneyline",
      pick: "Jan-Lennard Struff ML",
      odds: -115,
      book: "DraftKings",
    } as RealOddsEntry,
  ];
  assert.equal(resolveTennisSimHit(pick, sim, null, realOdds), 0.58);
  const before = {
    game: pick.game,
    market: pick.market,
    pick: pick.pick,
    odds: pick.odds,
    sport: pick.sport,
    book: pick.book,
  };
  scoreGameLinePick(pick, realOdds, undefined, undefined, sim);
  assert.deepEqual(
    {
      game: pick.game,
      market: pick.market,
      pick: pick.pick,
      odds: pick.odds,
      sport: pick.sport,
      book: pick.book,
    },
    before,
  );
});

test("NCAAF P0 / correlation / per-game caps unchanged by this PR", () => {
  assert.equal(
    !!p0UnvalidatedSimDecision({
      market: "Spread",
      sport: "ncaaf",
      isProp: false,
    }),
    true,
    "NCAAF game-line spread still P0-blocked",
  );
  assert.equal(
    p0UnvalidatedSimDecision({
      market: "Passing Yards",
      sport: "ncaaf",
      isProp: true,
      propMarketKey: "player_pass_yds",
    }),
    null,
    "NCAAF player props still allowed",
  );
  assert.equal(maxLegsPerGame(9), 2);
  assert.equal(maxPropsPerGame(9), 2);
  assert.equal(maxLegsPerGame(5), 2);
  assert.equal(maxLegsPerGame(15), 2);
});

test("seated ticket preserves exact book/event/market/side/line/odds", () => {
  const r = buildMixedSlate(9);
  for (const leg of r.afterTicket) {
    const src = r.pool.find(
      (l) =>
        l.pick.game === leg.game &&
        l.pick.market === leg.market &&
        l.pick.pick === leg.pick,
    );
    assert.ok(src, `seated leg missing from pool: ${leg.game} ${leg.pick}`);
    assert.equal(leg.odds, src!.pick.odds);
    assert.equal(leg.book, src!.pick.book);
    assert.equal(leg.sport, src!.pick.sport);
    assert.equal(leg.market, src!.pick.market);
  }
});

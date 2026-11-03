import { exactPropFixture } from "../test/exactPropFixture.ts";
/**
 * Final pre-merge verification harness — proves shared-path behavior across
 * every Coach sport without changing production seating logic.
 *
 * Capacity note: SINGLE_EVENT_CAPS are maximum seating ceilings when enough
 * real qualified independent markets exist — not a guarantee every live event
 * can fill 4/5/8/10. Tennis/UFC underfill from currently supported feed families.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { ParsedPick } from "../components/PickCard.tsx";
import { buildStagedTicketFromScan, type BoardScoredLeg } from "./ticketStaging.ts";
import {
  SINGLE_EVENT_CAPS,
  shouldActivateSingleEventSeating,
  resolveSingleEventSeatingContext,
  seatSingleEventTicket,
  inferSingleEventKeyFromPool,
} from "./singleEventSeating.ts";
import {
  getSportSeatingAdapter,
  isFamilySeatable,
  resolveMarketFamilyId,
} from "./sportSeatingAdapters.ts";
import { marketLadderKey, marketLadderScoreKey, wouldRepeatMarketLadder } from "./marketLadderKey.ts";
import {
  maxLegsPerGame,
  maxPropsPerGame,
  selectCorrelationAwareBoardLegs,
  wouldRepeatPlayerProp,
  wouldExceedMaxPropsPerGame,
  wouldExceedMaxLegsPerGame,
  parlayCorrelationPenalty,
} from "./parlayCorrelationScore.ts";

const mainScore = {
  composite: 8,
  grade: "B+",
  confidencePct: 58,
  edgePct: 4,
  simHit: 0.56,
  simAligned: true,
  highRiskValuePlay: false,
  recommends: true,
  factors: [],
  rubric: { composite: 8, grade: "B+", confidencePct: 58, edgePct: 4, scores: {} as never },
};

function scored(
  pick: Partial<ParsedPick> & Pick<ParsedPick, "game" | "market" | "pick" | "odds">,
  rankScore: number,
): BoardScoredLeg {
  return {
    pick: exactPropFixture({ isProp: false, sport: "nfl", finalAiScore: mainScore, ...pick }),
    evPct: 2,
    edgePct: 3,
    confidencePct: 55,
    impliedProbPct: 50,
    lineShoppingScore: 1,
    grade: "B",
    simHit: 0.55,
    composite: 7,
    rankScore,
  };
}

const SPORTS: Array<{
  sport: string;
  game: string;
  ask: string;
  unsupportedFamily: string | null;
  propMarkets: string[];
}> = [
  {
    sport: "nfl",
    game: "Vikings @ Saints",
    ask: "8 leg Saints",
    unsupportedFamily: null,
    propMarkets: ["Pass Yds", "Rush Yds", "Rec Yds", "Receptions", "Pass TDs", "Anytime TD", "Sacks", "Rush Attempts"],
  },
  {
    sport: "ncaaf",
    game: "Auburn @ Alabama",
    ask: "8 leg Alabama",
    unsupportedFamily: "sacks",
    propMarkets: ["Pass Yds", "Rush Yds", "Rec Yds", "Receptions", "Pass TDs", "Anytime TD", "Rush Attempts", "Field Goals"],
  },
  {
    sport: "nba",
    game: "Celtics @ Lakers",
    ask: "8 leg same game for Celtics @ Lakers",
    unsupportedFamily: null,
    propMarkets: ["Points", "Rebounds", "Assists", "Threes", "Steals", "Blocks", "Turnovers", "PRA"],
  },
  {
    sport: "wnba",
    game: "Aces @ Liberty",
    ask: "8 leg same game for Aces @ Liberty",
    unsupportedFamily: null,
    propMarkets: ["Points", "Rebounds", "Assists", "Threes", "Steals", "Blocks", "Turnovers", "PRA"],
  },
  {
    sport: "mlb",
    game: "Yankees @ Red Sox",
    ask: "8 leg same game for Yankees @ Red Sox",
    unsupportedFamily: "walks",
    propMarkets: ["Hits", "Total Bases", "Home Runs", "Strikeouts", "RBIs", "Runs", "Stolen Bases", "Outs"],
  },
  {
    sport: "nhl",
    game: "Bruins @ Rangers",
    ask: "8 leg same game for Bruins @ Rangers",
    unsupportedFamily: "saves",
    propMarkets: ["Points", "Goals", "Assists", "Shots on Goal", "Points", "Goals", "Assists", "Shots on Goal"],
  },
  {
    sport: "soccer",
    game: "France @ Brazil",
    ask: "8 leg same game for France @ Brazil",
    unsupportedFamily: "cards",
    propMarkets: ["Shots", "Shots on Target", "Anytime Goal", "Shots", "Shots on Target", "Anytime Goal", "Shots", "Shots on Target"],
  },
  {
    sport: "tennis",
    game: "Player A @ Player B",
    ask: "8 leg same game for Player A @ Player B",
    unsupportedFamily: "aces",
    propMarkets: [],
  },
  {
    sport: "ufc",
    game: "Fighter A @ Fighter B",
    ask: "8 leg same game for Fighter A @ Fighter B",
    unsupportedFamily: "method",
    propMarkets: [],
  },
];

const PLAYERS = ["A1", "B2", "C3", "D4", "E5", "F6", "G7", "H8", "I9", "J10"];

function richPool(sport: string, game: string, propMarkets: string[]): BoardScoredLeg[] {
  const out: BoardScoredLeg[] = [];
  let r = 500;
  if (propMarkets.length) {
    for (let i = 0; i < PLAYERS.length; i++) {
      const m = propMarkets[i % propMarkets.length]!;
      out.push(
        scored(
          {
            game,
            market: m,
            pick: `${PLAYERS[i]} Over ${10.5 + i}`,
            odds: -110,
            isProp: true,
            player: PLAYERS[i],
            propLine: 10.5 + i,
            propSide: "Over",
            sport,
          },
          r--,
        ),
      );
      // Distinct ALT rung in pool (same ladder seat).
      out.push(
        scored(
          {
            game,
            market: `${m} Alt`,
            pick: `${PLAYERS[i]} Over ${20.5 + i}`,
            odds: 120,
            isProp: true,
            player: PLAYERS[i],
            propLine: 20.5 + i,
            propSide: "Over",
            propIsAlt: true,
            sport,
          },
          r - 50,
        ),
      );
      r--;
    }
  }
  out.push(scored({ game, market: "Moneyline", pick: `${game.split(" @ ")[1]} ML`, odds: -110, sport }, r--));
  out.push(scored({ game, market: "Spread", pick: `${game.split(" @ ")[1]} -3.5`, odds: -110, sport }, r--));
  out.push(
    scored(
      {
        game,
        market: sport === "ufc" ? "Total Rounds" : "Total",
        pick: "Over 45.5",
        odds: -110,
        sport,
      },
      r--,
    ),
  );
  if (sport !== "tennis" && sport !== "ufc") {
    out.push(scored({ game, market: "Team Total", pick: `${game.split(" @ ")[1]} Over 22.5`, odds: -110, sport }, r--));
    out.push(scored({ game, market: "1H Spread", pick: `${game.split(" @ ")[0]} +2.5`, odds: -110, sport }, r--));
  }
  if (sport === "ufc") {
    out.push(scored({ game, market: "Alt Total Rounds", pick: "Over 1.5", odds: 140, sport }, r--));
  }
  // Unrelated event noise — must never fill a scoped request.
  out.push(
    scored(
      {
        game: "Other Away @ Other Home",
        market: propMarkets[0] ?? "Moneyline",
        pick: propMarkets[0] ? "Zed Over 99.5" : "Other Home ML",
        odds: -110,
        isProp: !!propMarkets[0],
        player: propMarkets[0] ? "Zed Noise" : undefined,
        propLine: propMarkets[0] ? 99.5 : undefined,
        propSide: propMarkets[0] ? "Over" : undefined,
        sport,
      },
      10,
    ),
  );
  return out;
}

type Check = "PASS" | "FAIL";
type SportVerifyRow = {
  sport: string;
  adapterSelected: string;
  explicitSingleEventActivation: Check;
  eventLock: Check;
  participantCap: Check;
  marketLadderProtection: Check;
  correlationProtection: Check;
  unsupportedMarketsExcluded: Check;
  honestShortfall: Check;
};

test("capacity ceilings are maxima when independents exist — not live guarantees", () => {
  assert.deepEqual(SINGLE_EVENT_CAPS[4], { maxProps: 4, maxGameEventLines: 3 });
  assert.deepEqual(SINGLE_EVENT_CAPS[5], { maxProps: 5, maxGameEventLines: 3 });
  assert.deepEqual(SINGLE_EVENT_CAPS[8], { maxProps: 8, maxGameEventLines: 4 });
  assert.deepEqual(SINGLE_EVENT_CAPS[10], { maxProps: 10, maxGameEventLines: 5 });
  // Thin tennis/UFC boards underfill below ceiling — proves ceilings ≠ guarantees.
  for (const sport of ["tennis", "ufc"] as const) {
    const row = SPORTS.find((s) => s.sport === sport)!;
    const { picks, breakdown } = buildStagedTicketFromScan(
      richPool(sport, row.game, row.propMarkets),
      10,
      undefined,
      { askText: row.ask.replace("8", "10"), singleEventSport: sport, singleEventKey: row.game },
    );
    assert.ok(picks.length < 10, `${sport} must underfill 10-leg`);
    assert.ok(breakdown.limitingRule?.startsWith("single_event_"));
    assert.equal(picks.filter((p) => p.isProp).length, 0);
  }
});

test("shared-path verification matrix for every Coach sport", () => {
  const matrix: SportVerifyRow[] = [];

  for (const row of SPORTS) {
    const adapter = getSportSeatingAdapter(row.sport);
    const pool = richPool(row.sport, row.game, row.propMarkets);
    const { picks, breakdown } = buildStagedTicketFromScan(pool, 8, undefined, {
      askText: row.ask,
      singleEventSport: row.sport,
      singleEventKey: row.game,
    });

    const activation = shouldActivateSingleEventSeating(row.ask);
    const ctx = resolveSingleEventSeatingContext({
      askText: row.ask,
      target: 8,
      sport: row.sport,
      eventKey: row.game,
    });

    const eventLock =
      picks.length > 0 && picks.every((p) => p.game === row.game) &&
      !picks.some((p) => /Other Away/i.test(p.game));

    const props = picks.filter((p) => p.isProp);
    const players = props.map((p) => String(p.player ?? "").toLowerCase()).filter(Boolean);
    const participantCap =
      row.propMarkets.length === 0
        ? props.length === 0
        : new Set(players).size === players.length &&
          props.every((p) => !wouldRepeatPlayerProp(p, props.filter((x) => x !== p)));

    const ladders = picks.map((p) => marketLadderKey(p));
    const marketLadderProtection = new Set(ladders).size === ladders.length;

    // Correlation: same-game second GL is penalized vs cross-game; soft gate preserved.
    const glA = { game: row.game, market: "Spread", pick: "Home -3.5", isProp: false as const, sport: row.sport };
    const glB = { game: row.game, market: "Total", pick: "Over 45.5", isProp: false as const, sport: row.sport };
    const glC = { game: "X @ Y", market: "Spread", pick: "X -1", isProp: false as const, sport: row.sport };
    const correlationProtection =
      parlayCorrelationPenalty(glB, [glA]) > parlayCorrelationPenalty(glC, [glA]);

    const unsupportedMarketsExcluded =
      row.unsupportedFamily == null
        ? true
        : isFamilySeatable(adapter, row.unsupportedFamily) === false;

    const honestShortfall =
      picks.length >= 8
        ? breakdown.limitingRule == null || breakdown.limitingRule === null
        : typeof breakdown.limitingRule === "string" &&
          breakdown.limitingRule.startsWith("single_event_");

    const pass = (ok: boolean): Check => (ok ? "PASS" : "FAIL");
    matrix.push({
      sport: row.sport,
      adapterSelected: adapter.sport,
      explicitSingleEventActivation: pass(activation && ctx.active),
      eventLock: pass(eventLock),
      participantCap: pass(participantCap),
      marketLadderProtection: pass(marketLadderProtection),
      correlationProtection: pass(correlationProtection),
      unsupportedMarketsExcluded: pass(unsupportedMarketsExcluded),
      honestShortfall: pass(!!honestShortfall),
    });
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ sharedPathMatrix: matrix }, null, 2));

  for (const row of matrix) {
    assert.equal(row.explicitSingleEventActivation, "PASS", row.sport);
    assert.equal(row.eventLock, "PASS", row.sport);
    assert.equal(row.participantCap, "PASS", row.sport);
    assert.equal(row.marketLadderProtection, "PASS", row.sport);
    assert.equal(row.correlationProtection, "PASS", row.sport);
    assert.equal(row.unsupportedMarketsExcluded, "PASS", row.sport);
    assert.equal(row.honestShortfall, "PASS", row.sport);
    assert.ok(
      row.adapterSelected === row.sport || (row.sport === "ufc" && row.adapterSelected === "ufc"),
    );
  }
});

test("multi-event: old caps retained; one-game slate alone does not activate; explicit asks do", () => {
  assert.equal(maxPropsPerGame(8), 2);
  assert.equal(maxLegsPerGame(8), 2);

  // 8-leg NFL multi-game uses old caps via correlation selection.
  const nflGames = ["Vikings @ Saints", "Chiefs @ Bills", "Cowboys @ Eagles", "Packers @ Bears"];
  const nflRanked = [];
  for (const g of nflGames) {
    for (let i = 0; i < 4; i++) {
      nflRanked.push({
        pick: {
          game: g,
          market: "Pass Yds",
          pick: `P${g}${i} Over 200`,
          odds: -110,
          isProp: true as const,
          player: `P${g}${i}`,
          sport: "nfl",
        },
        rankScore: 100 - nflRanked.length,
      });
    }
  }
  const nflOut = selectCorrelationAwareBoardLegs(nflRanked, 8, { ticketTarget: 8 });
  for (const g of nflGames) {
    const propsOnG = nflOut.filter((p) => p.game === g && p.isProp);
    assert.ok(propsOnG.length <= maxPropsPerGame(8), `NFL multi-event props/game ${propsOnG.length}`);
  }

  // 8-leg NBA multi-game uses old caps.
  const nbaGames = ["Celtics @ Lakers", "Heat @ Knicks", "Suns @ Nuggets", "Bucks @ Sixers"];
  const nbaRanked = [];
  for (const g of nbaGames) {
    for (let i = 0; i < 4; i++) {
      nbaRanked.push({
        pick: {
          game: g,
          market: "Points",
          pick: `N${g}${i} Over 20`,
          odds: -110,
          isProp: true as const,
          player: `N${g}${i}`,
          sport: "nba",
        },
        rankScore: 100 - nbaRanked.length,
      });
    }
  }
  const nbaOut = selectCorrelationAwareBoardLegs(nbaRanked, 8, { ticketTarget: 8 });
  for (const g of nbaGames) {
    const propsOnG = nbaOut.filter((p) => p.game === g && p.isProp);
    assert.ok(propsOnG.length <= maxPropsPerGame(8), `NBA multi-event props/game ${propsOnG.length}`);
  }

  // One loaded game alone does NOT activate.
  assert.equal(shouldActivateSingleEventSeating("8 leg tonight"), false);
  assert.equal(shouldActivateSingleEventSeating("8 leg mixed sports"), false);
  assert.equal(inferSingleEventKeyFromPool("8 leg tonight", ["Vikings @ Saints"]), null);
  const inactive = resolveSingleEventSeatingContext({ askText: "8 leg tonight", target: 8 });
  assert.equal(inactive.active, false);

  // Explicit Saints activates.
  assert.equal(shouldActivateSingleEventSeating("8 leg Saints"), true);
  assert.equal(resolveSingleEventSeatingContext({ askText: "8 leg Saints", target: 8 }).active, true);

  // Explicit single matchup activates shared framework for other sports.
  for (const ask of [
    "8 leg same game for Celtics @ Lakers",
    "8 leg same game for Yankees @ Red Sox",
    "8 leg same game for Bruins @ Rangers",
    "8 leg same game for France @ Brazil",
    "same game parlay for Player A @ Player B",
    "8 leg same game for Fighter A @ Fighter B",
  ]) {
    assert.equal(shouldActivateSingleEventSeating(ask), true, ask);
  }

  // wouldExceed helpers still enforce multi-event caps.
  const ticket = [
    { game: "A @ B", market: "Points", pick: "P1 Over 1", isProp: true, player: "P1" },
    { game: "A @ B", market: "Rebounds", pick: "P2 Over 1", isProp: true, player: "P2" },
  ];
  assert.equal(
    wouldExceedMaxPropsPerGame(
      { game: "A @ B", market: "Assists", pick: "P3 Over 1", isProp: true, player: "P3" },
      ticket,
      maxPropsPerGame(8),
    ),
    true,
  );
  assert.equal(
    wouldExceedMaxLegsPerGame(
      { game: "A @ B", market: "Total", pick: "Over 220", isProp: false },
      [
        { game: "A @ B", market: "Spread", pick: "A +3", isProp: false },
        { game: "A @ B", market: "Moneyline", pick: "A ML", isProp: false },
      ],
      maxLegsPerGame(8),
    ),
    true,
  );
});

test("ALT regression across applicable sports: distinct in pool, one seat, not preferred over independents", () => {
  const applicable = SPORTS.filter((s) => s.propMarkets.length > 0);
  const report: Array<Record<string, unknown>> = [];

  for (const row of applicable) {
    const m = row.propMarkets[0]!;
    const main = {
      game: row.game,
      market: m,
      pick: "Star Over 10.5",
      isProp: true as const,
      player: "Star Player",
      propSide: "Over",
      propLine: 10.5,
      sport: row.sport,
    };
    const alt = {
      ...main,
      market: `${m} Alt`,
      pick: "Star Over 20.5",
      propLine: 20.5,
      propIsAlt: true,
    };
    const distinctInPool = marketLadderScoreKey(main) !== marketLadderScoreKey(alt);
    const sameSeat = marketLadderKey(main) === marketLadderKey(alt);
    const ladderBlocks = wouldRepeatMarketLadder(alt, [main]);

    // ALT not preferred ahead of stronger independents when seating.
    const ranked = [
      {
        pick: {
          ...main,
          finalAiScore: mainScore,
          odds: -110,
        },
        rankScore: 50, // weaker main rung
      },
      {
        pick: {
          ...alt,
          finalAiScore: mainScore,
          odds: 150,
        },
        rankScore: 99, // high-rank ALT same ladder
      },
      {
        pick: {
          game: row.game,
          market: row.propMarkets[1] ?? "Moneyline",
          pick: row.propMarkets[1] ? "Other Over 5.5" : `${row.game.split(" @ ")[1]} ML`,
          odds: -110,
          isProp: !!row.propMarkets[1],
          player: row.propMarkets[1] ? "Other Star" : undefined,
          propLine: row.propMarkets[1] ? 5.5 : undefined,
          propSide: row.propMarkets[1] ? "Over" : undefined,
          sport: row.sport,
          finalAiScore: mainScore,
        },
        rankScore: 80,
      },
      {
        pick: {
          game: row.game,
          market: "Moneyline",
          pick: `${row.game.split(" @ ")[1]} ML`,
          odds: -110,
          isProp: false,
          sport: row.sport,
          finalAiScore: mainScore,
        },
        rankScore: 70,
      },
    ];
    const seated = seatSingleEventTicket<ParsedPick>(ranked, {
      target: 3,
      eventKey: row.game,
      sport: row.sport,
    });
    const starSeats = seated.picks.filter((p) => String(p.player ?? "").includes("Star Player"));
    const altPreferredAlone =
      starSeats.length === 1 && starSeats[0]!.propIsAlt === true && seated.picks.length === 1;
    // Must not fill with only ALT stacking — either main ladder once, plus other independents.
    const altNotAheadOfIndependents =
      !altPreferredAlone &&
      starSeats.length <= 1 &&
      seated.picks.some((p) => p.player === "Other Star" || p.market === "Moneyline");

    report.push({
      sport: row.sport,
      distinctInPool,
      sameSeatLadder: sameSeat,
      ladderBlocks,
      altNotAheadOfIndependents,
      seatedMarkets: seated.picks.map((p) => p.market),
    });

    assert.equal(distinctInPool, true, row.sport);
    assert.equal(sameSeat, true, row.sport);
    assert.equal(ladderBlocks, true, row.sport);
    assert.equal(altNotAheadOfIndependents, true, row.sport);
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ altRegression: report }, null, 2));
});

function pctile(samples: number[], p: number): number {
  const s = [...samples].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(s.length * p)))]!;
}

function bench(fn: () => void, rounds = 40): { p50: number; p95: number; mean: number } {
  for (let i = 0; i < 8; i++) fn(); // warm-up
  const samples: number[] = [];
  for (let i = 0; i < rounds; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  return { p50: pctile(samples, 0.5), p95: pctile(samples, 0.95), mean };
}

function identicalFixturePool(): BoardScoredLeg[] {
  // Fixed size: 120 props + 40 GLs = 160 candidates (same as prior perf proof).
  const game = "Vikings @ Saints";
  const out: BoardScoredLeg[] = [];
  for (let i = 0; i < 120; i++) {
    out.push(
      scored(
        {
          game,
          market: i % 2 ? "Pass Yds" : "Rush Yds",
          pick: `Player${i} Over ${100 + i}`,
          odds: -110,
          isProp: true,
          player: `Player${i}`,
          propLine: 100 + i,
          propSide: "Over",
          sport: "nfl",
        },
        1000 - i,
      ),
    );
  }
  for (let i = 0; i < 40; i++) {
    const markets = ["Moneyline", "Spread", "Total", "1H Spread", "Team Total"] as const;
    out.push(
      scored(
        {
          game,
          market: markets[i % markets.length]!,
          pick: `Saints line ${i}`,
          odds: -110,
          sport: "nfl",
        },
        500 - i,
      ),
    );
  }
  return out;
}

test("performance benchmark: multi-event vs single-event 4/8/10 on identical fixtures", () => {
  const pool = identicalFixturePool();
  assert.equal(pool.length, 160);

  const multi = bench(() => {
    buildStagedTicketFromScan(pool, 8, undefined, { askText: "8 leg tonight" });
  });
  const se4 = bench(() => {
    buildStagedTicketFromScan(pool, 4, undefined, {
      askText: "4 leg Saints",
      singleEventKey: "Vikings @ Saints",
      singleEventSport: "nfl",
    });
  });
  const se8 = bench(() => {
    buildStagedTicketFromScan(pool, 8, undefined, {
      askText: "8 leg Saints",
      singleEventKey: "Vikings @ Saints",
      singleEventSport: "nfl",
    });
  });
  const se10 = bench(() => {
    buildStagedTicketFromScan(pool, 10, undefined, {
      askText: "10 leg Saints",
      singleEventKey: "Vikings @ Saints",
      singleEventSport: "nfl",
    });
  });

  const report = {
    fixtureCandidates: pool.length,
    warmUp: 8,
    iterations: 40,
    multiEvent_8leg_ms: multi,
    singleEvent_4leg_ms: se4,
    singleEvent_8leg_ms: se8,
    singleEvent_10leg_ms: se10,
    delta_se8_vs_multi_p50_ms: se8.p50 - multi.p50,
    delta_se8_vs_multi_p50_pct: multi.p50 > 0 ? ((se8.p50 - multi.p50) / multi.p50) * 100 : 0,
    delta_se8_vs_multi_p95_ms: se8.p95 - multi.p95,
    delta_se8_vs_multi_p95_pct: multi.p95 > 0 ? ((se8.p95 - multi.p95) / multi.p95) * 100 : 0,
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ performanceBenchmark: report }, null, 2));

  // Material slowdown gate only — do not require a speedup.
  const materialP95 = se8.p95 > multi.p95 + 5 && se8.p95 > 20;
  const materialP50 = se8.p50 > multi.p50 + 5 && se8.p50 > 15;
  assert.equal(materialP95, false, `material p95 slowdown: multi=${multi.p95} se8=${se8.p95}`);
  assert.equal(materialP50, false, `material p50 slowdown: multi=${multi.p50} se8=${se8.p50}`);
  assert.ok(se4.p95 < 30 && se10.p95 < 30);
});

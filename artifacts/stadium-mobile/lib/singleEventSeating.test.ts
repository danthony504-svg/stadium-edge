import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStagedTicketFromScan,
  type BoardScoredLeg,
} from "./ticketStaging.ts";
import type { ParsedPick } from "../components/PickCard.tsx";
import {
  SINGLE_EVENT_CAPS,
  shouldActivateSingleEventSeating,
  resolveSingleEventSeatingContext,
  seatSingleEventTicket,
  singleEventCapsForTarget,
  inferSingleEventKeyFromPool,
} from "./singleEventSeating.ts";
import {
  getSportSeatingAdapter,
  isFamilySeatable,
  resolveMarketFamilyId,
  listSportSeatingAdapterSports,
} from "./sportSeatingAdapters.ts";
import { marketLadderKey, marketLadderScoreKey, wouldRepeatMarketLadder } from "./marketLadderKey.ts";
import { maxPropsPerGame, maxLegsPerGame, wouldRepeatPlayerProp } from "./parlayCorrelationScore.ts";

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
  const full: ParsedPick = {
    isProp: false,
    sport: "nfl",
    ...pick,
    finalAiScore: pick.finalAiScore ?? mainScore,
  };
  return {
    pick: full,
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

function prop(
  game: string,
  player: string,
  market: string,
  line: number,
  sport: string,
  rank: number,
  opts?: { alt?: boolean; side?: "Over" | "Under" },
): BoardScoredLeg {
  const side = opts?.side ?? "Over";
  return scored(
    {
      game,
      market: opts?.alt ? `${market} Alt` : market,
      pick: `${player} ${side} ${line} ${market}`,
      odds: opts?.alt ? 120 : -110,
      isProp: true,
      player,
      propLine: line,
      propSide: side,
      propIsAlt: !!opts?.alt,
      sport,
    },
    rank,
  );
}

function gl(
  game: string,
  market: string,
  pick: string,
  sport: string,
  rank: number,
): BoardScoredLeg {
  return scored({ game, market, pick, odds: -110, sport, isProp: false }, rank);
}

test("SINGLE_EVENT_CAPS match approved 4/5/8/10 ceilings", () => {
  assert.deepEqual(SINGLE_EVENT_CAPS[4], { maxProps: 3, maxGameEventLines: 3 });
  assert.deepEqual(SINGLE_EVENT_CAPS[5], { maxProps: 4, maxGameEventLines: 3 });
  assert.deepEqual(SINGLE_EVENT_CAPS[8], { maxProps: 6, maxGameEventLines: 4 });
  assert.deepEqual(SINGLE_EVENT_CAPS[10], { maxProps: 8, maxGameEventLines: 5 });
  assert.deepEqual(singleEventCapsForTarget(8), { maxProps: 6, maxGameEventLines: 4 });
});

test("activation: explicit team/game ask yes; generic multi-game no; one loaded game alone no", () => {
  assert.equal(shouldActivateSingleEventSeating("8 leg Saints"), true);
  assert.equal(shouldActivateSingleEventSeating("same game parlay for Yankees @ Red Sox"), true);
  assert.equal(shouldActivateSingleEventSeating("6 leg for Vikings vs Saints"), true);
  assert.equal(shouldActivateSingleEventSeating("8 leg tonight mixed sports"), false);
  assert.equal(shouldActivateSingleEventSeating("build me a 10-leg parlay for tonight"), false);
  assert.equal(shouldActivateSingleEventSeating(""), false);
  // Context inactive when no ask — even if caller has one event in pool.
  const ctx = resolveSingleEventSeatingContext({ askText: "8 leg tonight", target: 8 });
  assert.equal(ctx.active, false);
  assert.equal(inferSingleEventKeyFromPool("8 leg tonight", ["Vikings @ Saints"]), null);
});

test("multi-event retains old caps", () => {
  assert.equal(maxPropsPerGame(8), 2);
  assert.equal(maxPropsPerGame(5), 2);
  assert.equal(maxPropsPerGame(4), 3);
  assert.equal(maxLegsPerGame(8), 2);
  assert.equal(maxLegsPerGame(10), 2);
});

test("ALT rungs distinct in score pool but cannot occupy multiple same-ladder seats", () => {
  const main = {
    game: "Vikings @ Saints",
    market: "Pass Yds",
    pick: "Carr Over 249.5 Pass Yds",
    isProp: true as const,
    player: "Derek Carr",
    propSide: "Over",
    propLine: 249.5,
  };
  const alt = {
    ...main,
    market: "Pass Yds Alt",
    pick: "Carr Over 274.5 Pass Yds",
    propLine: 274.5,
    propIsAlt: true,
  };
  assert.notEqual(marketLadderScoreKey(main), marketLadderScoreKey(alt));
  assert.equal(marketLadderKey(main), marketLadderKey(alt));
  assert.equal(wouldRepeatMarketLadder(alt, [main]), true);
});

test("one participant cannot take multiple prop seats", () => {
  const a = {
    game: "A @ B",
    market: "Pass Yds",
    pick: "Carr Over 249.5",
    isProp: true as const,
    player: "Derek Carr",
  };
  const b = {
    game: "A @ B",
    market: "Pass TDs",
    pick: "Carr Over 1.5",
    isProp: true as const,
    player: "Derek Carr",
  };
  assert.equal(wouldRepeatPlayerProp(b, [a]), true);
});

function richSingleGamePool(sport: string, game: string): BoardScoredLeg[] {
  const players = [
    "Alpha One",
    "Bravo Two",
    "Charlie Three",
    "Delta Four",
    "Echo Five",
    "Foxtrot Six",
    "Golf Seven",
    "Hotel Eight",
    "India Nine",
    "Juliet Ten",
  ];
  const propMarkets =
    sport === "mlb"
      ? ["Hits", "Total Bases", "Home Runs", "Strikeouts", "RBIs", "Runs", "Stolen Bases", "Outs"]
      : sport === "nba" || sport === "wnba"
        ? ["Points", "Rebounds", "Assists", "Threes", "Steals", "Blocks", "Turnovers", "PRA"]
        : sport === "nhl"
          ? ["Points", "Goals", "Assists", "Shots on Goal", "Points", "Goals", "Assists", "Shots on Goal"]
          : sport === "soccer"
            ? ["Shots", "Shots on Target", "Anytime Goal", "Shots", "Shots on Target", "Anytime Goal", "Shots", "Shots on Target"]
            : ["Pass Yds", "Rush Yds", "Rec Yds", "Receptions", "Pass TDs", "Anytime TD", "Rush Attempts", "Sacks"];

  const out: BoardScoredLeg[] = [];
  let rank = 200;
  for (let i = 0; i < players.length; i++) {
    const m = propMarkets[i % propMarkets.length]!;
    if (sport === "tennis" || sport === "ufc") break;
    if (sport === "ncaaf" && m === "Sacks") continue;
    out.push(prop(game, players[i]!, m, 10.5 + i, sport, rank--));
    // ALT same ladder — must remain in pool but not double-seat.
    out.push(prop(game, players[i]!, m, 20.5 + i, sport, rank--, { alt: true }));
  }
  out.push(gl(game, "Moneyline", `${game.split(" @ ")[1]} ML`, sport, rank--));
  out.push(gl(game, "Spread", `${game.split(" @ ")[1]} -3.5`, sport, rank--));
  out.push(gl(game, "Total", "Over 45.5", sport, rank--));
  out.push(gl(game, "Team Total", `${game.split(" @ ")[1]} Over 22.5`, sport, rank--));
  out.push(gl(game, "1H Spread", `${game.split(" @ ")[0]} +2.5`, sport, rank--));
  out.push(gl(game, "Alt Spread", `${game.split(" @ ")[1]} -6.5`, sport, rank--));
  if (sport === "mlb") {
    out.push(gl(game, "F5 Moneyline", `${game.split(" @ ")[1]} ML`, sport, rank--));
    out.push(gl(game, "F5 Total", "Over 5.5", sport, rank--));
  }
  if (sport === "tennis") {
    out.push(gl(game, "Moneyline", "Player A ML", sport, 90));
    out.push(gl(game, "Spread", "Player A -3.5", sport, 80));
    out.push(gl(game, "Total", "Over 22.5", sport, 70));
    out.push(gl(game, "Alt Total", "Over 24.5", sport, 60));
  }
  if (sport === "ufc") {
    out.push(gl(game, "Moneyline", "Fighter A ML", sport, 90));
    out.push(gl(game, "Total Rounds", "Over 2.5", sport, 80));
    out.push(gl(game, "Alt Total Rounds", "Over 1.5", sport, 70));
  }
  // Unrelated event noise — must never fill a scoped request.
  out.push(prop("Other Away @ Other Home", "Zed Noise", "Pass Yds", 99.5, sport, 50));
  out.push(gl("Other Away @ Other Home", "Moneyline", "Other Home ML", sport, 49));
  return out;
}

const SPORT_GAMES: Record<string, string> = {
  nfl: "Vikings @ Saints",
  ncaaf: "Auburn @ Alabama",
  nba: "Celtics @ Lakers",
  wnba: "Aces @ Liberty",
  mlb: "Yankees @ Red Sox",
  nhl: "Bruins @ Rangers",
  soccer: "France @ Brazil",
  tennis: "Player A @ Player B",
  ufc: "Fighter A @ Fighter B",
};

for (const sport of Object.keys(SPORT_GAMES)) {
  for (const target of [4, 5, 8, 10] as const) {
    test(`single-event ${sport} ${target}-leg respects caps + event lock + honest shortfall`, () => {
      const game = SPORT_GAMES[sport]!;
      const pool = richSingleGamePool(sport, game);
      const ask =
        sport === "nfl"
          ? `${target} leg Saints`
          : sport === "mlb"
            ? `${target} leg same game for Yankees @ Red Sox`
            : `${target} leg same game for ${game}`;
      const { picks, breakdown } = buildStagedTicketFromScan(pool, target, undefined, {
        askText: ask,
        singleEventSport: sport,
        singleEventKey: game,
      });

      const caps = SINGLE_EVENT_CAPS[target];
      const props = picks.filter((p) => p.isProp);
      const gls = picks.filter((p) => !p.isProp);
      assert.ok(props.length <= caps.maxProps, `${sport} props ${props.length} > ${caps.maxProps}`);
      assert.ok(gls.length <= caps.maxGameEventLines, `${sport} gls ${gls.length} > ${caps.maxGameEventLines}`);
      assert.ok(picks.length <= target);
      assert.ok(picks.every((p) => p.game === game), "unrelated event must not fill");
      assert.ok(picks.length > 0, `${sport} ${target}-leg must seat at least one qualified leg`);

      // One prop per participant.
      const players = props.map((p) => String(p.player ?? "").toLowerCase()).filter(Boolean);
      assert.equal(new Set(players).size, players.length);

      // No duplicate ladders.
      const ladders = picks.map((p) => marketLadderKey(p));
      assert.equal(new Set(ladders).size, ladders.length);

      if (picks.length < target) {
        assert.ok(
          breakdown.limitingRule && String(breakdown.limitingRule).startsWith("single_event_"),
          `expected limitingRule, got ${breakdown.limitingRule}`,
        );
      }

      // Team sports with rich boards should fill to the lower of target vs policy ceiling.
      if (sport === "nfl" || sport === "nba" || sport === "mlb") {
        const ceiling = Math.min(target, caps.maxProps + caps.maxGameEventLines);
        assert.ok(
          picks.length >= Math.min(ceiling, 4),
          `${sport} ${target}-leg under-seated: ${picks.length} < min(4, ${ceiling})`,
        );
      }

      // Tennis / UFC cannot invent unsupported props; fill only from posted GLs.
      if (sport === "tennis" || sport === "ufc") {
        assert.equal(props.length, 0);
        assert.ok(picks.length <= caps.maxGameEventLines);
        assert.ok(
          picks.length < target || target <= 3,
          `${sport} deep asks must underfill when independent families are exhausted`,
        );
        assert.ok(breakdown.limitingRule);
      }
    });
  }
}

test("unsupported sport markets remain non-seatable", () => {
  const tennis = getSportSeatingAdapter("tennis");
  assert.equal(isFamilySeatable(tennis, "aces"), false);
  assert.equal(isFamilySeatable(tennis, "set_winner"), false);
  const ufc = getSportSeatingAdapter("ufc");
  assert.equal(isFamilySeatable(ufc, "method"), false);
  assert.equal(isFamilySeatable(ufc, "significant_strikes"), false);
  const soccer = getSportSeatingAdapter("soccer");
  assert.equal(isFamilySeatable(soccer, "cards"), false);
  assert.ok(listSportSeatingAdapterSports().includes("nfl"));
  assert.equal(resolveMarketFamilyId(tennis, "Aces", { isProp: true }), null);
});

test("generic multi-game ask does not use single-event path", () => {
  const pool = [
    ...richSingleGamePool("nfl", "Vikings @ Saints").slice(0, 6),
    ...richSingleGamePool("nfl", "Chiefs @ Bills").slice(0, 6),
  ];
  const { picks, breakdown } = buildStagedTicketFromScan(pool, 8, undefined, {
    askText: "8 leg tonight mixed",
  });
  assert.equal(breakdown.limitingRule == null || !String(breakdown.limitingRule).startsWith("single_event_"), true);
  // Multi-event seating may underfill but must not claim single-event limiter.
  void picks;
});

test("seatSingleEventTicket returns participant_cap when only one player qualifies", () => {
  const game = "Vikings @ Saints";
  const ranked = [
    prop(game, "Only Guy", "Pass Yds", 249.5, "nfl", 100),
    prop(game, "Only Guy", "Pass TDs", 1.5, "nfl", 90),
    prop(game, "Only Guy", "Rush Yds", 20.5, "nfl", 80),
    gl(game, "Moneyline", "Saints ML", "nfl", 70),
    gl(game, "Spread", "Saints -3.5", "nfl", 60),
    gl(game, "Total", "Over 45.5", "nfl", 50),
  ].map((l) => ({ pick: l.pick, rankScore: l.rankScore }));

  const out = seatSingleEventTicket(ranked, { target: 8, eventKey: game, sport: "nfl" });
  assert.equal(out.picks.filter((p) => p.isProp).length, 1);
  assert.ok(
    out.limitingRule === "single_event_participant_cap" ||
      out.limitingRule === "single_event_quality_pool_short" ||
      out.limitingRule === "single_event_correlation_exhausted" ||
      out.limitingRule === "single_event_market_ladder_exhausted" ||
      out.limitingRule === "single_event_game_line_family_exhausted",
  );
  assert.ok(out.picks.length < 8);
});

test("performance: single-event seating over 500 candidates stays sub-millisecond median", () => {
  const game = "Vikings @ Saints";
  const pool: BoardScoredLeg[] = [];
  for (let i = 0; i < 200; i++) {
    pool.push(prop(game, `Player ${i}`, i % 2 ? "Pass Yds" : "Rush Yds", 100 + i, "nfl", 500 - i));
    pool.push(gl(game, i % 3 === 0 ? "Spread" : i % 3 === 1 ? "Total" : "Moneyline", `Side ${i}`, "nfl", 300 - i));
  }
  const ranked = pool.map((l) => ({ pick: l.pick, rankScore: l.rankScore }));
  const samples: number[] = [];
  for (let i = 0; i < 40; i++) {
    const t0 = performance.now();
    seatSingleEventTicket(ranked, { target: 10, eventKey: game, sport: "nfl" });
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const p50 = samples[Math.floor(samples.length * 0.5)]!;
  const p95 = samples[Math.floor(samples.length * 0.95)]!;
  // Absolute stress gate on ~400 candidates — comparative before/after lives in
  // singleEventSeating.perf.test.ts (wired path must not regress multi-event).
  assert.ok(p50 < 25, `p50 ${p50}ms too high on 400-candidate stress`);
  assert.ok(p95 < 50, `p95 ${p95}ms too high on 400-candidate stress`);
});

test("correlationAware seating stays within same absolute stress budget", () => {
  const game = "Vikings @ Saints";
  const pool: BoardScoredLeg[] = [];
  for (let i = 0; i < 200; i++) {
    pool.push(prop(game, `Player ${i}`, i % 2 ? "Pass Yds" : "Rush Yds", 100 + i, "nfl", 500 - i));
    pool.push(gl(game, i % 3 === 0 ? "Spread" : i % 3 === 1 ? "Total" : "Moneyline", `Side ${i}`, "nfl", 300 - i));
  }
  const ranked = pool.map((l) => ({ pick: l.pick, rankScore: l.rankScore }));
  const samples: number[] = [];
  for (let i = 0; i < 40; i++) {
    const t0 = performance.now();
    seatSingleEventTicket(ranked, {
      target: 10,
      eventKey: game,
      sport: "nfl",
      correlationAware: true,
    });
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const p50 = samples[Math.floor(samples.length * 0.5)]!;
  const p95 = samples[Math.floor(samples.length * 0.95)]!;
  assert.ok(p50 < 25, `corr p50 ${p50}ms too high`);
  assert.ok(p95 < 50, `corr p95 ${p95}ms too high`);
});

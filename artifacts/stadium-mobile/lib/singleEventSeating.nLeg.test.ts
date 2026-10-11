/**
 * Phase 3: when ≥N genuinely qualified distinct props exist after
 * sim/edge/grade/confidence/ladder/correlation protections, staging must be
 * capable of seating N — including when game lines are unavailable.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildStagedTicketFromScan, type BoardScoredLeg } from "./ticketStaging.ts";
import type { ParsedPick } from "../components/PickCard.tsx";
import {
  effectiveSingleEventCaps,
  seatSingleEventTicket,
  singleEventCapsForTarget,
  SINGLE_EVENT_CAPS,
} from "./singleEventSeating.ts";

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

function propLeg(
  game: string,
  sport: string,
  player: string,
  market: string,
  line: number,
  rank: number,
): BoardScoredLeg {
  const pick: ParsedPick = {
    game,
    market,
    pick: `${player} Over ${line}`,
    odds: -110,
    isProp: true,
    player,
    propLine: line,
    propSide: "Over",
    sport,
    finalAiScore: mainScore,
  };
  return {
    pick,
    evPct: 3,
    edgePct: 4,
    confidencePct: 58,
    impliedProbPct: 52,
    lineShoppingScore: 1,
    grade: "B+",
    simHit: 0.56,
    composite: 8,
    rankScore: rank,
  };
}

function propsOnlyPool(sport: string, game: string, n: number, markets: string[]): BoardScoredLeg[] {
  const out: BoardScoredLeg[] = [];
  for (let i = 0; i < n; i++) {
    out.push(
      propLeg(game, sport, `Player ${i + 1}`, markets[i % markets.length]!, 10.5 + i, 1000 - i),
    );
  }
  return out;
}

const SPORT_MARKETS: Record<string, { game: string; markets: string[]; ask: (n: number) => string }> = {
  nfl: {
    game: "Vikings @ Saints",
    markets: ["Pass Yds", "Rush Yds", "Rec Yds", "Receptions", "Pass TDs", "Anytime TD", "Rush Attempts", "Sacks"],
    ask: (n) => `${n} leg Saints`,
  },
  ncaaf: {
    game: "Auburn @ Alabama",
    markets: ["Pass Yds", "Rush Yds", "Rec Yds", "Receptions", "Pass TDs", "Anytime TD", "Rush Attempts"],
    ask: (n) => `${n} leg same game for Auburn @ Alabama`,
  },
  nba: {
    game: "Celtics @ Lakers",
    markets: ["Points", "Rebounds", "Assists", "Threes", "Steals", "Blocks", "Turnovers", "PRA"],
    ask: (n) => `${n} leg same game for Celtics @ Lakers`,
  },
  wnba: {
    game: "Aces @ Liberty",
    markets: ["Points", "Rebounds", "Assists", "Threes", "Steals", "Blocks"],
    ask: (n) => `${n} leg same game for Aces @ Liberty`,
  },
  mlb: {
    game: "Yankees @ Red Sox",
    markets: ["Hits", "Total Bases", "Home Runs", "Strikeouts", "RBIs", "Runs", "Stolen Bases", "Outs"],
    ask: (n) => `${n} leg same game for Yankees @ Red Sox`,
  },
  nhl: {
    game: "Bruins @ Rangers",
    markets: ["Points", "Goals", "Assists", "Shots on Goal"],
    ask: (n) => `${n} leg same game for Bruins @ Rangers`,
  },
  soccer: {
    game: "France @ Brazil",
    markets: ["Shots", "Shots on Target", "Anytime Goal"],
    ask: (n) => `${n} leg same game for France @ Brazil`,
  },
};

test("effectiveSingleEventCaps lifts maxProps when GLs unavailable", () => {
  const pref = singleEventCapsForTarget(7);
  assert.deepEqual(pref, SINGLE_EVENT_CAPS[5]); // composition preference
  const caps = effectiveSingleEventCaps({
    target: 7,
    preference: pref,
    distinctQualifiedProps: 10,
    availableGameEventLines: 0,
  });
  assert.equal(caps.maxProps, 7);
  assert.equal(caps.maxGameEventLines, 0);
});

test("effectiveSingleEventCaps keeps composition preference when both props and GLs exist", () => {
  const caps = effectiveSingleEventCaps({
    target: 7,
    preference: SINGLE_EVENT_CAPS[5],
    distinctQualifiedProps: 10,
    availableGameEventLines: 5,
  });
  assert.equal(caps.maxProps, 4);
  assert.equal(caps.maxGameEventLines, 3);
  assert.equal(caps.maxProps + caps.maxGameEventLines, 7);
});

for (const target of [4, 5, 6, 7, 8, 9, 10, 12] as const) {
  for (const sport of Object.keys(SPORT_MARKETS)) {
    test(`requested=${target} props-only ≥N seats ${target} for ${sport}`, () => {
      const meta = SPORT_MARKETS[sport]!;
      const pool = propsOnlyPool(sport, meta.game, Math.max(target + 3, 12), meta.markets);
      const { picks, breakdown } = buildStagedTicketFromScan(pool, target, undefined, {
        askText: meta.ask(target),
        singleEventSport: sport,
        singleEventKey: meta.game,
      });
      assert.equal(picks.length, target, `${sport} ${target}: seated ${picks.length}`);
      assert.ok((breakdown.qualifiedInScope ?? 0) >= target);
      assert.ok(picks.every((p) => p.isProp), "props-only pool");
      assert.ok(picks.every((p) => p.game === meta.game));
      // One prop per player.
      const players = picks.map((p) => String(p.player ?? "").toLowerCase());
      assert.equal(new Set(players).size, players.length);
      assert.equal(breakdown.limitingRule, null);
    });
  }
}

test("requested=7, qualified distinct props≥7, game lines unavailable → 7 legs", () => {
  const game = "Vikings @ Saints";
  const pool = propsOnlyPool("nfl", game, 12, SPORT_MARKETS.nfl!.markets);
  const ranked = pool.map((l) => ({ pick: l.pick, rankScore: l.rankScore }));
  const seated = seatSingleEventTicket(ranked, {
    target: 7,
    eventKey: game,
    sport: "nfl",
  });
  assert.equal(seated.picks.length, 7);
  assert.equal(seated.limitingRule, null);
  assert.ok(seated.caps.maxProps >= 7);
  // Preference was 4 — effective lift must have occurred.
  assert.ok(SINGLE_EVENT_CAPS[5].maxProps < 7);
});

test("does not fill N merely because N was requested — thin pool shortfalls honestly", () => {
  const game = "Vikings @ Saints";
  const pool = propsOnlyPool("nfl", game, 3, ["Pass Yds"]);
  const { picks, breakdown } = buildStagedTicketFromScan(pool, 7, undefined, {
    askText: "7 leg Saints",
    singleEventSport: "nfl",
    singleEventKey: game,
  });
  assert.equal(picks.length, 3);
  assert.ok(breakdown.limitingRule);
  assert.ok((breakdown.qualifiedInScope ?? 0) >= 3);
});

test("period prop markets are not seatable", () => {
  const game = "Celtics @ Lakers";
  const pool: BoardScoredLeg[] = [
    propLeg(game, "nba", "Star", "player_points_q1", 8.5, 100),
    propLeg(game, "nba", "Star2", "Points", 24.5, 90),
  ];
  const seated = seatSingleEventTicket(
    pool.map((l) => ({ pick: l.pick, rankScore: l.rankScore })),
    { target: 4, eventKey: game, sport: "nba" },
  );
  assert.ok(!seated.picks.some((p) => /_q1|_h1/i.test(p.market)));
  assert.ok(seated.picks.some((p) => p.player === "Star2"));
});

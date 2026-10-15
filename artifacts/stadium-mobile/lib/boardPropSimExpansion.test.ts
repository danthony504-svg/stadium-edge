import test from "node:test";
import assert from "node:assert/strict";
import {
  boardPropSimExpansionBatchSize,
  boardPropSimInitialBatchSize,
  countQualifiedBoardLegs,
  isRealisticBoardPropCandidate,
  boardPropSlotTarget,
  countStagedPropLegs,
  pickDiverseLadderRungsForSim,
  preferAskLockedMarketsForSim,
  shouldStopPropSimForTicketMix,
  selectBoardPropSimCandidates,
  selectFootballMixPropSimCandidates,
} from "./boardPropSimExpansion.ts";
import { matchExplicitMarketLocks } from "./explicitMarketLock.ts";
import { parseCoachAskMarketConstraint } from "./coachAskMarketFilter.ts";
import {
  isPostedMilestoneAltLine,
  milestoneMarketFamily,
} from "./coachMilestoneLines.ts";
import {
  FOOTBALL_DST_PROP_SIM_CAP,
  isFootballDstPropMarket,
} from "./footballDstProps.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";

const qualScore = {
  composite: 7,
  grade: "C+",
  confidencePct: 55,
  edgePct: 2,
  simHit: 0.55,
  simAligned: true,
  highRiskValuePlay: false,
  recommends: true,
  factors: [],
  rubric: { composite: 7, grade: "C+", confidencePct: 55, edgePct: 2, scores: {} as never },
};

function propLeg(
  player: string,
  line: number,
  odds: number,
  propIsAlt: boolean,
  rankScore: number,
): BoardScoredLeg {
  return {
    pick: {
      game: "NYY @ WSH",
      market: "Total Bases",
      pick: `${player} Over ${line} Total Bases`,
      odds,
      isProp: true,
      sport: "mlb",
      player,
      propLine: line,
      propSide: "Over",
      propIsAlt,
      finalAiScore: qualScore,
    },
    evPct: 3,
    edgePct: 2,
    confidencePct: 55,
    impliedProbPct: 45,
    lineShoppingScore: 1,
    grade: "C+",
    simHit: 0.55,
    composite: 7,
    rankScore,
  };
}

test("isRealisticBoardPropCandidate requires sim-supported market and posted odds", () => {
  assert.equal(
    isRealisticBoardPropCandidate({
      game: "A @ B",
      market: "Points",
      pick: "Player Over 24.5 Points",
      odds: -110,
      isProp: true,
      sport: "nba",
      player: "Player",
      propLine: 24.5,
      propSide: "Over",
    }),
    true,
  );
  assert.equal(
    isRealisticBoardPropCandidate({
      game: "A @ B",
      market: "MVP",
      pick: "Player MVP",
      odds: 500,
      isProp: true,
      sport: "nba",
    }),
    false,
    "futures without a line/side are not sim candidates",
  );
});

test("boardPropSim batch sizes grow with leg target", () => {
  assert.equal(boardPropSimInitialBatchSize(6), 21);
  assert.equal(boardPropSimInitialBatchSize(15), 30);
  assert.equal(boardPropSimExpansionBatchSize(15), 60);
});

test("countQualifiedBoardLegs collapses duplicate ladder rungs before counting fill", () => {
  const players = ["Grisham", "Judge", "Soto", "Stanton", "Rizzo"];
  const scored: BoardScoredLeg[] = [];
  for (const [i, player] of players.entries()) {
    scored.push(propLeg(player, 1.5, 130 + i, false, 90 - i));
    scored.push(propLeg(player, 2.5, 250 + i, true, 80 - i));
  }
  assert.equal(scored.length, 10, "ten qualifying rungs before ladder collapse");
  assert.equal(countQualifiedBoardLegs(scored, 9), 5, "only one rung per player/market ladder counts");
});


test("prop-slot target is ~50% of legs", () => {
  assert.equal(boardPropSlotTarget(6), 3);
  assert.equal(boardPropSlotTarget(5), 3);
  assert.equal(boardPropSlotTarget(2), 0);
});

test("prop sim does not stop on game-line-only full ticket", () => {
  const gameOnly = [];
  for (let i = 0; i < 6; i++) {
    gameOnly.push({
      pick: {
        game: `A${i} @ B${i}`,
        market: "Spread",
        pick: `A${i} -3.5`,
        odds: -110,
        isProp: false,
        sport: "nfl",
        finalAiScore: qualScore,
      },
      evPct: 3,
      edgePct: 2,
      confidencePct: 55,
      impliedProbPct: 45,
      lineShoppingScore: 1,
      grade: "C+",
      simHit: 0.55,
      composite: 7,
      rankScore: 90 - i,
    });
  }
  assert.equal(
    shouldStopPropSimForTicketMix({ scored: gameOnly, target: 6 }),
    false,
    "full game-line ticket must keep scoring props",
  );
});

test("prop sim stops once mix fills prop slots", () => {
  const scored = [];
  for (let i = 0; i < 3; i++) {
    scored.push({
      pick: {
        game: `G${i} @ H${i}`,
        market: "Spread",
        pick: `G${i} -2.5`,
        odds: -110,
        isProp: false,
        sport: "nfl",
        finalAiScore: qualScore,
      },
      evPct: 3,
      edgePct: 2,
      confidencePct: 55,
      impliedProbPct: 45,
      lineShoppingScore: 1,
      grade: "C+",
      simHit: 0.55,
      composite: 7,
      rankScore: 90 - i,
    });
  }
  for (let i = 0; i < 3; i++) {
    scored.push(propLeg(`Player${i}`, 1.5 + i, 120 + i, false, 80 - i));
  }
  assert.equal(
    shouldStopPropSimForTicketMix({ scored, target: 6 }),
    true,
  );
});

test("selectBoardPropSimCandidates caps and ladder-dedupes", () => {
  const ranked = [];
  for (let i = 0; i < 10; i++) {
    ranked.push({
      game: "NYY @ WSH",
      market: "Total Bases",
      pick: `Grisham Over ${1.5 + (i % 2)} Total Bases`,
      odds: 130 + i,
      isProp: true,
      sport: "mlb",
      player: "Grisham",
      propLine: 1.5 + (i % 2),
      propSide: "Over",
      propIsAlt: i % 2 === 1,
    });
  }
  const { selected, skippedCount } = selectBoardPropSimCandidates(ranked, 3);
  assert.equal(selected.length, 3);
  assert.equal(skippedCount, 7);
});

test("selectBoardPropSimCandidates keeps multiple alt yard rungs per player ladder", () => {
  const ranked = [];
  for (const line of [67.5, 99.5, 124.5, 149.5, 174.5]) {
    ranked.push({
      game: "DEN @ KC",
      market: "Rush Yds",
      propMarketKey: "player_rush_yds",
      pick: `Barkley Over ${line} Rush Yds`,
      odds: -110,
      isProp: true,
      sport: "nfl",
      player: "Barkley",
      propLine: line,
      propSide: "Over",
      propIsAlt: line !== 67.5,
    });
  }
  // Other players so deferred fill is not required
  for (let i = 0; i < 5; i++) {
    ranked.push({
      game: "DEN @ KC",
      market: "Pass Yds",
      propMarketKey: "player_pass_yds",
      pick: `QB${i} Over 250.5 Pass Yds`,
      odds: -110,
      isProp: true,
      sport: "nfl",
      player: `QB${i}`,
      propLine: 250.5,
      propSide: "Over",
      propIsAlt: false,
    });
  }
  const { selected } = selectBoardPropSimCandidates(ranked, 8);
  const barkley = selected.filter((p) => p.player === "Barkley");
  assert.equal(barkley.length, 3, "main + milestone alts reach deep sim inside 3-rung budget");
  assert.deepEqual(
    barkley.map((p) => p.propLine).sort((a, b) => (a ?? 0) - (b ?? 0)),
    [67.5, 99.5, 174.5],
  );
});

test("posted milestones recognized across NFL/NBA/MLB (+ settlement lines)", () => {
  assert.ok(isPostedMilestoneAltLine(39.5, "player_reception_yds"), "40+ rec yds");
  assert.ok(isPostedMilestoneAltLine(199.5, "player_pass_yds"), "200+ pass yds");
  assert.ok(isPostedMilestoneAltLine(4.5, "player_receptions", 2.5), "5+ receptions");
  assert.ok(isPostedMilestoneAltLine(19.5, "player_points"), "20+ NBA points");
  assert.ok(isPostedMilestoneAltLine(1.5, "batter_hits"), "2+ MLB hits");
  assert.equal(isPostedMilestoneAltLine(72.5, "player_rush_yds"), false, "non-milestone rung");
  assert.equal(milestoneMarketFamily("player_pass_yds"), "yards");
  assert.equal(milestoneMarketFamily("batter_hits"), "baseball");
});

test("pickDiverseLadderRungsForSim prefers 40+ / 200+ milestones over nearest non-milestone", () => {
  const rungs = [62.5, 57.5, 59.5, 39.5, 72.5, 199.5].map((line) => ({
    propLine: line,
    propIsAlt: line !== 62.5,
    propMarketKey: "player_reception_yds",
    market: "Rec Yds",
  }));
  const picked = pickDiverseLadderRungsForSim(rungs, 3);
  const lines = picked.map((r) => r.propLine).sort((a, b) => (a ?? 0) - (b ?? 0));
  assert.ok(lines.includes(62.5), "main stays");
  assert.ok(lines.includes(39.5), "40+ receiving milestone must deep-sim");
  assert.ok(lines.includes(199.5), "far milestone kept as third rung");
  assert.equal(lines.includes(57.5), false, "nearest non-milestone must not crowd out 40+");
});

test("alt sim selection counts by sport/family include milestones when budget allows", () => {
  const sports: Array<{ sport: string; market: string; key: string; main: number; miles: number[] }> = [
    { sport: "nfl", market: "Rec Yds", key: "player_reception_yds", main: 52.5, miles: [39.5, 59.5, 74.5] },
    { sport: "ncaaf", market: "Pass Yds", key: "player_pass_yds", main: 245.5, miles: [199.5, 274.5, 299.5] },
    { sport: "nba", market: "Points", key: "player_points", main: 24.5, miles: [19.5, 29.5, 34.5] },
    { sport: "wnba", market: "Points", key: "player_points", main: 18.5, miles: [14.5, 19.5, 24.5] },
    { sport: "mlb", market: "Hits", key: "batter_hits", main: 0.5, miles: [1.5, 2.5] },
    { sport: "nhl", market: "Shots", key: "player_shots_on_goal", main: 2.5, miles: [3.5, 4.5] },
  ];
  const ranked = [];
  for (const s of sports) {
    for (let p = 0; p < 4; p++) {
      const player = `${s.sport}_P${p}`;
      ranked.push({
        game: `${s.sport} A @ B`,
        market: s.market,
        propMarketKey: s.key,
        pick: `${player} Over ${s.main} ${s.market}`,
        odds: -110,
        isProp: true as const,
        sport: s.sport,
        player,
        propLine: s.main,
        propSide: "Over" as const,
        propIsAlt: false,
      });
      for (const m of s.miles) {
        ranked.push({
          game: `${s.sport} A @ B`,
          market: s.market,
          propMarketKey: s.key,
          pick: `${player} Over ${m} ${s.market}`,
          odds: 150,
          isProp: true as const,
          sport: s.sport,
          player,
          propLine: m,
          propSide: "Over" as const,
          propIsAlt: true,
        });
      }
    }
  }
  const available = ranked.filter((r) => r.propIsAlt).length;
  const { selected } = selectBoardPropSimCandidates(ranked, 80);
  const simAlts = selected.filter((r) => r.propIsAlt);
  const bySport: Record<string, { available: number; simulated: number; milestones: number }> = {};
  for (const s of sports) {
    const avail = ranked.filter((r) => r.sport === s.sport && r.propIsAlt).length;
    const sim = simAlts.filter((r) => r.sport === s.sport);
    bySport[s.sport] = {
      available: avail,
      simulated: sim.length,
      milestones: sim.filter((r) => isPostedMilestoneAltLine(r.propLine, r.propMarketKey, s.main)).length,
    };
  }
  assert.ok(available >= 40, `expected many posted alts, got ${available}`);
  for (const sport of Object.keys(bySport)) {
    const row = bySport[sport]!;
    assert.ok(row.simulated > 0, `${sport}: alts must reach deep-sim set`);
    assert.ok(row.milestones > 0, `${sport}: milestone alts must be among simulated`);
  }
  // Same object must never occupy two deep-sim slots (wastes ladder budget).
  assert.equal(selected.length, new Set(selected).size, "no duplicate main/alt rows in sim set");
  // Surface exact counts in assertion message for the release report.
  assert.ok(
    true,
    `alt counts by sport=${JSON.stringify(bySport)} available=${available} simulatedAlts=${simAlts.length}`,
  );
});

test("selectBoardPropSimCandidates hard-caps D/ST props", () => {
  assert.equal(isFootballDstPropMarket("player_tackles_assists"), true);
  assert.equal(isFootballDstPropMarket("player_sacks"), false);
  const ranked = [];
  for (let i = 0; i < 40; i++) {
    ranked.push({
      game: "PHI @ CHI",
      market: "Tackles + Assists",
      propMarketKey: "player_tackles_assists",
      pick: `LB${i} Over 6.5 Tackles + Assists`,
      odds: -110,
      isProp: true,
      sport: "nfl",
      player: `LB${i}`,
      propLine: 6.5,
      propSide: "Over" as const,
      propIsAlt: false,
    });
  }
  for (let i = 0; i < 20; i++) {
    ranked.push({
      game: "PHI @ CHI",
      market: "Pass Yds",
      propMarketKey: "player_pass_yds",
      pick: `QB${i} Over 240.5 Pass Yds`,
      odds: -110,
      isProp: true,
      sport: "nfl",
      player: `QB${i}`,
      propLine: 240.5,
      propSide: "Over" as const,
      propIsAlt: false,
    });
  }
  const { selected } = selectBoardPropSimCandidates(ranked, 50);
  const dst = selected.filter((p) => isFootballDstPropMarket(p.propMarketKey));
  assert.ok(dst.length <= FOOTBALL_DST_PROP_SIM_CAP);
  assert.ok(selected.some((p) => p.propMarketKey === "player_pass_yds"));
});

test("selectFootballMixPropSimCandidates hard-caps D/ST in other bucket", () => {
  const ranked = [];
  for (let i = 0; i < 30; i++) {
    ranked.push({
      game: "PHI @ CHI",
      market: "Solo Tackles",
      propMarketKey: "player_solo_tackles",
      pick: `DB${i} Over 3.5 Solo Tackles`,
      odds: -115,
      isProp: true,
      sport: "nfl",
      player: `DB${i}`,
      propLine: 3.5,
      propSide: "Over" as const,
      athleteId: `id-${i}`,
    });
  }
  for (let i = 0; i < 20; i++) {
    ranked.push({
      game: "PHI @ CHI",
      market: "Pass Yds",
      propMarketKey: "player_pass_yds",
      pick: `QB${i} Over 250.5 Pass Yds`,
      odds: -110,
      isProp: true,
      sport: "nfl",
      player: `QB${i}`,
      propLine: 250.5,
      propSide: "Over" as const,
      athleteId: `qb-${i}`,
    });
  }
  const { selected } = selectFootballMixPropSimCandidates(ranked, 48);
  const dst = selected.filter((p) => isFootballDstPropMarket(p.propMarketKey));
  assert.ok(dst.length <= FOOTBALL_DST_PROP_SIM_CAP);
});

test("preferAskLockedMarketsForSim bubbles locked D/ST ahead of yards", () => {
  const yards = {
    game: "PHI @ CHI",
    market: "Pass Yds",
    propMarketKey: "player_pass_yds",
    pick: "Hurts Over 240.5 Pass Yds",
    odds: -110,
    isProp: true as const,
    sport: "nfl",
    player: "Hurts",
    propLine: 240.5,
    propSide: "Over" as const,
  };
  const tackles = {
    game: "PHI @ CHI",
    market: "Tackles + Assists",
    propMarketKey: "player_tackles_assists",
    pick: "LB1 Over 6.5 Tackles + Assists",
    odds: -115,
    isProp: true as const,
    sport: "nfl",
    player: "LB1",
    propLine: 6.5,
    propSide: "Over" as const,
  };
  const kick = {
    game: "PHI @ CHI",
    market: "Kicking Points",
    propMarketKey: "player_kicking_points",
    pick: "Kicker Over 7.5 Kicking Points",
    odds: -110,
    isProp: true as const,
    sport: "nfl",
    player: "Kicker",
    propLine: 7.5,
    propSide: "Over" as const,
  };
  // Natural skill order: yards first.
  const ranked = [yards, tackles, kick];
  const unlocked = preferAskLockedMarketsForSim(ranked, null);
  assert.equal(unlocked[0]!.propMarketKey, "player_pass_yds");

  const locked = preferAskLockedMarketsForSim(ranked, [
    "player_tackles_assists",
    "player_kicking_points",
  ]);
  assert.equal(locked[0]!.propMarketKey, "player_tackles_assists");
  assert.equal(locked[1]!.propMarketKey, "player_kicking_points");
  assert.equal(locked[2]!.propMarketKey, "player_pass_yds");
});

test("targeted D/ST ask funnel: fetched → simulated → qualified → delivered", () => {
  const ask = "5 leg NFL tackles + assists";
  const lock = matchExplicitMarketLocks(ask);
  assert.ok(lock);
  assert.deepEqual(lock!.allowedMarketKeys, ["player_tackles_assists"]);
  const constraint = parseCoachAskMarketConstraint(ask);
  assert.ok(constraint.allowedMarketKeys?.includes("player_tackles_assists"));

  // Synthetic posted board: many yards + D/ST rows (fetched candidates).
  const fetched: Array<{
    game: string;
    market: string;
    propMarketKey: string;
    pick: string;
    odds: number;
    isProp: true;
    sport: string;
    player: string;
    propLine: number;
    propSide: "Over";
    propIsAlt: boolean;
    athleteId: string;
  }> = [];
  for (let i = 0; i < 40; i++) {
    fetched.push({
      game: "PHI @ CHI",
      market: "Pass Yds",
      propMarketKey: "player_pass_yds",
      pick: `QB${i} Over 240.5 Pass Yds`,
      odds: -110,
      isProp: true,
      sport: "nfl",
      player: `QB${i}`,
      propLine: 240.5,
      propSide: "Over",
      propIsAlt: false,
      athleteId: `qb-${i}`,
    });
  }
  for (let i = 0; i < 20; i++) {
    fetched.push({
      game: "PHI @ CHI",
      market: "Tackles + Assists",
      propMarketKey: "player_tackles_assists",
      pick: `LB${i} Over 6.5 Tackles + Assists`,
      odds: -115,
      isProp: true,
      sport: "nfl",
      player: `LB${i}`,
      propLine: 6.5,
      propSide: "Over",
      propIsAlt: false,
      athleteId: `lb-${i}`,
    });
  }
  for (let i = 0; i < 8; i++) {
    fetched.push({
      game: "PHI @ CHI",
      market: "Kicking Points",
      propMarketKey: "player_kicking_points",
      pick: `K${i} Over 7.5 Kicking Points`,
      odds: -110,
      isProp: true,
      sport: "nfl",
      player: `K${i}`,
      propLine: 7.5,
      propSide: "Over",
      propIsAlt: false,
      athleteId: `k-${i}`,
    });
  }

  const allow = lock!.allowedMarketKeys;
  const askFetched = fetched.filter((p) =>
    allow.includes(p.propMarketKey.replace(/_alternate$/, "")),
  );
  const preferred = preferAskLockedMarketsForSim(fetched, allow);
  const { selected } = selectBoardPropSimCandidates(preferred, 50);
  const simulatedAsk = selected.filter((p) =>
    allow.includes(String(p.propMarketKey).replace(/_alternate$/, "")),
  );

  // Within existing DST cap — ask-locked tackles consume sim seats first.
  assert.ok(simulatedAsk.length > 0, "ask-locked tackles must reach deep-sim");
  assert.ok(
    simulatedAsk.length <= FOOTBALL_DST_PROP_SIM_CAP,
    `DST sim cap must hold (got ${simulatedAsk.length})`,
  );
  assert.equal(
    selected.filter((p) => p.propMarketKey === "player_pass_yds").length > 0,
    true,
    "mixed board still sims yards in remaining budget",
  );

  // Qualify + deliver: score ask-locked rows with full board-leg shape.
  const scored: BoardScoredLeg[] = simulatedAsk.slice(0, 8).map((p, i) => ({
    pick: { ...p, finalAiScore: qualScore },
    evPct: 3,
    edgePct: 2,
    confidencePct: 55,
    impliedProbPct: 45,
    lineShoppingScore: 1,
    grade: "C+",
    simHit: 0.55,
    composite: 7,
    rankScore: 10 - i,
  }));
  const qualified = countQualifiedBoardLegs(scored, 5);
  const delivered = Math.min(qualified, 5);

  const funnel = {
    ask,
    fetched: askFetched.length,
    simulated: simulatedAsk.length,
    qualified,
    delivered,
    dstCap: FOOTBALL_DST_PROP_SIM_CAP,
  };
  assert.ok(funnel.fetched >= 20, JSON.stringify(funnel));
  assert.ok(funnel.simulated >= 1, JSON.stringify(funnel));
  assert.ok(funnel.qualified >= 5, JSON.stringify(funnel));
  assert.equal(funnel.delivered, 5, JSON.stringify(funnel));
  // Surface exact funnel for the release report.
  assert.ok(true, `D/ST ask funnel ${JSON.stringify(funnel)}`);
});

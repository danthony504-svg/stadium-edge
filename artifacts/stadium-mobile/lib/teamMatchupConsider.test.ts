import test from "node:test";
import assert from "node:assert/strict";
import type { PlayerProp, PropSimulationResult, TeamDefense, TeamHistory } from "./api.ts";
import {
  buildConsiderCandidates,
  buildConsiderPick,
  countPostedAlts,
  emptyConsiderMessage,
  isRelevantPlayerMarket,
  MATCHUP_CONSIDER_MIN_SAMPLE_GAMES,
  MATCHUP_CONSIDER_MIN_SIMULATIONS,
  qualifyConsiderSim,
  relevantPlayerMarketsForSport,
  summarizeTeamForm,
  teamDefenseRows,
} from "./teamMatchupConsider.ts";

function prop(partial: Partial<PlayerProp> & Pick<PlayerProp, "player" | "market">): PlayerProp {
  return {
    player: partial.player,
    market: partial.market,
    line: partial.line ?? 22.5,
    overPrice: partial.overPrice ?? -110,
    underPrice: partial.underPrice ?? -110,
    alt: partial.alt ?? false,
    headshot: partial.headshot ?? null,
    athleteId: partial.athleteId ?? "a1",
    playerTeamId: partial.playerTeamId ?? "home1",
    eventId: partial.eventId ?? "ev1",
    overBook: partial.overBook ?? "DraftKings",
    underBook: partial.underBook ?? "FanDuel",
  };
}

function sim(partial: Partial<PropSimulationResult>): PropSimulationResult {
  return {
    key: partial.key ?? "k",
    player: partial.player ?? "P",
    market: partial.market ?? "player_points",
    line: partial.line ?? 22.5,
    side: partial.side ?? "Over",
    simulations: partial.simulations ?? MATCHUP_CONSIDER_MIN_SIMULATIONS,
    hitProbability: partial.hitProbability ?? 0.58,
    mostLikelyLine: null,
    meanProjection: partial.meanProjection ?? 24.1,
    medianProjection: null,
    confidenceScore: null,
    stdDev: null,
    sampleGames: partial.sampleGames ?? MATCHUP_CONSIDER_MIN_SAMPLE_GAMES,
    percentiles: null,
    nullReason: partial.nullReason ?? null,
  };
}

test("relevant markets: basketball includes pts/reb/ast/blk/threes; football pass/rush/rec/td", () => {
  assert.ok(isRelevantPlayerMarket("nba", "player_points"));
  assert.ok(isRelevantPlayerMarket("nba", "player_threes"));
  assert.ok(isRelevantPlayerMarket("ncaab", "player_blocks"));
  assert.equal(isRelevantPlayerMarket("nba", "player_pass_yds"), false);

  assert.ok(isRelevantPlayerMarket("nfl", "player_pass_yds"));
  assert.ok(isRelevantPlayerMarket("ncaaf", "player_rush_yds"));
  assert.ok(isRelevantPlayerMarket("nfl", "player_anytime_td"));
  assert.equal(isRelevantPlayerMarket("nfl", "player_points"), false);

  assert.ok(relevantPlayerMarketsForSport("mlb").includes("batter_hits"));
  assert.ok(relevantPlayerMarketsForSport("nhl").includes("player_goals"));
});

test("buildConsiderCandidates: both teams, bind by playerTeamId, drop alts/unbound/irrelevant", () => {
  const props: PlayerProp[] = [
    prop({ player: "Home Star", market: "player_points", playerTeamId: "H", line: 25.5 }),
    prop({
      player: "Home Star",
      market: "player_points",
      playerTeamId: "H",
      line: 30.5,
      alt: true,
      overPrice: -140,
    }),
    prop({ player: "Away Guard", market: "player_assists", playerTeamId: "A", line: 6.5 }),
    prop({ player: "Orphan", market: "player_points", playerTeamId: "OTHER", line: 10.5 }),
    prop({ player: "Passer", market: "player_pass_yds", playerTeamId: "H", line: 250.5 }), // irrelevant for nba
  ];
  const { candidates, skipReason } = buildConsiderCandidates({
    props,
    sport: "nba",
    homeTeam: "Home Team",
    awayTeam: "Away Team",
    ids: { homeTeamId: "H", awayTeamId: "A" },
  });
  assert.equal(skipReason, null);
  assert.equal(candidates.length, 2);
  assert.ok(candidates.some((c) => c.prop.player === "Home Star" && c.teamSide === "home"));
  assert.ok(candidates.some((c) => c.prop.player === "Away Guard" && c.teamSide === "away"));
  assert.ok(!candidates.some((c) => c.prop.player === "Orphan"));
  assert.ok(!candidates.some((c) => c.prop.alt));
  assert.ok(!candidates.some((c) => c.prop.market === "player_pass_yds"));
});

test("buildConsiderCandidates: missing team ids fail closed", () => {
  const { candidates, skipReason } = buildConsiderCandidates({
    props: [prop({ player: "X", market: "player_points", playerTeamId: "H" })],
    sport: "nba",
    homeTeam: "H",
    awayTeam: "A",
    ids: { homeTeamId: null, awayTeamId: null },
  });
  assert.equal(candidates.length, 0);
  assert.match(skipReason ?? "", /Team ids/i);
});

test("qualifyConsiderSim: requires 10k sims, sample, and hitProbability", () => {
  assert.equal(qualifyConsiderSim(null).status, "rejected");
  assert.equal(
    qualifyConsiderSim(sim({ simulations: 1000, hitProbability: 0.6 })).status,
    "rejected",
  );
  assert.equal(
    qualifyConsiderSim(sim({ sampleGames: 2, hitProbability: 0.6 })).status,
    "rejected",
  );
  assert.equal(
    qualifyConsiderSim(sim({ hitProbability: null, nullReason: "insufficient_sample" })).status,
    "rejected",
  );
  assert.equal(qualifyConsiderSim(sim({})).status, "qualified");
});

test("buildConsiderPick: both sides + alts metadata; rejects weak sim", () => {
  const cand = buildConsiderCandidates({
    props: [
      prop({
        player: "Star",
        market: "player_points",
        playerTeamId: "H",
        line: 22.5,
        overPrice: -115,
        underPrice: -105,
      }),
      prop({
        player: "Star",
        market: "player_points",
        playerTeamId: "H",
        line: 24.5,
        alt: true,
      }),
    ],
    sport: "nba",
    homeTeam: "Home",
    awayTeam: "Away",
    ids: { homeTeamId: "H", awayTeamId: "A" },
  }).candidates[0]!;

  const ok = buildConsiderPick({
    cand,
    sim: sim({
      player: "Star",
      market: "player_points",
      line: 22.5,
      side: cand.side,
      hitProbability: 0.61,
    }),
    grade: { grade: "A-", hits: 7, n: 10 },
    altCount: countPostedAlts(
      [
        prop({ player: "Star", market: "player_points", playerTeamId: "H", line: 22.5 }),
        prop({
          player: "Star",
          market: "player_points",
          playerTeamId: "H",
          line: 24.5,
          alt: true,
        }),
      ],
      "Star",
      "player_points",
    ),
    defenseNote: "Opp allows 112.4 PPG (team-wide season).",
  });
  assert.ok(ok);
  assert.equal(ok!.altCount, 1);
  assert.match(ok!.explanation, /10,000-sim|10000-sim|10\.000-sim|10,000/i);
  assert.match(ok!.explanation, /not position-specific/i);
  assert.equal(ok!.simulations, MATCHUP_CONSIDER_MIN_SIMULATIONS);

  const bad = buildConsiderPick({
    cand,
    sim: sim({ simulations: 500, hitProbability: 0.9 }),
    grade: null,
    altCount: 0,
  });
  assert.equal(bad, null);
});

test("football candidates bind rushing/receiving and reject basketball markets", () => {
  const { candidates } = buildConsiderCandidates({
    props: [
      prop({ player: "QB", market: "player_pass_yds", playerTeamId: "H", line: 250.5 }),
      prop({ player: "RB", market: "player_rush_yds", playerTeamId: "A", line: 65.5 }),
      prop({ player: "WR", market: "player_reception_yds", playerTeamId: "H", line: 55.5 }),
      prop({ player: "Big", market: "player_rebounds", playerTeamId: "H", line: 8.5 }),
    ],
    sport: "nfl",
    homeTeam: "Home",
    awayTeam: "Away",
    ids: { homeTeamId: "H", awayTeamId: "A" },
  });
  assert.equal(candidates.length, 3);
  assert.ok(candidates.every((c) => c.prop.market !== "player_rebounds"));
});

test("teamDefenseRows: team-wide scope; rush/pass sample sizes; no invent", () => {
  const def: TeamDefense = {
    sport: "nfl",
    teamId: "1",
    teamName: "Defense",
    avgPointsAgainst: 21.4,
    avgPointsFor: 24.1,
    pointDifferential: 2.7,
    defensive: {},
    offensive: {},
    rushDefense: {
      rushingYardsAllowedPerGame: 110.2,
      yardsPerRushAllowed: 4.1,
      sampleSize: 8,
    },
    passDefense: {
      passingYardsAllowedPerGame: 220.5,
      yardsPerPassAllowed: 7.0,
      sampleSize: 8,
    },
  };
  const rows = teamDefenseRows("nfl", def);
  assert.ok(rows.every((r) => r.scope === "team"));
  assert.ok(rows.some((r) => r.key === "rush_yds_allowed" && r.sampleSize === 8));
  assert.ok(rows.some((r) => /team-wide/i.test(r.timeframe)));
  assert.deepEqual(teamDefenseRows("nba", null), []);
});

test("summarizeTeamForm labels source/timeframe and missing splits", () => {
  const history = {
    sport: "nba",
    teamId: "1",
    teamName: "T",
    season: null,
    last10: {
      games: 10,
      wins: 6,
      losses: 4,
      ptsFor: 112,
      ptsAgainst: 108,
      avgMargin: 4,
    },
    last5: { games: 5, wins: 3, losses: 2, ptsFor: 110, ptsAgainst: 109, avgMargin: 1 },
    homeSplit: { games: 5, wins: 4, losses: 1, ptsFor: 115, ptsAgainst: 105, avgMargin: 10 },
    awaySplit: { games: 0, wins: 0, losses: 0, ptsFor: null, ptsAgainst: null, avgMargin: null },
    streak: { type: "W" as const, count: 2 },
    record: { games: 20, wins: 12, losses: 8, winPct: 0.6 },
    recent: [],
    lastGameDate: null,
  } satisfies TeamHistory;
  const s = summarizeTeamForm("T", history);
  assert.equal(s.last10, "6-4");
  assert.equal(s.homeSplit, "4-1");
  assert.equal(s.awaySplit, null);
  assert.match(s.source, /ESPN/);
});

test("emptyConsiderMessage is truthful for missing / unqualified", () => {
  assert.match(
    emptyConsiderMessage({
      propsLoaded: true,
      propsError: false,
      candidateCount: 4,
      qualifiedCount: 0,
      skipReason: null,
    }),
    /none cleared/i,
  );
  assert.match(
    emptyConsiderMessage({
      propsLoaded: true,
      propsError: true,
      candidateCount: 0,
      qualifiedCount: 0,
      skipReason: null,
    }),
    /unavailable/i,
  );
});

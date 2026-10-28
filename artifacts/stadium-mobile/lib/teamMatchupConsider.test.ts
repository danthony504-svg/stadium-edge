import test from "node:test";
import assert from "node:assert/strict";
import type { PlayerProp, PropSimulationResult, TeamDefense, TeamHistory } from "./api.ts";
import type { Grade } from "./propGrade.ts";
import {
  buildConsiderCandidates,
  buildConsiderPick,
  countPostedAlts,
  dedupeConsiderPicks,
  emptyConsiderMessage,
  filterConsiderPicks,
  isQuoteStale,
  isRelevantPlayerMarket,
  MATCHUP_CONSIDER_MIN_SAMPLE_GAMES,
  MATCHUP_CONSIDER_MIN_SIMULATIONS,
  MATCHUP_TOP_PER_ROLE,
  matchupFilterChips,
  matchupRolesForSport,
  oppDefenseNoteForMarket,
  qualifyConsiderSim,
  quoteTimestampForSide,
  rankConsiderPicksByRole,
  relevantPlayerMarketsForSport,
  resolveMatchupRole,
  softRoleFromMarket,
  summarizeTeamForm,
  teamDefenseRows,
  type ConsiderPick,
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
    position: partial.position ?? null,
    overSourceUpdatedAt: partial.overSourceUpdatedAt ?? null,
    underSourceUpdatedAt: partial.underSourceUpdatedAt ?? null,
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

function makePick(
  overrides: Partial<ConsiderPick> & Pick<ConsiderPick, "player" | "marketKey" | "roleKey">,
): ConsiderPick {
  const baseProp = prop({
    player: overrides.player,
    market: overrides.marketKey,
    playerTeamId: overrides.teamSide === "away" ? "A" : "H",
    position: overrides.position ?? null,
  });
  return {
    key: overrides.key ?? `${overrides.player}|${overrides.marketKey}`.toLowerCase(),
    player: overrides.player,
    athleteId: null,
    headshot: null,
    teamSide: overrides.teamSide ?? "home",
    teamName: overrides.teamName ?? "Home",
    oppName: overrides.oppName ?? "Away",
    position: overrides.position ?? null,
    positionVerified: overrides.positionVerified ?? false,
    roleKey: overrides.roleKey,
    roleLabel: overrides.roleLabel ?? overrides.roleKey,
    marketKey: overrides.marketKey,
    marketLabel: overrides.marketLabel ?? overrides.marketKey,
    side: overrides.side ?? "Over",
    line: overrides.line ?? 22.5,
    price: overrides.price ?? -110,
    overPrice: overrides.overPrice ?? -110,
    underPrice: overrides.underPrice ?? -110,
    sportsbook: overrides.sportsbook ?? "DraftKings",
    overBook: "DraftKings",
    underBook: "FanDuel",
    quoteUpdatedAt: overrides.quoteUpdatedAt ?? null,
    quoteStale: overrides.quoteStale ?? false,
    altCount: overrides.altCount ?? 0,
    grade: overrides.grade ?? ("A-" as Grade),
    gradeHits: overrides.gradeHits ?? 6,
    gradeN: overrides.gradeN ?? 10,
    edgePct: overrides.edgePct ?? 3.2,
    simHitPct: overrides.simHitPct ?? 58,
    simulations: MATCHUP_CONSIDER_MIN_SIMULATIONS,
    sampleGames: MATCHUP_CONSIDER_MIN_SAMPLE_GAMES,
    meanProjection: overrides.meanProjection ?? 24,
    formSummary: overrides.formSummary ?? "form",
    opportunitySummary: overrides.opportunitySummary ?? "opp unavailable",
    defenseSummary: overrides.defenseSummary ?? "def",
    explanation: overrides.explanation ?? "x",
    prop: overrides.prop ?? baseProp,
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

test("sport-specific role chips cover football/basketball/mlb", () => {
  const nfl = matchupRolesForSport("nfl").map((r) => r.key);
  assert.deepEqual(nfl, ["qb", "rb", "wr_te", "td"]);
  assert.equal(softRoleFromMarket("nfl", "player_rush_yds")?.key, "rb");
  assert.equal(softRoleFromMarket("nba", "player_assists")?.key, "ast");
  assert.equal(softRoleFromMarket("mlb", "pitcher_strikeouts")?.key, "pitcher");
  assert.ok(matchupFilterChips("nfl").some((c) => c.key === "all"));
});

test("resolveMatchupRole: verified roster position vs market-only soft role", () => {
  const verified = resolveMatchupRole({
    sport: "nfl",
    market: "player_reception_yds",
    rosterPosition: "WR",
  });
  assert.equal(verified.position, "WR");
  assert.equal(verified.positionVerified, true);
  assert.equal(verified.roleKey, "wr_te");

  const soft = resolveMatchupRole({
    sport: "nfl",
    market: "player_pass_yds",
    rosterPosition: null,
  });
  assert.equal(soft.position, null);
  assert.equal(soft.positionVerified, false);
  assert.equal(soft.roleKey, "qb");
  assert.equal(soft.roleFromMarketOnly, true);
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

test("wrong opponent / team binding: foreign playerTeamId never becomes a candidate", () => {
  const { candidates, skipReason } = buildConsiderCandidates({
    props: [
      prop({ player: "Wrong Team WR", market: "player_reception_yds", playerTeamId: "X", line: 55.5 }),
      prop({ player: "Home WR", market: "player_reception_yds", playerTeamId: "H", line: 60.5 }),
    ],
    sport: "nfl",
    homeTeam: "Home",
    awayTeam: "Away",
    ids: { homeTeamId: "H", awayTeamId: "A" },
  });
  assert.equal(skipReason, null);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.prop.player, "Home WR");
  assert.equal(candidates[0]!.oppName, "Away");
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

test("buildConsiderPick: exact-market fields, O/U books, quote, edge; rejects weak sim", () => {
  const cand = buildConsiderCandidates({
    props: [
      prop({
        player: "Star",
        market: "player_points",
        playerTeamId: "H",
        line: 22.5,
        overPrice: -115,
        underPrice: -105,
        position: "SG",
        overSourceUpdatedAt: "2026-10-27T12:00:00.000Z",
        underSourceUpdatedAt: "2026-10-27T12:00:00.000Z",
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
    grade: { grade: "A", hits: 7, n: 10 },
    sport: "nba",
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
    nowMs: Date.parse("2026-10-27T13:00:00.000Z"),
  });
  assert.ok(ok);
  assert.equal(ok!.altCount, 1);
  assert.equal(ok!.position, "SG");
  assert.equal(ok!.positionVerified, true);
  assert.equal(ok!.roleKey, "pts");
  assert.equal(ok!.overPrice, -115);
  assert.equal(ok!.underPrice, -105);
  assert.ok(ok!.edgePct != null);
  assert.equal(ok!.quoteUpdatedAt, "2026-10-27T12:00:00.000Z");
  assert.equal(ok!.quoteStale, false);
  assert.match(ok!.opportunitySummary, /unavailable/i);
  assert.match(ok!.explanation, /10,000-sim|10000-sim|10\.000-sim|10,000/i);
  assert.match(ok!.defenseSummary, /team-wide/i);
  assert.equal(ok!.simulations, MATCHUP_CONSIDER_MIN_SIMULATIONS);

  const bad = buildConsiderPick({
    cand,
    sim: sim({ simulations: 500, hitProbability: 0.9 }),
    grade: null,
    sport: "nba",
    altCount: 0,
  });
  assert.equal(bad, null);
});

test("stale quote flagged when older than freshness window", () => {
  const fresh = "2026-10-27T18:00:00.000Z";
  const stale = "2026-10-26T10:00:00.000Z";
  const now = Date.parse("2026-10-27T20:00:00.000Z");
  assert.equal(isQuoteStale(fresh, now), false);
  assert.equal(isQuoteStale(stale, now), true);
  assert.equal(isQuoteStale(null, now), false);
  const p = prop({
    player: "Q",
    market: "player_pass_yds",
    underSourceUpdatedAt: stale,
    overSourceUpdatedAt: fresh,
  });
  assert.equal(quoteTimestampForSide(p, "Under"), stale);
  assert.equal(quoteTimestampForSide(p, "Over"), fresh);
});

test("oppDefenseNoteForMarket: team-wide only; never invents positional allowances", () => {
  const def: TeamDefense = {
    sport: "nfl",
    teamId: "1",
    teamName: "Defense",
    avgPointsAgainst: 18.2,
    avgPointsFor: 24.1,
    pointDifferential: 5.9,
    defensive: {},
    offensive: {},
    rushDefense: {
      rushingYardsAllowedPerGame: 88.4,
      yardsPerRushAllowed: 3.5,
      sampleSize: 5,
    },
    passDefense: {
      passingYardsAllowedPerGame: 210.1,
      yardsPerPassAllowed: 6.8,
      sampleSize: 5,
    },
  };
  const rush = oppDefenseNoteForMarket({
    sport: "nfl",
    market: "player_rush_yds",
    oppName: "Jaguars",
    oppDefense: def,
  });
  assert.match(rush ?? "", /rush ypg/i);
  assert.match(rush ?? "", /Position-specific/i);
  assert.match(rush ?? "", /team-wide/i);
  assert.equal(
    oppDefenseNoteForMarket({
      sport: "nfl",
      market: "player_rush_yds",
      oppName: "X",
      oppDefense: null,
    }),
    null,
  );
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

test("rank + filter + dedupe: top 1-2 per role from either side", () => {
  const picks: ConsiderPick[] = [
    makePick({ player: "Home RB1", marketKey: "player_rush_yds", roleKey: "rb", roleLabel: "RB", teamSide: "home", simHitPct: 62, edgePct: 4 }),
    makePick({ player: "Away RB2", marketKey: "player_rush_yds", roleKey: "rb", roleLabel: "RB", teamSide: "away", simHitPct: 60, edgePct: 3 }),
    makePick({ player: "Home RB3", marketKey: "player_rush_yds", roleKey: "rb", roleLabel: "RB", teamSide: "home", simHitPct: 55, edgePct: 1 }),
    makePick({ player: "Home QB", marketKey: "player_pass_yds", roleKey: "qb", roleLabel: "QB", teamSide: "home", simHitPct: 59, edgePct: 2 }),
    // duplicate player+market weaker — should drop
    makePick({
      player: "Home RB1",
      marketKey: "player_rush_yds",
      roleKey: "rb",
      roleLabel: "RB",
      teamSide: "home",
      simHitPct: 50,
      edgePct: 0,
      key: "dup",
    }),
  ];
  const deduped = dedupeConsiderPicks(picks);
  assert.equal(deduped.filter((p) => p.player === "Home RB1").length, 1);
  assert.equal(deduped.find((p) => p.player === "Home RB1")!.simHitPct, 62);

  const rbOnly = filterConsiderPicks(deduped, "rb");
  assert.ok(rbOnly.every((p) => p.roleKey === "rb"));
  assert.equal(filterConsiderPicks(deduped, "all").length, deduped.length);

  const groups = rankConsiderPicksByRole(deduped, MATCHUP_TOP_PER_ROLE);
  const rb = groups.find((g) => g.roleKey === "rb");
  assert.ok(rb);
  assert.equal(rb!.picks.length, 2);
  assert.equal(rb!.picks[0]!.player, "Home RB1");
  assert.equal(rb!.picks[1]!.player, "Away RB2");
  assert.ok(!rb!.picks.some((p) => p.player === "Home RB3"));
  const qb = groups.find((g) => g.roleKey === "qb");
  assert.equal(qb!.picks.length, 1);
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

test("emptyConsiderMessage is truthful for missing / thin evidence", () => {
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


test("recommendations reject weak, ungraded, stale and mismatched exact selections across sports", () => {
  for (const [sport, market] of [["nba", "player_points"], ["nfl", "player_rush_yds"], ["mlb", "batter_hits"], ["nhl", "player_shots_on_goal"], ["soccer", "player_shots"]]) {
    const cand = buildConsiderCandidates({props:[prop({player:"P", market, playerTeamId:"H"})], sport, homeTeam:"Home", awayTeam:"Away", ids:{homeTeamId:"H",awayTeamId:"A"}, eventId:"ev1"}).candidates[0]!;
    const good = {cand, sim:sim({market}), grade:{grade:"A" as Grade,hits:7,n:10}, sport, altCount:0};
    assert.ok(buildConsiderPick(good), sport);
    for (const patch of [{hitProbability:0.28},{hitProbability:0.519},{hitProbability:1.01},{hitProbability:NaN},{sampleGames:NaN},{simulations:NaN},{deepPending:true},{player:"Other"},{market:"wrong_market"},{line:23.5},{side:"Under" as const}]) {
      assert.equal(buildConsiderPick({...good,sim:{...good.sim,...patch}}),null,`${sport} ${JSON.stringify(patch)}`);
    }
    assert.equal(buildConsiderPick({...good,grade:null}),null);
    assert.equal(buildConsiderPick({...good,grade:{grade:"A",hits:1,n:10}}),null);
    assert.equal(buildConsiderPick({...good,cand:{...cand,price:-500,prop:{...cand.prop,overPrice:-500}}}),null);
    assert.equal(buildConsiderPick({...good,cand:{...cand,price:105}}),null);
    assert.equal(buildConsiderPick({...good,cand:{...cand,prop:{...cand.prop,overSourceUpdatedAt:"2000-01-01T00:00:00Z"}}}),null);
    assert.match(buildConsiderPick(good)!.formSummary,/separate from simulation history/);
  }
});

test("event and athlete binding plus quote-sensitive cache identity", () => {
  const p=prop({player:"P",market:"player_points",playerTeamId:"H"});
  const build=(props:PlayerProp[])=>buildConsiderCandidates({props,sport:"nba",homeTeam:"Home",awayTeam:"Away",ids:{homeTeamId:"H",awayTeamId:"A"},eventId:"ev1"}).candidates;
  assert.equal(build([{...p,eventId:"other"}]).length,0);
  assert.equal(build([{...p,athleteId:null}]).length,0);
  assert.notEqual(build([p])[0]!.key,build([{...p,overPrice:110}])[0]!.key);
  assert.notEqual(build([p])[0]!.key,build([{...p,overSourceUpdatedAt:"2026-10-27T12:00Z"}])[0]!.key);
});

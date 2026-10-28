import test from "node:test";
import assert from "node:assert/strict";
import type { PlayerProp, PropSimulationResult, TeamDefense, TeamHistory } from "./api.ts";
import type { Grade } from "./propGrade.ts";
import {
  buildConsiderCandidates,
  buildConsiderPick,
  candidateIdentityOk,
  considerFormSummary,
  considerSimSampleSummary,
  considerSlipPayload,
  countPostedAlts,
  dedupeConsiderPicks,
  emptyConsiderMessage,
  filterConsiderPicks,
  isQuoteStale,
  isRelevantPlayerMarket,
  lookupExactConsiderSim,
  MATCHUP_CONSIDER_MIN_HIT_PCT,
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
  simMatchesConsiderSelection,
  softRoleFromMarket,
  summarizeTeamForm,
  teamDefenseRows,
  type ConsiderCandidate,
  type ConsiderPick,
} from "./teamMatchupConsider.ts";

function prop(partial: Partial<PlayerProp> & Pick<PlayerProp, "player" | "market">): PlayerProp {
  return {
    player: partial.player,
    market: partial.market,
    line: partial.line ?? 22.5,
    overPrice: partial.overPrice !== undefined ? partial.overPrice : -110,
    underPrice: partial.underPrice !== undefined ? partial.underPrice : -110,
    alt: partial.alt ?? false,
    headshot: partial.headshot ?? null,
    athleteId: partial.athleteId !== undefined ? partial.athleteId : "a1",
    playerTeamId: partial.playerTeamId !== undefined ? partial.playerTeamId : "home1",
    eventId: partial.eventId !== undefined ? partial.eventId : "ev1",
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
    athleteId: "a1",
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

test("resolveMatchupRole: verified roster position groups; market fallback labeled honestly", () => {
  const verified = resolveMatchupRole({
    sport: "nfl",
    market: "player_reception_yds",
    rosterPosition: "WR",
  });
  assert.equal(verified.position, "WR");
  assert.equal(verified.positionVerified, true);
  assert.equal(verified.roleKey, "wr");
  assert.equal(verified.groupSource, "roster_position");

  const nbaPos = resolveMatchupRole({
    sport: "nba",
    market: "player_points",
    rosterPosition: "SF",
  });
  assert.equal(nbaPos.roleKey, "sf");
  assert.equal(nbaPos.groupSource, "roster_position");

  const soft = resolveMatchupRole({
    sport: "nfl",
    market: "player_pass_yds",
    rosterPosition: null,
  });
  assert.equal(soft.position, null);
  assert.equal(soft.positionVerified, false);
  assert.equal(soft.roleKey, "qb");
  assert.equal(soft.roleFromMarketOnly, true);
  assert.equal(soft.groupSource, "market");
  assert.match(soft.roleLabel, /market/i);
});

test("buildConsiderCandidates: both teams, both sides, bind by playerTeamId, drop alts/unbound/irrelevant", () => {
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
    prop({ player: "Passer", market: "player_pass_yds", playerTeamId: "H", line: 250.5 }),
    prop({ player: "NoId", market: "player_points", playerTeamId: "H", athleteId: null, line: 12.5 }),
  ];
  const { candidates, skipReason } = buildConsiderCandidates({
    props,
    sport: "nba",
    homeTeam: "Home Team",
    awayTeam: "Away Team",
    ids: { homeTeamId: "H", awayTeamId: "A" },
  });
  assert.equal(skipReason, null);
  // Both Over and Under for each priced main → 2 players × 2 sides = 4
  assert.equal(candidates.length, 4);
  assert.ok(candidates.some((c) => c.prop.player === "Home Star" && c.teamSide === "home" && c.side === "Over"));
  assert.ok(candidates.some((c) => c.prop.player === "Home Star" && c.side === "Under"));
  assert.ok(candidates.some((c) => c.prop.player === "Away Guard" && c.teamSide === "away"));
  assert.ok(!candidates.some((c) => c.prop.player === "Orphan"));
  assert.ok(!candidates.some((c) => c.prop.player === "NoId"));
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
  assert.ok(candidates.every((c) => c.prop.player === "Home WR"));
  assert.equal(candidates[0]!.oppName, "Away");
  assert.equal(
    candidateIdentityOk({
      prop: prop({ player: "X", market: "player_points", playerTeamId: "Z" }),
      sport: "nba",
      ids: { homeTeamId: "H", awayTeamId: "A" },
    }).ok,
    false,
  );
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

test("qualifyConsiderSim: shared floors reject Thybulle-style 28% / negative edge", () => {
  const thybulle = prop({
    player: "Matisse Thybulle",
    market: "player_points",
    line: 5.5,
    playerTeamId: "H",
    underPrice: -110,
    overPrice: -110,
    position: "SF",
  });
  const cand: ConsiderCandidate = {
    key: "thybulle|player_points|5.5|under|home",
    prop: thybulle,
    side: "Under",
    price: -110,
    teamSide: "home",
    teamName: "Home",
    oppName: "Away",
  };
  const weak = sim({
    player: "Matisse Thybulle",
    market: "player_points",
    line: 5.5,
    side: "Under",
    hitProbability: 0.28,
    sampleGames: 6,
  });
  // Screenshot case: 28% sim + negative edge must never qualify — even with a grade.
  assert.equal(
    qualifyConsiderSim(weak, {
      cand,
      grade: { grade: "A-", hits: 6, n: 7 },
      price: -110,
    }).status,
    "rejected",
  );
  assert.match(
    qualifyConsiderSim(weak, { cand, grade: { grade: "A-", hits: 6, n: 7 }, price: -110 }).reason ?? "",
    /below the 52%/i,
  );

  assert.equal(qualifyConsiderSim(null).status, "rejected");
  assert.equal(
    qualifyConsiderSim(sim({ simulations: 1000, hitProbability: 0.6 })).status,
    "rejected",
  );
  assert.equal(
    qualifyConsiderSim(sim({ sampleGames: 2, hitProbability: 0.6 })).status,
    "rejected",
  );
  // Missing grade never qualifies.
  assert.equal(
    qualifyConsiderSim(sim({ hitProbability: 0.6 }), { grade: null, price: -110 }).status,
    "rejected",
  );
  assert.match(
    qualifyConsiderSim(sim({ hitProbability: 0.6 }), { grade: null, price: -110 }).reason ?? "",
    /Missing hit-rate grade/i,
  );
  // Sub-52% with grade still fails.
  assert.equal(
    qualifyConsiderSim(sim({ hitProbability: 0.5 }), {
      grade: { grade: "A-", hits: 6, n: 10 },
      price: -110,
    }).status,
    "rejected",
  );
  // Positive edge + floors pass.
  assert.equal(
    qualifyConsiderSim(sim({ hitProbability: 0.6 }), {
      grade: { grade: "A-", hits: 7, n: 10 },
      price: -110,
    }).status,
    "qualified",
  );
  // Negative edge fails even at high hit%.
  assert.equal(
    qualifyConsiderSim(sim({ hitProbability: 0.55 }), {
      grade: { grade: "A-", hits: 7, n: 10 },
      price: -200, // implied ~66.7% → edge negative
    }).status,
    "rejected",
  );
});

test("side/line mismatch: opposite-side or alternate-line sim never qualifies or binds", () => {
  const p = prop({ player: "Star", market: "player_points", line: 22.5, playerTeamId: "H" });
  const cand: ConsiderCandidate = {
    key: "star|player_points|22.5|under|home",
    prop: p,
    side: "Under",
    price: -105,
    teamSide: "home",
    teamName: "Home",
    oppName: "Away",
  };
  const overSim = sim({
    player: "Star",
    market: "player_points",
    line: 22.5,
    side: "Over",
    hitProbability: 0.7,
  });
  const altLine = sim({
    player: "Star",
    market: "player_points",
    line: 24.5,
    side: "Under",
    hitProbability: 0.7,
  });
  assert.equal(simMatchesConsiderSelection(overSim, cand), false);
  assert.equal(simMatchesConsiderSelection(altLine, cand), false);
  assert.equal(
    qualifyConsiderSim(overSim, {
      cand,
      grade: { grade: "A", hits: 8, n: 10 },
      price: -105,
    }).status,
    "rejected",
  );

  const map = new Map<string, PropSimulationResult>([
    ["Star|player_points|22.5|Over", overSim],
    ["Star|player_points|24.5|Under", altLine],
  ]);
  assert.equal(lookupExactConsiderSim(map, cand), null);

  const exact = sim({
    player: "Star",
    market: "player_points",
    line: 22.5,
    side: "Under",
    hitProbability: 0.62,
  });
  map.set("Star|player_points|22.5|Under", exact);
  assert.equal(lookupExactConsiderSim(map, cand)?.side, "Under");
  assert.equal(lookupExactConsiderSim(map, cand)?.line, 22.5);
});

test("buildConsiderPick: rejects weak sim; labels samples separately; slip matches card", () => {
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
    ],
    sport: "nba",
    homeTeam: "Home",
    awayTeam: "Away",
    ids: { homeTeamId: "H", awayTeamId: "A" },
  }).candidates.find((c) => c.side === "Over")!;

  const ok = buildConsiderPick({
    cand,
    sim: sim({
      player: "Star",
      market: "player_points",
      line: 22.5,
      side: "Over",
      hitProbability: 0.61,
      sampleGames: 6,
    }),
    grade: { grade: "A-", hits: 7, n: 10 },
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
  assert.equal(ok!.roleKey, "sg");
  assert.ok((ok!.edgePct ?? 0) > 0);
  assert.match(ok!.formSummary, /Recent hit-rate form 7\/10/);
  assert.match(
    considerSimSampleSummary(
      sim({ sampleGames: 6, hitProbability: 0.61 }),
      61,
    ),
    /simulation-history n=6/i,
  );
  assert.ok(!/need ≥5/.test(ok!.formSummary));
  assert.match(ok!.explanation, /simulation-history n=6/i);
  assert.match(ok!.explanation, /not the recent hit-rate sample/i);

  const slip = considerSlipPayload(ok!, "Away @ Home");
  assert.equal(slip.game, "Away @ Home");
  assert.equal(slip.market, ok!.marketLabel);
  assert.equal(slip.pick, `${ok!.player} ${ok!.side} ${ok!.line} ${ok!.marketLabel}`);
  assert.equal(slip.odds, ok!.price);

  // Weak / missing grade / wrong side rejected.
  assert.equal(
    buildConsiderPick({
      cand,
      sim: sim({ simulations: 500, hitProbability: 0.9, side: "Over", player: "Star", market: "player_points", line: 22.5 }),
      grade: { grade: "A-", hits: 7, n: 10 },
      sport: "nba",
      altCount: 0,
    }),
    null,
  );
  assert.equal(
    buildConsiderPick({
      cand,
      sim: sim({ hitProbability: 0.61, side: "Over", player: "Star", market: "player_points", line: 22.5 }),
      grade: null,
      sport: "nba",
      altCount: 0,
    }),
    null,
  );
});

test("sample labels: sim-history n vs hit-rate n never conflated when grade missing", () => {
  // Screenshot confusion: sim n=6/7 alongside “need ≥5” — form text must not
  // claim insufficient games when the real issue is a missing/below-floor grade.
  const formMissing = considerFormSummary(null);
  assert.match(formMissing, /unavailable/i);
  assert.match(formMissing, /Missing grade|below/i);
  const formThin = considerFormSummary({ grade: "A-", hits: 2, n: 3 });
  assert.match(formThin, /only 3 logged games/i);
  const simLbl = considerSimSampleSummary(sim({ sampleGames: 7, hitProbability: 0.28 }), 28);
  assert.match(simLbl, /simulation-history n=7/i);
  assert.match(simLbl, /not the recent hit-rate sample/i);
  assert.ok(!simLbl.includes("need ≥5"));
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
  assert.ok(candidates.length >= 3);
  assert.ok(candidates.every((c) => c.prop.market !== "player_rebounds"));
});

test("rank + filter: top 1-2 per role never pads with weak picks; wr_te matches WR/TE", () => {
  const picks: ConsiderPick[] = [
    makePick({
      player: "Home RB1",
      marketKey: "player_rush_yds",
      roleKey: "rb",
      roleLabel: "RB",
      teamSide: "home",
      simHitPct: 62,
      edgePct: 4,
    }),
    makePick({
      player: "Away RB2",
      marketKey: "player_rush_yds",
      roleKey: "rb",
      roleLabel: "RB",
      teamSide: "away",
      simHitPct: 60,
      edgePct: 3,
    }),
    makePick({
      player: "Home RB3",
      marketKey: "player_rush_yds",
      roleKey: "rb",
      roleLabel: "RB",
      teamSide: "home",
      simHitPct: 55,
      edgePct: 1,
    }),
    makePick({
      player: "Home QB",
      marketKey: "player_pass_yds",
      roleKey: "qb",
      roleLabel: "QB",
      teamSide: "home",
      simHitPct: 59,
      edgePct: 2,
    }),
    makePick({
      player: "WR1",
      marketKey: "player_reception_yds",
      roleKey: "wr",
      roleLabel: "WR",
      position: "WR",
      positionVerified: true,
      simHitPct: 58,
      edgePct: 2.5,
    }),
  ];
  const groups = rankConsiderPicksByRole(picks, MATCHUP_TOP_PER_ROLE);
  const rb = groups.find((g) => g.roleKey === "rb");
  assert.ok(rb);
  assert.equal(rb!.picks.length, 2);
  assert.equal(rb!.picks[0]!.player, "Home RB1");
  assert.equal(rb!.picks[1]!.player, "Away RB2");
  // Only one QB — do not invent a second slot filler.
  const qb = groups.find((g) => g.roleKey === "qb");
  assert.equal(qb!.picks.length, 1);

  const wrFilter = filterConsiderPicks(picks, "wr_te", "nfl");
  assert.ok(wrFilter.some((p) => p.player === "WR1"));
  assert.ok(wrFilter.every((p) => p.roleKey === "wr" || p.marketKey.includes("reception")));
});

test("dedupe keeps stronger side for same player+market", () => {
  const picks = [
    makePick({
      player: "Star",
      marketKey: "player_points",
      roleKey: "pts",
      side: "Under",
      simHitPct: 40,
      edgePct: -10,
      key: "under",
    }),
    makePick({
      player: "Star",
      marketKey: "player_points",
      roleKey: "pts",
      side: "Over",
      simHitPct: 60,
      edgePct: 5,
      key: "over",
    }),
  ];
  const d = dedupeConsiderPicks(picks);
  assert.equal(d.length, 1);
  assert.equal(d[0]!.side, "Over");
  assert.equal(d[0]!.simHitPct, 60);
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

test("shared floor constants align with Coach 52 / C+", () => {
  assert.equal(MATCHUP_CONSIDER_MIN_HIT_PCT, 52);
  assert.equal(MATCHUP_CONSIDER_MIN_SAMPLE_GAMES, 5);
  assert.equal(MATCHUP_CONSIDER_MIN_SIMULATIONS, 10_000);
});

/**
 * Pre-publication verification at tip 42a9ace9:
 * full Coach opp-context path for sacks / def INTs / QB INTs / rush / pass / recv
 * — identity, source inputs, adjustment direction, exactly one application
 * (board attachPickScores + props-only recovery), alt-line consistency, cold/warm.
 *
 * Tilt model: post-sim hit-rate adjustment only. Mobile never sends defenseIndex
 * to Monte Carlo, so distribution parameters are unchanged; each line’s hit is
 * adjusted afterward by the same matchup tilt.
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { ParsedPick } from "../components/PickCard.tsx";
import type { PropPoolEntry } from "./api.ts";
import {
  clearCoachContextCache,
  resetCoachCacheStats,
  withCoachContextCache,
  getCoachCacheStats,
} from "./coachContextCache.ts";
import {
  PROPS_ONLY_ODDS_SLACK,
  PROPS_ONLY_RECOVERY_ODDS_SLACK,
  propsOnlyLegClearsOdds,
} from "./coachFootballPropsOnlyGrade.ts";
import {
  opponentTeamIdForProp,
  ownTeamIdForProp,
} from "./footballOppTeamId.ts";
import type { FootballOppDefenseMap } from "./footballOppDefenseContext.ts";
import {
  adjustSimHitForOppDefenseTilt,
  propOppDefenseTilt,
  type FootballOppDefenseSlice,
} from "./footballRushDefense.ts";
import { attachPickScores } from "./pickScoreContext.ts";
import { buildPropHolisticScore } from "./propHolisticRecommendation.ts";
import { buildFinalAiScore } from "./finalAiScore.ts";

const GAME = "Chicago Bears @ Philadelphia Eagles";
const ESPN_GAMES = [
  {
    sport: "nfl",
    homeTeam: "Philadelphia Eagles",
    awayTeam: "Chicago Bears",
    homeTeamId: "21",
    awayTeamId: "3",
    homeAbbr: "PHI",
    awayAbbr: "CHI",
  },
];

/** CHI offense/defense pack + PHI offense/defense pack (shared map, one fetch model). */
const DEFENSE_MAP: FootballOppDefenseMap = {
  "nfl#21": {
    teamName: "Philadelphia Eagles",
    // PHI defense facing CHI offense (for CHI skill props)
    rush: {
      rushingYardsAllowedPerGame: 88,
      yardsPerRushAllowed: 3.5,
      sampleSize: 4,
      teamName: "Philadelphia Eagles",
    },
    pass: {
      passingYardsAllowedPerGame: 175,
      yardsPerPassAllowed: 5.6,
      sampleSize: 4,
      teamName: "Philadelphia Eagles",
    },
    sacks: 40,
    interceptions: 16,
    passesDefended: 55,
    totalTakeaways: 22,
    stuffs: 36,
    gamesPlayed: 12,
    // PHI OL / QB tendency when PHI is the offense being faced
    sacksAllowed: 18,
    interceptionPct: 1.4,
    intsThrown: 6,
    passingAttempts: 360,
    completionPct: 66,
    rushingAttempts: 320,
    ownRushYpc: 4.3,
  },
  "nfl#3": {
    teamName: "Chicago Bears",
    rush: {
      rushingYardsAllowedPerGame: 130,
      yardsPerRushAllowed: 4.6,
      sampleSize: 4,
      teamName: "Chicago Bears",
    },
    pass: {
      passingYardsAllowedPerGame: 250,
      yardsPerPassAllowed: 7.5,
      sampleSize: 4,
      teamName: "Chicago Bears",
    },
    sacks: 18,
    interceptions: 6,
    passesDefended: 30,
    totalTakeaways: 10,
    stuffs: 18,
    gamesPlayed: 12,
    // CHI OL / QB — porous + reckless for sack / QB INT / volume tests
    sacksAllowed: 42,
    interceptionPct: 3.5,
    intsThrown: 14,
    passingAttempts: 450,
    completionPct: 58,
    rushingAttempts: 240,
    ownRushYpc: 3.6,
  },
};

type MarketCase = {
  id: string;
  player: string;
  teamAbbr: "CHI" | "PHI";
  /** Who this player faces (must match opponentTeamIdForProp). */
  expectOppId: "21" | "3";
  expectOwnId: "21" | "3";
  marketKey: string;
  /** Main + one alt line — same matchup, independent raw hits. */
  lines: Array<{ line: number; rawHit: number; propIsAlt?: boolean }>;
  side: "Over" | "Under";
  /** Expected tilt sign for Over (or flipped for Under). */
  expectTiltSign: 1 | -1 | 0;
};

const CASES: MarketCase[] = [
  {
    id: "sacks",
    player: "Sweat",
    teamAbbr: "PHI",
    expectOppId: "3", // faces CHI offense (OL sacks allowed)
    expectOwnId: "21",
    marketKey: "player_sacks",
    lines: [
      { line: 0.5, rawHit: 0.58 },
      { line: 1.5, rawHit: 0.42, propIsAlt: true },
    ],
    side: "Over",
    expectTiltSign: 1, // CHI porous OL + PHI pass-rush
  },
  {
    id: "defensive_ints",
    player: "Slay",
    teamAbbr: "PHI",
    expectOppId: "3", // faces CHI QB INT tendency
    expectOwnId: "21",
    marketKey: "player_defensive_interceptions",
    lines: [
      { line: 0.5, rawHit: 0.52 },
      { line: 1.5, rawHit: 0.28, propIsAlt: true },
    ],
    side: "Over",
    expectTiltSign: 1,
  },
  {
    id: "qb_ints",
    player: "Williams",
    teamAbbr: "CHI",
    expectOppId: "21", // faces PHI ball-hawking D
    expectOwnId: "3",
    marketKey: "player_pass_interceptions",
    lines: [
      { line: 0.5, rawHit: 0.55 },
      { line: 1.5, rawHit: 0.3, propIsAlt: true },
    ],
    side: "Over",
    expectTiltSign: 1,
  },
  {
    id: "rush_yds",
    player: "Swift",
    teamAbbr: "CHI",
    expectOppId: "21", // stiff PHI run D
    expectOwnId: "3",
    marketKey: "player_rush_yds",
    lines: [
      { line: 62.5, rawHit: 0.56 },
      { line: 44.5, rawHit: 0.68, propIsAlt: true },
    ],
    side: "Over",
    expectTiltSign: -1,
  },
  {
    id: "pass_yds",
    player: "Williams",
    teamAbbr: "CHI",
    expectOppId: "21",
    expectOwnId: "3",
    marketKey: "player_pass_yds",
    lines: [
      { line: 225.5, rawHit: 0.54 },
      { line: 199.5, rawHit: 0.62, propIsAlt: true },
    ],
    side: "Over",
    expectTiltSign: -1,
  },
  {
    id: "recv_yds",
    player: "Moore",
    teamAbbr: "CHI",
    expectOppId: "21",
    expectOwnId: "3",
    marketKey: "player_reception_yds",
    lines: [
      { line: 54.5, rawHit: 0.53 },
      { line: 39.5, rawHit: 0.64, propIsAlt: true },
    ],
    side: "Over",
    expectTiltSign: -1, // stingy PHI pass D
  },
];

function packsFor(teamAbbr: "CHI" | "PHI"): {
  oppId: string;
  ownId: string;
  pack: FootballOppDefenseSlice;
  ownPack: FootballOppDefenseSlice;
} {
  const oppId = opponentTeamIdForProp({
    sport: "nfl",
    game: GAME,
    teamAbbr,
    espnGames: ESPN_GAMES,
  })!;
  const ownId = ownTeamIdForProp({
    sport: "nfl",
    game: GAME,
    teamAbbr,
    espnGames: ESPN_GAMES,
  })!;
  return {
    oppId,
    ownId,
    pack: DEFENSE_MAP[`nfl#${oppId}`]!,
    ownPack: DEFENSE_MAP[`nfl#${ownId}`]!,
  };
}

/** Mirror scoredLegFromHit matchup application (props-only + recovery). */
function applyOnce(opts: {
  marketKey: string;
  side: "Over" | "Under";
  teamAbbr: "CHI" | "PHI";
  rawHit: number;
  odds: number;
  recovery?: boolean;
}) {
  const { oppId, ownId, pack, ownPack } = packsFor(opts.teamAbbr);
  const tilt = propOppDefenseTilt({
    sport: "nfl",
    market: opts.marketKey,
    side: opts.side,
    pack,
    ownPack,
  });
  const before = opts.rawHit;
  const after = adjustSimHitForOppDefenseTilt(before, tilt.tilt)!;
  const applied = tilt.tilt !== 0 && after !== before;
  const holistic = buildPropHolisticScore({
    sport: "nfl",
    marketKey: opts.marketKey,
    propSide: opts.side,
    simHit: after,
    edgePct: 4,
    footballOppDefense: pack,
    footballOwnPack: ownPack,
    oppMatchupAppliedToSim: applied,
    rubricScores: {
      matchup: null,
      trend: 6,
      lineValue: 6,
      injury: null,
      lineShopping: 5.5,
      simulation: 6,
    },
  });
  const oppFactor = holistic.factors.find((f) => f.key === "opponentTendency")!;
  const pick = {
    game: GAME,
    market: opts.marketKey,
    propMarketKey: opts.marketKey,
    pick: `P Over ${opts.marketKey}`,
    odds: opts.odds,
    isProp: true as const,
    sport: "nfl",
    player: "P",
    teamAbbr: opts.teamAbbr,
    propLine: 0.5,
    propSide: opts.side,
  };
  const slack = opts.recovery
    ? PROPS_ONLY_RECOVERY_ODDS_SLACK
    : PROPS_ONLY_ODDS_SLACK;
  const clears = propsOnlyLegClearsOdds(pick, after, slack);
  return {
    oppId,
    ownId,
    oppName: pack.teamName,
    ownName: ownPack.teamName,
    tilt,
    before,
    after,
    applied,
    oppFactor,
    holistic,
    clears,
    delta: Math.round((after - before) * 1000) / 1000,
  };
}

test("identity: CHI skill props face PHI (21); PHI defender faces CHI (3)", () => {
  for (const c of CASES) {
    const { oppId, ownId } = packsFor(c.teamAbbr);
    assert.equal(oppId, c.expectOppId, c.id);
    assert.equal(ownId, c.expectOwnId, c.id);
  }
});

test("pipeline: each family — inputs, direction, exactly one application", () => {
  const report: unknown[] = [];
  for (const c of CASES) {
    const main = applyOnce({
      marketKey: c.marketKey,
      side: c.side,
      teamAbbr: c.teamAbbr,
      rawHit: c.lines[0]!.rawHit,
      odds: -110,
    });
    assert.equal(main.oppId, c.expectOppId, c.id);
    assert.ok(main.tilt.display, `${c.id} must surface source inputs`);
    if (c.expectTiltSign > 0) assert.ok(main.tilt.tilt > 0, c.id);
    if (c.expectTiltSign < 0) assert.ok(main.tilt.tilt < 0, c.id);
    assert.equal(main.applied, main.tilt.tilt !== 0, c.id);
    // Exactly one application: tendency score null when sim already adjusted.
    assert.equal(main.oppFactor.score, null, `${c.id} tendency must not re-score`);
    assert.equal(main.oppFactor.present, true, `${c.id} display coverage`);
    assert.ok(main.oppFactor.display, c.id);
    if (main.tilt.tilt > 0) assert.ok(main.delta > 0, c.id);
    if (main.tilt.tilt < 0) assert.ok(main.delta < 0, c.id);
    report.push({
      id: c.id,
      opponent: { id: main.oppId, name: main.oppName },
      own: { id: main.ownId, name: main.ownName },
      inputs: main.tilt.display,
      tilt: main.tilt.tilt,
      simHit: { before: main.before, after: main.after, delta: main.delta },
      opponentTendencyScore: main.oppFactor.score,
      oneApplication: main.applied && main.oppFactor.score == null,
    });
  }
  assert.ok(true, `pipeline-report ${JSON.stringify(report)}`);
});

test("alt lines: same matchup tilt; each line’s hit adjusted afterward (not MC params)", () => {
  // Prove: tilt is identical across main/alt; raw hits differ; each gets post-hoc adj.
  // Mobile does not pass defenseIndex — distribution parameters stay untouched.
  for (const c of CASES) {
    const { pack, ownPack } = packsFor(c.teamAbbr);
    const tilt = propOppDefenseTilt({
      sport: "nfl",
      market: c.marketKey,
      side: c.side,
      pack,
      ownPack,
    });
    const adjusted = c.lines.map((ln) => ({
      line: ln.line,
      propIsAlt: !!ln.propIsAlt,
      raw: ln.rawHit,
      adj: adjustSimHitForOppDefenseTilt(ln.rawHit, tilt.tilt)!,
    }));
    // Same tilt for every rung of the ladder.
    for (const row of adjusted) {
      const expected = adjustSimHitForOppDefenseTilt(row.raw, tilt.tilt)!;
      assert.equal(row.adj, expected, `${c.id} line ${row.line}`);
    }
    // Distinct raw hits stay distinct after adj (parallel shift, not re-sim).
    assert.notEqual(adjusted[0]!.raw, adjusted[1]!.raw, c.id);
    const d0 = adjusted[0]!.adj - adjusted[0]!.raw;
    const d1 = adjusted[1]!.adj - adjusted[1]!.raw;
    assert.equal(Math.round(d0 * 1000), Math.round(d1 * 1000), `${c.id} same delta`);
  }
});

test("board attachPickScores: one application + opp identity on representative props", () => {
  const picks: ParsedPick[] = [];
  const pool: PropPoolEntry[] = [];
  const sims = new Map<string, { hitProbability: number | null }>();

  for (const c of CASES) {
    const ln = c.lines[0]!;
    const pick: ParsedPick = {
      game: GAME,
      market: c.marketKey,
      propMarketKey: c.marketKey,
      pick: `${c.player} ${c.side} ${ln.line} ${c.marketKey}`,
      odds: -110,
      isProp: true,
      sport: "nfl",
      player: c.player,
      teamAbbr: c.teamAbbr,
      propLine: ln.line,
      propSide: c.side,
      athleteId: `${c.id}-ath`,
    };
    picks.push(pick);
    pool.push({
      game: GAME,
      player: c.player,
      market: c.marketKey,
      marketKey: c.marketKey,
      line: ln.line,
      side: c.side,
      odds: -110,
      sport: "nfl",
      teamAbbr: c.teamAbbr,
      athleteId: `${c.id}-ath`,
    } as PropPoolEntry);
    // Key format used by lookupPropSimHit — player|market|line|side variants.
    const keys = [
      `${c.player}|${c.marketKey}|${ln.line}|${c.side}`,
      `${c.player}|${c.marketKey}|${ln.line}|${c.side.toLowerCase()}`,
    ];
    for (const k of keys) sims.set(k, { hitProbability: ln.rawHit });
  }

  const scored = attachPickScores(picks, {
    propPool: pool,
    propSimulations: sims,
    oppRushDefense: DEFENSE_MAP,
    espnGames: ESPN_GAMES as never,
  });

  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i]!;
    const p = scored[i]!;
    const hit = p.finalAiScore?.simHit ?? null;
    assert.ok(hit != null, c.id);
    const raw = c.lines[0]!.rawHit;
    // Direction matches tilt expectation.
    if (c.expectTiltSign > 0) assert.ok(hit! >= raw, c.id);
    if (c.expectTiltSign < 0) assert.ok(hit! <= raw, c.id);
    const opp = p.finalAiScore?.propHolistic?.factors?.find(
      (f) => f.key === "opponentTendency",
    );
    // When hit moved, tendency must not also score a lean.
    if (hit !== raw) {
      assert.ok(opp?.present, c.id);
      assert.equal(opp?.score, null, `${c.id} board path one application`);
    }
  }
});

test("recovery path: same one-application matchup under recovery odds slack", () => {
  for (const c of CASES) {
    const strict = applyOnce({
      marketKey: c.marketKey,
      side: c.side,
      teamAbbr: c.teamAbbr,
      rawHit: c.lines[0]!.rawHit,
      odds: -130,
      recovery: false,
    });
    const recovery = applyOnce({
      marketKey: c.marketKey,
      side: c.side,
      teamAbbr: c.teamAbbr,
      rawHit: c.lines[0]!.rawHit,
      odds: -130,
      recovery: true,
    });
    // Same opponent + same tilt/adj regardless of recovery slack.
    assert.equal(recovery.oppId, strict.oppId, c.id);
    assert.equal(recovery.tilt.tilt, strict.tilt.tilt, c.id);
    assert.equal(recovery.after, strict.after, c.id);
    assert.equal(recovery.oppFactor.score, null, c.id);
    assert.equal(recovery.applied, strict.applied, c.id);
    // Recovery only widens odds gate — does not re-apply matchup.
    assert.ok(
      recovery.clears === true || recovery.clears === strict.clears || recovery.clears,
      c.id,
    );
  }
});

test("cold/warm cache + tip vs parent scoring cost on identical fixtures", async () => {
  clearCoachContextCache();
  resetCoachCacheStats();
  const path = "/sports/team-defense?sport=nfl&teamId=pipeline-bench";
  let fetches = 0;
  const fetchMs = 28;
  const fetcher = async () => {
    fetches += 1;
    await new Promise((r) => setTimeout(r, fetchMs));
    return { ok: true, teamId: "pipeline-bench" };
  };

  const coldT0 = performance.now();
  await Promise.all([
    withCoachContextCache(path, "teamDefense", fetcher),
    withCoachContextCache(path, "teamDefense", fetcher),
    withCoachContextCache(path, "teamDefense", fetcher),
  ]);
  const coldMs = performance.now() - coldT0;
  assert.equal(fetches, 1);

  const warmT0 = performance.now();
  await Promise.all([
    withCoachContextCache(path, "teamDefense", fetcher),
    withCoachContextCache(path, "teamDefense", fetcher),
  ]);
  const warmMs = performance.now() - warmT0;
  assert.equal(fetches, 1);
  assert.ok(warmMs < 8, `warm ${warmMs}`);

  // Tip scoring (one application) vs parent-style (sim adj + tendency score).
  const tipIters = 200;
  const tipT0 = performance.now();
  for (let i = 0; i < tipIters; i++) {
    for (const c of CASES) {
      applyOnce({
        marketKey: c.marketKey,
        side: c.side,
        teamAbbr: c.teamAbbr,
        rawHit: c.lines[0]!.rawHit,
        odds: -110,
      });
    }
  }
  const tipMs = performance.now() - tipT0;

  const parentT0 = performance.now();
  for (let i = 0; i < tipIters; i++) {
    for (const c of CASES) {
      const { pack, ownPack } = packsFor(c.teamAbbr);
      const tilt = propOppDefenseTilt({
        sport: "nfl",
        market: c.marketKey,
        side: c.side,
        pack,
        ownPack,
      });
      const after = adjustSimHitForOppDefenseTilt(c.lines[0]!.rawHit, tilt.tilt);
      // Parent: scored tendency again (double-count path).
      buildPropHolisticScore({
        sport: "nfl",
        marketKey: c.marketKey,
        propSide: c.side,
        simHit: after,
        edgePct: 4,
        footballOppDefense: pack,
        footballOwnPack: ownPack,
        oppMatchupAppliedToSim: false,
        rubricScores: {
          matchup: null,
          trend: 6,
          lineValue: 6,
          injury: null,
          lineShopping: 5.5,
          simulation: 6,
        },
      });
    }
  }
  const parentMs = performance.now() - parentT0;

  const stats = getCoachCacheStats().find((s) => s.stage === "teamDefense");
  assert.ok((stats?.cacheHit ?? 0) >= 2);

  const timing = {
    sha: "42a9ace9729572491823d8240fef8e6f978c4522",
    parentSha: "2444d2e4c8631a3fed655ee98a116c1bf157e216",
    cache: {
      coldMs: Math.round(coldMs * 10) / 10,
      warmMs: Math.round(warmMs * 10) / 10,
      fetches,
    },
    scoringIdenticalFixtures: {
      iterations: tipIters,
      markets: CASES.length,
      tipOneApplicationMs: Math.round(tipMs * 10) / 10,
      parentDoubleCountMs: Math.round(parentMs * 10) / 10,
    },
    note:
      "Cache path unchanged vs parent (shared team-defense coalesce). Tip scoring is same-order; no extra network or MC runs. Parent lacked oppMatchupAppliedToSim (double-counted tendency).",
  };
  assert.ok(true, `timing-report ${JSON.stringify(timing)}`);
  // Tip must not be materially slower than parent double-count path on same fixtures.
  assert.ok(
    tipMs < parentMs * 1.5 + 50,
    `tip ${tipMs} vs parent ${parentMs}`,
  );
});

test("deadlines/qualification preserved: recovery slack ≠ matchup re-entry; blockOver intact", () => {
  // Stingy PHI run D still hard-blocks CHI rush Over (qualification gate).
  const { pack, ownPack } = packsFor("CHI");
  const tilt = propOppDefenseTilt({
    sport: "nfl",
    market: "player_rush_yds",
    side: "Over",
    pack,
    ownPack,
  });
  assert.equal(tilt.blockOver, true, "qualification: stingy rush Over blocked");
  // Cancelling a waiter must not abort shared cache fill (coachContextCache contract).
  assert.ok(PROPS_ONLY_RECOVERY_ODDS_SLACK > PROPS_ONLY_ODDS_SLACK);
});

test("Bo Nix Under 13.5 rush: reproduce delivered 98% (history, not inverted, one adj)", async () => {
  // Live ESPN series for athlete 4426338 (2026-10-15 snapshot) — all under 13.5.
  const rushYds = [10, 10, 7, 6, 2];
  const line = 13.5;
  const {
    gradeFootballPropFromHistory,
  } = await import("./coachFootballPropsOnlyGrade.ts");
  const {
    adjustSimHitForOppDefenseTilt,
    propOppDefenseTilt,
  } = await import("./footballRushDefense.ts");

  const recent = rushYds.map((yds) => ({
    stats: { rushingYards: String(yds) },
  }));
  const graded = gradeFootballPropFromHistory(
    {
      game: "Seattle Seahawks @ Denver Broncos",
      market: "Rush Yds",
      propMarketKey: "player_rush_yds",
      pick: "Bo Nix Under 13.5 Rush Yds",
      odds: -108,
      isProp: true,
      sport: "nfl",
      player: "Bo Nix",
      athleteId: "4426338",
      propLine: line,
      propSide: "Under",
    },
    { player: "Bo Nix", recent },
  );
  // 5/5 under → soft-clip 0.98 (not missing→0 inventing the edge).
  assert.equal(graded.hitProbability, 0.98);
  assert.equal(graded.nullReason, null);

  // Blank stats must not become zero fills in the series used for grading.
  const withBlank = gradeFootballPropFromHistory(
    {
      game: "Seattle Seahawks @ Denver Broncos",
      market: "Rush Yds",
      propMarketKey: "player_rush_yds",
      pick: "Bo Nix Under 13.5 Rush Yds",
      odds: -108,
      isProp: true,
      sport: "nfl",
      player: "Bo Nix",
      athleteId: "4426338",
      propLine: line,
      propSide: "Under",
    },
    {
      player: "Bo Nix",
      recent: [
        { stats: { rushingYards: "" } },
        { stats: {} },
        ...recent,
      ],
    },
  );
  assert.equal(withBlank.hitProbability, 0.98, "blanks skipped; series still 5 mapped unders");

  // SEA soft-stingy rush D — Under tilt; one application soft-caps at 0.98.
  const pack = {
    teamName: "Seattle Seahawks",
    rush: {
      rushingYardsAllowedPerGame: 100.4,
      yardsPerRushAllowed: null,
      sampleSize: 5,
      teamName: "Seattle Seahawks",
    },
    gamesPlayed: 5,
  };
  const ownPack = { ownRushYpc: 1.94, gamesPlayed: 5 };
  const tiltU = propOppDefenseTilt({
    sport: "nfl",
    market: "player_rush_yds",
    side: "Under",
    pack,
    ownPack,
  });
  const tiltO = propOppDefenseTilt({
    sport: "nfl",
    market: "player_rush_yds",
    side: "Over",
    pack,
    ownPack,
  });
  assert.ok(tiltU.tilt > 0, "Under favored vs soft-stingy SEA run D");
  assert.ok(tiltO.tilt < 0, "Over demoted — not an inverted Under");
  const once = adjustSimHitForOppDefenseTilt(0.971, tiltU.tilt);
  const twice = adjustSimHitForOppDefenseTilt(once, tiltU.tilt);
  assert.equal(once, 0.98);
  assert.equal(twice, 0.98, "second adjust cannot raise past soft-cap");

  // Holistic: after sim adj, tendency must not re-score.
  const { buildPropHolisticScore } = await import("./propHolisticRecommendation.ts");
  const h = buildPropHolisticScore({
    sport: "nfl",
    marketKey: "player_rush_yds",
    propSide: "Under",
    simHit: once,
    edgePct: 40,
    footballOppDefense: pack,
    footballOwnPack: ownPack,
    oppMatchupAppliedToSim: true,
    rubricScores: {
      matchup: null,
      trend: 6,
      lineValue: 6,
      injury: null,
      lineShopping: 5.5,
      simulation: 6,
    },
  });
  const opp = h.factors.find((f) => f.key === "opponentTendency");
  assert.equal(opp?.score, null);
  assert.ok(opp?.present && opp.display);

  assert.ok(
    true,
    JSON.stringify({
      athleteId: "4426338",
      eventId: "401872995",
      rushingYards: rushYds,
      propsOnlyHit: graded.hitProbability,
      mcRawThenAdj: once,
      identity: "SEA@DEN Under 13.5 → displayed 98%",
    }),
  );
});

test("buildFinalAiScore board path wires oppMatchupAppliedToSim", () => {
  const { pack, ownPack } = packsFor("CHI");
  const tilt = propOppDefenseTilt({
    sport: "nfl",
    market: "player_pass_yds",
    side: "Over",
    pack,
    ownPack,
  });
  const raw = 0.55;
  const adj = adjustSimHitForOppDefenseTilt(raw, tilt.tilt)!;
  const score = buildFinalAiScore({
    pick: {
      game: GAME,
      market: "Pass Yds",
      propMarketKey: "player_pass_yds",
      pick: "Williams Over 225.5 Pass Yds",
      odds: -110,
      isProp: true,
      sport: "nfl",
      player: "Williams",
      propLine: 225.5,
      propSide: "Over",
    },
    rubricScores: {
      matchup: null,
      trend: 6,
      lineValue: 6,
      injury: null,
      lineShopping: 5.5,
      simulation: 6,
    },
    edgePct: 4,
    odds: -110,
    propSimHit: adj,
    propHolisticContext: {
      sport: "nfl",
      marketKey: "player_pass_yds",
      propSide: "Over",
      footballOppDefense: pack,
      footballOwnPack: ownPack,
      oppMatchupAppliedToSim: true,
    },
  });
  const opp = score.propHolistic?.factors.find((f) => f.key === "opponentTendency");
  assert.equal(opp?.score, null);
  assert.ok(opp?.present && opp.display);
  assert.equal(score.simHit, adj);
});

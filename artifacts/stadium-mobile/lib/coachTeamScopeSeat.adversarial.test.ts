/**
 * Adversarial tests: team/game include-scope is an immutable seating constraint.
 * Unified qualification (#711) remains the quality authority — scope does not
 * resurrect rejected candidates or weaken floors.
 *
 * Avoids importing boardMarketScanner (heavy api graph); exercises the same
 * seating helpers buildScanResult uses after include-scope filtering.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  coachAskTeamScope,
  coachAskTeamShortfallNote,
  filterPicksForAskTeam,
  filterScoredLegsForAskTeam,
  pickMatchesAskTeamScope,
} from "./coachAskTeamScope.ts";
import { coachBoardSportsForAsk } from "./coachPropBoardCoverage.ts";
import { coachBuildSports, focalSportsFromText } from "./chatContextPriority.ts";
import {
  coachCandidateIsQualified,
  withCoachQualification,
} from "./coach/qualifyCoachCandidate.ts";
import {
  buildStagedTicketFromScan,
  topUpTicketFromQualifiedScored,
  type BoardScoredLeg,
} from "./ticketStaging.ts";
import {
  enforceMultiSportFloorOnTicket,
  injectPrioritySportsIntoTicket,
} from "./coachPrioritySports.ts";
import { fillReservedPropSlots } from "./boardScanPropDelivery.ts";
import { boardLegPoolRole } from "./ticketStaging.ts";
import {
  exactMarket10kProvenance,
  withExactMarket10kProvenance,
} from "./coachPropProbabilityProvenance.ts";

const ALL = [
  "mlb",
  "wnba",
  "nba",
  "nhl",
  "soccer",
  "ufc",
  "tennis",
  "nfl",
  "ncaaf",
  "ncaab",
];

const BILLS_GAME = "Miami Dolphins @ Buffalo Bills";
const SABRES_GAME = "Toronto Maple Leafs @ Buffalo Sabres";
const GUARDIANS_GAME = "Tampa Bay Rays @ Cleveland Guardians";
const DODGERS_GAME = "Milwaukee Brewers @ Los Angeles Dodgers";
const LAKERS_GAME = "Boston Celtics @ Los Angeles Lakers";

function scoredLeg(opts: {
  sport: string;
  game: string;
  grade?: string;
  confidencePct?: number;
  edgePct?: number;
  simHit?: number;
  isProp?: boolean;
  player?: string;
  market?: string;
  odds?: number;
  qualificationStatus?: "qualified" | "rejected";
  rankScore?: number;
}): BoardScoredLeg {
  const grade = opts.grade ?? "B+";
  const confidencePct = opts.confidencePct ?? 58;
  const edgePct = opts.edgePct ?? 4;
  const simHit = opts.simHit ?? 0.56;
  const market = opts.market ?? (opts.isProp ? "Player Points" : "Moneyline");
  const basePick = {
    sport: opts.sport,
    game: opts.game,
    market,
    pick: opts.isProp ? "Over 22.5" : "Home ML",
    odds: opts.odds ?? -110,
    isProp: !!opts.isProp,
    athleteId: opts.isProp ? "ath-scope" : undefined,
    eventId: opts.isProp ? "evt-scope" : undefined,
    propSide: opts.isProp ? "Over" : undefined,
    propLine: opts.isProp ? 24.5 : undefined,
    propMarketKey: opts.isProp ? "player_points" : undefined,
    player: opts.player,
    qualificationStatus: opts.qualificationStatus,
    simHit: opts.isProp ? simHit : undefined,
    finalAiScore: {
      grade,
      confidencePct,
      edgePct,
      simHit,
      simAligned: true,
      recommends: true,
      composite: 7,
      highRiskValuePlay: false,
      factors: [],
      rubric: {
        composite: 7,
        grade,
        confidencePct,
        edgePct,
        scores: {} as never,
      },
      ...(opts.isProp
        ? {
            propProbabilityProvenance: exactMarket10kProvenance({
              hitProbability: simHit,
              simulations: 10_000,
              sport: opts.sport,
              marketKey: "player_points",
              athleteId: "ath-scope",
              eventId: "evt-scope",
              side: "Over",
              line: 24.5,
            }),
          }
        : {}),
    },
  };
  const pick = opts.isProp ? withExactMarket10kProvenance(basePick) : basePick;
  return {
    pick: pick as never,
    evPct: 5,
    edgePct,
    confidencePct,
    impliedProbPct: 50,
    lineShoppingScore: 1,
    grade,
    simHit,
    composite: 7,
    rankScore: opts.rankScore ?? 60,
    hitReliability: 1,
  };
}

function mixedBoardPool(): BoardScoredLeg[] {
  const legs: BoardScoredLeg[] = [];
  for (let i = 0; i < 4; i++) {
    legs.push(
      scoredLeg({
        sport: "mlb",
        game: i % 2 === 0 ? GUARDIANS_GAME : DODGERS_GAME,
        grade: "A",
        confidencePct: 70,
        edgePct: 8,
        simHit: 0.62,
        rankScore: 99 - i,
      }),
    );
  }
  legs.push(
    scoredLeg({
      sport: "nba",
      game: LAKERS_GAME,
      grade: "A",
      confidencePct: 68,
      edgePct: 7,
      simHit: 0.6,
      rankScore: 95,
    }),
  );
  legs.push(
    scoredLeg({
      sport: "nhl",
      game: SABRES_GAME,
      grade: "A-",
      confidencePct: 64,
      edgePct: 6,
      simHit: 0.58,
      rankScore: 90,
    }),
  );
  for (let i = 0; i < 6; i++) {
    legs.push(
      scoredLeg({
        sport: "nfl",
        game: BILLS_GAME,
        grade: "B+",
        confidencePct: 56,
        edgePct: 3 + i * 0.1,
        simHit: 0.55,
        isProp: i % 2 === 1,
        player: i % 2 === 1 ? `Bills Player ${i}` : undefined,
        market: i % 2 === 1 ? "Passing Yards" : "Moneyline",
        rankScore: 50 + i,
      }),
    );
  }
  legs.push(
    scoredLeg({
      sport: "nfl",
      game: BILLS_GAME,
      grade: "B",
      confidencePct: 54,
      edgePct: 2.5,
      simHit: 0.54,
      isProp: true,
      player: "Josh Allen",
      market: "Alt Passing Yards",
      rankScore: 48,
    }),
  );
  return legs;
}

/**
 * Mirrors buildScanResult's scoped seating path: filter → stage → no cross-sport
 * floor → reserved props → top-up → scope belt.
 */
function seatScopedTicket(ask: string, pool: BoardScoredLeg[], target = 9) {
  const scope = coachAskTeamScope(ask);
  const stagePool = filterScoredLegsForAskTeam(pool, scope);
  const eventKey =
    scope?.sport === "nhl"
      ? SABRES_GAME
      : scope?.sport === "nfl"
        ? BILLS_GAME
        : null;
  const staged = buildStagedTicketFromScan(stagePool, target, `adv-${ask}`, {
    askText: ask,
    singleEventSport: scope?.sport ?? null,
    singleEventKey: eventKey,
    ticketStyle: "balanced",
  });
  let picks = staged.picks;
  // Scoped asks disable cross-sport inject/floor (same as buildScanResult).
  picks = injectPrioritySportsIntoTicket(picks, stagePool, target, ["nfl", "ncaaf"], true);
  picks = fillReservedPropSlots(picks, stagePool as never, target);
  picks = enforceMultiSportFloorOnTicket(picks, stagePool, target, ["nfl", "ncaaf"], true);
  if (picks.length < target) {
    picks = topUpTicketFromQualifiedScored(picks, stagePool, target, `adv-${ask}`);
  }
  picks = filterPicksForAskTeam(picks, scope);
  return { scope, picks, stagePool };
}

test("entity: 9 leg buffalo → Bills / NFL (not Sabres)", () => {
  const ask = "9 leg buffalo";
  const scope = coachAskTeamScope(ask);
  assert.ok(scope);
  assert.equal(scope!.sport, "nfl");
  assert.ok(scope!.matchTokens.includes("bills"));
  assert.deepEqual([...focalSportsFromText(ask)], ["nfl"]);
  assert.deepEqual(coachBuildSports(ask, 9, ALL), ["nfl"]);
  assert.deepEqual(coachBoardSportsForAsk(ask, 9, ALL), ["nfl"]);
});

test("entity: 9 leg bills / buffalo bills → Bills; sabres asks stay NHL", () => {
  for (const ask of ["9 leg bills", "9 leg buffalo bills"]) {
    const scope = coachAskTeamScope(ask);
    assert.ok(scope, ask);
    assert.equal(scope!.sport, "nfl", ask);
    assert.ok(scope!.matchTokens.includes("bills"), ask);
  }
  for (const ask of ["9 leg sabres", "9 leg buffalo sabres"]) {
    const scope = coachAskTeamScope(ask);
    assert.ok(scope, ask);
    assert.equal(scope!.sport, "nhl", ask);
    assert.ok(scope!.matchTokens.includes("sabres"), ask);
    assert.ok(!pickMatchesAskTeamScope({ sport: "nfl", game: BILLS_GAME }, scope), ask);
  }
});

test("9 leg buffalo seating: only Bills game legs; zero MLB/NBA/NHL foreign", () => {
  const { scope, picks } = seatScopedTicket("9 leg buffalo", mixedBoardPool(), 9);
  assert.ok(scope);
  assert.ok(picks.length > 0);
  for (const p of picks) {
    assert.equal(p.sport, "nfl", `foreign sport ${p.sport} ${p.game}`);
    assert.ok(pickMatchesAskTeamScope(p, scope), `out of scope: ${p.game}`);
    assert.ok(!/guardians|rays|dodgers|brewers|lakers|celtics|sabres|maple/i.test(p.game ?? ""));
  }
});

test("9 leg bills / buffalo bills seating: Bills only", () => {
  for (const ask of ["9 leg bills", "9 leg buffalo bills"]) {
    const { scope, picks } = seatScopedTicket(ask, mixedBoardPool(), 9);
    assert.ok(scope);
    for (const p of picks) {
      assert.equal(p.sport, "nfl", ask);
      assert.ok(pickMatchesAskTeamScope(p, scope), `${ask} → ${p.game}`);
    }
  }
});

test("9 leg sabres / buffalo sabres seating: Sabres only", () => {
  const pool = [
    ...mixedBoardPool(),
    scoredLeg({
      sport: "nhl",
      game: SABRES_GAME,
      grade: "B+",
      confidencePct: 57,
      edgePct: 3.5,
      simHit: 0.55,
      isProp: true,
      player: "Tage Thompson",
      market: "Player Points",
      rankScore: 70,
    }),
    scoredLeg({
      sport: "nhl",
      game: SABRES_GAME,
      grade: "B",
      confidencePct: 55,
      edgePct: 3,
      simHit: 0.54,
      rankScore: 65,
    }),
  ];
  for (const ask of ["9 leg sabres", "9 leg buffalo sabres"]) {
    const { scope, picks } = seatScopedTicket(ask, pool, 9);
    assert.ok(scope);
    for (const p of picks) {
      assert.equal(p.sport, "nhl", ask);
      assert.ok(pickMatchesAskTeamScope(p, scope), `${ask} → ${p.game}`);
      assert.ok(!/bills|dolphins|guardians|dodgers/i.test(p.game ?? ""), ask);
    }
  }
});

test("only 4 valid Bills legs → shortfall; no foreign fill", () => {
  const pool = [
    scoredLeg({ sport: "mlb", game: GUARDIANS_GAME, grade: "A", confidencePct: 72, edgePct: 9, simHit: 0.63, rankScore: 100 }),
    scoredLeg({ sport: "mlb", game: DODGERS_GAME, grade: "A", confidencePct: 71, edgePct: 8, simHit: 0.62, rankScore: 99 }),
    scoredLeg({ sport: "nba", game: LAKERS_GAME, grade: "A", confidencePct: 70, edgePct: 8, simHit: 0.61, rankScore: 98 }),
    ...[0, 1, 2, 3].map((i) =>
      scoredLeg({
        sport: "nfl",
        game: BILLS_GAME,
        grade: "B+",
        confidencePct: 56,
        edgePct: 3,
        simHit: 0.55,
        isProp: i > 0,
        player: i > 0 ? `BP${i}` : undefined,
        rankScore: 40 + i,
      }),
    ),
  ];
  const { scope, picks } = seatScopedTicket("9 leg buffalo", pool, 9);
  assert.ok(scope);
  assert.ok(picks.length <= 4);
  assert.ok(picks.length > 0);
  for (const p of picks) {
    assert.ok(pickMatchesAskTeamScope(p, scope));
  }
  const note = coachAskTeamShortfallNote(scope, 9, picks.length, 1);
  assert.ok(note.length > 0);
  assert.match(note, /won't fill with other games/i);
});

test("generic stronger MLB pool cannot enter Bills scoped ticket", () => {
  const pool = mixedBoardPool();
  const scoped = filterScoredLegsForAskTeam(pool, coachAskTeamScope("9 leg buffalo"));
  assert.ok(scoped.every((l) => l.pick.sport === "nfl"));
  assert.equal(
    scoped.filter((l) => /guardians|dodgers|lakers|sabres/i.test(l.pick.game ?? "")).length,
    0,
  );
  const { picks } = seatScopedTicket("9 leg buffalo", pool, 9);
  assert.equal(picks.filter((p) => p.sport !== "nfl").length, 0);
});

test("ALT top-up: Bills alternatives allowed; unrelated ALT blocked", () => {
  const scope = coachAskTeamScope("9 leg bills");
  const billsAlt = scoredLeg({
    sport: "nfl",
    game: BILLS_GAME,
    grade: "B",
    confidencePct: 54,
    edgePct: 2.5,
    simHit: 0.54,
    isProp: true,
    player: "Stefon Diggs",
    market: "Alt Receiving Yards",
    rankScore: 45,
  });
  const mlbAlt = scoredLeg({
    sport: "mlb",
    game: GUARDIANS_GAME,
    grade: "A",
    confidencePct: 70,
    edgePct: 8,
    simHit: 0.6,
    isProp: true,
    player: "Jose Ramirez",
    market: "Alt Total Bases",
    rankScore: 100,
  });
  const short = [
    scoredLeg({
      sport: "nfl",
      game: BILLS_GAME,
      grade: "B+",
      confidencePct: 58,
      edgePct: 4,
      simHit: 0.56,
      rankScore: 55,
    }).pick,
  ];
  const topped = topUpTicketFromQualifiedScored(
    short as never,
    filterScoredLegsForAskTeam([billsAlt, mlbAlt], scope),
    9,
  );
  assert.ok(topped.some((p) => /Diggs|Receiving/i.test(`${p.player ?? ""} ${p.market ?? ""}`)));
  assert.equal(topped.filter((p) => p.sport === "mlb").length, 0);

  const onlyForeign = topUpTicketFromQualifiedScored(
    short as never,
    filterScoredLegsForAskTeam([mlbAlt], scope),
    9,
  );
  assert.equal(onlyForeign.length, 1);
  assert.equal(onlyForeign[0]!.sport, "nfl");
});

test("partial publish path: scope filter drops foreign legs", () => {
  const scope = coachAskTeamScope("9 leg buffalo");
  const mixed = [
    scoredLeg({ sport: "nfl", game: BILLS_GAME }).pick,
    scoredLeg({ sport: "mlb", game: GUARDIANS_GAME, grade: "A", confidencePct: 70 }).pick,
    scoredLeg({ sport: "nba", game: LAKERS_GAME, grade: "A", confidencePct: 70 }).pick,
  ];
  const filtered = filterPicksForAskTeam(mixed as never, scope);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]!.sport, "nfl");
});

test("multi-sport floor / priority inject disabled for team-scoped asks", () => {
  const picks = [
    scoredLeg({ sport: "nfl", game: BILLS_GAME }).pick,
    scoredLeg({ sport: "nfl", game: BILLS_GAME, isProp: true, player: "P1" }).pick,
  ];
  const pool = mixedBoardPool();
  const floored = enforceMultiSportFloorOnTicket(picks as never, pool, 9, ["nfl", "ncaaf"], true);
  const injected = injectPrioritySportsIntoTicket(picks as never, pool, 9, ["nfl", "ncaaf"], true);
  assert.equal(floored.filter((p) => p.sport !== "nfl").length, 0);
  assert.equal(injected.filter((p) => p.sport !== "nfl").length, 0);
});

test("fillReservedPropSlots on scoped pool cannot seat foreign props", () => {
  const scope = coachAskTeamScope("9 leg buffalo");
  const pool = filterScoredLegsForAskTeam(mixedBoardPool(), scope);
  const filled = fillReservedPropSlots([], pool as never, 9);
  for (const p of filled) {
    assert.ok(pickMatchesAskTeamScope(p, scope));
  }
});

test("PR #711 regression: rejected candidates stay rejected even when in scope", () => {
  const rejected = withCoachQualification(
    {
      sport: "nfl",
      game: BILLS_GAME,
      market: "Player Points",
      isProp: true,
      odds: 25000,
      finalAiScore: {
        grade: "F",
        confidencePct: 10,
        edgePct: 4,
        simHit: 0.04,
      },
    },
    { requestStyle: "normal", isProp: true },
  );
  assert.equal(rejected.qualificationStatus, "rejected");
  assert.equal(
    coachCandidateIsQualified(rejected, { requestStyle: "normal", isProp: true }),
    false,
  );
  const scope = coachAskTeamScope("9 leg buffalo");
  assert.ok(pickMatchesAskTeamScope(rejected, scope));
  assert.equal(boardLegPoolRole(rejected as never, rejected.finalAiScore as never), null);

  const { picks } = seatScopedTicket(
    "9 leg buffalo",
    [
      scoredLeg({
        sport: "nfl",
        game: BILLS_GAME,
        grade: "F",
        confidencePct: 10,
        edgePct: 4,
        simHit: 0.04,
        isProp: true,
        player: "Bad Prop",
        odds: 25000,
        qualificationStatus: "rejected",
        rankScore: 100,
      }),
    ],
    9,
  );
  assert.equal(picks.length, 0);
});

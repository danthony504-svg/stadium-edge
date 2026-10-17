/**
 * Paired E2E fixture suite for Rays @ Guardians incident (mobile-rc-3645).
 * Synthetic tickets only — covers abbr ML/spread bind, stamp reject, delivery
 * grounding gate, reliability enrichment, and multi-sport regression smoke.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyDeliveryGroundingGate,
} from "./coachDeliveryGrounding.ts";
import { buildCoachReliabilityBody } from "./coachReliabilityReporter.ts";
import { coachTeamNickname } from "./coachTeamIdResolve.ts";
import {
  buildGameCoverQuery,
  gameSimHitForPick,
} from "./gameSimScoring.ts";
import type { ParsedPick } from "../components/PickCard.tsx";

function prop(
  overrides: Partial<ParsedPick> & Pick<ParsedPick, "game" | "teamAbbr" | "player">,
): ParsedPick {
  return {
    market: "Hits",
    pick: "Over 0.5",
    odds: -110,
    isProp: true,
    propMarketKey: "batter_hits",
    sport: "mlb",
    ...overrides,
  };
}

const stampedMlbSim = {
  sport: "mlb",
  simulations: 10_000,
  homeWinProbability: 0.55,
  awayWinProbability: 0.45,
  tieProbability: 0,
  homeProjectedScore: 4,
  awayProjectedScore: 3.5,
  mostLikelyWinner: "home" as const,
  mostLikelyWinnerPct: 0.55,
  confidenceScore: 50,
  engineVersion: "sport-sim-v1",
};

test("incident E2E: TB ML → away side, hit === awayWinProbability (0.45), not home/0.5", () => {
  const q = buildGameCoverQuery({
    game: "Tampa Bay Rays @ Cleveland Guardians",
    market: "Moneyline",
    pick: "TB ML",
    odds: -110,
    isProp: false,
    sport: "mlb",
  });
  assert.ok(q);
  assert.equal(q!.kind, "ml");
  assert.equal(q!.teamSide, "away");

  const hit = gameSimHitForPick(
    {
      game: "Tampa Bay Rays @ Cleveland Guardians",
      market: "Moneyline",
      pick: "TB ML",
      odds: -110,
      isProp: false,
      sport: "mlb",
    },
    stampedMlbSim,
  );
  assert.equal(hit, 0.45);
  assert.notEqual(hit, stampedMlbSim.homeWinProbability);
  assert.notEqual(hit, 0.5);
});

test("incident E2E: CLE +1.5 → home side spread query", () => {
  const spread = buildGameCoverQuery({
    game: "Rays @ Guardians",
    market: "Spread",
    pick: "CLE +1.5",
    odds: -110,
    isProp: false,
    sport: "mlb",
  });
  assert.ok(spread);
  assert.equal(spread!.kind, "spread");
  assert.equal(spread!.teamSide, "home");
  assert.equal(spread!.line, 1.5);
});

test("incident E2E: missing engineVersion → gameSimHitForPick null (stamp reject)", () => {
  const { engineVersion: _drop, ...unstamped } = stampedMlbSim;
  const hit = gameSimHitForPick(
    {
      game: "Tampa Bay Rays @ Cleveland Guardians",
      market: "Moneyline",
      pick: "TB ML",
      odds: -110,
      isProp: false,
      sport: "mlb",
    },
    unstamped,
  );
  assert.equal(hit, null);
});

test("incident E2E: wrong football stamp sport-sim-v1 on nfl → null", () => {
  const hit = gameSimHitForPick(
    {
      game: "Tampa Bay Buccaneers @ Atlanta Falcons",
      market: "Moneyline",
      pick: "TB ML",
      odds: -110,
      isProp: false,
      sport: "nfl",
    },
    {
      ...stampedMlbSim,
      sport: "nfl",
      engineVersion: "sport-sim-v1",
    },
  );
  assert.equal(hit, null);
});

test("incident E2E: delivery gate removes NYY orphan, CLE refill, shortfall when unmet", () => {
  const picks = [
    prop({
      game: "Rays @ Guardians",
      teamAbbr: "TB",
      player: "Junior Caminero",
    }),
    prop({
      game: "Rays @ Guardians",
      teamAbbr: "NYY",
      player: "Aaron Judge",
    }),
  ];
  const qualified = [
    prop({
      game: "Rays @ Guardians",
      teamAbbr: "CLE",
      player: "Jose Ramirez",
      market: "Hits",
      pick: "Over 1.5",
    }),
    prop({
      game: "Rays @ Guardians",
      teamAbbr: "BOS",
      player: "Rafael Devers",
    }),
  ];
  const result = applyDeliveryGroundingGate({
    picks,
    qualifiedCandidates: qualified,
    target: 3,
  });
  assert.equal(result.removedCount, 1);
  assert.equal(result.replacedCount, 1);
  assert.equal(result.picks.length, 2);
  assert.equal(result.shortfall, 1);
  assert.ok(result.picks.every((p) => p.teamAbbr !== "NYY"));
  assert.ok(result.picks.some((p) => p.player === "Jose Ramirez"));
  assert.ok(!result.picks.some((p) => p.player === "Rafael Devers"));
});

test("incident E2E: reliability body includes enrichment + scanFailureCode for FETCH_EMPTY", () => {
  const body = buildCoachReliabilityBody({
    requestId: "rays-guardians-e2e-fetch-empty",
    sportCategory: "mlb",
    requestedLegCount: 5,
    returnedLegCount: 0,
    durationMs: 8615,
    realOddsAvailable: true,
    scanFailureCode: "GAME_SIMS_FETCH_EMPTY",
    scanFailureDetail: "5 game(s) had ESPN ids but 0 Monte Carlo draws returned usable grades",
    updateId: "01a-e2e",
    channel: "preview",
    bakedSha: "deadbeef",
    requestScope: { sport: "mlb", team: "Rays" },
    candidateIds: ["Rays @ Guardians|Moneyline|TB ML"],
    gameIds: ["Rays @ Guardians"],
    simFailureReason: "GAME_SIMS_FETCH_EMPTY",
  });
  assert.equal(body?.scanFailureCode, "GAME_SIMS_FETCH_EMPTY");
  assert.equal(body?.updateId, "01a-e2e");
  assert.equal(body?.channel, "preview");
  assert.equal(body?.bakedSha, "deadbeef");
  assert.deepEqual(body?.requestScope, { sport: "mlb", team: "Rays" });
  assert.deepEqual(body?.gameIds, ["Rays @ Guardians"]);
  assert.equal(body?.simFailureReason, "GAME_SIMS_FETCH_EMPTY");
});

test("multi-sport smoke: NFL TB nick stays bay; NBA/NFL full-name ML still binds; nfl unstamped rejects", () => {
  assert.equal(coachTeamNickname("TB", "nfl"), "bay");
  assert.equal(coachTeamNickname("Tampa Bay Buccaneers", "nfl"), "buccaneers");
  assert.equal(coachTeamNickname("TB", "mlb"), "rays");

  const nba = buildGameCoverQuery({
    game: "Boston Celtics @ Miami Heat",
    market: "Moneyline",
    pick: "Boston Celtics ML",
    odds: -110,
    isProp: false,
    sport: "nba",
  });
  assert.ok(nba);
  assert.equal(nba!.teamSide, "away");

  const nfl = buildGameCoverQuery({
    game: "Tampa Bay Buccaneers @ Atlanta Falcons",
    market: "Moneyline",
    pick: "Tampa Bay Buccaneers ML",
    odds: -110,
    isProp: false,
    sport: "nfl",
  });
  assert.ok(nfl);
  assert.equal(nfl!.teamSide, "away");

  const unstampedNfl = gameSimHitForPick(
    {
      game: "Tampa Bay Buccaneers @ Atlanta Falcons",
      market: "Moneyline",
      pick: "Tampa Bay Buccaneers ML",
      odds: -110,
      isProp: false,
      sport: "nfl",
    },
    {
      sport: "nfl",
      simulations: 10_000,
      homeWinProbability: 0.52,
      awayWinProbability: 0.48,
      tieProbability: 0,
      homeProjectedScore: 24,
      awayProjectedScore: 21,
      mostLikelyWinner: "home" as const,
      mostLikelyWinnerPct: 0.52,
      confidenceScore: 50,
      // missing engineVersion
    },
  );
  assert.equal(unstampedNfl, null);
});

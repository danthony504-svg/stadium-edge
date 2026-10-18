/**
 * Request-reproducing regressions for greenfield-1792241518210 / 6360124 / 6362208.
 * Observe-only classification — does not change selection.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildCoachReliabilityBody } from "./coachReliabilityReporter.ts";
import { mapScanFailureCode } from "./coachReliabilityClassify.ts";
import { evaluateReturnedPicksGrounding } from "./coachReliabilityGrounding.ts";
import { deriveCoachScanFailureReason } from "./coachScanFailureReason.ts";

const RAYS_GUARDIANS_TICKET = [
  {
    game: "Rays @ Guardians",
    teamAbbr: "TB",
    player: "Junior Caminero",
    isProp: true as const,
    market: "Hits",
    propMarketKey: "batter_hits",
    sport: "mlb",
  },
  {
    game: "Rays @ Guardians",
    teamAbbr: "CLE",
    player: "Jose Ramirez",
    isProp: true as const,
    market: "Hits",
    propMarketKey: "batter_hits",
    sport: "mlb",
  },
  {
    game: "Rays @ Guardians",
    teamAbbr: "TBR",
    player: "Yandy Diaz",
    isProp: true as const,
    market: "Hits",
    sport: "mlb",
  },
  {
    game: "Tampa Bay Rays @ Cleveland Guardians",
    teamAbbr: "TB",
    player: "Brandon Lowe",
    isProp: true as const,
    market: "Home Runs",
    sport: "mlb",
  },
  {
    game: "Tampa Bay Rays @ Cleveland Guardians",
    teamAbbr: "CLE",
    player: "Steven Kwan",
    isProp: true as const,
    market: "Hits",
    sport: "mlb",
  },
  {
    game: "Rays @ Guardians",
    teamAbbr: "TB",
    player: "Josh Lowe",
    isProp: true as const,
    market: "Strikeouts",
    sport: "mlb",
  },
];

test("greenfield-1792241518210/6360124: grounded 6/6 Rays@Guardians does not page grounding", () => {
  const grounding = evaluateReturnedPicksGrounding(RAYS_GUARDIANS_TICKET);
  assert.equal(grounding.hasMismatch, false);
  const body = buildCoachReliabilityBody({
    requestId: "greenfield-1792241518210",
    sportCategory: "mlb",
    requestedLegCount: 6,
    returnedLegCount: 6,
    durationMs: 63805,
    realOddsAvailable: true,
    picks: RAYS_GUARDIANS_TICKET,
  });
  // Full N/N with every leg grounded → nothing alertable (not a grounding page).
  assert.equal(body, null);
});

test("greenfield grounding: full 6/6 with one bad leg still pages (no suppress-on-full)", () => {
  const picks = [
    ...RAYS_GUARDIANS_TICKET.slice(0, 5),
    {
      game: "Rays @ Guardians",
      teamAbbr: "NYY",
      player: "Aaron Judge",
      isProp: true as const,
      market: "Hits",
      sport: "mlb",
    },
  ];
  const body = buildCoachReliabilityBody({
    requestId: "greenfield-1792246360124",
    sportCategory: "mlb",
    requestedLegCount: 6,
    returnedLegCount: 6,
    durationMs: 55837,
    realOddsAvailable: true,
    picks,
  });
  assert.equal(body?.eventType, "coach_grounding_failure");
  assert.equal(body?.rootCause, "player_game_grounding_mismatch");
  assert.equal(body?.returnedLegCount, 6);
  assert.equal(body?.requestedLegCount, 6);
  assert.equal(body?.affectedGame, "Rays @ Guardians");
});

test("greenfield-1792246362208: missing_sim_output modes distinguished", () => {
  assert.equal(
    mapScanFailureCode("GAME_SIMS_FETCH_EMPTY")?.failureReason,
    "missing_sim_output",
  );
  assert.equal(
    mapScanFailureCode("GAME_SIMS_ALL_NULL")?.failureReason,
    "missing_sim_output",
  );
  assert.equal(
    mapScanFailureCode("GAME_SIMS_STAMP_REJECTED")?.failureReason,
    "missing_sim_output",
  );
  assert.equal(
    mapScanFailureCode("GAME_LINES_NO_SIM_GRADE")?.failureReason,
    "simulation_failure",
  );
  assert.equal(
    mapScanFailureCode("PROP_ALL_NO_SIM_GRADE")?.failureReason,
    "simulation_failure",
  );
  assert.equal(
    mapScanFailureCode("PROP_POOL_EMPTY")?.failureReason,
    "alt_market_failure",
  );

  const stamp = deriveCoachScanFailureReason({
    stagedPickCount: 0,
    oddsGameCount: 5,
    teamIdMapSize: 10,
    gameEntryCount: 5,
    gameSimsLoaded: 0,
    gameLegsScored: 0,
    propPoolSize: 0,
    propLegsScored: 0,
    oddsLabelsBound: 5,
    gameSimsFetchNull: 5,
    gameSimsStampRejected: 5,
    gameSimsAttempted: true,
  });
  assert.equal(stamp?.code, "GAME_SIMS_STAMP_REJECTED");

  const httpEmpty = deriveCoachScanFailureReason({
    stagedPickCount: 0,
    oddsGameCount: 5,
    teamIdMapSize: 10,
    gameEntryCount: 5,
    gameSimsLoaded: 0,
    gameLegsScored: 0,
    propPoolSize: 0,
    propLegsScored: 0,
    oddsLabelsBound: 5,
    gameSimsFetchNull: 5,
    gameSimsStampRejected: 0,
    gameSimsAttempted: true,
  });
  assert.equal(httpEmpty?.code, "GAME_SIMS_FETCH_EMPTY");

  const body = buildCoachReliabilityBody({
    requestId: "greenfield-1792246362208",
    sportCategory: "mlb",
    requestedLegCount: 5,
    returnedLegCount: 0,
    durationMs: 8615,
    realOddsAvailable: true,
    scanFailureCode: "GAME_SIMS_FETCH_EMPTY",
    scanFailureDetail: "5 game(s) had ESPN ids but 0 Monte Carlo draws returned usable grades",
  });
  assert.equal(body?.scanFailureCode, "GAME_SIMS_FETCH_EMPTY");
  assert.equal(body?.returnedLegCount, 0);
});

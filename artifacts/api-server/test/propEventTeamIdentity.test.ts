import assert from "node:assert/strict";
import test from "node:test";

import { propBelongsToGameTeams } from "../src/lib/propGameTeamGate.ts";
import {
  finalizePropIdentityDiag,
  matchEspnGameForOddsEvent,
  normalizePropIdentityStartsAt,
  propEventTeamIdentityCacheKey,
  reconcileCallerTeamIds,
  resolvePropEventTeamIdentity,
  resolvePropEventTeamIdentityFromGames,
  stampIdentityFailDiag,
  type PropEspnGameRow,
  type PropEventTeamIdentityDiag,
} from "../src/lib/propEventTeamIdentity.ts";
import { cacheGet } from "../src/lib/store.ts";

const HOU_JAX: PropEspnGameRow = {
  id: "401772833",
  sport: "nfl",
  homeTeam: "Jacksonville Jaguars",
  awayTeam: "Houston Texans",
  homeTeamId: "30",
  awayTeamId: "34",
  homeAbbr: "JAX",
  awayAbbr: "HOU",
  startsAt: "2026-10-18T13:30:00Z",
};

const OTHER_NFL: PropEspnGameRow = {
  id: "401772900",
  sport: "nfl",
  homeTeam: "Kansas City Chiefs",
  awayTeam: "Buffalo Bills",
  homeTeamId: "12",
  awayTeamId: "2",
  homeAbbr: "KC",
  awayAbbr: "BUF",
  startsAt: "2026-10-19T17:00:00Z",
};

const NCAAF_SAME_NAMES: PropEspnGameRow = {
  id: "401778001",
  sport: "ncaaf",
  homeTeam: "Jacksonville Jaguars", // synthetic collision — must never bind to NFL
  awayTeam: "Houston Texans",
  homeTeamId: "99930",
  awayTeamId: "99934",
  homeAbbr: "JAX",
  awayAbbr: "HOU",
  startsAt: "2026-10-18T13:30:00Z",
};

const NBA_SAMPLE: PropEspnGameRow = {
  id: "401810001",
  sport: "nba",
  homeTeam: "Boston Celtics",
  awayTeam: "New York Knicks",
  homeTeamId: "2",
  awayTeamId: "18",
  homeAbbr: "BOS",
  awayAbbr: "NYK",
  startsAt: "2026-10-20T23:30:00Z",
};

const MLB_DH_A: PropEspnGameRow = {
  id: "401820001",
  sport: "mlb",
  homeTeam: "New York Yankees",
  awayTeam: "Boston Red Sox",
  homeTeamId: "10",
  awayTeamId: "2",
  homeAbbr: "NYY",
  awayAbbr: "BOS",
  startsAt: "2026-10-18T17:05:00Z",
};

const MLB_DH_B: PropEspnGameRow = {
  id: "401820002",
  sport: "mlb",
  homeTeam: "New York Yankees",
  awayTeam: "Boston Red Sox",
  homeTeamId: "10",
  awayTeamId: "2",
  homeAbbr: "NYY",
  awayAbbr: "BOS",
  startsAt: "2026-10-18T23:05:00Z",
};

const GAMES = [HOU_JAX, OTHER_NFL, NCAAF_SAME_NAMES, NBA_SAMPLE, MLB_DH_A, MLB_DH_B];

test("no caller team ids + valid Odds event → authoritative ESPN ids resolved", () => {
  const r = resolvePropEventTeamIdentityFromGames(
    {
      sport: "nfl",
      oddsEventId: "57418b2cf5aca558b3c98eafac1e264a",
      homeTeam: "Jacksonville Jaguars",
      awayTeam: "Houston Texans",
      startsAt: "2026-10-18T13:30:00Z",
    },
    GAMES,
  );
  assert.equal(r.ok, true);
  assert.equal(r.homeTeamId, "30");
  assert.equal(r.awayTeamId, "34");
  assert.equal(r.espnEventId, "401772833");
  assert.equal(r.diag.status, "resolved");
  assert.equal(r.diag.source, "espn_scoreboard");
});

test("correct supplied ids → same resolved results", () => {
  const r = resolvePropEventTeamIdentityFromGames(
    {
      sport: "nfl",
      oddsEventId: "57418b2cf5aca558b3c98eafac1e264a",
      homeTeam: "Jacksonville Jaguars",
      awayTeam: "Houston Texans",
      startsAt: "2026-10-18T13:30:00Z",
      callerHomeTeamId: "30",
      callerAwayTeamId: "34",
    },
    GAMES,
  );
  assert.equal(r.ok, true);
  assert.equal(r.homeTeamId, "30");
  assert.equal(r.awayTeamId, "34");
  assert.equal(r.diag.status, "resolved");
});

test("swapped caller ids → fail closed (caller_conflict)", () => {
  const r = resolvePropEventTeamIdentityFromGames(
    {
      sport: "nfl",
      oddsEventId: "57418b2cf5aca558b3c98eafac1e264a",
      homeTeam: "Jacksonville Jaguars",
      awayTeam: "Houston Texans",
      startsAt: "2026-10-18T13:30:00Z",
      callerHomeTeamId: "34",
      callerAwayTeamId: "30",
    },
    GAMES,
  );
  assert.equal(r.ok, false);
  assert.equal(r.homeTeamId, null);
  assert.equal(r.awayTeamId, null);
  assert.equal(r.diag.status, "caller_conflict");
  assert.equal(r.diag.reason, "caller_team_ids_swapped");
});

test("wrong caller ids → fail closed", () => {
  const r = resolvePropEventTeamIdentityFromGames(
    {
      sport: "nfl",
      oddsEventId: "57418b2cf5aca558b3c98eafac1e264a",
      homeTeam: "Jacksonville Jaguars",
      awayTeam: "Houston Texans",
      callerHomeTeamId: "12",
      callerAwayTeamId: "2",
    },
    GAMES,
  );
  assert.equal(r.ok, false);
  assert.equal(r.diag.status, "caller_conflict");
  assert.equal(r.diag.reason, "caller_team_ids_mismatch");
});

test("partial caller ids → fail closed", () => {
  const r = reconcileCallerTeamIds("30", "34", "30", "");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "partial_caller_team_ids");
});

test("flipped Odds orientation (away@home names swapped) → unresolved", () => {
  // Require correct home/away orientation — do not silently flip.
  const hit = matchEspnGameForOddsEvent(GAMES, {
    sport: "nfl",
    homeTeam: "Houston Texans",
    awayTeam: "Jacksonville Jaguars",
    startsAt: "2026-10-18T13:30:00Z",
  });
  assert.equal(hit, null);
});

test("ambiguous doubleheader without startsAt → fail closed", () => {
  const hit = matchEspnGameForOddsEvent([MLB_DH_A, MLB_DH_B], {
    sport: "mlb",
    homeTeam: "New York Yankees",
    awayTeam: "Boston Red Sox",
  });
  assert.equal(hit, null);
});

test("doubleheader disambiguated by startsAt → unique match", () => {
  const hit = matchEspnGameForOddsEvent([MLB_DH_A, MLB_DH_B], {
    sport: "mlb",
    homeTeam: "New York Yankees",
    awayTeam: "Boston Red Sox",
    startsAt: "2026-10-18T23:10:00Z",
  });
  assert.ok(hit);
  assert.equal(hit!.game.id, "401820002");
});

test("NFL request does not bind NCAAF ids with colliding names", () => {
  const r = resolvePropEventTeamIdentityFromGames(
    {
      sport: "nfl",
      oddsEventId: "57418b2cf5aca558b3c98eafac1e264a",
      homeTeam: "Jacksonville Jaguars",
      awayTeam: "Houston Texans",
    },
    [NCAAF_SAME_NAMES], // NFL scoreboard empty — only NCAAF collision present
  );
  assert.equal(r.ok, false);
  assert.equal(r.diag.status, "unresolved");
});

test("NCAAF request ignores NFL scoreboard rows", () => {
  const r = resolvePropEventTeamIdentityFromGames(
    {
      sport: "ncaaf",
      oddsEventId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      homeTeam: "Jacksonville Jaguars",
      awayTeam: "Houston Texans",
    },
    [HOU_JAX], // NFL only
  );
  assert.equal(r.ok, false);
  assert.equal(r.diag.status, "unresolved");
});

/**
 * Stage 1 clarification: "NFL←NCAAF cross-sport unresolved" means intentional
 * fail-closed isolation — NOT a leakage path. sport=nfl + NCAAF Odds team names
 * cannot bind to the NFL scoreboard, so identity.status=unresolved and props
 * stay empty. NCAAF events/athletes cannot enter an NFL /sports/props board.
 */
test("sport=nfl + NCAAF Odds teams → unresolved (isolation, not leakage)", () => {
  const ncaafOnly: PropEspnGameRow = {
    id: "401860903",
    sport: "ncaaf",
    homeTeam: "Oregon State Beavers",
    awayTeam: "Washington State Cougars",
    homeTeamId: "204",
    awayTeamId: "265",
    homeAbbr: "ORST",
    awayAbbr: "WSU",
    startsAt: "2026-10-18T19:00:00Z",
  };
  const r = resolvePropEventTeamIdentityFromGames(
    {
      sport: "nfl",
      oddsEventId: "473d8828a17151640834e090d9eb46e4",
      homeTeam: "Oregon State Beavers",
      awayTeam: "Washington State Cougars",
      startsAt: "2026-10-18T19:00:00Z",
    },
    [HOU_JAX, ncaafOnly],
  );
  assert.equal(r.ok, false);
  assert.equal(r.diag.status, "unresolved");
  assert.equal(r.homeTeamId, null);
  assert.equal(r.awayTeamId, null);
});

/**
 * ESPN reuses numeric team ids across sports (30 = JAX NFL, 30 = USC NCAAF).
 * Mixed scoreboard pools must still bind by sport + exact team names.
 */
test("ESPN id 30 collision: NFL Jaguars resolve ignores NCAAF USC row", () => {
  const uscNcaaf: PropEspnGameRow = {
    id: "401860999",
    sport: "ncaaf",
    homeTeam: "USC Trojans",
    awayTeam: "UCLA Bruins",
    homeTeamId: "30", // same numeric id as NFL Jacksonville
    awayTeamId: "26",
    homeAbbr: "USC",
    awayAbbr: "UCLA",
    startsAt: "2026-10-18T13:30:00Z",
  };
  const r = resolvePropEventTeamIdentityFromGames(
    {
      sport: "nfl",
      oddsEventId: "57418b2cf5aca558b3c98eafac1e264a",
      homeTeam: "Jacksonville Jaguars",
      awayTeam: "Houston Texans",
      startsAt: "2026-10-18T13:30:00Z",
    },
    [uscNcaaf, HOU_JAX],
  );
  assert.equal(r.ok, true);
  assert.equal(r.espnEventId, "401772833"); // NFL fixture, not USC event
  assert.equal(r.homeTeamId, "30");
  assert.equal(r.awayTeamId, "34");
  assert.equal(r.diag.homeTeam, "Jacksonville Jaguars");
});

test("foreign NCAAF team id cannot survive NFL matchup gate", () => {
  // After Stage 1 resolve, gate is still the player-level belt.
  assert.equal(propBelongsToGameTeams("204", "30", "34"), false); // ORST
  assert.equal(propBelongsToGameTeams("265", "30", "34"), false); // WSU
  assert.equal(propBelongsToGameTeams("30", "30", "34"), true); // JAX only
  assert.equal(propBelongsToGameTeams("34", "30", "34"), true); // HOU only
});

test("second NFL event resolves independently", () => {
  const r = resolvePropEventTeamIdentityFromGames(
    {
      sport: "nfl",
      oddsEventId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      homeTeam: "Kansas City Chiefs",
      awayTeam: "Buffalo Bills",
      startsAt: "2026-10-19T17:00:00Z",
    },
    GAMES,
  );
  assert.equal(r.ok, true);
  assert.equal(r.homeTeamId, "12");
  assert.equal(r.awayTeamId, "2");
});

test("NBA exact-name resolve (representative non-NFL)", () => {
  const r = resolvePropEventTeamIdentityFromGames(
    {
      sport: "nba",
      oddsEventId: "cccccccccccccccccccccccccccccccc",
      homeTeam: "Boston Celtics",
      awayTeam: "New York Knicks",
    },
    GAMES,
  );
  assert.equal(r.ok, true);
  assert.equal(r.homeTeamId, "2");
  assert.equal(r.awayTeamId, "18");
});

test("fuzzy substring names do not match (no silent fuzzy resolve)", () => {
  const hit = matchEspnGameForOddsEvent(GAMES, {
    sport: "nfl",
    homeTeam: "Jaguars",
    awayTeam: "Texans",
  });
  assert.equal(hit, null);
});

test("exact abbr match works when Odds posts abbrs", () => {
  const hit = matchEspnGameForOddsEvent(GAMES, {
    sport: "nfl",
    homeTeam: "JAX",
    awayTeam: "HOU",
    startsAt: "2026-10-18T13:30:00Z",
  });
  assert.ok(hit);
  assert.equal(hit!.via, "abbr");
  assert.equal(hit!.game.homeTeamId, "30");
});

test("propGameTeamGate still rejects foreign / unassigned players", () => {
  assert.equal(propBelongsToGameTeams(null, "30", "34"), false);
  assert.equal(propBelongsToGameTeams("12", "30", "34"), false);
  assert.equal(propBelongsToGameTeams("30", "30", "34"), true);
  assert.equal(propBelongsToGameTeams("34", "30", "34"), true);
  // Gate unchanged: missing matchup ids still fail closed.
  assert.equal(propBelongsToGameTeams("30", "", ""), false);
});

test("finalizePropIdentityDiag distinguishes no_provider_props vs team_filtered vs resolved", () => {
  const base: PropEventTeamIdentityDiag = {
    status: "resolved",
    reason: "matched_via_full_name",
    sport: "nfl",
    oddsEventId: "57418b2cf5aca558b3c98eafac1e264a",
    espnEventId: "401772833",
    homeTeam: "Jacksonville Jaguars",
    awayTeam: "Houston Texans",
    homeTeamId: "30",
    awayTeamId: "34",
    callerHomeTeamId: null,
    callerAwayTeamId: null,
    source: "espn_scoreboard",
    preGateCount: null,
    postGateCount: null,
    rejectedUnassignedOrForeign: null,
  };
  assert.equal(
    finalizePropIdentityDiag(base, { preGateCount: 0, postGateCount: 0 }).status,
    "no_provider_props",
  );
  assert.equal(
    finalizePropIdentityDiag(base, { preGateCount: 50, postGateCount: 0 }).status,
    "team_filtered",
  );
  const ok = finalizePropIdentityDiag(base, { preGateCount: 720, postGateCount: 719 });
  assert.equal(ok.status, "resolved");
  assert.equal(ok.rejectedUnassignedOrForeign, 1);
  assert.equal(ok.preGateCount, 720);
  assert.equal(ok.postGateCount, 719);
});

test("HOU@JAX regression contract: resolved ids are ESPN 30/34 (719-prop path)", () => {
  // Production proof (pre-fix): with 30/34 → 719 props; without → 0.
  // This unit locks the identity half of that funnel.
  const r = resolvePropEventTeamIdentityFromGames(
    {
      sport: "nfl",
      oddsEventId: "57418b2cf5aca558b3c98eafac1e264a",
      homeTeam: "Jacksonville Jaguars",
      awayTeam: "Houston Texans",
      startsAt: "2026-10-18T13:30:00Z",
    },
    GAMES,
  );
  assert.deepEqual(
    { home: r.homeTeamId, away: r.awayTeamId, ok: r.ok },
    { home: "30", away: "34", ok: true },
  );
});

// ---------------------------------------------------------------------------
// PR-C: MLB event identity cache + startsAt (cold/warm, DH, poison recovery)
// ---------------------------------------------------------------------------

const MLB_TB_CLE_G1: PropEspnGameRow = {
  id: "401930514",
  sport: "mlb",
  homeTeam: "Cleveland Guardians",
  awayTeam: "Tampa Bay Rays",
  homeTeamId: "5",
  awayTeamId: "30",
  homeAbbr: "CLE",
  awayAbbr: "TB",
  startsAt: "2026-10-18T17:10:00Z",
};

const MLB_TB_CLE_G2: PropEspnGameRow = {
  id: "401930515",
  sport: "mlb",
  homeTeam: "Cleveland Guardians",
  awayTeam: "Tampa Bay Rays",
  homeTeamId: "5",
  awayTeamId: "30",
  homeAbbr: "CLE",
  awayAbbr: "TB",
  startsAt: "2026-10-18T23:10:00Z",
};

const MLB_SINGLE: PropEspnGameRow = {
  id: "401930600",
  sport: "mlb",
  homeTeam: "Los Angeles Dodgers",
  awayTeam: "San Diego Padres",
  homeTeamId: "19",
  awayTeamId: "25",
  homeAbbr: "LAD",
  awayAbbr: "SD",
  startsAt: "2026-10-19T02:10:00Z",
};

test("normalizePropIdentityStartsAt buckets to ISO minute; missing → _", () => {
  assert.equal(normalizePropIdentityStartsAt(null), "_");
  assert.equal(normalizePropIdentityStartsAt(""), "_");
  assert.equal(normalizePropIdentityStartsAt("not-a-date"), "_");
  assert.equal(
    normalizePropIdentityStartsAt("2026-10-18T23:10:44.123Z"),
    "2026-10-18T23:10",
  );
  assert.equal(
    normalizePropIdentityStartsAt("2026-10-18T23:10:00Z"),
    normalizePropIdentityStartsAt("2026-10-18T23:10:59Z"),
  );
});

test("v2 cache key includes sport, oddsEventId, and startsAt norm", () => {
  const k = propEventTeamIdentityCacheKey(
    "mlb",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "2026-10-18T23:10:00Z",
  );
  assert.equal(
    k,
    "prop-event-team-identity:v2:mlb:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:2026-10-18T23:10",
  );
  const missing = propEventTeamIdentityCacheKey(
    "mlb",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    null,
  );
  assert.match(missing, /:_\s*$|:_\b/);
  assert.ok(missing.endsWith(":_"));
});

test("MLB single game resolves without startsAt when unique", () => {
  const r = resolvePropEventTeamIdentityFromGames(
    {
      sport: "mlb",
      oddsEventId: "11111111111111111111111111111111",
      homeTeam: "Los Angeles Dodgers",
      awayTeam: "San Diego Padres",
    },
    [MLB_SINGLE, MLB_TB_CLE_G1],
  );
  assert.equal(r.ok, true);
  assert.equal(r.espnEventId, "401930600");
  assert.equal(r.homeTeamId, "19");
  assert.equal(r.awayTeamId, "25");
});

test("M1: dual-game TB@CLE + commenceTime → ESPN 401930515", () => {
  const hit = matchEspnGameForOddsEvent([MLB_TB_CLE_G1, MLB_TB_CLE_G2], {
    sport: "mlb",
    homeTeam: "Cleveland Guardians",
    awayTeam: "Tampa Bay Rays",
    startsAt: "2026-10-18T23:15:00Z",
  });
  assert.ok(hit);
  assert.equal(hit!.game.id, "401930515");
  const r = resolvePropEventTeamIdentityFromGames(
    {
      sport: "mlb",
      oddsEventId: "22222222222222222222222222222222",
      homeTeam: "Cleveland Guardians",
      awayTeam: "Tampa Bay Rays",
      startsAt: "2026-10-18T23:15:00Z",
    },
    [MLB_TB_CLE_G1, MLB_TB_CLE_G2],
  );
  assert.equal(r.ok, true);
  assert.equal(r.espnEventId, "401930515");
  assert.equal(r.homeTeamId, "5");
  assert.equal(r.awayTeamId, "30");
});

test("two events identical team names different startsAt → distinct ESPN ids", () => {
  const a = resolvePropEventTeamIdentityFromGames(
    {
      sport: "mlb",
      oddsEventId: "33333333333333333333333333333333",
      homeTeam: "Cleveland Guardians",
      awayTeam: "Tampa Bay Rays",
      startsAt: "2026-10-18T17:10:00Z",
    },
    [MLB_TB_CLE_G1, MLB_TB_CLE_G2],
  );
  const b = resolvePropEventTeamIdentityFromGames(
    {
      sport: "mlb",
      oddsEventId: "44444444444444444444444444444444",
      homeTeam: "Cleveland Guardians",
      awayTeam: "Tampa Bay Rays",
      startsAt: "2026-10-18T23:10:00Z",
    },
    [MLB_TB_CLE_G1, MLB_TB_CLE_G2],
  );
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.espnEventId, "401930514");
  assert.equal(b.espnEventId, "401930515");
  assert.notEqual(a.espnEventId, b.espnEventId);
});

test("missing startsAt on doubleheader → fail closed (no guess)", () => {
  const r = resolvePropEventTeamIdentityFromGames(
    {
      sport: "mlb",
      oddsEventId: "55555555555555555555555555555555",
      homeTeam: "Cleveland Guardians",
      awayTeam: "Tampa Bay Rays",
    },
    [MLB_TB_CLE_G1, MLB_TB_CLE_G2],
  );
  assert.equal(r.ok, false);
  assert.equal(r.diag.status, "unresolved");
  assert.equal(r.espnEventId, null);
});

test("M2: resolve without startsAt then with startsAt is not null-poisoned", async () => {
  const oddsEventId = "66666666666666666666666666666666";
  const games = [MLB_TB_CLE_G1, MLB_TB_CLE_G2];
  const coldMiss = await resolvePropEventTeamIdentity({
    sport: "mlb",
    oddsEventId,
    homeTeam: "Cleveland Guardians",
    awayTeam: "Tampa Bay Rays",
    // no startsAt — ambiguous DH
    espnGames: games,
  });
  assert.equal(coldMiss.ok, false);

  // Miss must NOT write a null cache entry under the "_" key.
  const missKey = propEventTeamIdentityCacheKey("mlb", oddsEventId, null);
  assert.equal(await cacheGet(missKey), undefined);

  const recovered = await resolvePropEventTeamIdentity({
    sport: "mlb",
    oddsEventId,
    homeTeam: "Cleveland Guardians",
    awayTeam: "Tampa Bay Rays",
    startsAt: "2026-10-18T23:10:00Z",
    espnGames: games,
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.espnEventId, "401930515");
});

test("cold vs warm cache parity for MLB DH slot", async () => {
  const oddsEventId = "77777777777777777777777777777777";
  const args = {
    sport: "mlb",
    oddsEventId,
    homeTeam: "Cleveland Guardians",
    awayTeam: "Tampa Bay Rays",
    startsAt: "2026-10-18T17:10:00Z",
    espnGames: [MLB_TB_CLE_G1, MLB_TB_CLE_G2],
  };
  const cold = await resolvePropEventTeamIdentity(args);
  const warm = await resolvePropEventTeamIdentity(args);
  assert.equal(cold.ok, true);
  assert.equal(warm.ok, true);
  assert.deepEqual(
    {
      home: cold.homeTeamId,
      away: cold.awayTeamId,
      espn: cold.espnEventId,
    },
    {
      home: warm.homeTeamId,
      away: warm.awayTeamId,
      espn: warm.espnEventId,
    },
  );
  assert.equal(cold.espnEventId, "401930514");
  const key = propEventTeamIdentityCacheKey(
    "mlb",
    oddsEventId,
    args.startsAt,
  );
  const cached = await cacheGet<{ espnEventId: string; startsAtNorm: string }>(
    key,
  );
  assert.ok(cached);
  assert.equal(cached!.espnEventId, "401930514");
  assert.equal(cached!.startsAtNorm, "2026-10-18T17:10");
});

test("stale cached identity: schedule startsAt change uses separate key", async () => {
  const oddsEventId = "88888888888888888888888888888888";
  const games = [MLB_TB_CLE_G1, MLB_TB_CLE_G2];
  const first = await resolvePropEventTeamIdentity({
    sport: "mlb",
    oddsEventId,
    homeTeam: "Cleveland Guardians",
    awayTeam: "Tampa Bay Rays",
    startsAt: "2026-10-18T17:10:00Z",
    espnGames: games,
  });
  assert.equal(first.espnEventId, "401930514");

  // Provider moved commenceTime to game 2 — new key, no stale G1 association.
  const updated = await resolvePropEventTeamIdentity({
    sport: "mlb",
    oddsEventId,
    homeTeam: "Cleveland Guardians",
    awayTeam: "Tampa Bay Rays",
    startsAt: "2026-10-18T23:10:00Z",
    espnGames: games,
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.espnEventId, "401930515");
});

test("wrong-game athlete rejected by propGameTeamGate after identity resolve", () => {
  // Correct TB@CLE ids are 5/30; foreign NYY athlete (10) must fail.
  assert.equal(propBelongsToGameTeams("10", "5", "30"), false);
  assert.equal(propBelongsToGameTeams("5", "5", "30"), true);
  assert.equal(propBelongsToGameTeams("30", "5", "30"), true);
  assert.equal(propBelongsToGameTeams(null, "5", "30"), false);
});

test("Odds vs ESPN event ids stay separated on resolve", () => {
  const oddsEventId = "99999999999999999999999999999999";
  const r = resolvePropEventTeamIdentityFromGames(
    {
      sport: "mlb",
      oddsEventId,
      homeTeam: "Cleveland Guardians",
      awayTeam: "Tampa Bay Rays",
      startsAt: "2026-10-18T23:10:00Z",
    },
    [MLB_TB_CLE_G1, MLB_TB_CLE_G2],
  );
  assert.equal(r.ok, true);
  assert.equal(r.diag.oddsEventId, oddsEventId);
  assert.equal(r.espnEventId, "401930515");
  assert.notEqual(r.diag.oddsEventId, r.espnEventId);
});

test("NFL/NCAAF isolation unchanged with MLB DH fixtures present", () => {
  const pool = [...GAMES, MLB_TB_CLE_G1, MLB_TB_CLE_G2, MLB_SINGLE];
  const nfl = resolvePropEventTeamIdentityFromGames(
    {
      sport: "nfl",
      oddsEventId: "57418b2cf5aca558b3c98eafac1e264a",
      homeTeam: "Jacksonville Jaguars",
      awayTeam: "Houston Texans",
      startsAt: "2026-10-18T13:30:00Z",
    },
    pool,
  );
  assert.equal(nfl.ok, true);
  assert.equal(nfl.espnEventId, "401772833");
  assert.equal(nfl.homeTeamId, "30");

  const cross = resolvePropEventTeamIdentityFromGames(
    {
      sport: "nfl",
      oddsEventId: "abababababababababababababababab",
      homeTeam: "Cleveland Guardians",
      awayTeam: "Tampa Bay Rays",
      startsAt: "2026-10-18T23:10:00Z",
    },
    pool,
  );
  assert.equal(cross.ok, false);
});

test("M3: preGate>0 & identity fail → identity_unresolved (not no_provider_props)", () => {
  const base: PropEventTeamIdentityDiag = {
    status: "unresolved",
    reason: "no_authoritative_espn_match",
    sport: "mlb",
    oddsEventId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    espnEventId: null,
    homeTeam: "Cleveland Guardians",
    awayTeam: "Tampa Bay Rays",
    homeTeamId: null,
    awayTeamId: null,
    callerHomeTeamId: null,
    callerAwayTeamId: null,
    source: null,
    preGateCount: null,
    postGateCount: null,
    rejectedUnassignedOrForeign: null,
  };
  const stamped = stampIdentityFailDiag(base, 272);
  assert.equal(stamped.status, "identity_unresolved");
  assert.equal(stamped.preGateCount, 272);
  assert.equal(stamped.postGateCount, 0);

  const finalized = finalizePropIdentityDiag(base, {
    preGateCount: 272,
    postGateCount: 0,
  });
  assert.equal(finalized.status, "identity_unresolved");
  assert.notEqual(finalized.status, "no_provider_props");

  // Identity ok but provider empty stays no_provider_props.
  const okEmpty = finalizePropIdentityDiag(
    { ...base, status: "resolved", reason: "matched_via_full_name" },
    { preGateCount: 0, postGateCount: 0 },
  );
  assert.equal(okEmpty.status, "no_provider_props");
});

test("valid MLB props survive gate when identity is authoritative", () => {
  const r = resolvePropEventTeamIdentityFromGames(
    {
      sport: "mlb",
      oddsEventId: "acacacacacacacacacacacacacacacac",
      homeTeam: "Cleveland Guardians",
      awayTeam: "Tampa Bay Rays",
      startsAt: "2026-10-18T23:10:00Z",
    },
    [MLB_TB_CLE_G1, MLB_TB_CLE_G2],
  );
  assert.equal(r.ok, true);
  const home = r.homeTeamId!;
  const away = r.awayTeamId!;
  // Simulate provider rows: home/away athletes + foreign.
  const pre = [
    { playerTeamId: home },
    { playerTeamId: away },
    { playerTeamId: home },
    { playerTeamId: "10" }, // NYY foreign
    { playerTeamId: null },
  ];
  const post = pre.filter((p) =>
    propBelongsToGameTeams(p.playerTeamId, home, away),
  );
  assert.equal(pre.length, 5);
  assert.equal(post.length, 3);
  const diag = finalizePropIdentityDiag(r.diag, {
    preGateCount: pre.length,
    postGateCount: post.length,
  });
  assert.equal(diag.status, "resolved");
  assert.equal(diag.postGateCount, 3);
  assert.equal(diag.rejectedUnassignedOrForeign, 2);
});

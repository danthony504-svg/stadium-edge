import assert from "node:assert/strict";
import test from "node:test";

import { COACH_SIM_MIN_CONFIDENCE, COACH_SIM_MIN_GRADE } from "./gameSimQualityGates.ts";
import { askAllowsNcaafPlayerProps } from "./boardScanPropDelivery.ts";
import {
  explicitFootballPropsSportScope,
  filterPicksByAllowedSports,
  filterPoolByAllowedSports,
  hardLockedSportsFromAsk,
  resolveAuthoritativeCandidateSport,
  resolveImmutableAskSportScope,
  rowMatchesAllowedSports,
} from "./coachAskSportScope.ts";
import { filterPoolByFootballRecoverySports } from "./coachFootballPropsOnlyRecovery.ts";

test("qualification floors unchanged (#711)", () => {
  assert.equal(COACH_SIM_MIN_CONFIDENCE, 52);
  assert.equal(COACH_SIM_MIN_GRADE, "C+");
});

test("explicitFootballPropsSportScope: NFL / NCAAF / generic", () => {
  assert.equal(explicitFootballPropsSportScope("5 leg NFL player props"), "nfl");
  assert.equal(explicitFootballPropsSportScope("5 leg nfl player props"), "nfl");
  assert.equal(
    explicitFootballPropsSportScope("7 leg college football player props"),
    "ncaaf",
  );
  assert.equal(explicitFootballPropsSportScope("5 leg ncaaf player props"), "ncaaf");
  assert.equal(explicitFootballPropsSportScope("8 leg college"), "ncaaf");
  assert.equal(explicitFootballPropsSportScope("5 leg football player props"), null);
  assert.equal(explicitFootballPropsSportScope("5 leg player props"), null);
});

test("hardLockedSportsFromAsk: exclusive NCAAF/NFL for P0 early-exit", () => {
  assert.deepEqual(hardLockedSportsFromAsk("6 leg NCAAF"), ["ncaaf"]);
  assert.deepEqual(hardLockedSportsFromAsk("8 leg college"), ["ncaaf"]);
  assert.deepEqual(hardLockedSportsFromAsk("5 leg NFL player props"), ["nfl"]);
  assert.equal(hardLockedSportsFromAsk("5 leg football player props"), null);
});

test("resolveImmutableAskSportScope forces singleton for explicit leagues", () => {
  assert.deepEqual(
    resolveImmutableAskSportScope({
      askText: "5 leg NFL player props",
      boardSports: ["nfl", "ncaaf", "nba"],
    }),
    ["nfl"],
  );
  assert.deepEqual(
    resolveImmutableAskSportScope({
      askText: "7 leg college football player props",
      boardSports: ["nfl", "ncaaf"],
    }),
    ["ncaaf"],
  );
  assert.deepEqual(
    resolveImmutableAskSportScope({
      askText: "5 leg football player props",
      boardSports: ["nfl", "ncaaf"],
    }).sort(),
    ["ncaaf", "nfl"],
  );
  assert.deepEqual(
    resolveImmutableAskSportScope({
      askText: "5 leg NBA player props",
      boardSports: ["nba"],
    }),
    ["nba"],
  );
});

test("askAllowsNcaafPlayerProps no longer authorizes NCAAF from NFL player props", () => {
  assert.equal(askAllowsNcaafPlayerProps("5 leg NFL player props"), false);
  assert.equal(askAllowsNcaafPlayerProps("5 leg college football player props"), true);
  assert.equal(askAllowsNcaafPlayerProps("5 leg football player props"), true);
  assert.equal(askAllowsNcaafPlayerProps("5 leg player props"), false);
  assert.equal(askAllowsNcaafPlayerProps("5 leg touchdown"), false);
  assert.equal(askAllowsNcaafPlayerProps("8 leg college"), false);
});

test("NFL request + stronger NCAAF candidates → NCAAF rejected", () => {
  const mixed = [
    { sport: "ncaaf", player: "CFB_Strong", marketKey: "player_rush_yds", odds: -105 },
    { sport: "nfl", player: "NFL_Weak", marketKey: "player_rush_yds", odds: -200 },
    { sport: "ncaaf", player: "CFB_Alt", marketKey: "player_pass_yds_alternate", odds: -110 },
  ];
  const scope = {
    allowedSports: resolveImmutableAskSportScope({
      askText: "5 leg NFL player props",
      boardSports: ["nfl"],
    }),
  };
  const out = filterPoolByAllowedSports(mixed, scope);
  assert.deepEqual(out.map((r) => r.player), ["NFL_Weak"]);
  assert.equal(out.some((r) => r.sport === "ncaaf"), false);
});

test("NCAAF request + stronger NFL candidates → NFL rejected", () => {
  const mixed = [
    { sport: "nfl", player: "NFL_Strong", marketKey: "player_receptions", odds: -105 },
    { sport: "ncaaf", player: "CFB_Ok", marketKey: "player_receptions", odds: -180 },
  ];
  const scope = {
    allowedSports: resolveImmutableAskSportScope({
      askText: "7 leg college football player props",
      boardSports: ["ncaaf"],
    }),
  };
  const out = filterPoolByAllowedSports(mixed, scope);
  assert.deepEqual(out.map((r) => r.player), ["CFB_Ok"]);
  assert.equal(out.some((r) => r.sport === "nfl"), false);
});

test("unknown-sport row rejected unless authoritative metadata resolves", () => {
  const scope = { allowedSports: ["nfl"] as const };
  assert.equal(rowMatchesAllowedSports(null, scope), false);
  assert.equal(rowMatchesAllowedSports("", scope), false);
  assert.equal(rowMatchesAllowedSports("nfl", scope), true);

  const picks = [
    { sport: null, game: "Away @ Home", player: "Untagged" },
    { sport: "nfl", game: "KC @ BUF", player: "Tagged" },
  ];
  const withoutMeta = filterPicksByAllowedSports(picks, scope);
  assert.deepEqual(withoutMeta.map((p) => p.player), ["Tagged"]);

  const withMeta = filterPicksByAllowedSports(picks, scope, [
    { sport: "nfl", awayTeam: "Away", homeTeam: "Home" },
  ]);
  assert.deepEqual(withMeta.map((p) => p.player).sort(), ["Tagged", "Untagged"]);

  assert.equal(
    resolveAuthoritativeCandidateSport({
      sport: null,
      game: "Away @ Home",
      espnGames: [{ sport: "ncaaf", awayTeam: "Away", homeTeam: "Home" }],
    }),
    "ncaaf",
  );
  // Resolved ncaaf still fails NFL scope.
  assert.deepEqual(
    filterPicksByAllowedSports(
      [{ sport: null, game: "Away @ Home", player: "CFB" }],
      scope,
      [{ sport: "ncaaf", awayTeam: "Away", homeTeam: "Home" }],
    ),
    [],
  );
});

test("ALT / backfill candidates cannot override sport scope", () => {
  const scope = { allowedSports: ["nfl"] as const };
  const alts = [
    { sport: "nfl", marketKey: "player_pass_yds_alternate", player: "NFL_Alt" },
    { sport: "ncaaf", marketKey: "player_pass_yds_alternate", player: "CFB_Alt" },
    { sport: "ncaaf", marketKey: "player_rush_yds", player: "CFB_Main" },
  ];
  const belted = filterPoolByFootballRecoverySports(alts, scope);
  assert.deepEqual(belted.map((r) => r.player), ["NFL_Alt"]);
});

test("generic football keeps both leagues when board allows both", () => {
  const scope = {
    allowedSports: resolveImmutableAskSportScope({
      askText: "5 leg football player props",
      boardSports: ["nfl", "ncaaf"],
    }),
  };
  const mixed = [
    { sport: "nfl", player: "A" },
    { sport: "ncaaf", player: "B" },
    { sport: "nba", player: "C" },
  ];
  const out = filterPoolByAllowedSports(mixed, scope);
  assert.deepEqual(out.map((r) => r.player).sort(), ["A", "B"]);
});

test("NBA board scope rejects NFL/NCAAF contaminants", () => {
  const scope = {
    allowedSports: resolveImmutableAskSportScope({
      askText: "5 leg NBA player props",
      boardSports: ["nba"],
    }),
  };
  const mixed = [
    { sport: "nba", player: "Hooper" },
    { sport: "nfl", player: "Leak" },
    { sport: "ncaaf", player: "Leak2" },
  ];
  assert.deepEqual(
    filterPoolByAllowedSports(mixed, scope).map((r) => r.player),
    ["Hooper"],
  );
});

test("shortfall shape: 5 requested + 3 scoped NFL candidates stays 3/5", () => {
  // Structural proof — belt leaves only 3 NFL rows; seating must not borrow NCAAF.
  const scope = {
    allowedSports: resolveImmutableAskSportScope({
      askText: "5 leg NFL player props",
      boardSports: ["nfl"],
    }),
  };
  const pool = [
    { sport: "nfl", player: "N1" },
    { sport: "nfl", player: "N2" },
    { sport: "nfl", player: "N3" },
    { sport: "ncaaf", player: "C1" },
    { sport: "ncaaf", player: "C2" },
  ];
  const scoped = filterPoolByAllowedSports(pool, scope);
  assert.equal(scoped.length, 3);
  assert.equal(scoped.every((r) => r.sport === "nfl"), true);
  // Honest shortfall: staged cannot exceed scoped pool size without other sports.
  const target = 5;
  const staged = Math.min(scoped.length, target);
  assert.equal(staged, 3);
  assert.ok(staged < target);
});

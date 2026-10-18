/**
 * Stage 4 P0 — defenseIndexByFamily mapper unit tests.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  DEFAULT_DEFENSE_INDEX_SHRINK,
  buildDefenseIndexByFamily,
  defenseIndexFamilyForMarket,
  indexForMarket,
  shrinkRatioToOne,
} from "./defenseIndexFromPack.ts";
import type { FootballOppDefenseSlice } from "./footballRushDefense.ts";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "stage4");

function loadPack(name: string): {
  sport: string;
  teamId: string;
  pack: FootballOppDefenseSlice;
} {
  const j = JSON.parse(readFileSync(join(FIX, name), "utf8")) as {
    sport: string;
    teamId: string;
    pack: FootballOppDefenseSlice;
  };
  return j;
}

test("shrinkRatioToOne blends toward 1 with prior games", () => {
  assert.equal(shrinkRatioToOne(0.5, 0, 8), 1);
  const s = shrinkRatioToOne(0.5, 5, 8);
  assert.ok(s > 0.5 && s < 1);
  assert.ok(Math.abs(s - (5 * 0.5 + 8) / 13) < 1e-9);
});

test("JAX rush pack → rush_yds index shrunk then clamped (stingy D)", () => {
  const { pack, teamId } = loadPack("jax-jaguars-defense.json");
  assert.equal(pack.rush?.rushingYardsAllowedPerGame, 63.8);
  assert.equal(pack.rush?.sampleSize, 5);

  const built = buildDefenseIndexByFamily({
    sport: "nfl",
    opponentTeamId: teamId,
    oppPack: pack,
  });

  const rush = built.defenseIndexByFamily.rush_yds;
  assert.ok(rush != null, "rush_yds index present");
  // raw 63.8/112 ≈ 0.57 → shrink ≈ 0.834 → clamp to matchupMin 0.9
  assert.equal(rush, DEFAULT_DEFENSE_INDEX_SHRINK.matchupMin);
  const expl = built.explain.find((e) => e.family === "rush_yds");
  assert.ok(expl);
  assert.equal(expl!.sampleSize, 5);
  assert.ok(expl!.raw < 0.6);
  assert.ok(
    built.skipped.some((s) => s.family === "anytime_td" && s.reason === "family_excluded"),
  );
});

test("JAX pass pack → pass_yds index > 1 (leaky pass D)", () => {
  const { pack, teamId } = loadPack("jax-jaguars-defense.json");
  const built = buildDefenseIndexByFamily({
    sport: "nfl",
    opponentTeamId: teamId,
    oppPack: pack,
  });
  const pass = built.defenseIndexByFamily.pass_yds;
  assert.ok(pass != null && pass > 1 && pass <= DEFAULT_DEFENSE_INDEX_SHRINK.matchupMax);
  assert.ok(built.defenseIndexByFamily.rec_yds != null, "recv proxy from pass D");
});

test("HOU rush also clamps to floor (stingy but less extreme than JAX)", () => {
  const { pack, teamId } = loadPack("hou-texans-defense.json");
  const built = buildDefenseIndexByFamily({
    sport: "nfl",
    opponentTeamId: teamId,
    oppPack: pack,
  });
  assert.equal(built.defenseIndexByFamily.rush_yds, 0.9);
  assert.ok(
    (built.explain.find((e) => e.family === "rush_yds")?.raw ?? 0) >
      (buildDefenseIndexByFamily({
        sport: "nfl",
        opponentTeamId: "30",
        oppPack: loadPack("jax-jaguars-defense.json").pack,
      }).explain.find((e) => e.family === "rush_yds")?.raw ?? 1),
  );
});

test("thin sample / missing pack fail closed", () => {
  const thin = buildDefenseIndexByFamily({
    sport: "nfl",
    opponentTeamId: "30",
    oppPack: {
      rush: {
        rushingYardsAllowedPerGame: 60,
        yardsPerRushAllowed: 3,
        sampleSize: 1,
      },
    },
  });
  assert.equal(thin.defenseIndexByFamily.rush_yds, undefined);
  assert.ok(thin.skipped.some((s) => s.reason === "thin_sample"));

  const missing = buildDefenseIndexByFamily({
    sport: "nfl",
    opponentTeamId: "30",
    oppPack: null,
  });
  assert.deepEqual(missing.defenseIndexByFamily, {});
  assert.ok(missing.skipped.some((s) => s.reason === "ambiguous_pack"));
});

test("stale pack skipped when maxAgeMs set", () => {
  const { pack, teamId } = loadPack("jax-jaguars-defense.json");
  const built = buildDefenseIndexByFamily({
    sport: "nfl",
    opponentTeamId: teamId,
    oppPack: pack,
    fetchedAtMs: Date.now() - 10_000,
    maxAgeMs: 1_000,
  });
  assert.deepEqual(built.defenseIndexByFamily, {});
  assert.ok(built.skipped.some((s) => s.reason === "stale_or_unverified"));
});

test("configurable shrink/clamp for tests (not prod approval)", () => {
  const { pack, teamId } = loadPack("jax-jaguars-defense.json");
  const built = buildDefenseIndexByFamily({
    sport: "nfl",
    opponentTeamId: teamId,
    oppPack: pack,
    config: { matchupMin: 0.7, matchupMax: 1.3, shrinkPriorGames: 0 },
  });
  const rush = built.defenseIndexByFamily.rush_yds!;
  assert.ok(rush < 0.9, `test-config allows below prod floor: ${rush}`);
  assert.ok(rush > 0.5);
});

test("multi-sport coverage: NBA/WNBA/NCAAB/NHL/MLB/soccer/NCAAF emit families", () => {
  const multi = JSON.parse(
    readFileSync(join(FIX, "multi-sport-defense-packs.json"), "utf8"),
  ) as Record<string, FootballOppDefenseSlice>;

  const nba = buildDefenseIndexByFamily({
    sport: "nba",
    opponentTeamId: "nba1",
    oppPack: multi.nba,
  });
  assert.ok(nba.defenseIndexByFamily.points != null);
  assert.ok(nba.defenseIndexByFamily.assists != null);

  const nhl = buildDefenseIndexByFamily({
    sport: "nhl",
    opponentTeamId: "nhl1",
    oppPack: multi.nhl,
  });
  assert.ok(nhl.defenseIndexByFamily.goals != null);

  const mlb = buildDefenseIndexByFamily({
    sport: "mlb",
    opponentTeamId: "mlb1",
    oppPack: multi.mlb,
  });
  assert.ok(mlb.defenseIndexByFamily.hits != null);
  assert.ok(mlb.defenseIndexByFamily.strikeouts != null);

  const soccer = buildDefenseIndexByFamily({
    sport: "soccer",
    opponentTeamId: "soc1",
    oppPack: multi.soccer,
  });
  assert.ok(soccer.defenseIndexByFamily.goals != null);

  const ncaaf = buildDefenseIndexByFamily({
    sport: "ncaaf",
    opponentTeamId: "cfb1",
    oppPack: multi.ncaaf,
  });
  assert.ok(ncaaf.defenseIndexByFamily.rush_yds != null);

  const unsupported = buildDefenseIndexByFamily({
    sport: "tennis",
    opponentTeamId: "1",
    oppPack: multi.nba,
  });
  assert.ok(unsupported.skipped.some((s) => s.reason === "unsupported_sport"));
});

test("market family map preserves identity keys", () => {
  assert.equal(defenseIndexFamilyForMarket("player_rush_yds"), "rush_yds");
  assert.equal(defenseIndexFamilyForMarket("player_anytime_td"), null);
  const by = { rush_yds: 0.9 } as const;
  assert.equal(indexForMarket(by, "player_rush_yds"), 0.9);
  assert.equal(indexForMarket(by, "player_anytime_td"), null);
});

test("playerPosition ignored — no invented positional splits", () => {
  const { pack, teamId } = loadPack("jax-jaguars-defense.json");
  const a = buildDefenseIndexByFamily({
    sport: "nfl",
    opponentTeamId: teamId,
    oppPack: pack,
    playerPosition: "RB",
  });
  const b = buildDefenseIndexByFamily({
    sport: "nfl",
    opponentTeamId: teamId,
    oppPack: pack,
    playerPosition: "QB",
  });
  assert.deepEqual(a.defenseIndexByFamily, b.defenseIndexByFamily);
});

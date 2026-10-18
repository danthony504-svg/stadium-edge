/**
 * Stage 4 P0 — api-server twin of defenseIndexByFamily mapper.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_DEFENSE_INDEX_SHRINK,
  buildDefenseIndexByFamily,
} from "../src/lib/defenseIndexFromPack.js";

test("api-server twin: JAX-like stingy rush clamps to matchupMin", () => {
  const built = buildDefenseIndexByFamily({
    sport: "nfl",
    opponentTeamId: "30",
    oppPack: {
      teamName: "Jacksonville Jaguars",
      gamesPlayed: 5,
      rush: {
        rushingYardsAllowedPerGame: 63.8,
        yardsPerRushAllowed: 2.93,
        sampleSize: 5,
      },
      pass: {
        passingYardsAllowedPerGame: 266.2,
        yardsPerPassAllowed: null,
        sampleSize: 5,
      },
      sacksAllowed: 10,
    },
  });
  assert.equal(
    built.defenseIndexByFamily.rush_yds,
    DEFAULT_DEFENSE_INDEX_SHRINK.matchupMin,
  );
  assert.ok(
    built.defenseIndexByFamily.pass_yds != null &&
      built.defenseIndexByFamily.pass_yds > 1,
  );
  assert.ok(
    built.skipped.some(
      (s) => s.family === "anytime_td" && s.reason === "family_excluded",
    ),
  );
});

test("api-server twin: thin / missing fail closed", () => {
  const thin = buildDefenseIndexByFamily({
    sport: "nfl",
    opponentTeamId: "1",
    oppPack: {
      rush: {
        rushingYardsAllowedPerGame: 50,
        yardsPerRushAllowed: 3,
        sampleSize: 1,
      },
    },
  });
  assert.equal(thin.defenseIndexByFamily.rush_yds, undefined);

  const empty = buildDefenseIndexByFamily({
    sport: "nba",
    opponentTeamId: "2",
    oppPack: null,
  });
  assert.deepEqual(empty.defenseIndexByFamily, {});
});

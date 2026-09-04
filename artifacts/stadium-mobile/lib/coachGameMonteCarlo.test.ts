import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGameTeamIdMap,
  resolveTeamIds,
  resolveTeamIdsWithReason,
  slateGameSimulationIdentity,
} from "./coachGameMonteCarlo.ts";

test("resolves an unambiguous posted-event abbreviation to ESPN team IDs", () => {
  const ids = buildGameTeamIdMap([{
    sport: "nfl",
    homeTeam: "Buffalo Bills",
    homeAbbr: "BUF",
    homeTeamId: "1",
    awayTeam: "Kansas City Chiefs",
    awayAbbr: "KC",
    awayTeamId: "2",
  }] as never);

  assert.deepEqual(resolveTeamIds("KC @ Buffalo Bills", "nfl", ids), {
    sport: "nfl",
    homeTeam: "Buffalo Bills",
    homeTeamId: "1",
    awayTeam: "Kansas City Chiefs",
    awayTeamId: "2",
    homeAliases: ["buffalo bills", "buf", "bills"],
    awayAliases: ["kansas city chiefs", "kc", "chiefs"],
  });
});

test("does not invent IDs for an unknown posted event", () => {
  const ids = buildGameTeamIdMap([
    { sport: "ncaaf", homeTeam: "Tigers", homeTeamId: "1", awayTeam: "Eagles", awayTeamId: "2" },
    { sport: "ncaaf", homeTeam: "Tigers", homeTeamId: "3", awayTeam: "Bears", awayTeamId: "4" },
  ] as never);

  assert.equal(resolveTeamIds("Unknown @ Tigers", "ncaaf", ids), null);
  assert.equal(
    resolveTeamIdsWithReason("Unknown @ Tigers", "ncaaf", ids).reason,
    "no_matching_event",
  );
});

test("uses the supported name-only simulation route for tennis and UFC only", () => {
  const unresolved = { ids: null, reason: "no_matching_event" } as const;
  assert.deepEqual(
    slateGameSimulationIdentity("Fighter A @ Fighter B", "ufc", unresolved),
    {
      sport: "ufc",
      homeTeamId: "",
      awayTeamId: "",
      homeTeam: "Fighter B",
      awayTeam: "Fighter A",
    },
  );
  assert.equal(
    slateGameSimulationIdentity("Club A @ Club B", "soccer", unresolved),
    null,
  );
});

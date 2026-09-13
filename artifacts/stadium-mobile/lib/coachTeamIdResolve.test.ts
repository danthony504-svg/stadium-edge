import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCoachGameTeamIdMap,
  resolveCoachGameTeamIds,
} from "./coachTeamIdResolve.ts";
import {
  deriveCoachScanFailureReason,
  formatCoachScanFailureTrace,
} from "./coachScanFailureReason.ts";

test("NCAAF odds label resolves ESPN full nicknames for game sims", () => {
  const map = buildCoachGameTeamIdMap([
    {
      sport: "ncaaf",
      homeTeam: "Michigan Wolverines",
      awayTeam: "Ohio State Buckeyes",
      homeTeamId: "130",
      awayTeamId: "194",
    },
  ]);
  // Nickname-only keys fail here ("buckeyes|wolverines" vs "state|michigan").
  assert.equal(map.get("state|michigan"), undefined);
  const ids = resolveCoachGameTeamIds("Ohio State @ Michigan", "ncaaf", map);
  assert.ok(ids, "fuzzy resolve must bind Odds label to ESPN ids");
  assert.equal(ids!.homeTeamId, "130");
  assert.equal(ids!.awayTeamId, "194");
});

test("soccer accents / hyphens resolve Odds labels to ESPN ids", () => {
  const map = buildCoachGameTeamIdMap([
    {
      sport: "soccer",
      homeTeam: "Atlético Madrid",
      awayTeam: "Paris Saint-Germain",
      homeTeamId: "1068",
      awayTeamId: "160",
    },
  ]);
  const ids = resolveCoachGameTeamIds(
    "Paris Saint Germain @ Atletico Madrid",
    "soccer",
    map,
  );
  assert.ok(ids, "accent + hyphen soccer labels must resolve");
  assert.equal(ids!.homeTeamId, "1068");
  assert.equal(ids!.awayTeamId, "160");
});

test("soccer home/away flip still binds team ids (TEAM_IDS_UNRESOLVED screenshot)", () => {
  const map = buildCoachGameTeamIdMap([
    {
      sport: "soccer",
      homeTeam: "Brazil",
      awayTeam: "Mexico",
      homeTeamId: "205",
      awayTeamId: "239",
    },
  ]);
  // Odds lists the fixture with opposite venue sides from ESPN.
  const ids = resolveCoachGameTeamIds("Brazil @ Mexico", "soccer", map);
  assert.ok(ids, "venue-flipped soccer labels must resolve");
  assert.equal(ids!.homeTeamId, "239"); // Mexico (odds home)
  assert.equal(ids!.awayTeamId, "205"); // Brazil (odds away)
  assert.equal(ids!.homeTeam, "Mexico");
  assert.equal(ids!.awayTeam, "Brazil");
});

test("soccer Inter Miami CF strips club suffix against ESPN Inter Miami", () => {
  const map = buildCoachGameTeamIdMap([
    {
      sport: "soccer",
      homeTeam: "LA Galaxy",
      awayTeam: "Inter Miami",
      homeTeamId: "191",
      awayTeamId: "20232",
    },
  ]);
  const ids = resolveCoachGameTeamIds("Inter Miami CF @ LA Galaxy", "soccer", map);
  assert.ok(ids);
  assert.equal(ids!.awayTeamId, "20232");
  assert.equal(ids!.homeTeamId, "191");
});

test("empty diagnostics produce TEAM_IDS_UNRESOLVED trace for phone triage", () => {
  const reason = deriveCoachScanFailureReason({
    stagedPickCount: 0,
    oddsGameCount: 10,
    teamIdMapSize: 30,
    gameEntryCount: 10,
    gameSimsLoaded: 0,
    gameLegsScored: 0,
    propPoolSize: 120,
  });
  assert.equal(reason?.code, "TEAM_IDS_UNRESOLVED");
  assert.match(formatCoachScanFailureTrace(reason!), /0 game sims bound/);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCoachGameTeamIdMap,
  resolveCoachGameTeamIds,
  bindOddsLabelsToTeamIdMap,
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

test("NFL home/away flip binds prop game labels the same as game sims", () => {
  const map = buildCoachGameTeamIdMap([
    {
      sport: "nfl",
      homeTeam: "San Francisco 49ers",
      awayTeam: "Arizona Cardinals",
      homeTeamId: "25",
      awayTeamId: "22",
    },
  ]);
  // Odds sometimes lists Home @ Away while ESPN stores Away @ Home.
  const ids = resolveCoachGameTeamIds(
    "San Francisco 49ers @ Arizona Cardinals",
    "nfl",
    map,
  );
  assert.ok(ids, "venue-flipped NFL labels must resolve for prop sims");
  assert.equal(ids!.homeTeamId, "22");
  assert.equal(ids!.awayTeamId, "25");
});

test("NFL nickname Odds label resolves ESPN full names", () => {
  const map = buildCoachGameTeamIdMap([
    {
      sport: "nfl",
      homeTeam: "San Francisco 49ers",
      awayTeam: "Arizona Cardinals",
      homeTeamId: "25",
      awayTeamId: "22",
    },
  ]);
  const ids = resolveCoachGameTeamIds("Cardinals @ 49ers", "nfl", map);
  assert.ok(ids);
  assert.equal(ids!.homeTeamId, "25");
  assert.equal(ids!.awayTeamId, "22");
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

test("empty diagnostics without unresolved counters are not TEAM_IDS_UNRESOLVED", () => {
  // Rebuild: healthy map + 0 sims without bind counters → fetch empty, not labels.
  const reason = deriveCoachScanFailureReason({
    stagedPickCount: 0,
    oddsGameCount: 10,
    teamIdMapSize: 30,
    gameEntryCount: 10,
    gameSimsLoaded: 0,
    gameLegsScored: 0,
    propPoolSize: 0,
  });
  assert.equal(reason?.code, "GAME_SIMS_FETCH_EMPTY");
  assert.doesNotMatch(formatCoachScanFailureTrace(reason!), /TEAM_IDS_UNRESOLVED/);
});

test("NFL abbr + bindOddsLabels covers Odds labels before slate sims", () => {
  const map = buildCoachGameTeamIdMap([
    {
      sport: "nfl",
      homeTeam: "San Francisco 49ers",
      awayTeam: "Arizona Cardinals",
      homeAbbr: "SF",
      awayAbbr: "ARI",
      homeTeamId: "25",
      awayTeamId: "22",
    },
  ]);
  assert.ok(map.get("ari @ sf"));
  const { bound, unresolved } = bindOddsLabelsToTeamIdMap(map, [
    { awayTeam: "Arizona Cardinals", homeTeam: "San Francisco 49ers", sport: "nfl" },
    { awayTeam: "Cardinals", homeTeam: "49ers", sport: "nfl" },
  ]);
  assert.equal(bound, 2);
  assert.equal(unresolved.length, 0);
  assert.ok(map.get("arizona cardinals @ san francisco 49ers"));
  assert.ok(map.get("cardinals @ 49ers"));
});

test("NFL LA Rams / Chargers Odds abbrs bind to ESPN full names", () => {
  const map = buildCoachGameTeamIdMap([
    {
      sport: "nfl",
      homeTeam: "Los Angeles Rams",
      awayTeam: "Los Angeles Chargers",
      homeAbbr: "LAR",
      awayAbbr: "LAC",
      homeTeamId: "14",
      awayTeamId: "24",
    },
  ]);
  const ids = resolveCoachGameTeamIds("LA Chargers @ LA Rams", "nfl", map);
  assert.ok(ids, "LA Chargers @ LA Rams must bind");
  assert.equal(ids!.homeTeamId, "14");
  assert.equal(ids!.awayTeamId, "24");
  const { bound, unresolved } = bindOddsLabelsToTeamIdMap(map, [
    { awayTeam: "LA Chargers", homeTeam: "LA Rams", sport: "nfl" },
  ]);
  assert.equal(bound, 1);
  assert.equal(unresolved.length, 0);
});

test("phone 10-leg NFL empty is not TEAM_IDS_UNRESOLVED under requirePropMix", () => {
  // Screenshot after #529: props-first starved game sims → fake TEAM_IDS_UNRESOLVED.
  const reason = deriveCoachScanFailureReason({
    stagedPickCount: 0,
    oddsGameCount: 15,
    teamIdMapSize: 60,
    gameEntryCount: 15,
    gameSimsLoaded: 0,
    gameLegsScored: 0,
    propPoolSize: 200,
    propLegsScored: 0,
    propPhaseIncomplete: true,
    requirePropMix: true,
  });
  assert.equal(reason?.code, "PROP_PHASE_INCOMPLETE");
  assert.doesNotMatch(formatCoachScanFailureTrace(reason!), /TEAM_IDS_UNRESOLVED/);
});

test("requirePropMix with empty prop pool is PROP_POOL_EMPTY not TEAM_IDS", () => {
  const reason = deriveCoachScanFailureReason({
    stagedPickCount: 0,
    oddsGameCount: 15,
    teamIdMapSize: 60,
    gameEntryCount: 15,
    gameSimsLoaded: 0,
    gameLegsScored: 0,
    propPoolSize: 0,
    propLegsScored: 0,
    requirePropMix: true,
  });
  assert.equal(reason?.code, "PROP_POOL_EMPTY");
  assert.doesNotMatch(formatCoachScanFailureTrace(reason!), /labels did not resolve/);
});

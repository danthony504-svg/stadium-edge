import assert from "node:assert/strict";
import { test } from "node:test";
import { propHasConfirmedAbsence } from "../src/lib/propAvailability.ts";
import { runPropSims, type OpportunityShiftBuildInputs } from "../src/lib/propSimRunner.ts";
import type { SimPropRequest } from "../src/lib/monteCarloBuild.ts";
import { deriveChannelUsageFromHistory } from "../src/lib/opportunityShift/channelUsageFromHistory.ts";
import { loadAuthoritativePlayerHistory, clearAuthoritativePlayerHistoryForTests, peekAuthoritativePlayerHistory, AUTHORITATIVE_PLAYER_HISTORY_TTL_MS } from "../src/lib/authoritativePlayerHistory.ts";
import { resolvePropAthleteIdsDetailed } from "../src/lib/resolvePropAthleteIds.ts";

const prop = { sport: "nfl", athleteId: "fast-context-out", player: "Test Player", isHome: true, market: "rush_yds", line: 60.5, side: "Over" } as SimPropRequest;
const inputs: OpportunityShiftBuildInputs = {
  gameKey: "test", homeTeam: "Chicago Bears", awayTeam: "Green Bay Packers", players: [],
  injuries: [{ team: "Chicago Bears", entries: [{ athleteId: prop.athleteId, player: prop.player, status: "Out" }] }],
};

test("confirmed absence requires matching sport, team and athlete; uncertainty stays uncertain", () => {
  assert.equal(propHasConfirmedAbsence(prop, "nfl", inputs), true);
  assert.equal(propHasConfirmedAbsence({ ...prop, athleteId: "different" }, "nfl", inputs), false);
  assert.equal(propHasConfirmedAbsence({ ...prop, isHome: false }, "nfl", inputs), false);
  assert.equal(propHasConfirmedAbsence({ ...prop, isHome: null }, "nfl", inputs), false);
  assert.equal(propHasConfirmedAbsence(prop, "nba", inputs), false);
  for (const status of ["Questionable", "Doubtful", "Active"]) {
    const injuries = [{ team: "Chicago Bears", entries: [{ athleteId: prop.athleteId, player: prop.player, status }] }];
    assert.equal(propHasConfirmedAbsence(prop, "nfl", { ...inputs, injuries }), false);
  }
});

test("out players bypass histories and simulation: neither Over nor Under gets a probability", async () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("must not fetch"); };
  try {
    for (let i = 0; i < 2; i++) {
      const result = await runPropSims([{ ...prop, side: "Over" }, { ...prop, side: "Under" }], "fast", {
        sport: "nfl", oppPace: null, leaguePace: null, oppKeyInjuries: 0, ownKeyInjuries: 0,
        weatherImpact: null, opportunityShiftInputs: inputs,
      }, {});
      assert.equal(result.rows.length, 2);
      assert.equal(result.rows[0]!.nullReason, "confirmed_unavailable");
      assert.equal(result.rows[0]!.simulations, 0);
      assert.equal(result.rows[0]!.hitProbability, null);
      assert.equal(result.rows[1]!.hitProbability, null);
      assert.equal(result.rows[1]!.nullReason, "confirmed_unavailable");
    }
    assert.equal(requests, 0);
  } finally { globalThis.fetch = original; }
});

test("workload uses measured opportunities, not outcomes or invented opportunity proxies", () => {
  const derive = (stats: Record<string, string>) => deriveChannelUsageFromHistory({ labels: Object.keys(stats), recent: Array.from({ length: 5 }, () => ({ stats, isHome: true })), vsOpponent: [] }).channelUsage;
  const usage = derive({ TGT: "8", REB: "10", AST: "5", AB: "4", RBI: "2", rushingAttempts: "15", MIN: "30:30", TOI: "18:15" });
  assert.equal(usage.routes, undefined);
  assert.equal(usage.reb_opps, undefined);
  assert.equal(usage.ast_opps, undefined);
  assert.equal(usage.pa, undefined);
  assert.equal(usage.rz_carries, undefined);
  assert.equal(usage.gl_carries, undefined);
  assert.equal(usage.designed_runs, undefined);
  assert.equal(usage.carries, 15);
  assert.equal(usage.minutes, 30.5);
  assert.equal(usage.toi, 18.25);
  const measured = derive({ reboundChances: "17", potentialAssists: "9", routesRun: "25", PA: "4", redZoneRushingAttempts: "0" });
  assert.equal(measured.reb_opps, 17);
  assert.equal(measured.ast_opps, 9);
  assert.equal(measured.routes, 25);
  assert.equal(measured.pa, 4);
  assert.equal(measured.rz_carries, 0);
});

test("reading shared history does not reset its original observation time or TTL", async () => {
  const originalFetch = globalThis.fetch, originalNow = Date.now;
  let clock = originalNow(), requests = 0;
  Date.now = () => clock;
  globalThis.fetch = async () => {
    requests++;
    return Response.json({ labels: ["H"], events: { e: { gameDate: "2026-10-01", atVs: "vs" } }, seasonTypes: [{ categories: [{ events: [{ eventId: "e", stats: ["2"] }] }] }] });
  };
  try {
    const first = await loadAuthoritativePlayerHistory("mlb", "context-freshness-unique");
    assert.ok(first.history);
    clock += AUTHORITATIVE_PLAYER_HISTORY_TTL_MS - 1000;
    clearAuthoritativePlayerHistoryForTests();
    const second = await loadAuthoritativePlayerHistory("mlb", "context-freshness-unique");
    assert.equal(second.history?.loadedAtMs, first.history.loadedAtMs);
    assert.equal(requests, 1);
    clock += 1001;
    assert.equal(peekAuthoritativePlayerHistory("mlb", "context-freshness-unique"), undefined);
    const third = await loadAuthoritativePlayerHistory("mlb", "context-freshness-unique");
    assert.equal(requests, 2);
    assert.equal(third.history?.loadedAtMs, clock);
  } finally { globalThis.fetch = originalFetch; Date.now = originalNow; clearAuthoritativePlayerHistoryForTests(); }
});

test("roster position reaches simulations using the existing roster requests, without inventing starts", async () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async input => {
    requests++;
    assert.match(String(input), /\/roster$/);
    return Response.json({ athletes: String(input).includes("/teams/context-home/")
      ? [{ id: "context-running-back", displayName: "Test Runner", position: { abbreviation: "RB" } }]
      : [] });
  };
  try {
    const request = { ...prop, athleteId: "context-running-back", player: "Test Runner", position: "QB", homeTeamId: "context-home", awayTeamId: "context-away" };
    const first = await resolvePropAthleteIdsDetailed("nfl", [request], { homeTeamId: "context-home", awayTeamId: "context-away" });
    assert.equal(first.props[0]?.position, "RB");
    assert.equal(first.props[0]?.isHome, true);
    assert.equal("isStarter" in first.props[0]!, false);
    assert.equal(requests, 2, "one roster per team, with no extra role/lineup request");
    await resolvePropAthleteIdsDetailed("nfl", [request], { homeTeamId: "context-home", awayTeamId: "context-away" });
    assert.equal(requests, 2, "subsequent role reads reuse the existing roster cache");
  } finally { globalThis.fetch = original; }
});

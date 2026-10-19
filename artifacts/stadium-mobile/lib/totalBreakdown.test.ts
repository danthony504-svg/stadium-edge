import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { resolveBreakdownTeam, totalBreakdown, totalHistoryRows, totalHistoryCounts, totalSelection } from "./totalBreakdown";

const game = "Atlanta Dream @ Golden State Valkyries";
test("old Coach links recover both WNBA identities from matchup", () => {
  const b = totalBreakdown({ team: "Atlanta Dream", opp: "Golden State Valkyries", game, market: "Alt Total", pick: "Over 155" });
  assert.equal(b.away, "Atlanta Dream");
  assert.equal(b.home, "Golden State Valkyries");
  assert.equal(b.teamTotal, false);
  assert.equal(b.line, 155);
  assert.equal(b.scoreHistorySupported, true);
});
for (const [pick, team, line] of [["Dream Over 72.5", "Atlanta Dream", 72.5], ["Valkyries Over 74.5", "Golden State Valkyries", 74.5]] as const) {
  test(`${pick} measures only ${team}`, () => {
    const b = totalBreakdown({ game, market: "Team Total", pick });
    assert.equal(b.teamTotal, true);
    assert.equal(b.selectedTeam, team);
    assert.equal(b.line, line);
    assert.deepEqual(totalHistoryRows([{ pts: 75, oppPts: 80 }], b.teamTotal).map(g => g.total), [75]);
  });
}
test("team identity fails closed for missing, ambiguous and wrong-sport matches", () => {
  const rows = [{ name: "Los Angeles Lakers", sport: "nba" }, { name: "Los Angeles Clippers", sport: "nba" }];
  assert.equal(resolveBreakdownTeam(rows, "Los Angeles", "nba"), null);
  assert.equal(resolveBreakdownTeam(rows, "Dream", "nba"), null);
  assert.equal(resolveBreakdownTeam(rows, "Lakers", "wnba"), null);
  assert.equal(resolveBreakdownTeam(rows, "Lakers", "nba"), rows[0]);
  assert.equal(totalBreakdown({ game, market: "Team Total", pick: "Over 72.5" }).selectedTeam, null);
  assert.equal(totalBreakdown({ game: "New York Knicks @ New York Liberty", market: "Team Total", pick: "New York Under 80" }).selectedTeam, null);
});
test("numbers in team names cannot become total lines", () => {
  assert.deepEqual(totalSelection("76ers Under 112.5"), { side: "Under", line: 112.5 });
  assert.equal(resolveBreakdownTeam([{ name: "Philadelphia 76ers", sport: "nba" }], "76ers", "nba")?.name, "Philadelphia 76ers");
  assert.equal(totalSelection("Over TBD"), null);
});
test("Under, Over and pushes use the exact scoring unit", () => {
  const rows = [{ pts: 70, oppPts: 90 }, { pts: 72.5, oppPts: 80 }, { pts: 75, oppPts: 80 }, { pts: null, oppPts: 1 }, { pts: NaN, oppPts: 80 }];
  const team = totalHistoryRows(rows, true);
  assert.deepEqual(totalHistoryCounts(team, 72.5, "Under"), { hits: 1, pushes: 1 });
  assert.deepEqual(totalHistoryCounts(team, 72.5, "Over"), { hits: 1, pushes: 1 });
  assert.deepEqual(totalHistoryCounts(totalHistoryRows(rows, false), 155, "Over"), { hits: 1, pushes: 1 });
  assert.deepEqual(totalHistoryRows([{ pts: 0, oppPts: null }], true).map(g => g.total), [0]);
  assert.deepEqual(totalHistoryRows([{ pts: 0, oppPts: Infinity }], false), []);
});
test("legacy fallback, finite lines and period/specialty history stay honest", () => {
  const b = totalBreakdown({ team: "Away", opp: "Home", line: "Infinity" });
  assert.equal(b.away, "Away");
  assert.equal(b.home, "Home");
  assert.equal(b.line, null);
  for (const market of ["Team Totals H1", "totals_q2", "First 5 Total", "Total Corners", "Total Sets"]) {
    assert.equal(totalBreakdown({ market }).scoreHistorySupported, false, market);
  }
  assert.equal(totalBreakdown({ game, market: "alternate_team_totals", pick: "Dream Over 72.5" }).selectedTeam, "Atlanta Dream");
});
test("Coach passes the names consumed by the total screen", () => {
  const coach = readFileSync(new URL("../app/(tabs)/coach.tsx", import.meta.url), "utf8");
  assert.match(coach, /away: total\.away/);
  assert.match(coach, /home: total\.home/);
  assert.match(coach, /totalSide: total\.side/);
  const screen = readFileSync(new URL("../app/team-pick/[id].tsx", import.meta.url), "utf8");
  assert.doesNotMatch(screen, /sportHits\[0\]|!isFight \|\| fightHasStats|No injuries reported for either side/);
});

test("the same total semantics apply across outdoor and indoor team sports", () => {
  for (const [away, home, pick] of [
    ["Cleveland Guardians", "Tampa Bay Rays", "Guardians Under 4.5"],
    ["San Francisco 49ers", "Seattle Seahawks", "49ers Over 21.5"],
    ["Boston Bruins", "New York Rangers", "Bruins Under 3.5"],
    ["Arsenal", "Chelsea", "Arsenal Over 1.5"],
  ]) {
    const b = totalBreakdown({ game: `${away} @ ${home}`, market: "Team Total", pick });
    assert.equal(b.selectedTeam, away);
    assert.equal(b.scoreHistorySupported, true);
    assert.equal(b.teamTotal, true);
  }
});

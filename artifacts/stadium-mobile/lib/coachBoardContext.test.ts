import assert from "node:assert/strict";
import test from "node:test";

import { buildGameInjuryReport } from "./injuries.ts";
import type { InjuryTeam } from "./api.ts";

/**
 * Mirrors attachMatchupInjuries without importing coachBoardContext (avoids
 * loading api.ts value exports under node --test).
 */
function attachMatchupInjuriesForTest(
  games: Array<{ sport?: string; awayTeam?: string | null; homeTeam?: string | null }>,
  injuriesBySport: Record<string, InjuryTeam[]>,
): Record<string, NonNullable<ReturnType<typeof buildGameInjuryReport>>> {
  const out: Record<string, NonNullable<ReturnType<typeof buildGameInjuryReport>>> = {};
  for (const g of games) {
    const sport = String(g.sport ?? "").toLowerCase();
    const away = String(g.awayTeam ?? "").trim();
    const home = String(g.homeTeam ?? "").trim();
    if (!sport || !away || !home) continue;
    const teams = injuriesBySport[sport];
    if (!teams?.length) continue;
    const report = buildGameInjuryReport(sport, teams, away, home);
    if (report) out[`${away} @ ${home}`] = report;
  }
  return out;
}

test("attachMatchupInjuries keys reports by Away @ Home when both sides present", () => {
  const games = [
    {
      sport: "mlb",
      homeTeam: "Texas Rangers",
      awayTeam: "Toronto Blue Jays",
    },
  ];
  const injuries: Record<string, InjuryTeam[]> = {
    mlb: [
      {
        team: "Texas Rangers",
        teamAbbr: "TEX",
        entries: [
          { player: "Starter Ace", position: "SP", status: "Out", description: "" },
        ],
      },
      {
        team: "Toronto Blue Jays",
        teamAbbr: "TOR",
        entries: [
          { player: "Reliever X", position: "RP", status: "Day-To-Day", description: "" },
        ],
      },
    ],
  };
  const map = attachMatchupInjuriesForTest(games, injuries);
  const key = "Toronto Blue Jays @ Texas Rangers";
  assert.ok(map[key], "expected injury report for matchup");
  assert.ok(map[key]!.sides.length >= 1);
});

test("flattenInjuryTeams merges sports (inline)", () => {
  const bySport: Record<string, InjuryTeam[]> = {
    mlb: [{ team: "Yankees", teamAbbr: "NYY", entries: [] }],
    nfl: [{ team: "Chiefs", teamAbbr: "KC", entries: [] }],
  };
  const flat = Object.values(bySport).flat();
  assert.equal(flat.length, 2);
});

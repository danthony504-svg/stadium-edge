import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildPlayerScoutingReport,
  buildTeamScoutingReport,
  serializeScoutingReportForAI,
} from "./scoutingReport.ts";

test("buildPlayerScoutingReport: recent windows and home/away from game logs", () => {
  const report = buildPlayerScoutingReport(
    {
      athleteId: "1",
      name: "Test Player",
      sport: "nba",
      league: "nba",
      team: "Lakers",
      headshot: null,
      isActive: true,
    },
    {
      sport: "nba",
      athleteId: "1",
      labels: [],
      recent: [
        { eventId: "a", date: "2026-01-01", opponentName: "BOS", isHome: true, stats: { PTS: "20" } },
        { eventId: "b", date: "2026-01-02", opponentName: "NYK", isHome: false, stats: { PTS: "30" } },
        { eventId: "c", date: "2026-01-03", opponentName: "MIA", isHome: true, stats: { PTS: "25" } },
      ],
      vsOpponent: [],
      vsOpponentName: null,
      season: "2026",
      availableSeasons: ["2026"],
      seasonSummary: { games: 10, averages: { PTS: 24.5 }, totals: {} },
    },
    { injuryStatus: "Questionable — ankle" },
  );

  assert.equal(report.kind, "player");
  assert.equal(report.title, "Test Player");
  assert.match(serializeScoutingReportForAI(report), /SCOUTING REPORT/);
  const seasonSec = report.sections.find((s) => s.title === "Season & form");
  const last5 = seasonSec?.fields.find((f) => f.label === "Last 5 games")?.value;
  assert.ok(last5?.includes("25.00 avg"));
  const splits = report.sections.find((s) => s.title === "Splits");
  const ha = splits?.fields.find((f) => f.label === "Home vs away")?.value;
  assert.ok(ha?.includes("Home 22.50"));
  assert.ok(ha?.includes("Away 30.00"));
});

test("buildPlayerScoutingReport: betting snapshot from best prop edge", () => {
  const report = buildPlayerScoutingReport(
    {
      athleteId: "2",
      name: "Slugger",
      sport: "mlb",
      league: "mlb",
      team: "Dodgers",
      headshot: null,
      isActive: true,
    },
    {
      sport: "mlb",
      athleteId: "2",
      labels: [],
      recent: [],
      vsOpponent: [],
      vsOpponentName: null,
      season: null,
      availableSeasons: [],
      seasonSummary: { games: 0, averages: {}, totals: {} },
    },
    {
      props: [
        {
          sport: "mlb",
          game: "A @ B",
          startsAt: "2026-06-28T00:00:00Z",
          player: "Slugger",
          market: "batter_home_runs",
          line: 0.5,
          over: 450,
          under: -650,
          alt: false,
          edge: 4.2,
          fairProb: 0.22,
        },
      ],
      probables: {
        pitcher: {
          name: "Ace Pitcher",
          athleteId: "9",
          throws: "Right",
          tendency: {
            era: 3.2,
            whip: 1.1,
            ip: 80,
            kPer9: 9,
            hrAllowed: 10,
            hrPer9: 1.1,
            flyBallPct: 38,
            groundFlyRatio: 1.2,
            oppOPS: 0.7,
            barrelPctAllowed: 6,
            hardHitPctAllowed: 35,
            battedBallEvents: 100,
          },
        },
        gameEnv: {
          homeAbbr: "LAD",
          venue: "Dodger Stadium",
          park: { hrIndex: 98, altitudeFt: 500, dome: false },
          weather: { tempF: 72, condition: "Clear", windMph: 8, humidity: 40 },
        },
      },
    },
  );

  assert.equal(report.priceVerdict, "underpriced");
  assert.ok(report.bestProp?.includes("batter_home_runs"));
  assert.ok(report.marketExpectation?.includes("%"));
  assert.ok(report.modelExpectation?.includes("22"));
});

test("buildTeamScoutingReport: record, splits, and odds enrichment", () => {
  const report = buildTeamScoutingReport(
    {
      teamId: "99",
      name: "Lakers",
      location: "Los Angeles",
      abbrev: "LAL",
      sport: "nba",
      league: "nba",
      logo: null,
    },
    {
      sport: "nba",
      teamId: "99",
      teamName: "Los Angeles Lakers",
      season: "2026",
      last10: { games: 10, wins: 7, losses: 3, ptsFor: 112, ptsAgainst: 108, avgMargin: 4 },
      last5: { games: 5, wins: 4, losses: 1, ptsFor: 115, ptsAgainst: 107, avgMargin: 8 },
      homeSplit: { games: 20, wins: 12, losses: 8, ptsFor: null, ptsAgainst: null, avgMargin: null },
      awaySplit: { games: 20, wins: 10, losses: 10, ptsFor: null, ptsAgainst: null, avgMargin: null },
      streak: { type: "W", count: 3 },
      record: { games: 40, wins: 22, losses: 18, winPct: 0.55 },
      recent: [],
      lastGameDate: null,
    },
    { injuries: "Star (Out)", bookOdds: -140, fairOdds: -125, winProb: 0.65 },
  );

  assert.equal(report.kind, "team");
  const rec = report.sections.find((s) => s.title === "Record & momentum");
  const homeAway = rec?.fields.find((f) => f.label === "Home / away")?.value;
  assert.ok(homeAway?.includes("12-8"));
  assert.equal(report.priceVerdict, "underpriced");
});

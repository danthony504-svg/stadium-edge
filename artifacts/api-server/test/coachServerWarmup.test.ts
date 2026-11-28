import assert from "node:assert/strict";
import { test } from "node:test";
import { opponentMarketAllowance } from "../src/lib/loadOpponentMarketAllowance.ts";
import { runPrebuildJobs } from "../src/lib/prebuildJobs.ts";

test("server cron warms reusable histories while app is absent, bounds concurrency and coalesces overlapping runs", async () => {
  const original = globalThis.fetch;
  let activeHistories = 0, peakHistories = 0;
  const histories: string[] = [], gameReads: string[] = [];
  const teams = ["test-nba-home", "test-nba-away"];
  const events = Array.from({ length: 3 }, (_, i) => ({
    id: `test-nba-final-${i}`, date: new Date(Date.now() - (i + 1) * 86400_000).toISOString(),
    competitions: [{ status: { type: { completed: true } },
      competitors: teams.map(id => ({ team: { id }, score: "111" })) }],
  }));
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/sports/games")) {
      const sport = url.searchParams.get("sport")!;
      gameReads.push(sport);
      if (sport === "nba") return Response.json([{
        id: "test-nba-upcoming", homeTeam: "New York Knicks", awayTeam: "Miami Heat",
        homeTeamId: teams[0], awayTeamId: teams[1],
        startsAt: new Date(Date.now() + 3600_000).toISOString(),
      }]);
      return Response.json(sport === "nfl" ? [{ id: "test-event", homeTeam: "Chicago Bears", awayTeam: "Green Bay Packers", startsAt: new Date(Date.now() + 3600_000).toISOString() }] : []);
    }
    if (url.pathname.endsWith("/sports/odds")) return Response.json([]);
    if (url.pathname.endsWith("/sports/props") && url.searchParams.get("sport") === "nba") {
      return Response.json({ props: [] });
    }
    if (url.pathname.includes("/basketball/nba/") && url.pathname.endsWith("/schedule")) return Response.json({ events });
    if (url.pathname.includes("/basketball/nba/") && url.pathname.endsWith("/summary")) {
      const event = events.find(row => row.id === url.searchParams.get("event"))!;
      return Response.json({
        header: { id: event.id, competitions: [{ ...event.competitions[0], date: event.date }] },
        boxscore: { teams: teams.map(id => ({ team: { id }, statistics: [{ name: "assists", value: 21 }] })) },
      });
    }
    if (url.pathname.endsWith("/sports/props")) return Response.json({ props: Array.from({ length: 25 }, (_, i) => ({ athleteId: `cron-warm-player-${i}` })) });
    if (url.pathname.endsWith("/injuries")) return Response.json({ injuries: [{ displayName: "Chicago Bears", injuries: [{ athlete: { id: "cron-warm-out", displayName: "Missing Runner", position: { abbreviation: "RB" } }, status: "Out" }] }] });
    if (url.pathname.endsWith("/gamelog")) {
      histories.push(url.pathname.split("/").at(-2)!);
      peakHistories = Math.max(peakHistories, ++activeHistories);
      await new Promise(resolve => setTimeout(resolve, 2));
      activeHistories--;
      return Response.json({ labels: ["CAR"], events: { e: { gameDate: "2026-10-01" } }, seasonTypes: [{ categories: [{ events: [{ eventId: "e", stats: ["15"] }] }] }] });
    }
    throw new Error(`Unexpected warmup request ${url.pathname}`);
  };
  try {
    const [a, b] = await Promise.all([runPrebuildJobs(), runPrebuildJobs()]);
    assert.deepEqual(a, b);
    assert.equal(new Set(gameReads).size, gameReads.length, "one run per sport despite two callers");
    assert.equal(histories.length, 16);
    assert.ok(histories.includes("cron-warm-out"), "absent player's historical workload is prepared without a prop");
    assert.equal(peakHistories, 2);
    assert.equal(a.summary.historiesWarmed, 16);
    assert.equal(a.summary.opponentTeamsWarmed, 2);
    for (const team of teams) {
      assert.ok((await opponentMarketAllowance("nba", team)).some(row => row.market === "player_assists" && row.sampleSize === 3));
    }
    assert.equal(a.perSport.filter(s => s.histories > 0).length, 1, "no history fan-out for empty slates");
  } finally { globalThis.fetch = original; }
});

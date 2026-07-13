import assert from "node:assert/strict";
import { test } from "node:test";

import { fetchEspnPlayerHistory } from "../src/lib/espnPlayerHistory.ts";
import { fetchGameRoster, normalizePlayerName } from "../src/lib/espnRoster.ts";
import { simulateProp } from "../src/lib/monteCarloBuild.ts";
import { resolvePropAthleteIds } from "../src/lib/resolvePropAthleteIds.ts";
import { gameValueForMarket, computeAmbiguous } from "../src/lib/propStatValue.ts";

test("WNBA prop sim pipeline: ESPN history → Monte Carlo hit probability", async () => {
  const sb = await fetch("https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard");
  assert.equal(sb.ok, true);
  const scoreboard = (await sb.json()) as {
    events?: Array<{
      competitions?: Array<{
        competitors?: Array<{ homeAway?: string; team?: { id?: string; displayName?: string } }>;
      }>;
    }>;
  };
  const event = scoreboard.events?.[0];
  assert.ok(event, "expected at least one WNBA event on ESPN scoreboard");

  const comp = event.competitions?.[0];
  const home = comp?.competitors?.find((c) => c.homeAway === "home");
  const away = comp?.competitors?.find((c) => c.homeAway === "away");
  assert.ok(home?.team?.id && away?.team?.id, "expected home/away team ids");

  const roster = await fetchGameRoster("wnba", home.team.id, away.team.id);
  assert.ok(roster.length > 0, "expected non-empty WNBA roster");

  const player = roster.find((r) => r.athleteId);
  assert.ok(player?.athleteId, "expected roster entry with athleteId");

  const history = await fetchEspnPlayerHistory("wnba", player.athleteId);
  assert.ok(history?.recent?.length, "expected ESPN game log with recent games");
  assert.ok(history.recent.length >= 3, "expected at least 3 recent games for MC");

  const result = simulateProp(
    {
      player: player.name,
      market: "player_points",
      line: 12.5,
      side: "Over",
      sport: "wnba",
      athleteId: player.athleteId,
    },
    history,
    { sport: "wnba", playerHistories: new Map() },
    5000,
  );

  assert.ok(result.hitProbability != null, "expected non-null hitProbability when history is present");
  assert.ok(result.simulations > 0, "expected simulations to run");
  assert.ok(result.sampleGames >= 3, "expected sampleGames >= 3");
});

test("WNBA full pipeline proof: raw stats → sim → edge → confidence", async () => {
  const sb = await fetch("https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard");
  const scoreboard = (await sb.json()) as {
    events?: Array<{
      competitions?: Array<{
        competitors?: Array<{ homeAway?: string; team?: { id?: string; displayName?: string } }>;
      }>;
    }>;
  };
  const comp = scoreboard.events?.[0]?.competitions?.[0];
  const home = comp?.competitors?.find((c) => c.homeAway === "home");
  const away = comp?.competitors?.find((c) => c.homeAway === "away");
  if (!home?.team?.id || !away?.team?.id) return;

  const roster = await fetchGameRoster("wnba", home.team.id, away.team.id);
  const player = roster.find((r) => r.athleteId);
  if (!player?.athleteId) return;

  const history = await fetchEspnPlayerHistory("wnba", player.athleteId);
  assert.ok(history?.recent?.length, "expected history");

  const market = "player_points";
  const line = 14.5;
  const side = "Over" as const;
  const labels = history.labels ?? [];
  const ambiguous = computeAmbiguous(labels);
  const rawStats = history.recent.slice(0, 5).map((g) => ({
    stats: g.stats,
    value: gameValueForMarket(market, g.stats, ambiguous),
  }));
  assert.ok(rawStats.filter((r) => r.value != null).length >= 3, "expected mapped raw stat values");

  const sim = simulateProp(
    { player: player.name, market, line, side, sport: "wnba", athleteId: player.athleteId },
    history,
    { sport: "wnba", playerHistories: new Map() },
    5000,
  );
  assert.ok(sim.hitProbability != null, "sim must grade");
  assert.ok(sim.confidenceScore != null, "confidence must be present");

  const impliedFromFair = 0.5;
  const edgePct = Math.round((sim.hitProbability! - impliedFromFair) * 1000) / 10;
  const grade =
    sim.hitProbability! >= 0.58 && sim.confidenceScore! >= 60
      ? "Strong"
      : sim.hitProbability! >= 0.52
        ? "Lean"
        : "Pass";

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        player: player.name,
        market,
        line,
        side,
        rawStats,
        simulation: {
          hitProbability: sim.hitProbability,
          meanProjection: sim.meanProjection,
          confidenceScore: sim.confidenceScore,
          sampleGames: sim.sampleGames,
        },
        edgePct,
        confidencePct: sim.confidenceScore,
        grade,
        recommendation: grade === "Pass" ? "No bet" : `${side} ${line} ${market}`,
      },
      null,
      2,
    ),
  );
});

test("resolvePropAthleteIds backfills missing athleteId from roster", async () => {
  const sb = await fetch("https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard");
  const scoreboard = (await sb.json()) as {
    events?: Array<{
      competitions?: Array<{
        competitors?: Array<{ homeAway?: string; team?: { id?: string; displayName?: string } }>;
      }>;
    }>;
  };
  const comp = scoreboard.events?.[0]?.competitions?.[0];
  const home = comp?.competitors?.find((c) => c.homeAway === "home");
  const away = comp?.competitors?.find((c) => c.homeAway === "away");
  if (!home?.team?.id || !away?.team?.id) return;

  const roster = await fetchGameRoster("wnba", home.team.id, away.team.id);
  const player = roster.find((r) => r.athleteId);
  if (!player) return;

  const resolved = await resolvePropAthleteIds(
    "wnba",
    [{ player: player.name, market: "player_points", line: 12.5, side: "Over", sport: "wnba" }],
    {
      homeTeamId: home.team.id,
      awayTeamId: away.team.id,
      homeTeam: home.team.displayName,
      awayTeam: away.team.displayName,
    },
  );
  assert.ok(resolved[0]?.athleteId, "roster backfill should resolve athleteId");
});

test("missing athleteId yields null sim with nullReason", () => {
  const result = simulateProp(
    {
      player: "A'ja Wilson",
      market: "player_points",
      line: 22.5,
      side: "Over",
      sport: "wnba",
      athleteId: null,
    },
    null,
    { sport: "wnba", playerHistories: new Map() },
    5000,
  );
  assert.equal(result.hitProbability, null);
  assert.equal(result.nullReason, "missing_athlete_id");
  assert.equal(result.sampleGames, 0);
});

test("simulateProp grades when sport comes from game context only", async () => {
  const sb = await fetch("https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard");
  const scoreboard = (await sb.json()) as {
    events?: Array<{
      competitions?: Array<{
        competitors?: Array<{ homeAway?: string; team?: { id?: string; displayName?: string } }>;
      }>;
    }>;
  };
  const comp = scoreboard.events?.[0]?.competitions?.[0];
  const home = comp?.competitors?.find((c) => c.homeAway === "home");
  const away = comp?.competitors?.find((c) => c.homeAway === "away");
  if (!home?.team?.id || !away?.team?.id) return;

  const roster = await fetchGameRoster("wnba", home.team.id, away.team.id);
  const player = roster.find((r) => r.athleteId);
  if (!player?.athleteId) return;

  const history = await fetchEspnPlayerHistory("wnba", player.athleteId);
  assert.ok(history?.recent?.length);

  const result = simulateProp(
    {
      player: player.name,
      market: "player_points",
      line: 10.5,
      side: "Over",
      athleteId: player.athleteId,
    } as Parameters<typeof simulateProp>[0],
    history,
    { sport: "wnba", playerHistories: new Map() },
    3000,
  );
  assert.ok(result.hitProbability != null, "game-level sport should be enough when history loads");
});

test("roster backfill resolves athleteId from player name", async () => {
  const sb = await fetch("https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard");
  const scoreboard = (await sb.json()) as {
    events?: Array<{
      competitions?: Array<{
        competitors?: Array<{ homeAway?: string; team?: { id?: string; displayName?: string } }>;
      }>;
    }>;
  };
  const comp = scoreboard.events?.[0]?.competitions?.[0];
  const home = comp?.competitors?.find((c) => c.homeAway === "home");
  const away = comp?.competitors?.find((c) => c.homeAway === "away");
  if (!home?.team?.id || !away?.team?.id) return;

  const roster = await fetchGameRoster("wnba", home.team.id, away.team.id);
  const player = roster.find((r) => r.athleteId);
  if (!player) return;

  const byName = new Map(
    roster.filter((r) => r.athleteId).map((r) => [normalizePlayerName(r.name), r.athleteId!] as const),
  );
  const resolved = byName.get(normalizePlayerName(player.name));
  assert.equal(resolved, player.athleteId);
});

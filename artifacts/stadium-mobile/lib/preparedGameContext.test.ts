import assert from "node:assert/strict";
import { test } from "node:test";
import { preparedContextForGame, preparedContextRejectsProp, preparedEnvironmentForGames, filterPreparedDeliveryPicks, type PreparedCoachGameContext } from "./preparedGameContext.ts";
import { buildPropHolisticScore } from "./propHolisticRecommendation.ts";
import type { EspnGame, PropPoolEntry } from "./api.ts";

function fixture(sport = "mlb") {
  const now = Date.now(), startsAt = new Date(now + 3600_000).toISOString();
  const context: PreparedCoachGameContext = {
    version: 1, sport, eventId: "g", startsAt, homeTeamId: "h", awayTeamId: "a", observedAtMs: now, expiresAtMs: now + 120_000,
    lineups: [{ teamId: "h", complete: true, players: [{ athleteId: "bench", starter: false, position: "OF", battingOrder: null }] }],
    environment: { venue: "Verified venue", exposure: "outdoor", weather: { source: "openweather_forecast", locationScope: "venue", observedAtMs: now, forecastAtMs: Date.parse(startsAt), tempF: 40, windMph: 22, gustMph: 30, windDeg: null, humidity: null, precipChancePct: null, condition: null } },
  };
  const game: EspnGame = { id: "g", sport, startsAt, homeTeamId: "h", awayTeamId: "a", name: "Away @ Home", shortName: "A @ H", homeTeam: "Home", awayTeam: "Away", status: "Scheduled", preparedContext: context };
  const entry: PropPoolEntry = { player: "Bench Player", sport, game: game.name, athleteId: "bench", playerTeamId: "h", startsAt, marketKey: "batter_hits", marketLabel: "Hits", line: 0.5, side: "Over", odds: -110 };
  return { now, context, game, entry };
}

test("source-age and full event identity survive JSON transport, with unknown data staying usable", () => {
  const { game, now } = fixture();
  assert.ok(preparedContextForGame(JSON.parse(JSON.stringify(game)), now));
  assert.equal(preparedContextForGame(game, now + 120_001), null);
  for (const change of [{ id: "other" }, { homeTeamId: "wrong" }, { startsAt: new Date(now + 7200_000).toISOString() }, { sport: "nba" }]) {
    assert.equal(preparedContextForGame({ ...game, ...change }, now), null);
  }
  assert.equal(preparedContextForGame({ ...game, preparedContext: undefined }), null);
});

test("confirmed bench gate is event-specific and does not discard basketball reserves or unknown lineups", () => {
  const { context, game, entry } = fixture();
  assert.equal(preparedContextRejectsProp(entry, [game]), true);
  assert.equal(preparedContextRejectsProp({ ...entry, startsAt: new Date(Date.parse(entry.startsAt!) + 86400_000).toISOString() }, [game]), false);
  assert.equal(preparedContextRejectsProp({ ...entry, athleteId: "unknown" }, [game]), false);
  assert.equal(preparedContextRejectsProp({ ...entry, marketKey: "pitcher_strikeouts" }, [game]), false);
  const basketball = fixture("nba");
  assert.equal(preparedContextRejectsProp(basketball.entry, [basketball.game]), false);
  context.lineups[0]!.complete = false;
  assert.equal(preparedContextRejectsProp(entry, [game]), false);
});

test("final delivery excludes a verified bench player even on recovery and alternate picks", () => {
  const { game, entry } = fixture();
  const pick = { ...entry, isProp: true, propMarketKey: entry.marketKey };
  assert.deepEqual(filterPreparedDeliveryPicks([pick, { ...pick, athleteId: "starter", line: 1.5 }], [game]).map(p => p.athleteId), ["starter"]);
});

test("prepared game-time forecast overlays legacy current weather without network work", () => {
  const { game, context } = fixture("nfl");
  const merged = preparedEnvironmentForGames([game], { [game.name]: { coaches: { home: { name: "Coach" } }, weather: { tempF: 85, windMph: 2 } } });
  const env = merged[game.name] as { weather: { tempF: number }; coaches: unknown };
  assert.equal(env.weather.tempF, 40);
  assert.ok(env.coaches);
  context.environment.exposure = "unknown";
  const unknown = preparedEnvironmentForGames([game], { [game.name]: { park: { dome: true }, weather: { tempF: 85 } } })[game.name] as { weather: unknown; exposure: string; park: { dome: boolean } };
  assert.equal(unknown.weather, null);
  assert.equal(unknown.park.dome, false);
  assert.equal(unknown.exposure, "unknown");
});

test("stale forecasts do not become fresh merely because the event context refreshed", () => {
  const { game, context, now } = fixture("soccer");
  context.environment.weather!.observedAtMs = now - 300_001;
  assert.equal((preparedEnvironmentForGames([game])[game.name] as { weather: unknown }).weather, null);
});

const weatherScore = (sport: string, side: string, weather: { windMph?: number; tempF?: number; precipChancePct?: number }, exposure?: "unknown") => buildPropHolisticScore({ sport, marketKey: sport === "mlb" ? "batter_home_runs" : "player_pass_yds", propSide: side, mlbGameEnv: { weather, exposure } }).factors.find(f => f.key === "weather")!;

test("football Under reverses adverse wind exactly once", () => {
  const over = weatherScore("nfl", "Over", { windMph: 22 });
  const under = weatherScore("nfl", "Under", { windMph: 22 });
  assert.ok(over.score! < 5);
  assert.ok(under.score! > 5);
  assert.equal(weatherScore("nfl", "Over", { windMph: 22 }, "unknown").score, null);
});

test("baseball wind speed without direction creates no Over advantage", () => {
  assert.equal(weatherScore("mlb", "Over", { tempF: 65, windMph: 0 }).score, weatherScore("mlb", "Over", { tempF: 65, windMph: 25 }).score);
});

test("soccer and tennis carry real weather without inventing probability effects", () => {
  for (const sport of ["soccer", "tennis"]) {
    const factor = weatherScore(sport, "Over", { windMph: 22, tempF: 40 });
    assert.equal(factor.applicable, true);
    assert.equal(factor.score, null);
    assert.match(factor.display ?? "", /22 mph/);
  }
});

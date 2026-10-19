import assert from "node:assert/strict";
import { test } from "node:test";
import { performance } from "node:perf_hooks";
import { cacheSet } from "../src/lib/store.ts";
import { parsePreparedGameContext, weatherAtGameTime, warmPreparedGameContexts, readPreparedGameContexts, attachPreparedGameContexts, preparedContextForMatch, refreshPreparedGameContexts, type ContextGame, type ContextSummary } from "../src/lib/preparedGameContext.ts";
import { propHasConfirmedNonstarter } from "../src/lib/propAvailability.ts";
import { runPropSims } from "../src/lib/propSimRunner.ts";

function fixture(sport = "mlb", id = "990001") {
  const now = Date.now();
  const game: ContextGame = { id, sport, startsAt: new Date(now + 3600_000).toISOString(), homeTeamId: "home", awayTeamId: "away", homeAbbr: "SF" };
  const count = sport === "mlb" ? 9 : sport === "soccer" ? 11 : 5;
  const rows = [...Array.from({ length: count }, (_, i) => ({ athlete: { id: `starter-${i}`, position: { abbreviation: "OF" } }, starter: true, battingOrder: (i + 1) * 100 })), { athlete: { id: "bench", position: { abbreviation: "OF" } }, starter: false }];
  const summary: ContextSummary = { header: { id, competitions: [{ id, date: game.startsAt, status: { type: { state: "pre" } }, competitors: [{ homeAway: "home", team: { id: "home" } }, { homeAway: "away", team: { id: "away" } }] }] }, gameInfo: { venue: { fullName: "Levi's Stadium", indoor: false } }, boxscore: { players: [{ team: { id: "home" }, statistics: [{ athletes: rows }, { athletes: rows }] }] } };
  return { now, game, summary };
}

test("lineups require this pregame event, date, sides and explicit starter flags", () => {
  for (const sport of ["mlb", "nba", "wnba", "ncaab", "soccer"]) {
    const { now, game, summary } = fixture(sport);
    const c = parsePreparedGameContext(sport, game, summary, now)!;
    assert.ok(c);
    assert.equal(c.lineups[0]?.complete, true);
    assert.equal(c.lineups[0]?.players.find(p => p.athleteId === "starter-0")?.battingOrder, 1);
    const altered = structuredClone(summary);
    altered.boxscore!.players![0]!.statistics![0]!.athletes!.forEach(r => { delete r.starter; });
    altered.boxscore!.players![0]!.statistics!.splice(1);
    assert.equal(parsePreparedGameContext(sport, game, altered, now)?.lineups[0]?.complete, false);
    for (const change of [
      (d: ContextSummary) => { d.header!.id = "another-event"; },
      (d: ContextSummary) => { d.header!.competitions![0]!.date = new Date(now + 7200_000).toISOString(); },
      (d: ContextSummary) => { d.header!.competitions![0]!.status!.type!.state = "post"; },
      (d: ContextSummary) => { d.header!.competitions![0]!.competitors![0]!.team!.id = "wrong-side"; },
    ]) {
      const d = structuredClone(summary); change(d);
      assert.equal(parsePreparedGameContext(sport, game, d, now), null);
    }
  }
});

test("batting lineup completeness ignores the extra starting pitcher", () => {
  const { now, game, summary } = fixture();
  summary.boxscore!.players![0]!.statistics!.push({ athletes: [{ athlete: { id: "pitcher", position: { abbreviation: "P" } }, starter: true }] });
  const c = parsePreparedGameContext("mlb", game, summary, now)!;
  assert.equal(c.lineups[0]!.complete, true);
  assert.equal(c.lineups[0]!.players.length, 11);
});

test("conflicting provider starter flags never establish a confirmed complete lineup", () => {
  const { now, game, summary } = fixture();
  summary.boxscore!.players![0]!.statistics!.push({ athletes: [{ athlete: { id: "starter-0" }, starter: false }] });
  assert.equal(parsePreparedGameContext("mlb", game, summary, now)?.lineups[0]?.complete, false);
});

test("stadium identity prevents home-park weather on neutral sites; retractable roof stays unknown", () => {
  const { now, game, summary } = fixture("nfl");
  delete summary.gameInfo!.venue!.indoor;
  assert.equal(parsePreparedGameContext("nfl", game, summary, now)?.environment.exposure, "outdoor");
  summary.gameInfo!.venue!.fullName = "Neutral Site";
  assert.equal(parsePreparedGameContext("nfl", game, summary, now)?.environment.exposure, "unknown");
  game.homeAbbr = "DAL"; summary.gameInfo!.venue!.fullName = "AT&T Stadium";
  assert.equal(parsePreparedGameContext("nfl", game, summary, now)?.environment.exposure, "unknown");
});

test("forecast selects game time, preserves unknown fields and rejects out-of-range forecasts", () => {
  const now = Date.now(), start = new Date(now + 6 * 3600_000).toISOString();
  const fc = { list: [{ dt: now / 1000, main: { temp: 85 }, wind: { speed: 2 }, pop: 0 }, { dt: Date.parse(start) / 1000, main: { temp: 40 }, wind: { speed: 22 } }] };
  const w = weatherAtGameTime(fc, start, "city")!;
  assert.equal(w.tempF, 40); assert.equal(w.windMph, 22);
  assert.equal(w.precipChancePct, null); assert.equal(w.humidity, null);
  assert.equal(w.locationScope, "city");
  assert.equal(weatherAtGameTime(fc, new Date(now + 24 * 3600_000).toISOString(), "venue"), null);
});

test("server preparation is reusable with zero provider calls on reads", async () => {
  const { game, summary } = fixture("nfl", "990002");
  const original = globalThis.fetch, previousKey = process.env.OPENWEATHER_API_KEY;
  process.env.OPENWEATHER_API_KEY = "test-only";
  let requests = 0;
  globalThis.fetch = async input => {
    requests++;
    if (String(input).includes("/summary?")) return Response.json(summary);
    assert.match(String(input), /openweathermap\.org\/data\/2\.5\/forecast/);
    return Response.json({ list: [{ dt: Date.parse(game.startsAt) / 1000, main: { temp: 55 }, wind: { speed: 15 } }] });
  };
  try {
    assert.equal(await warmPreparedGameContexts("nfl", [game]), 1);
    assert.equal(requests, 2);
    const before = await readPreparedGameContexts("nfl");
    const times: number[] = [];
    for (let i = 0; i < 100; i++) {
      const at = performance.now();
      const result = await attachPreparedGameContexts("nfl", [game]);
      assert.equal(result[0]?.preparedContext?.eventId, game.id);
      times.push(performance.now() - at);
    }
    assert.equal(requests, 2);
    assert.equal((await readPreparedGameContexts("nfl"))[0]?.observedAtMs, before[0]?.observedAtMs);
    times.sort((a,b) => a-b);
    console.log(`[prepared-context] cached attachment p95=${times[95]!.toFixed(3)}ms; foreground provider calls=0`);
  } finally { globalThis.fetch = original; if (previousKey == null) delete process.env.OPENWEATHER_API_KEY; else process.env.OPENWEATHER_API_KEY = previousKey; }
});

test("stale and ambiguous events are unusable", async () => {
  const { now, game, summary } = fixture("soccer", "990003");
  const context = parsePreparedGameContext("soccer", game, summary, now)!;
  context.requiresEventTime = true;
  await cacheSet("coach-prepared-game:v1:soccer", [context], 120_000);
  assert.equal(await preparedContextForMatch("soccer", "home", "away"), null);
  assert.equal((await preparedContextForMatch("soccer", "home", "away", game.startsAt))?.eventId, game.id);
  context.expiresAtMs = now - 1;
  await cacheSet("coach-prepared-game:v1:soccer", [context], 120_000);
  assert.deepEqual(await readPreparedGameContexts("soccer"), []);
});

test("weather provider failure preserves a verified lineup", async () => {
  const { game, summary } = fixture("nfl", "990004");
  game.homeAbbr = "GB"; summary.gameInfo!.venue!.fullName = "Lambeau Field";
  const original = globalThis.fetch, previousKey = process.env.OPENWEATHER_API_KEY;
  process.env.OPENWEATHER_API_KEY = "test-only";
  globalThis.fetch = async input => String(input).includes("/summary?") ? Response.json(summary) : Response.json({}, { status: 503 });
  try {
    assert.equal(await warmPreparedGameContexts("nfl", [game]), 1);
    const contexts = await readPreparedGameContexts("nfl");
    assert.ok(contexts[0]?.lineups[0]?.players.length);
    assert.equal(contexts[0]?.environment.weather, null);
  } finally { globalThis.fetch = original; if (previousKey == null) delete process.env.OPENWEATHER_API_KEY; else process.env.OPENWEATHER_API_KEY = previousKey; }
});

test("confirmed bench starter-dependent markets cannot bypass the shared simulation gate", async () => {
  const { now, game, summary } = fixture("mlb");
  const preparedContext = parsePreparedGameContext("mlb", game, summary, now)!;
  const prop = { sport: "mlb", player: "Bench Player", athleteId: "bench", market: "batter_hits", line: 0.5, side: "Over" as const, isHome: true };
  assert.equal(propHasConfirmedNonstarter(prop, "mlb", preparedContext), true);
  assert.equal(propHasConfirmedNonstarter({ ...prop, market: "pitcher_strikeouts" }, "mlb", preparedContext), false);
  assert.equal(propHasConfirmedNonstarter({ ...prop, sport: "nba" }, "nba", { ...preparedContext, sport: "nba" }), false);
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("no source calls permitted"); };
  try {
    const result = await runPropSims([prop, { ...prop, side: "Under" }], "quick", { sport: "mlb", oppPace: null, leaguePace: null, oppKeyInjuries: 0, ownKeyInjuries: 0, weatherImpact: null, preparedContext }, {});
    assert.ok(result.rows.every(r => r.nullReason === "confirmed_nonstarter" && r.hitProbability == null && r.simulations === 0));
  } finally { globalThis.fetch = original; }
});

test("tennis uses the actual tournament city and preserves unknown roof status", async () => {
  const { game } = fixture("tennis", "990005");
  const original = globalThis.fetch, previousKey = process.env.OPENWEATHER_API_KEY;
  process.env.OPENWEATHER_API_KEY = "test-only";
  let geocodes = 0;
  globalThis.fetch = async input => {
    const url = String(input);
    if (url.includes("/scoreboard")) return Response.json({ events: [{ id: "tournament", venue: { displayName: "Paris, France" }, groupings: [{ competitions: [{ id: game.id, date: game.startsAt, venue: { fullName: "Paris, France", court: "Court 1" }, status: { type: { state: "pre", description: "Scheduled" } }, competitors: [{ id: "home", homeAway: "home", athlete: { displayName: "Home Player" } }, { id: "away", homeAway: "away", athlete: { displayName: "Away Player" } }] }] }] }] });
    if (url.includes("/geo/")) { geocodes++; return Response.json([{ name: "Paris", country: "FR", lat: 48.86, lon: 2.35 }]); }
    assert.match(url, /openweathermap\.org\/data\/2\.5\/forecast/);
    return Response.json({ list: [{ dt: Date.parse(game.startsAt) / 1000, main: { temp: 60 }, wind: { speed: 12 } }] });
  };
  try {
    assert.equal(await warmPreparedGameContexts("tennis", [game]), 1);
    const context = (await readPreparedGameContexts("tennis"))[0]!;
    assert.equal(geocodes, 1);
    assert.equal(context.environment.weather?.locationScope, "city");
    assert.equal(context.environment.weather?.tempF, 60);
    assert.equal(context.environment.exposure, "unknown");
    assert.deepEqual(context.lineups, []);
  } finally { globalThis.fetch = original; if (previousKey == null) delete process.env.OPENWEATHER_API_KEY; else process.env.OPENWEATHER_API_KEY = previousKey; }
});

test("closed-app context refresh never reloads odds, prop boards or simulations", async () => {
  const original = globalThis.fetch;
  const paths: string[] = [];
  globalThis.fetch = async input => {
    paths.push(String(input));
    return Response.json({}, { status: 503 });
  };
  try {
    const [a, b] = await Promise.all([refreshPreparedGameContexts(), refreshPreparedGameContexts()]);
    assert.deepEqual(a, b);
    assert.ok(a.sports >= 1);
    assert.ok(paths.every(path => !/\/odds|\/props|\/simulate/.test(path)));
  } finally { globalThis.fetch = original; }
});

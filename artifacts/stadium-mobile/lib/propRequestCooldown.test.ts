import assert from "node:assert/strict";
import test from "node:test";
import { createPropRequestCooldown } from "./propRequestCooldown.ts";
import { getProps, getPrizePicksProps } from "./api.ts";
import { shouldSkipScannerPropExpand, propBoardGamesForScope } from "./coach/propPoolPolicy.ts";

test("429 backpressure spans sports and event URLs, expires, and leaves other routes independent", () => {
  let now = 1000;
  const gate = createPropRequestCooldown(() => now);
  assert.equal(gate.block("/sports/props?sport=nba&eventId=1", "2"), true);
  for (const sport of ["nfl", "ncaaf", "nba", "wnba", "ncaab", "mlb", "nhl", "soccer", "tennis", "ufc"]) {
    assert.throws(() => gate.assertAllowed(`/sports/props?sport=${sport}&eventId=2`), /429/);
  }
  gate.assertAllowed("/sports/prizepicks-props?sport=soccer");
  gate.assertAllowed("/sports/odds?sport=nba");
  assert.equal(gate.block("/sports/odds", null), false);
  now = 3000;
  gate.assertAllowed("/sports/props?sport=nba");
});

test("missing/invalid Retry-After uses server's minute window; HTTP dates are honored", () => {
  let now = Date.parse("2026-10-23T18:00:00Z");
  const gate = createPropRequestCooldown(() => now);
  gate.block("/sports/props", "invalid");
  gate.block("/sports/prizepicks-props", "Fri, 23 Oct 2026 18:00:10 GMT");
  now += 10_000;
  gate.assertAllowed("/sports/prizepicks-props");
  assert.equal(gate.isBlocked("/sports/props"), true);
  now += 50_000;
  gate.assertAllowed("/sports/props");
});

test("completed empty/thin prop boards are not fetched again by the scanner", () => {
  for (const size of [0, 1, 39, 40, 400]) assert.equal(shouldSkipScannerPropExpand(size, true), true);
  assert.equal(shouldSkipScannerPropExpand(0, false), false);
});

test("load scope avoids disallowed college requests while retaining every applicable sport", () => {
  const games = ["nfl", "ncaaf", "nba", "wnba", "ncaab", "mlb", "nhl", "soccer", "tennis", "ufc"].map(sport => ({sport}));
  assert.deepEqual(propBoardGamesForScope(games, {gameLinesOnly: true, allowNcaafPlayerProps: true}), []);
  assert.deepEqual(propBoardGamesForScope(games, {gameLinesOnly: false, allowNcaafPlayerProps: false}), games.filter(g => g.sport !== "ncaaf"));
  assert.deepEqual(propBoardGamesForScope(games, {gameLinesOnly: false, allowNcaafPlayerProps: true}), games);
  assert.equal(games.length, 10, "does not mutate the game-line board");
});

test("real prop GET path sends one request on 429 instead of three per event", async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response('{"error":"Too many requests"}', { status: 429 });
  };
  try {
    const first = await getProps({sport:"nba",eventId:"cooldown-first"});
    const second = await getProps({sport:"nfl",eventId:"cooldown-second"});
    assert.deepEqual(first.props, []);
    assert.deepEqual(second.props, []);
    assert.equal(calls, 1);
    await assert.rejects(getPrizePicksProps({sport:"soccer",home:"Home",away:"Away"}), /429/);
    await assert.rejects(getPrizePicksProps({sport:"nhl",home:"Home",away:"Away"}), /429/);
    assert.equal(calls, 2, "separate fallback route gets one attempt, then shares its own cooldown");
  } finally { globalThis.fetch = previous; }
});

/**
 * Calendar-day context regressions — run with:
 *   node --import ./test/register-hooks.mjs --test lib/coach/dateContextRegression.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildFocalSportParlayContext } from "../api.ts";
import { filterOddsForSlateDay, slateDayFromThread } from "../slate.ts";

for (const sport of ["mlb", "nba", "wnba", "nfl", "ncaaf", "ncaab", "nhl", "soccer", "tennis", "ufc"]) {
  test(`${sport}: tomorrow-only feed cannot populate tonight's context`, async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: new Date(2026, 9, 13, 23, 30) });
    const tomorrow = new Date(2026, 9, 14, 19).toISOString();
    let oddsRequests = 0;
    t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/sports/odds")) oddsRequests++;
      return new Response(JSON.stringify(url.includes("/sports/odds") ? [{
        id: `${sport}-tomorrow`, sport, commenceTime: tomorrow,
        homeTeam: "Home", awayTeam: "Away", markets: [],
      }] : []), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const built = await buildFocalSportParlayContext(sport, 4, undefined, {
      tonightOnly: true, focalText: "4 leg from today",
    });
    assert.equal(oddsRequests, 1, "the real loader read the supplied board");
    assert.equal(built.todayOnly, true);
    assert.deepEqual(built.context.realGames, []);
    assert.deepEqual(built.context.realOdds, []);
    assert.deepEqual(built.context.realProps, []);
    assert.deepEqual(built.propPool, []);
  });
}

test("local midnight: today's evening UTC-next-day game stays; tomorrow does not", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(2026, 9, 13, 18) });
  const tonight = { startsAt: new Date(2026, 9, 13, 23, 59).toISOString() };
  const tomorrow = { startsAt: new Date(2026, 9, 14, 0, 1).toISOString() };
  for (const ask of ["4 leg from today", "4 leg tonight"]) {
    assert.deepEqual(filterOddsForSlateDay([tonight, tomorrow], slateDayFromThread(ask)), [tonight]);
  }
});

test("mixed board preserves tonight and excludes tomorrow before props load", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(2026, 9, 13, 18) });
  const tonight = new Date(2026, 9, 13, 20).toISOString();
  const tomorrow = new Date(2026, 9, 14, 20).toISOString();
  const requested: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    return new Response(JSON.stringify(url.includes("/sports/odds") ? [tonight, tomorrow].map((commenceTime, i) => ({
      id: i ? "tomorrow" : "tonight", sport: "mlb", commenceTime,
      homeTeam: "Home", awayTeam: "Away", markets: [],
    })) : []), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  const built = await buildFocalSportParlayContext("mlb", 4, undefined, { tonightOnly: true });
  assert.equal(built.todayOnly, true);
  assert.deepEqual(built.context.realGames.map((g) => g.startsAt), [tonight]);
  assert.ok(!requested.some((url) => url.includes("tomorrow")), "no tomorrow props request");
});

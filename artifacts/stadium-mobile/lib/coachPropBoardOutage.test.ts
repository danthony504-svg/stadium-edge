import assert from "node:assert/strict";
import test from "node:test";
import { fetchFullBoardPropPool, type OddsGame } from "./api.ts";
import { buildCoachParlay } from "./coach/buildParlay.ts";
import { createCoachPropBoardHealth, type CoachPropBoardHealth } from "./coachPropBoardHealth.ts";

const games: OddsGame[] = Array.from({ length: 15 }, (_, i) => ({
  id: String(i + 1).padStart(32, "0"), sport: "nba",
  homeTeam: "Boston Celtics", awayTeam: "Miami Heat",
  commenceTime: new Date(Date.now() + (i + 60) * 60_000).toISOString(),
  markets: [{ key: "totals", outcomes: [
    { name: "Over", point: 220.5, price: -110 }, { name: "Under", point: 220.5, price: -110 },
  ] }],
}));

test("three consecutive 502s latch the breaker and measure failed attempts", () => {
  let now = 100;
  const circuit = createCoachPropBoardHealth(() => now);
  circuit.observe(502, 11);
  circuit.observe(200, 8);
  circuit.observe(502, 12);
  circuit.observe(502, 14);
  assert.equal(circuit.allowsAttempt(), true);
  circuit.observe(502, 17);
  circuit.observe(200, 15);
  now = 150;
  assert.deepEqual(circuit.snapshot(), {
    attempts: 6, gatewayFailures: 4, failedAttemptMs: 54, propLoadMs: 50, circuitOpen: true,
  });
});

test("full prop outage stops after the first concurrent wave and preserves posted rows only", async () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return Response.json({ error: "Upstream unreachable" }, { status: 502 });
  };
  try {
    const reports: CoachPropBoardHealth[] = [];
    const odds = await fetchFullBoardPropPool(games, [], [], undefined, health => reports.push(health));
    assert.deepEqual(odds, []);
    assert.equal(requests, 6);
    assert.equal(reports[0]?.gatewayFailures, 3);
    assert.equal(reports.at(-1)?.gatewayFailures, 6);
    assert.equal(reports.at(-1)?.circuitOpen, true);
  } finally { globalThis.fetch = original; }
});

test("Coach returns no invented legs and tells the user when the entire prop board fails", async () => {
  const original = globalThis.fetch;
  const propRequests: string[] = [];
  globalThis.fetch = async input => {
    const { pathname, search } = new URL(String(input));
    if (pathname.endsWith("/sports/props")) {
      propRequests.push(search);
      return Response.json({ error: "Upstream unavailable" }, { status: 502 });
    }
    if (pathname.endsWith("/sports/odds")) return Response.json(games);
    if (pathname.endsWith("/sports/live-odds")) return Response.json({ odds: [] });
    if (pathname.endsWith("/sports/simulate/props")) assert.fail("no posted props to simulate");
    return Response.json([]);
  };
  try {
    const result = await buildCoachParlay({
      requestedLegs: 15, askText: "15 leg NBA player props only", signal: AbortSignal.timeout(5000),
    });
    assert.deepEqual(result.picks, []);
    assert.match(result.note, /Prop markets unavailable right now/);
    assert.ok(propRequests.length >= 3 && propRequests.length <= 6);
    assert.equal(new Set(propRequests).size, propRequests.length);
  } finally { globalThis.fetch = original; }
});

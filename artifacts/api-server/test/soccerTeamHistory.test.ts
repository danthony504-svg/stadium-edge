import assert from "node:assert/strict";
import test from "node:test";
import router from "../src/routes/history.js";

// Exercise the real handlers, cache, search mapping, schedule parsing and form
// reducers with provider-shaped payloads; no network or production writes.
async function call(path: string, query: Record<string, string>) {
  const layer = (router as any).stack.find((l: any) => l.route?.path === path);
  assert.ok(layer, path);
  let body: any;
  const res = { status() { return this; }, json(value: any) { body = value; } };
  await layer.route.stack[0].handle({ query, log: { error() {} } }, res);
  return body;
}
function event(id: string, score: number, against: number, completed = true, teamId = "21922") {
  return { id, date: `2026-10-${id}T12:00:00Z`, competitions: [{
    status: { type: { completed, state: completed ? "post" : "pre" } },
    competitors: [
      { homeAway: "home", team: { id: teamId, displayName: "Sabah FK" }, score: { value: score } },
      { homeAway: "away", team: { id: "124", displayName: "Borussia Dortmund" }, score: String(against) },
    ],
  }] };
}

test("soccer lookup reaches exact team history across competitions, without inventing wins or games", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input); calls.push(url);
    if (url.includes("/search?")) return Response.json({ items: [
      { id: "21922", displayName: "Sabah FK", league: "uefa.champions" },
      { id: "123", displayName: "Soccer domestic club", league: "jpn.1" },
      { id: "456", displayName: "Other domestic club", league: "aze.1", sport: "soccer" },
      { id: "1", displayName: "Lakers", league: "nba" },
      { id: "2", displayName: "Unknown", league: "unknown" },
    ] });
    assert.ok(init?.signal, "schedule has a bounded network timeout");
    assert.match(url, /\/soccer\/all\/teams\/21922\/schedule$/);
    return Response.json({ team: { id: "21922", displayName: "Sabah FK" }, events: [
      event("18", 1, 1), event("17", 2, 0), event("16", 0, 3),
      event("20", 4, 0, false), event("15", 3, 0, true, "999"),
    ] });
  };
  try {
    const search = await call("/sports/team-search", { query: "soccer-regression-sabah" });
    assert.deepEqual(search.results.map((r: any) => [r.name, r.sport]), [
      ["Lakers", "nba"], ["Sabah FK", "soccer"], ["Soccer domestic club", "soccer"], ["Other domestic club", "soccer"],
    ]);
    const history = await call("/sports/team-history", { sport: "soccer", teamId: search.results[1].teamId });
    assert.equal(history.teamName, "Sabah FK");
    assert.equal(history.recent.length, 3);
    assert.deepEqual(history.record, { games: 3, wins: 1, losses: 1, draws: 1, winPct: .333 });
    assert.equal(history.last10.draws, 1);
    assert.equal(history.last10.losses, 1);
    assert.equal(history.recent[0].won, null);
    assert.equal(history.streak, null, "latest draw breaks the previous win streak");
    assert.equal(history.season, null);
    assert.equal(calls.filter(u => u.includes("/schedule")).length, 1, "one schedule request, no league fan-out");
  } finally { globalThis.fetch = original; }
});

test("non-soccer schedules keep their league and genuine empty feeds remain empty", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async input => {
    const url = String(input); calls.push(url);
    assert.match(url, /\/basketball\/nba\/teams\/soccer-regression-empty\/schedule/);
    return Response.json({ team: { displayName: "Empty team" }, events: [] });
  };
  try {
    const history = await call("/sports/team-history", { sport: "nba", teamId: "soccer-regression-empty" });
    assert.deepEqual(history.recent, []);
    assert.equal(history.last10.games, 0);
    assert.equal(history.last10.ptsFor, null);
    assert.equal(calls.length, 2, "existing prior-season fallback stays bounded");
  } finally { globalThis.fetch = original; }
});

test("an all-draw soccer schedule is current evidence, not a reason to substitute a prior season", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async input => {
    const url = String(input); calls.push(url);
    assert.match(url, /soccer\/all\/teams\/all-draw-regression\/schedule$/);
    return Response.json({ team: { displayName: "Draw club" }, events: [event("18", 0, 0, true, "all-draw-regression")] });
  };
  try {
    const history = await call("/sports/team-history", { sport: "soccer", teamId: "all-draw-regression" });
    assert.equal(history.record.games, 1);
    assert.equal(history.record.draws, 1);
    assert.equal(history.record.losses, 0);
    assert.equal(history.last10.games, 1);
    assert.equal(history.season, null);
    assert.equal(calls.length, 1);
    const cached = await call("/sports/team-history", { sport: "soccer", teamId: "all-draw-regression" });
    assert.deepEqual(cached, history);
    assert.equal(calls.length, 1, "repeat lookup uses the existing cache");
  } finally { globalThis.fetch = original; }
});

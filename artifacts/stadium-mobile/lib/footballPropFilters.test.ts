import assert from "node:assert/strict";
import test from "node:test";

import {
  FOOTBALL_PASSING_MARKETS,
  FOOTBALL_PROP_FILTER_GROUPS,
  FOOTBALL_RECEIVING_MARKETS,
  FOOTBALL_RUSHING_MARKETS,
  FOOTBALL_TD_MARKETS,
} from "./footballPropFilters.ts";

const byId = (id: string) => FOOTBALL_PROP_FILTER_GROUPS.find((f) => f.id === id);
const allScoped = FOOTBALL_PROP_FILTER_GROUPS.flatMap((f) => f.markets ?? []);

test("the football pills are Popular, Passing, Rushing, Receiving and TDs", () => {
  assert.deepEqual(
    FOOTBALL_PROP_FILTER_GROUPS.map((f) => f.label),
    ["Popular", "Passing", "Rushing", "Receiving", "TDs"],
  );
});

test("Popular stays unscoped so it still mixes every market", () => {
  assert.equal(byId("popular")!.markets, undefined);
});

test("every high-volume football market is reachable from a category pill", () => {
  const highVolume = [
    "player_pass_yds",
    "player_pass_tds",
    "player_pass_attempts",
    "player_pass_completions",
    "player_pass_interceptions",
    "player_pass_longest_completion",
    "player_rush_yds",
    "player_rush_attempts",
    "player_rush_longest",
    "player_reception_yds",
    "player_receptions",
    "player_reception_longest",
  ];
  for (const market of highVolume) {
    assert.ok(allScoped.includes(market), `${market} is only reachable from Popular`);
  }
});

test("the pre-existing football markets are no longer Popular-only", () => {
  // These four carry the most provider inventory but had no pill before.
  for (const market of ["player_pass_yds", "player_rush_yds", "player_reception_yds", "player_receptions"]) {
    assert.ok(allScoped.includes(market), `${market} still has no category pill`);
  }
});

test("Passing covers yards, TDs, attempts, completions, interceptions and longest completion", () => {
  assert.deepEqual(byId("passing")!.markets, FOOTBALL_PASSING_MARKETS);
  for (const market of [
    "player_pass_yds",
    "player_pass_tds",
    "player_pass_attempts",
    "player_pass_completions",
    "player_pass_interceptions",
    "player_pass_longest_completion",
  ]) {
    assert.ok(FOOTBALL_PASSING_MARKETS.includes(market), `Passing is missing ${market}`);
  }
});

test("Rushing covers yards, attempts and longest rush", () => {
  assert.deepEqual(byId("rushing")!.markets, FOOTBALL_RUSHING_MARKETS);
  assert.deepEqual(FOOTBALL_RUSHING_MARKETS, [
    "player_rush_yds",
    "player_rush_attempts",
    "player_rush_longest",
  ]);
});

test("Receiving covers yards, receptions and longest reception", () => {
  assert.deepEqual(byId("receiving")!.markets, FOOTBALL_RECEIVING_MARKETS);
  assert.deepEqual(FOOTBALL_RECEIVING_MARKETS, [
    "player_reception_yds",
    "player_receptions",
    "player_reception_longest",
  ]);
});

test("TDs only offers the TD market that is actually posted with a line", () => {
  assert.deepEqual(byId("tds")!.markets, FOOTBALL_TD_MARKETS);
  assert.deepEqual(FOOTBALL_TD_MARKETS, ["player_pass_tds"]);
});

test("anytime TD is never presented as a simulated category", () => {
  assert.ok(!allScoped.includes("player_anytime_td"));
});

test("sacks stays out of the categories until its stat path is verified", () => {
  assert.ok(!allScoped.includes("player_sacks"));
});

test("no market is listed twice inside a single pill", () => {
  for (const f of FOOTBALL_PROP_FILTER_GROUPS) {
    const markets = f.markets ?? [];
    assert.equal(new Set(markets).size, markets.length, `${f.label} repeats a market`);
  }
});

test("passing TDs is the only market shared across pills", () => {
  const counts = new Map<string, number>();
  for (const m of allScoped) counts.set(m, (counts.get(m) ?? 0) + 1);
  const shared = [...counts.entries()].filter(([, n]) => n > 1).map(([m]) => m);
  assert.deepEqual(shared, ["player_pass_tds"]);
});

test("every pill id is unique so pill selection cannot be ambiguous", () => {
  const ids = FOOTBALL_PROP_FILTER_GROUPS.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("a grouped pill ranks by edge so one market cannot fill the display cap", () => {
  // Mirrors the Simulator's filteredProps ordering for a multi-market pill.
  const rows = [
    ...Array.from({ length: 22 }, (_, i) => ({ market: "player_reception_yds", ev: 0.01 * i })),
    ...Array.from({ length: 16 }, (_, i) => ({ market: "player_reception_longest", ev: 0.5 + 0.01 * i })),
    ...Array.from({ length: 12 }, (_, i) => ({ market: "player_receptions", ev: 0.3 + 0.01 * i })),
  ];
  const scoped = byId("receiving")!.markets!;
  const filtered = rows.filter((r) => scoped.includes(r.market));
  assert.ok(filtered.length > 40, "fixture should exceed the 40-row cap");

  const providerOrder = new Set(filtered.slice(0, 40).map((r) => r.market));
  const edgeOrder = new Set(
    [...filtered].sort((a, b) => (b.ev ?? 0) - (a.ev ?? 0)).slice(0, 40).map((r) => r.market),
  );
  assert.equal(edgeOrder.size, 3, "edge ordering must keep all three receiving markets visible");
  assert.ok(providerOrder.size <= edgeOrder.size);
});

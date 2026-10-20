import assert from "node:assert/strict";
import test from "node:test";
import { findExactPropPoolRow } from "./propPoolIdentity.ts";
import { propsOnlyPoolRowForPick } from "./coachFootballPropsOnlyGrade.ts";

const row = { player: "Player", side: "Over", line: 10.5, marketKey: "player_reception_yds", game: "A @ B", sport: "nfl", athleteId: "a", eventId: "event" };
const pick = { player: "Player", propSide: "Over", propLine: 10.5, propMarketKey: "player_reception_yds", game: "A @ B", sport: "nfl", athleteId: "a", eventId: "event" };

test("same player and numeric line never select another stat or rematch", () => {
  const wrongStat = { ...row, marketKey: "player_rush_yds" };
  const rematch = { ...row, eventId: "rematch" };
  assert.equal(findExactPropPoolRow(pick, [wrongStat, rematch, row]), row);
  assert.equal(findExactPropPoolRow(pick, [wrongStat, rematch]), undefined);
  assert.equal(propsOnlyPoolRowForPick(pick as never, [wrongStat, rematch]), undefined);
  assert.equal(findExactPropPoolRow({ ...pick, eventId: undefined }, [row, rematch]), undefined);
});

test("binary null-point matching preserves its actual market, No side and event", () => {
  const anytime = { ...row, marketKey: "player_anytime_td", side: "Under", line: null };
  const first = { ...anytime, marketKey: "player_first_td" };
  assert.equal(findExactPropPoolRow({ ...pick, propMarketKey: "player_anytime_td", propSide: "No", propLine: 0.5 }, [first, anytime]), anytime);
  assert.equal(findExactPropPoolRow({ ...pick, propMarketKey: "player_anytime_td", propSide: "Over", propLine: 0.5 }, [anytime]), undefined);
});

test("simulation never invents NBA or borrows a sport from another pick", async () => {
  const { fetchPropSimulations } = await import("./api.ts");
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("unexpected request"); };
  try {
    const result = await fetchPropSimulations([{ isProp: true, player: "Unknown", propMarketKey: "player_points", propLine: 10.5, propSide: "Over", athleteId: "u" }], []);
    assert.equal(calls, 0);
    assert.equal(result.hits.size, 0);
  } finally { globalThis.fetch = original; }
});

test("indexed exact lookup preserves ambiguity, market and quote identity", async () => {
  const { createExactPropPoolLookup } = await import("./propPoolIdentity.ts");
  const pool = [row, { ...row, marketKey: "player_rush_yds" }, { ...row, eventId: "rematch" }, { ...row, sportsbook: "Book B", odds: 105 }];
  const lookup = createExactPropPoolLookup(pool);
  for (const query of [pick, { ...pick, eventId: undefined }, { ...pick, propMarketKey: "player_rush_yds" }, { ...pick, sportsbook: "Book B", odds: 105 }, { ...pick, sportsbook: "Book B", odds: 110 }]) {
    assert.equal(lookup(query), findExactPropPoolRow(query, pool));
  }
  assert.equal(lookup({ ...pick, propMarketKey: "unknown_market" }), undefined);
});


test("indexed lookup does not scan unrelated players and agrees with exact quote binding", async () => {
  const { createExactPropPoolLookup } = await import("./propPoolIdentity.ts");
  let inspected=0;
  const unrelated=Array.from({length:1000},(_,i)=>({...row,player:`Other ${i}`,get eventId(){inspected++;return "other";}}));
  const lookup=createExactPropPoolLookup([...unrelated,row]);
  assert.equal(lookup(pick),row);
  assert.equal(inspected,0,"unrelated event identities need no per-pick scan");
});

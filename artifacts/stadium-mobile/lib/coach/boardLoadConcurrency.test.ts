import assert from "node:assert/strict";
import test from "node:test";
import { loadScanInputs } from "./buildParlay.ts";

test("actual board loader starts props before live feed finishes and still waits for live data", async () => {
  const previous = globalThis.fetch;
  let releaseLive!: () => void;
  let propsStarted!: () => void;
  const livePending = new Promise<void>(resolve => { releaseLive = resolve; });
  const propsPending = new Promise<void>(resolve => { propsStarted = resolve; });
  const starts = new Date(Date.now() + 3_600_000).toISOString();
  const game = { id: "load-overlap", sport: "nba", homeTeam: "Home", awayTeam: "Away", homeTeamId: "1", awayTeamId: "2", commenceTime: starts, startsAt: starts, bookmakers: [] };
  let finished = false;
  globalThis.fetch = async input => {
    const url = String(input);
    let body: unknown;
    if (url.includes("/sports/live-odds?")) {
      await livePending;
      body = { games: [], odds: [] };
    } else if (url.includes("/sports/props?")) {
      propsStarted();
      body = {props: []};
    } else if (url.includes("/sports/games?") || url.includes("/sports/odds?")) {
      body = [game];
    } else throw new Error(`Unexpected request ${url}`);
    return new Response(JSON.stringify(body), {headers: {"content-type": "application/json"}});
  };
  let loading: ReturnType<typeof loadScanInputs> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    loading = loadScanInputs(new AbortController().signal, 2, "2 leg NBA").then(result => {finished = true; return result;});
    await Promise.race([
      propsPending,
      new Promise((_, reject) => {timer = setTimeout(() => reject(new Error("props waited for live feed")), 1000);}),
    ]);
    assert.equal(finished, false, "does not finalize without the live feed");
    releaseLive();
    const result = await loading;
    assert.equal(result.oddsGames.length, 1);
    assert.deepEqual(result.propPool, []);
  } finally {
    clearTimeout(timer);
    releaseLive();
    await loading;
    globalThis.fetch = previous;
  }
});

test("actual game-line-only board load makes zero player-prop calls", async () => {
  const previous = globalThis.fetch;
  let props = 0;
  const starts = new Date(Date.now() + 3_600_000).toISOString();
  globalThis.fetch = async input => {
    const url = String(input);
    if (url.includes("/sports/props?")) props++;
    const body = url.includes("/sports/live-odds?") ? {games: [], odds: []}
      : [{id: "game-only", sport: "nfl", homeTeam: "Home", awayTeam: "Away", commenceTime: starts, startsAt: starts, bookmakers: []}];
    return new Response(JSON.stringify(body), {headers: {"content-type": "application/json"}});
  };
  try {
    const result = await loadScanInputs(new AbortController().signal, 4, "4 leg NFL spreads and moneylines only");
    assert.equal(props, 0);
    assert.equal(result.oddsGames.length, 1, "team board survives the prop exclusion");
  } finally { globalThis.fetch = previous; }
});

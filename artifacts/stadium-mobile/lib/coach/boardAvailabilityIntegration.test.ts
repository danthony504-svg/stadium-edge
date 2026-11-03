import assert from "node:assert/strict";
import test from "node:test";
import { buildCoachParlay, loadScanInputs } from "./buildParlay.ts";
import { emptyCoachBoardReason, summarizeCoachBoard } from "../coachBoardAvailability.ts";
import { buildFinalCoachParlayNote } from "../boardScanPropDelivery.ts";
import { buildCoachReliabilityBody } from "../coachReliabilityReporter.ts";
import { mapScanFailureCode as serverMap, shouldAlertCoachEvent } from "../../../api-server/src/lib/coachReliabilitySanitize.ts";
import { mapScanFailureCode } from "../coachReliabilityClassify.ts";

const noteFor = (code: "NO_UPCOMING_ODDS" | "ODDS_BOARD_LOAD_FAILED") =>
  buildFinalCoachParlayNote({ target: 10, picks: [], propPoolSize: 0,
    propsPending: false, shortfallLead: "quality bar", failureReason: {code, detail: "private diagnostic"} });

// Exercise the real HTTP wrapper + board loader, not a duplicate of its filters.
for (const sport of ["nba", "wnba", "ncaab", "nfl", "ncaaf", "nhl", "mlb", "soccer", "tennis", "ufc"]) {
  test(`${sport}: started and distant quotes never seed a pregame ticket`, async () => {
    const previous = globalThis.fetch;
    const now = Date.now();
    let propCalls = 0;
    globalThis.fetch = async input => {
      const url = String(input);
      if (url.includes("/sports/props?")) propCalls++;
      const body = url.includes("/sports/live-odds?") ? { games: [], odds: [] }
        : url.includes("/sports/odds?") ? [-60_000, 0, 49 * 3600_000].map((offset, i) =>
          ({id: `event-${i}`, sport, homeTeam: "Home", awayTeam: "Away", commenceTime: new Date(now + offset).toISOString(), markets: []})) : [];
      return new Response(JSON.stringify(body), {headers: {"content-type": "application/json"}});
    };
    try {
      const inputs = await loadScanInputs(new AbortController().signal, 10, `10 leg ${sport}`);
      assert.equal(inputs.oddsGames.length, 0);
      assert.equal(propCalls, 0);
      assert.deepEqual(inputs.boardAvailability, {failedSports: 0, receivedGames: 3,
        startedGames: 2, outsideHorizonGames: 1, invalidStartGames: 0, pregameGames: 0});
      assert.equal(emptyCoachBoardReason(inputs.boardAvailability)?.code, "NO_UPCOMING_ODDS");
    } finally { globalThis.fetch = previous; }
  });
}

test("HTTP failure is distinct from a successful empty response; browsing stays resilient", async () => {
  const previous = globalThis.fetch;
  const { getOdds } = await import("../api.ts");
  globalThis.fetch = async input => String(input).includes("/sports/odds?")
    ? new Response("unavailable", { status: 403 })
    : new Response(JSON.stringify(String(input).includes("live-odds") ? {games: [], odds: []} : []));
  try {
    const inputs = await loadScanInputs(new AbortController().signal, 10, "10 leg NBA");
    assert.equal(inputs.boardAvailability.failedSports, 1);
    assert.equal(emptyCoachBoardReason(inputs.boardAvailability)?.code, "ODDS_BOARD_LOAD_FAILED");
    assert.deepEqual(await getOdds("nba"), []);
  } finally { globalThis.fetch = previous; }
});

test("successful empty board and invalid starts never invent a started-game diagnosis", () => {
  assert.equal(emptyCoachBoardReason(summarizeCoachBoard([], 0)), null);
  assert.equal(emptyCoachBoardReason(summarizeCoachBoard([{commenceTime: "bad"}], 0)), null);
});

test("a healthy upcoming board retains its scope and quality diagnoses despite another league failing", () => {
  const c = summarizeCoachBoard([{commenceTime: new Date(Date.now() + 3600_000).toISOString()}], 1);
  assert.equal(c.pregameGames, 1);
  assert.equal(emptyCoachBoardReason(c), null);
});

test("copy and client/server telemetry distinguish an expected pregame cutoff from a load failure", () => {
  assert.match(noteFor("NO_UPCOMING_ODDS"), /already started.*48 hours/);
  assert.match(noteFor("ODDS_BOARD_LOAD_FAILED"), /could not be loaded.*retry/);
  for (const code of ["NO_UPCOMING_ODDS", "ODDS_BOARD_LOAD_FAILED"]) {
    assert.doesNotMatch(noteFor(code as Parameters<typeof noteFor>[0]), /quality bar|private diagnostic/);
    assert.deepEqual(mapScanFailureCode(code), serverMap(code));
    const body = buildCoachReliabilityBody({requestedLegCount: 10, returnedLegCount: 0,
      picks: [], scanFailureCode: code, realOddsAvailable: false});
    assert.ok(body);
    assert.equal(body.scanFailureCode, code);
    const mapped = serverMap(code)!;
    assert.equal(shouldAlertCoachEvent({...body, ...mapped} as never), code === "ODDS_BOARD_LOAD_FAILED");
  }
});

test("cancelled loading propagates cancellation instead of declaring no odds", async () => {
  const prior = globalThis.fetch;
  const abort = new AbortController();
  abort.abort();
  globalThis.fetch = async () => new Response("[]");
  try { await assert.rejects(loadScanInputs(abort.signal, 10, "10 leg NBA"), /cancelled/); }
  finally { globalThis.fetch = prior; }
});

for (const failed of [false, true]) {
  test(`full ten-leg NBA builder: ${failed ? "failed fetch" : "started slate"} reaches the correct terminal result`, async () => {
    const previous = globalThis.fetch;
    let simulations = 0;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("simulate")) simulations++;
      if (url.includes("/sports/odds?") && failed) return new Response("denied", {status: 403});
      const body = url.includes("/sports/live-odds?") ? {games: [], odds: []}
        : url.includes("/sports/odds?") ? [{id: "started", sport: "nba", homeTeam: "Home", awayTeam: "Away",
          commenceTime: new Date(Date.now() - 60_000).toISOString(), markets: []}] : [];
      return new Response(JSON.stringify(body), {headers: {"content-type": "application/json"}});
    };
    try {
      const result = await buildCoachParlay({requestedLegs: 10, askText: "10 leg NBA", signal: new AbortController().signal});
      assert.equal(result.picks.length, 0);
      assert.equal(result.timedOut, false);
      assert.equal(result.scan?.failureReason?.code, failed ? "ODDS_BOARD_LOAD_FAILED" : "NO_UPCOMING_ODDS");
      assert.match(result.note, failed ? /could not be loaded/ : /already started/);
      assert.equal(simulations, 0);
    } finally { globalThis.fetch = previous; }
  });
}

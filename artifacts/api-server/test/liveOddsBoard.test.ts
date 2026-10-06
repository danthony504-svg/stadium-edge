/**
 * API-server pure helpers for live-odds board enrichment.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  espnPickcenterProviderLastUpdate,
  extractLiveGameStateFromEspnEvent,
} from "../src/lib/liveOddsBoard.ts";

test("extractLiveGameStateFromEspnEvent: surfaces period + clock for state=in", () => {
  const state = extractLiveGameStateFromEspnEvent({
    id: "401772001",
    date: "2026-10-06T00:00:00Z",
    competitions: [
      {
        status: {
          displayClock: "4:21",
          period: 3,
          type: { state: "in", shortDetail: "3rd Qtr" },
        },
        competitors: [
          { homeAway: "away", score: "88", team: { displayName: "Boston Celtics" } },
          { homeAway: "home", score: "92", team: { displayName: "New York Knicks" } },
        ],
      },
    ],
  });
  assert.ok(state);
  assert.equal(state!.eventId, "401772001");
  assert.equal(state!.awayScore, 88);
  assert.equal(state!.homeScore, 92);
  assert.equal(state!.period, 3);
  assert.equal(state!.periodLabel, "3rd Qtr");
  assert.equal(state!.clock, "4:21");
  assert.equal(state!.state, "in");
});

test("extractLiveGameStateFromEspnEvent: missing clock stays null (never invents)", () => {
  const state = extractLiveGameStateFromEspnEvent({
    id: "1",
    competitions: [
      {
        status: {
          displayClock: undefined,
          period: 1,
          type: { state: "in", shortDetail: "Bot 3rd" },
        },
        competitors: [
          { homeAway: "away", score: "2", team: { displayName: "A" } },
          { homeAway: "home", score: "1", team: { displayName: "B" } },
        ],
      },
    ],
  });
  assert.equal(state!.clock, null);
  assert.equal(state!.periodLabel, "Bot 3rd");
});

test("extractLiveGameStateFromEspnEvent: ignores pre/post", () => {
  assert.equal(
    extractLiveGameStateFromEspnEvent({
      id: "1",
      competitions: [
        {
          status: { type: { state: "pre" } },
          competitors: [
            { homeAway: "away", team: { displayName: "A" } },
            { homeAway: "home", team: { displayName: "B" } },
          ],
        },
      ],
    }),
    null,
  );
});

test("espnPickcenterProviderLastUpdate: never fabricates a timestamp", () => {
  assert.equal(espnPickcenterProviderLastUpdate({ pickcenter: [{}] }), null);
  assert.equal(espnPickcenterProviderLastUpdate(null), null);
});

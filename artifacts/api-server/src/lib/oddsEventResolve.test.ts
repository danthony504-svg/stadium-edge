import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveOddsEvent, type OddsEventRow } from "./oddsEventResolve.ts";

const tigersRangers: OddsEventRow[] = [
  {
    id: "aaa11111111111111111111111111111",
    home_team: "Texas Rangers",
    away_team: "Detroit Tigers",
    commence_time: "2026-07-04T20:05:00Z",
  },
  {
    id: "bbb22222222222222222222222222222",
    home_team: "Texas Rangers",
    away_team: "Detroit Tigers",
    commence_time: "2026-07-05T19:30:00Z",
  },
];

test("resolveOddsEvent disambiguates duplicate matchups by startsAt", () => {
  const july4 = resolveOddsEvent(tigersRangers, {
    eventId: "401816020",
    homeName: "Texas Rangers",
    awayName: "Detroit Tigers",
    startsAt: "2026-07-04T20:05Z",
  });
  assert.equal(july4?.id, "aaa11111111111111111111111111111");

  const july5 = resolveOddsEvent(tigersRangers, {
    eventId: "401816035",
    homeName: "Texas Rangers",
    awayName: "Detroit Tigers",
    startsAt: "2026-07-05T19:30Z",
  });
  assert.equal(july5?.id, "bbb22222222222222222222222222222");
});

test("resolveOddsEvent returns null when duplicate matchups lack startsAt", () => {
  const r = resolveOddsEvent(tigersRangers, {
    eventId: "401816020",
    homeName: "Texas Rangers",
    awayName: "Detroit Tigers",
  });
  assert.equal(r, null);
});

test("resolveOddsEvent accepts a real Odds API id directly", () => {
  const r = resolveOddsEvent(tigersRangers, {
    eventId: "aaa11111111111111111111111111111",
    homeName: "Texas Rangers",
    awayName: "Detroit Tigers",
  });
  assert.equal(r?.id, "aaa11111111111111111111111111111");
});

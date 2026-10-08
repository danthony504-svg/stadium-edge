import assert from "node:assert/strict";
import { test } from "node:test";

import type { ParsedPick } from "../components/PickCard.tsx";
import {
  filterPicksForOddsIntegrity,
  type OddsIntegrityPropsResponse,
} from "./coachTicketOddsIntegrity.ts";

const NOW = Date.parse("2026-10-08T12:00:00.000Z");

function propPick(overrides: Partial<ParsedPick> = {}): ParsedPick {
  return {
    game: "Tampa Bay Buccaneers @ Dallas Cowboys",
    market: "Rush Yds",
    pick: "Javonte Williams Under 69.5 Rush Yds",
    odds: -110,
    sport: "nfl",
    isProp: true,
    player: "Javonte Williams",
    propLine: 69.5,
    propSide: "Under",
    propMarketKey: "player_rush_yds",
    eventId: "evt-tb-dal",
    sportsbook: "DraftKings",
    oddsFetchedAt: new Date(NOW - 60_000).toISOString(),
    oddsProvider: "OddsAPI",
    ...overrides,
  };
}

test("T3: provider outage on revalidate drops prop + note; no invented odds", async () => {
  const stale = propPick({
    oddsFetchedAt: new Date(NOW - 20 * 60_000).toISOString(),
  });

  const emptyFetch = async (): Promise<OddsIntegrityPropsResponse> => ({
    home: "Dallas Cowboys",
    away: "Tampa Bay Buccaneers",
    bookmaker: null,
    props: [],
    provider: "OddsAPI",
    eventId: "evt-tb-dal",
    fetchedAt: new Date(NOW).toISOString(),
    providerLastUpdate: null,
  });

  const result = await filterPicksForOddsIntegrity([stale], {
    nowMs: NOW,
    revalidate: true,
    fetchProps: emptyFetch,
  });
  assert.equal(result.picks.length, 0);
  assert.equal(result.droppedProviderOutage, 1);
  assert.match(result.note, /provider props were unavailable/i);
});

test("T3b: successful revalidate refreshes price without inventing books", async () => {
  const stale = propPick({
    oddsFetchedAt: new Date(NOW - 20 * 60_000).toISOString(),
    odds: -110,
  });
  const refresh = async (): Promise<OddsIntegrityPropsResponse> => ({
    home: "Dallas Cowboys",
    away: "Tampa Bay Buccaneers",
    bookmaker: "FanDuel",
    props: [
      {
        player: "Javonte Williams",
        market: "player_rush_yds",
        line: 69.5,
        overPrice: -105,
        underPrice: -115,
        overBook: "FanDuel",
        underBook: "FanDuel",
        position: "RB",
      },
    ],
    provider: "OddsAPI",
    eventId: "evt-tb-dal",
    fetchedAt: new Date(NOW - 30_000).toISOString(),
    providerLastUpdate: new Date(NOW - 20_000).toISOString(),
  });

  const result = await filterPicksForOddsIntegrity([stale], {
    nowMs: NOW,
    revalidate: true,
    fetchProps: refresh,
  });
  assert.equal(result.revalidated, 1);
  assert.equal(result.picks.length, 1);
  assert.equal(result.picks[0]!.odds, -115);
  assert.equal(result.picks[0]!.sportsbook, "FanDuel");
  assert.ok(result.picks[0]!.oddsFetchedAt);
});

test("fresh verified prop passes integrity filter", async () => {
  const fresh = propPick();
  const result = await filterPicksForOddsIntegrity([fresh], {
    nowMs: NOW,
    revalidate: false,
  });
  assert.equal(result.picks.length, 1);
  assert.equal(result.droppedStale, 0);
  assert.equal(result.droppedUnverifiable, 0);
});

test("unverifiable game line missing sportsbook is dropped", async () => {
  const gl: ParsedPick = {
    game: "Tampa Bay Buccaneers @ Dallas Cowboys",
    market: "Spread",
    pick: "Cowboys -8.5",
    odds: -105,
    sport: "nfl",
    isProp: false,
    eventId: "evt-tb-dal",
    sportsbook: null,
    oddsFetchedAt: new Date(NOW - 60_000).toISOString(),
  };
  const result = await filterPicksForOddsIntegrity([gl], {
    nowMs: NOW,
    revalidate: false,
  });
  assert.equal(result.picks.length, 0);
  assert.equal(result.droppedUnverifiable, 1);
});

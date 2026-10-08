import assert from "node:assert/strict";
import { test } from "node:test";

import {
  COACH_PREGAME_ODDS_STALE_AFTER_MS,
  classifyCoachOddsFreshness,
  legOddsSnapshotIsDeliverable,
} from "./coachOddsFreshness.ts";

const NOW = Date.parse("2026-10-08T12:00:00.000Z");

test("T1: missing fetchedAt/eventId/sportsbook → not deliverable", () => {
  const missingFetch = legOddsSnapshotIsDeliverable(
    {
      eventId: "evt1",
      sportsbook: "DraftKings",
      odds: -110,
      oddsFetchedAt: null,
      isProp: true,
      propLine: 69.5,
      propSide: "Under",
    },
    { nowMs: NOW },
  );
  assert.equal(missingFetch.ok, false);
  assert.equal(missingFetch.reason, "unknown_freshness");

  const missingEvent = legOddsSnapshotIsDeliverable(
    {
      eventId: "",
      sportsbook: "DraftKings",
      odds: -110,
      oddsFetchedAt: new Date(NOW - 60_000).toISOString(),
      isProp: true,
      propLine: 69.5,
      propSide: "Under",
    },
    { nowMs: NOW },
  );
  assert.equal(missingEvent.ok, false);
  assert.equal(missingEvent.reason, "missing_event_id");

  const missingBook = legOddsSnapshotIsDeliverable(
    {
      eventId: "evt1",
      sportsbook: null,
      odds: -110,
      oddsFetchedAt: new Date(NOW - 60_000).toISOString(),
      isProp: true,
      propLine: 69.5,
      propSide: "Under",
    },
    { nowMs: NOW },
  );
  assert.equal(missingBook.ok, false);
  assert.equal(missingBook.reason, "missing_sportsbook");
});

test("T2: fetchedAt older than 10 min → stale", () => {
  const staleAt = new Date(NOW - COACH_PREGAME_ODDS_STALE_AFTER_MS - 1).toISOString();
  const freshness = classifyCoachOddsFreshness({
    fetchedAt: staleAt,
    nowMs: NOW,
  });
  assert.equal(freshness.status, "stale");
  assert.equal(freshness.ageSource, "fetchedAt");

  const check = legOddsSnapshotIsDeliverable(
    {
      eventId: "tb-dal",
      sportsbook: "FanDuel",
      odds: -110,
      oddsFetchedAt: staleAt,
      isProp: true,
      propLine: 69.5,
      propSide: "Under",
      market: "Rush Yds",
    },
    { nowMs: NOW },
  );
  assert.equal(check.ok, false);
  assert.equal(check.reason, "stale_odds");
});

test("fresh snapshot within TTL is deliverable", () => {
  const check = legOddsSnapshotIsDeliverable(
    {
      eventId: "tb-dal",
      sportsbook: "FanDuel",
      odds: -110,
      oddsFetchedAt: new Date(NOW - 2 * 60_000).toISOString(),
      isProp: true,
      propLine: 69.5,
      propSide: "Under",
    },
    { nowMs: NOW },
  );
  assert.equal(check.ok, true);
  assert.equal(check.freshness.status, "fresh");
});

test("providerLastUpdate preferred over fetchedAt for age", () => {
  const freshness = classifyCoachOddsFreshness({
    providerLastUpdate: new Date(NOW - 30_000).toISOString(),
    fetchedAt: new Date(NOW - COACH_PREGAME_ODDS_STALE_AFTER_MS - 5_000).toISOString(),
    nowMs: NOW,
  });
  assert.equal(freshness.status, "fresh");
  assert.equal(freshness.ageSource, "providerLastUpdate");
});

test("TTL constant is 10 minutes", () => {
  assert.equal(COACH_PREGAME_ODDS_STALE_AFTER_MS, 10 * 60 * 1000);
});

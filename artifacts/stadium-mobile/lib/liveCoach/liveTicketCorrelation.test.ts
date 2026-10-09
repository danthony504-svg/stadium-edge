/**
 * Live Coach same-event correlation + intent count for "N leg SPORT live".
 * Run: node --import ./test/register-hooks.mjs --test lib/liveCoach/liveTicketCorrelation.test.ts
 */

import assert from "node:assert/strict";
import test from "node:test";

import { parseLiveCoachIntent } from "./liveCoachIntent.ts";
import {
  liveCandidateConflictsTicket,
  livePicksConflictSameEvent,
  liveSideTeamKey,
} from "./liveTicketCorrelation.ts";
import { buildLiveCoachRecommendations } from "./buildLiveCoach.ts";
import type { LiveOddsFeed } from "../api.ts";

test("intent: 5 leg NFL live → count 5 (not default 3)", () => {
  const i = parseLiveCoachIntent("5 leg NFL live");
  assert.equal(i.wantsLive, true);
  assert.equal(i.sport, "nfl");
  assert.equal(i.count, 5);
});

test("intent: 5 legs NBA live / 8 leg NHL live → explicit counts", () => {
  assert.equal(parseLiveCoachIntent("5 legs NBA live").count, 5);
  assert.equal(parseLiveCoachIntent("8 leg NHL live").count, 8);
  assert.equal(parseLiveCoachIntent("5 leg live NFL").count, 5);
});

test("liveSideTeamKey extracts ML and spread team tokens", () => {
  assert.equal(liveSideTeamKey("Buccaneers ML", "Moneyline"), "buccaneers");
  assert.equal(liveSideTeamKey("Buccaneers +8.5", "Spread"), "buccaneers");
  assert.equal(liveSideTeamKey("Under 49.5", "Total"), null);
});

test("same-team ML + spread on one event conflicts", () => {
  assert.equal(
    livePicksConflictSameEvent(
      { eventId: "e1", market: "Moneyline", pick: "Buccaneers ML" },
      { eventId: "e1", market: "Spread", pick: "Buccaneers +8.5" },
    ),
    true,
  );
});

test("ML + total on one event does not conflict", () => {
  assert.equal(
    livePicksConflictSameEvent(
      { eventId: "e1", market: "Moneyline", pick: "Buccaneers ML" },
      { eventId: "e1", market: "Total", pick: "Under 49.5" },
    ),
    false,
  );
});

test("opposite moneylines on one event conflict", () => {
  assert.equal(
    livePicksConflictSameEvent(
      { eventId: "e1", market: "Moneyline", pick: "Buccaneers ML" },
      { eventId: "e1", market: "Moneyline", pick: "Cowboys ML" },
    ),
    true,
  );
});

test("distinct events never conflict", () => {
  assert.equal(
    livePicksConflictSameEvent(
      { eventId: "e1", market: "Moneyline", pick: "Buccaneers ML" },
      { eventId: "e2", market: "Moneyline", pick: "Nets ML" },
    ),
    false,
  );
});

function tnfFeed(now = new Date().toISOString()): LiveOddsFeed {
  return {
    games: [
      {
        sport: "nfl",
        game: "Tampa Bay Buccaneers @ Dallas Cowboys",
        status: "in",
        state: "in",
        awayTeam: "Tampa Bay Buccaneers",
        homeTeam: "Dallas Cowboys",
        awayScore: 7,
        homeScore: 10,
        period: 2,
        periodLabel: "2nd Quarter",
        clock: "8:30",
        eventId: "401872980",
        source: "espn_pickcenter",
        fetchedAt: now,
        startsAt: now,
      },
    ],
    odds: [
      {
        sport: "nfl",
        game: "Tampa Bay Buccaneers @ Dallas Cowboys",
        live: true,
        eventId: "401872980",
        awayTeam: "Tampa Bay Buccaneers",
        homeTeam: "Dallas Cowboys",
        awayScore: 7,
        homeScore: 10,
        state: "in",
        period: 2,
        periodLabel: "2nd Quarter",
        clock: "8:30",
        source: "espn_pickcenter",
        fetchedAt: now,
        providerLastUpdate: null,
        marketStatus: "open",
        market: "Moneyline",
        pick: "Buccaneers ML",
        odds: 380,
        line: null,
      },
      {
        sport: "nfl",
        game: "Tampa Bay Buccaneers @ Dallas Cowboys",
        live: true,
        eventId: "401872980",
        awayTeam: "Tampa Bay Buccaneers",
        homeTeam: "Dallas Cowboys",
        awayScore: 7,
        homeScore: 10,
        state: "in",
        period: 2,
        periodLabel: "2nd Quarter",
        clock: "8:30",
        source: "espn_pickcenter",
        fetchedAt: now,
        providerLastUpdate: null,
        marketStatus: "open",
        market: "Moneyline",
        pick: "Cowboys ML",
        odds: -500,
        line: null,
      },
      {
        sport: "nfl",
        game: "Tampa Bay Buccaneers @ Dallas Cowboys",
        live: true,
        eventId: "401872980",
        awayTeam: "Tampa Bay Buccaneers",
        homeTeam: "Dallas Cowboys",
        awayScore: 7,
        homeScore: 10,
        state: "in",
        period: 2,
        periodLabel: "2nd Quarter",
        clock: "8:30",
        source: "espn_pickcenter",
        fetchedAt: now,
        providerLastUpdate: null,
        marketStatus: "open",
        market: "Spread",
        pick: "Buccaneers +8.5",
        odds: -102,
        line: 8.5,
      },
      {
        sport: "nfl",
        game: "Tampa Bay Buccaneers @ Dallas Cowboys",
        live: true,
        eventId: "401872980",
        awayTeam: "Tampa Bay Buccaneers",
        homeTeam: "Dallas Cowboys",
        awayScore: 7,
        homeScore: 10,
        state: "in",
        period: 2,
        periodLabel: "2nd Quarter",
        clock: "8:30",
        source: "espn_pickcenter",
        fetchedAt: now,
        providerLastUpdate: null,
        marketStatus: "open",
        market: "Spread",
        pick: "Cowboys -8.5",
        odds: -118,
        line: -8.5,
      },
      {
        sport: "nfl",
        game: "Tampa Bay Buccaneers @ Dallas Cowboys",
        live: true,
        eventId: "401872980",
        awayTeam: "Tampa Bay Buccaneers",
        homeTeam: "Dallas Cowboys",
        awayScore: 7,
        homeScore: 10,
        state: "in",
        period: 2,
        periodLabel: "2nd Quarter",
        clock: "8:30",
        source: "espn_pickcenter",
        fetchedAt: now,
        providerLastUpdate: null,
        marketStatus: "open",
        market: "Total",
        pick: "Under 49.5",
        odds: -110,
        line: 49.5,
      },
      {
        sport: "nfl",
        game: "Tampa Bay Buccaneers @ Dallas Cowboys",
        live: true,
        eventId: "401872980",
        awayTeam: "Tampa Bay Buccaneers",
        homeTeam: "Dallas Cowboys",
        awayScore: 7,
        homeScore: 10,
        state: "in",
        period: 2,
        periodLabel: "2nd Quarter",
        clock: "8:30",
        source: "espn_pickcenter",
        fetchedAt: now,
        providerLastUpdate: null,
        marketStatus: "open",
        market: "Total",
        pick: "Over 49.5",
        odds: -110,
        line: 49.5,
      },
    ],
    fetchedAt: now,
  } as LiveOddsFeed;
}

test("5 leg NFL live on single TNF board: intent 5, no same-team ML+spread stack", async () => {
  const result = await buildLiveCoachRecommendations({
    askText: "5 leg NFL live",
    feed: tnfFeed(),
    seed: 42,
  });
  assert.equal(result.intent.count, 5);
  assert.ok(result.picks.length <= 2, `expected ≤2 non-overlapping seats, got ${result.picks.length}`);
  const ml = result.picks.find((p) => /ML/i.test(p.pick));
  const spread = result.picks.find((p) => p.market === "Spread");
  if (ml && spread) {
    const teamMl = liveSideTeamKey(ml.pick, ml.market);
    const teamSp = liveSideTeamKey(spread.pick, spread.market);
    assert.notEqual(teamMl, teamSp, "must not seat same-team ML+spread");
  }
  // Ticket-level conflict check
  const rows = result.picks.map((p) => ({
    eventId: p.liveCoach!.eventId,
    market: p.market,
    pick: p.pick,
  }));
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      assert.equal(
        livePicksConflictSameEvent(rows[i]!, rows[j]!),
        false,
        `conflict ${rows[i]!.pick} vs ${rows[j]!.pick}`,
      );
    }
  }
  assert.ok(
    /found \d+ of 5/i.test(result.note) || result.picks.length === 5,
    `expected honest shortfall note, got: ${result.note}`,
  );
});

test("liveCandidateConflictsTicket catches Bucs ML then Bucs spread", () => {
  const ticket = [{ eventId: "e1", market: "Moneyline", pick: "Buccaneers ML" }];
  assert.equal(
    liveCandidateConflictsTicket(ticket, {
      eventId: "e1",
      market: "Spread",
      pick: "Buccaneers +8.5",
    }),
    true,
  );
  assert.equal(
    liveCandidateConflictsTicket(ticket, {
      eventId: "e1",
      market: "Total",
      pick: "Under 49.5",
    }),
    false,
  );
});

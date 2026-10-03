import assert from "node:assert/strict";
import test from "node:test";
import {
  blendPeriodExpected,
  buildPeriodOffenseDefenseProfile,
} from "./gameSimScoring.ts";
import { teamTotalOffenseDefenseLean } from "./teamTotalMatchup.ts";
import type { MatchupHistoryEntry } from "./api.ts";
import {
  boardScanTeamTotalSlotCount,
  fillReservedTeamTotalSlots,
  isCollegeTeamTotalPick,
} from "./boardScanPropDelivery.ts";
import {
  balancedMixSlots,
  COLLEGE_FOOTBALL_BALANCED_MIX_FRACTIONS,
  FOOTBALL_BALANCED_MIX_FRACTIONS,
} from "./balancedTicketMix.ts";

test("teamTotalOffenseDefenseLean uses offense vs opponent points allowed", () => {
  const entry = {
    home: { ptsFor: 32, ptsAgainst: 18, avgMargin: 10 },
    away: { ptsFor: 14, ptsAgainst: 28, avgMargin: -8 },
    homePace: null,
    awayPace: null,
    homeVenueForm: null,
    awayVenueForm: null,
    homeStreak: null,
    awayStreak: null,
    homeSeason: null,
    awaySeason: null,
    homeRest: null,
    awayRest: null,
    h2h: null,
    lastMeeting: null,
    mlLean: null,
  } as MatchupHistoryEntry;

  const overLean = teamTotalOffenseDefenseLean(
    entry,
    "home",
    "Minnesota Golden Gophers Over 20.5",
    "Iowa Hawkeyes",
    "Minnesota Golden Gophers",
  );
  assert.ok(overLean);
  assert.match(overLean!.side, /Minnesota/);
  assert.ok(overLean!.edge > 0);

  const underLean = teamTotalOffenseDefenseLean(
    entry,
    "away",
    "Iowa Hawkeyes Under 17.5",
    "Iowa Hawkeyes",
    "Minnesota Golden Gophers",
  );
  // Iowa expected ≈ (14+18)/2 = 16 → Under 17.5 aligns.
  assert.ok(underLean);
  assert.match(underLean!.side, /Iowa/);
});

test("blendPeriodExpected / period profile require real averages", () => {
  assert.equal(blendPeriodExpected(7.2, 6.8), 7);
  assert.equal(blendPeriodExpected(null, 6.8), null);
  const profile = buildPeriodOffenseDefenseProfile(
    { q1: { scored: 7, allowed: 5 }, h1: { scored: 14, allowed: 10 } },
    { q1: { scored: 5, allowed: 8 }, h1: { scored: 11, allowed: 16 } },
  );
  assert.ok(profile);
  assert.equal(profile!.homeByPeriod.q1, 7.5); // (7+8)/2
  assert.equal(profile!.awayByPeriod.q1, 5); // (5+5)/2
  assert.equal(buildPeriodOffenseDefenseProfile(null, null), null);
});

test("college mix floors team-total seats and keeps props at 0; NFL still budgets props", () => {
  const nfl = balancedMixSlots(7, FOOTBALL_BALANCED_MIX_FRACTIONS);
  const college = balancedMixSlots(7, COLLEGE_FOOTBALL_BALANCED_MIX_FRACTIONS, {
    floorTeamTotals: true,
  });
  assert.equal(college.props, 0, `college props should be 0, got ${college.props}`);
  assert.ok(college.teamTotals >= 1, `college teamTotals=${college.teamTotals}`);
  assert.ok(college.alternateLines >= 1);
  assert.ok(nfl.props >= 1, `nfl props=${nfl.props}`);
  assert.equal(
    nfl.props + nfl.gameLines + nfl.teamTotals + nfl.alternateLines,
    7,
  );
  assert.equal(
    college.props + college.gameLines + college.teamTotals + college.alternateLines,
    7,
  );
});

test("fillReservedTeamTotalSlots swaps FG spreads for posted team totals", () => {
  assert.equal(boardScanTeamTotalSlotCount(7), 1);
  assert.equal(isCollegeTeamTotalPick({ market: "Team Total" }), true);
  assert.equal(isCollegeTeamTotalPick({ market: "Alt Team Total" }), true);
  assert.equal(isCollegeTeamTotalPick({ market: "Spread" }), false);

  const g1 = "Iowa Hawkeyes @ Minnesota Golden Gophers";
  const g2 = "Duke Blue Devils @ Virginia Cavaliers";
  type P = {
    game: string;
    market: string;
    pick: string;
    odds: number;
    isProp?: boolean;
    sport?: string;
    finalAiScore?: { composite: number };
  };
  const ticket: P[] = [
    {
      game: g1,
      market: "Spread",
      pick: "Iowa Hawkeyes +14.5",
      odds: -110,
      sport: "ncaaf",
      finalAiScore: { composite: 6 },
    },
    {
      game: g2,
      market: "Spread",
      pick: "Duke Blue Devils +3.5",
      odds: -110,
      sport: "ncaaf",
      finalAiScore: { composite: 5.5 },
    },
    {
      game: "A @ B",
      market: "Spread",
      pick: "A +7.5",
      odds: -110,
      sport: "ncaaf",
      finalAiScore: { composite: 5 },
    },
    {
      game: "C @ D",
      market: "Spread",
      pick: "C +1.5",
      odds: -110,
      sport: "ncaaf",
      finalAiScore: { composite: 4.5 },
    },
    {
      game: "E @ F",
      market: "Spread",
      pick: "E +3.5",
      odds: -110,
      sport: "ncaaf",
      finalAiScore: { composite: 4 },
    },
    {
      game: "G @ H",
      market: "Spread",
      pick: "G +6.5",
      odds: -110,
      sport: "ncaaf",
      finalAiScore: { composite: 3.5 },
    },
    {
      game: "I @ J",
      market: "Spread",
      pick: "I +2.5",
      odds: -110,
      sport: "ncaaf",
      finalAiScore: { composite: 3 },
    },
  ];
  const scored = [
    ...ticket.map((pick, i) => ({ pick, rankScore: 100 - i })),
    {
      pick: {
        game: g1,
        market: "Team Total",
        pick: "Minnesota Golden Gophers Over 24.5",
        odds: -105,
        sport: "ncaaf",
        finalAiScore: { composite: 8 },
      },
      rankScore: 99,
    },
  ];
  const out = fillReservedTeamTotalSlots(ticket, scored, 7, 4);
  assert.ok(
    out.some((p) => /team total/i.test(p.market)),
    `expected a team total seat, got ${out.map((p) => p.market).join(",")}`,
  );
});

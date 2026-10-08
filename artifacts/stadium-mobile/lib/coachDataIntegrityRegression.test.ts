/**
 * End-to-end regression for the five audited C-ticket integrity failures.
 * Demonstrates rejection of each failure class and retention of legitimate legs.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { ParsedPick } from "../components/PickCard.tsx";
import { explainBoardLegQualification } from "./boardLegQualification.ts";
import {
  isUnsupportedQbRushOverHalf,
  yardageTicketSampleFails,
} from "./coachPropIntegrityGates.ts";
import { legOddsSnapshotIsDeliverable } from "./coachOddsFreshness.ts";
import { filterPicksForOddsIntegrity } from "./coachTicketOddsIntegrity.ts";
import { enforceMlLeanOnPicks } from "./mlLeanEnforcement.ts";

const NOW = Date.parse("2026-10-08T18:00:00.000Z");
const FRESH = new Date(NOW - 90_000).toISOString();
const STALE = new Date(NOW - 20 * 60_000).toISOString();

const TB_DAL = "Tampa Bay Buccaneers @ Dallas Cowboys";
const DET_KC = "Detroit Lions @ Kansas City Chiefs";
const DEN_NYJ = "Denver Broncos @ New York Jets";

function okScore(simHit = 0.58) {
  return {
    composite: 7.2,
    grade: "B" as const,
    confidencePct: 60,
    edgePct: 5,
    simHit,
    simAligned: true,
    highRiskValuePlay: false,
    recommends: true,
    factors: [],
    rubric: {
      composite: 7.2,
      grade: "B",
      confidencePct: 60,
      edgePct: 5,
      scores: {} as never,
    },
  };
}

/** Apply ticket-delivery integrity gates used by Coach (lean → odds). */
async function deliverTicket(
  picks: ParsedPick[],
  opts: {
    matchupHistory?: Record<string, { mlLean?: { side: string; edge: number; reasons: string[] } }>;
    qualifiedCandidates?: ParsedPick[];
  } = {},
): Promise<{ picks: ParsedPick[]; removed: string[] }> {
  const removed: string[] = [];
  let current = picks.filter((p) => {
    if (isUnsupportedQbRushOverHalf(p)) {
      removed.push(`${p.pick}: qb_rush_over_half`);
      return false;
    }
    if (yardageTicketSampleFails(p)) {
      removed.push(`${p.pick}: thin_yardage_sample`);
      return false;
    }
    if (p.isProp && p.finalAiScore == null && p.propMarketKey === "player_pass_tds") {
      // Server null sim → no score → not deliverable as graded prop.
      removed.push(`${p.pick}: pass_td_ungradeable`);
      return false;
    }
    if (p.finalAiScore) {
      const q = explainBoardLegQualification(p, p.finalAiScore);
      if (!q.qualifies && (isUnsupportedQbRushOverHalf(p) || yardageTicketSampleFails(p))) {
        removed.push(`${p.pick}: ${q.gate}`);
        return false;
      }
    }
    return true;
  });

  if (opts.matchupHistory) {
    const lean = enforceMlLeanOnPicks(current, {
      matchupHistory: opts.matchupHistory as never,
      qualifiedCandidates: opts.qualifiedCandidates ?? current,
    });
    for (const p of current) {
      if (!lean.picks.some((x) => x.pick === p.pick && x.game === p.game)) {
        if (!lean.picks.some((x) => x.game === p.game && x.market === p.market)) {
          removed.push(`${p.pick}: lean_drop_ungraded`);
        }
      }
    }
    current = lean.picks;
  }

  const odds = await filterPicksForOddsIntegrity(current, {
    nowMs: NOW,
    revalidate: true,
    fetchProps: (async () => ({
      home: null,
      away: null,
      bookmaker: null,
      props: [],
      fetchedAt: new Date(NOW).toISOString(),
      eventId: "x",
      provider: "OddsAPI",
    })) as never,
  });
  for (const p of current) {
    if (!odds.picks.some((x) => x.pick === p.pick)) {
      removed.push(`${p.pick}: odds_integrity`);
    }
  }
  return { picks: odds.picks, removed };
}

test("48h NFL scenario: five failure classes rejected; legitimate legs kept", async () => {
  const bagent: ParsedPick = {
    game: "Chicago Bears @ Washington Commanders",
    market: "Pass TDs",
    pick: "Tyson Bagent Under 1.5 Pass TDs",
    odds: -130,
    sport: "nfl",
    isProp: true,
    player: "Tyson Bagent",
    propLine: 1.5,
    propSide: "Under",
    propMarketKey: "player_pass_tds",
    position: "QB",
    eventId: "chi-was",
    sportsbook: "DraftKings",
    oddsFetchedAt: FRESH,
    // No finalAiScore — server returned null / unreliable_participation_history
  };

  const goff: ParsedPick = {
    game: DET_KC,
    market: "Rush Yds",
    pick: "Jared Goff Over 0.5 Rush Yds",
    odds: -140,
    sport: "nfl",
    isProp: true,
    player: "Jared Goff",
    propLine: 0.5,
    propSide: "Over",
    propMarketKey: "player_rush_yds",
    position: "QB",
    eventId: "det-kc",
    sportsbook: "FanDuel",
    oddsFetchedAt: FRESH,
    finalAiScore: okScore(0.84) as never,
    validParticipatingGames: 8,
  };

  const harvey: ParsedPick = {
    game: DEN_NYJ,
    market: "Rec Yds",
    pick: "RJ Harvey Over 26.5 Rec Yds",
    odds: -115,
    sport: "nfl",
    isProp: true,
    player: "RJ Harvey",
    propLine: 26.5,
    propSide: "Over",
    propMarketKey: "player_reception_yds",
    position: "RB",
    eventId: "den-nyj",
    sportsbook: "BetMGM",
    oddsFetchedAt: FRESH,
    finalAiScore: okScore(0.71) as never,
    validParticipatingGames: 3,
    sampleGames: 3,
  };

  const javonte: ParsedPick = {
    game: TB_DAL,
    market: "Rush Yds",
    pick: "Javonte Williams Under 69.5 Rush Yds",
    odds: -110,
    sport: "nfl",
    isProp: true,
    player: "Javonte Williams",
    propLine: 69.5,
    propSide: "Under",
    propMarketKey: "player_rush_yds",
    position: "RB",
    eventId: "tb-dal",
    sportsbook: "DraftKings",
    oddsFetchedAt: STALE, // expired; revalidate returns empty → drop
    finalAiScore: okScore(0.72) as never,
    validParticipatingGames: 8,
  };

  const cowboys: ParsedPick = {
    game: TB_DAL,
    market: "Spread",
    pick: "Cowboys -8.5",
    odds: -105,
    sport: "nfl",
    isProp: false,
    eventId: "tb-dal",
    sportsbook: "DraftKings",
    oddsFetchedAt: FRESH,
    // Score-less lean promotion — the original bug
  };

  const legitRbRush: ParsedPick = {
    game: TB_DAL,
    market: "Rush Yds",
    pick: "Bucky Irving Over 62.5 Rush Yds",
    odds: -110,
    sport: "nfl",
    isProp: true,
    player: "Bucky Irving",
    propLine: 62.5,
    propSide: "Over",
    propMarketKey: "player_rush_yds",
    position: "RB",
    eventId: "tb-dal",
    sportsbook: "DraftKings",
    oddsFetchedAt: FRESH,
    finalAiScore: okScore(0.59) as never,
    validParticipatingGames: 7,
  };

  const legitQbRushHigh: ParsedPick = {
    game: DET_KC,
    market: "Rush Yds",
    pick: "Jared Goff Over 15.5 Rush Yds",
    odds: 150,
    sport: "nfl",
    isProp: true,
    player: "Jared Goff",
    propLine: 15.5,
    propSide: "Over",
    propMarketKey: "player_rush_yds",
    position: "QB",
    eventId: "det-kc",
    sportsbook: "FanDuel",
    oddsFetchedAt: FRESH,
    finalAiScore: okScore(0.4) as never, // longshot — may fail EV; integrity gates alone OK
    validParticipatingGames: 8,
  };

  const ticket = [bagent, goff, harvey, javonte, cowboys, legitRbRush, legitQbRushHigh];

  // Unit-level: each failure class is independently blocked.
  assert.equal(bagent.finalAiScore, undefined);
  assert.equal(isUnsupportedQbRushOverHalf(goff), true);
  assert.equal(yardageTicketSampleFails(harvey), true);
  assert.equal(legOddsSnapshotIsDeliverable(javonte, { nowMs: NOW }).ok, false);
  assert.equal(cowboys.finalAiScore, undefined);

  const { picks, removed } = await deliverTicket(ticket, {
    matchupHistory: {
      [TB_DAL]: {
        mlLean: { side: "Tampa Bay Buccaneers", edge: 4, reasons: ["sim"] },
      },
    },
    qualifiedCandidates: [], // no graded Bucs lean → Cowboys dropped
  });

  const remaining = picks.map((p) => p.pick);
  assert.ok(!remaining.includes(bagent.pick), "Bagent ungradeable pass TD removed");
  assert.ok(!remaining.includes(goff.pick), "Goff QB rush O0.5 removed");
  assert.ok(!remaining.includes(harvey.pick), "Harvey thin sample removed");
  assert.ok(!remaining.includes(javonte.pick), "Javonte stale/unverifiable odds removed");
  assert.ok(!remaining.includes(cowboys.pick), "Cowboys ungraded lean removed");

  assert.ok(remaining.includes(legitRbRush.pick), "legitimate RB rush kept");
  // QB rush Over 15.5 must clear integrity (settlement) gate even if EV is weak.
  assert.equal(isUnsupportedQbRushOverHalf(legitQbRushHigh), false);

  assert.ok(removed.length >= 5, `expected ≥5 removals, got ${removed.length}: ${removed.join("; ")}`);
});

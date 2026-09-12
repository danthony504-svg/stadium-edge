import assert from "node:assert/strict";
import test from "node:test";

import type { ParsedPick } from "../components/PickCard.tsx";
import {
  COACH_PRIORITY_SPORTS,
  injectPrioritySportsIntoTicket,
} from "./coachPrioritySports.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";

function makePick(opts: {
  sport: string;
  game: string;
  pick: string;
  composite: number;
  isProp?: boolean;
}): ParsedPick {
  return {
    game: opts.game,
    market: opts.isProp ? "Passing Yards" : "Spread",
    pick: opts.pick,
    odds: -110,
    sport: opts.sport,
    isProp: opts.isProp ?? false,
    finalAiScore: {
      composite: opts.composite,
      grade: "A",
      confidencePct: 70,
      edgePct: 10,
      simHit: 0.7,
      simAligned: true,
      highRiskValuePlay: false,
      recommends: true,
      factors: [],
      rubric: {
        composite: opts.composite,
        grade: "A",
        confidencePct: 70,
        edgePct: 10,
        scores: {} as never,
      },
    },
  } as ParsedPick;
}

function scored(pick: ParsedPick, rankScore: number): BoardScoredLeg {
  return { pick, rankScore, edgePct: 10, confidencePct: 70 };
}

test("injects NFL and NCAAF when ticket is all MLB but football qualifies", () => {
  const mlb = [
    makePick({ sport: "mlb", game: "A @ B", pick: "A +1.5", composite: 8 }),
    makePick({ sport: "mlb", game: "C @ D", pick: "C +1.5", composite: 7.5 }),
    makePick({ sport: "mlb", game: "E @ F", pick: "E +1.5", composite: 7 }),
    makePick({ sport: "mlb", game: "G @ H", pick: "G +1.5", composite: 6.5 }),
    makePick({ sport: "mlb", game: "I @ J", pick: "I +1.5", composite: 6 }),
    makePick({ sport: "mlb", game: "K @ L", pick: "K +1.5", composite: 5 }),
  ];
  const nfl = makePick({
    sport: "nfl",
    game: "Chiefs @ Bills",
    pick: "Chiefs +3.5",
    composite: 7.2,
  });
  const ncaaf = makePick({
    sport: "ncaaf",
    game: "Alabama @ Georgia",
    pick: "Alabama +7.5",
    composite: 7.1,
  });
  const pool = [
    ...mlb.map((p, i) => scored(p, 90 - i)),
    scored(nfl, 80),
    scored(ncaaf, 79),
  ];

  const out = injectPrioritySportsIntoTicket(mlb, pool, 6);
  const sports = new Set(out.map((p) => p.sport));
  assert.ok(sports.has("nfl"), "expected NFL leg on ticket");
  assert.ok(sports.has("ncaaf"), "expected NCAAF leg on ticket");
  assert.equal(out.length, 6);
  assert.deepEqual([...COACH_PRIORITY_SPORTS], ["nfl", "ncaaf"]);
});

test("does not invent football when no qualifying NFL/NCAAF legs exist", () => {
  const mlb = [
    makePick({ sport: "mlb", game: "A @ B", pick: "A +1.5", composite: 8 }),
    makePick({ sport: "mlb", game: "C @ D", pick: "C +1.5", composite: 7 }),
    makePick({ sport: "mlb", game: "E @ F", pick: "E +1.5", composite: 6 }),
  ];
  const out = injectPrioritySportsIntoTicket(
    mlb,
    mlb.map((p, i) => scored(p, 90 - i)),
    3,
  );
  assert.deepEqual(
    out.map((p) => p.sport),
    ["mlb", "mlb", "mlb"],
  );
});


test("prefers NFL player prop over leaving a game-line-only NFL seat", () => {
  const ticket = [
    makePick({ sport: "mlb", game: "A @ B", pick: "A +1.5", composite: 8 }),
    makePick({ sport: "mlb", game: "C @ D", pick: "C +1.5", composite: 7.5 }),
    makePick({ sport: "mlb", game: "E @ F", pick: "E +1.5", composite: 7 }),
    makePick({ sport: "mlb", game: "G @ H", pick: "G +1.5", composite: 6.5 }),
    makePick({ sport: "mlb", game: "I @ J", pick: "I +1.5", composite: 6 }),
    makePick({
      sport: "nfl",
      game: "Packers @ Vikings",
      pick: "Over 46.5",
      composite: 7.2,
    }),
  ];
  const nflProp = makePick({
    sport: "nfl",
    game: "Packers @ Vikings",
    pick: "J. Love Over 224.5 Pass Yds",
    composite: 7.0,
    isProp: true,
  });
  const pool = [
    ...ticket.map((p, i) => scored(p, 90 - i)),
    scored(nflProp, 85),
  ];
  const out = injectPrioritySportsIntoTicket(ticket, pool, 6);
  const nflLegs = out.filter((p) => p.sport === "nfl");
  assert.ok(nflLegs.some((p) => p.isProp), "expected NFL player prop on ticket");
});

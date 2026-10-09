import assert from "node:assert/strict";
import test from "node:test";

import type { ParsedPick } from "../components/PickCard.tsx";
import {
  COACH_PRIORITY_SPORTS,
  enforceMultiSportFloorOnTicket,
  injectPrioritySportsIntoTicket,
  interleaveEntriesBySport,
  reservedCrossSportSeats,
  slateAwarePrioritySports,
  sportsPresentOnSlate,
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
  // P0 blocks NCAAF game-line sides — priority inject must use eligible props.
  const ncaaf = makePick({
    sport: "ncaaf",
    game: "Alabama @ Georgia",
    pick: "J. Milroe Over 224.5 Pass Yds",
    composite: 7.1,
    isProp: true,
  });
  const pool = [
    ...mlb.map((p, i) => scored(p, 90 - i)),
    scored(nfl, 80),
    scored(ncaaf, 79),
  ];

  const out = injectPrioritySportsIntoTicket(mlb, pool, 6);
  const sports = new Set(out.map((p) => p.sport));
  assert.ok(sports.has("nfl"), "expected NFL leg on ticket");
  assert.ok(sports.has("ncaaf"), "expected NCAAF prop leg on ticket");
  assert.ok(
    out.some((p) => p.sport === "ncaaf" && p.isProp),
    "NCAAF seat must be a player prop under P0",
  );
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


test("reservedCrossSportSeats reserves ~25% seats on 9-leg mixes", () => {
  assert.equal(reservedCrossSportSeats(5, 2), 0);
  assert.equal(reservedCrossSportSeats(6, 2), 2);
  assert.equal(reservedCrossSportSeats(9, 2), 3);
  assert.equal(reservedCrossSportSeats(9, 0), 0);
});

test("enforceMultiSportFloorOnTicket breaks all-MLB 9-leg when NFL/NCAAF qualify", () => {
  const mlb = Array.from({ length: 9 }, (_, i) =>
    makePick({
      sport: "mlb",
      game: `M${i} @ N${i}`,
      pick: `M${i} Over 1.5 Total Bases`,
      composite: 9 - i * 0.1,
      isProp: true,
    }),
  );
  const nfl = makePick({
    sport: "nfl",
    game: "Chiefs @ Bills",
    pick: "Mahomes Over 1.5 Pass TDs",
    composite: 7.2,
    isProp: true,
  });
  // P0: NCAAF spreads cannot qualify — use an eligible NCAAF prop for the floor.
  const ncaaf = makePick({
    sport: "ncaaf",
    game: "Alabama @ Georgia",
    pick: "R. Williams Over 74.5 Rush Yds",
    composite: 7.0,
    isProp: true,
  });
  const nba = makePick({
    sport: "nba",
    game: "Lakers @ Celtics",
    pick: "Lakers +3.5",
    composite: 6.8,
  });
  const pool = [
    ...mlb.map((p, i) => scored(p, 90 - i)),
    scored(nfl, 80),
    scored(ncaaf, 79),
    scored(nba, 78),
  ];
  const out = enforceMultiSportFloorOnTicket(mlb, pool, 9);
  const sports = new Set(out.map((p) => p.sport));
  assert.ok(sports.has("nfl") || sports.has("ncaaf") || sports.has("nba"), `expected cross-sport legs, got ${[...sports]}`);
  const mlbCount = out.filter((p) => p.sport === "mlb").length;
  assert.ok(mlbCount <= 6, `expected ≤6 MLB on 9-leg mix, got ${mlbCount} mlb / sports=${[...sports]}`);
  assert.equal(out.length, 9);
});

test("enforceMultiSportFloorOnTicket does not invent sports absent from the pool", () => {
  const mlb = Array.from({ length: 9 }, (_, i) =>
    makePick({
      sport: "mlb",
      game: `A${i} @ B${i}`,
      pick: `A${i} ML`,
      composite: 8 - i * 0.1,
    }),
  );
  const out = enforceMultiSportFloorOnTicket(
    mlb,
    mlb.map((p, i) => scored(p, 90 - i)),
    9,
  );
  assert.deepEqual(
    [...new Set(out.map((p) => p.sport))],
    ["mlb"],
  );
});

test("slateAwarePrioritySports expands to NHL/WNBA/tennis when football is empty", () => {
  const askPri = ["nfl", "ncaaf"];
  const slate = ["nhl", "wnba", "tennis", "ncaaf"];
  // NCAAF present → keep it; also include other slate sports.
  const out = slateAwarePrioritySports(askPri, slate);
  assert.ok(out.includes("ncaaf"), `expected ncaaf in ${out}`);
  assert.ok(!out.includes("nfl"), "empty NFL must not stay priority");
  assert.ok(
    out.some((s) => s === "nhl" || s === "wnba" || s === "tennis"),
    `expected non-football slate sport in ${out}`,
  );
});

test("slateAwarePrioritySports on thin tonight slate (no football) prioritizes live sports", () => {
  const out = slateAwarePrioritySports(
    ["nfl", "ncaaf"],
    ["nhl", "wnba", "tennis"],
  );
  assert.deepEqual(
    [...out].sort(),
    ["nhl", "tennis", "wnba"].sort(),
  );
  assert.ok(!out.includes("nfl"));
  assert.ok(!out.includes("ncaaf"));
});

test("slateAwarePrioritySports does not invent sports absent from slate", () => {
  const out = slateAwarePrioritySports(["nfl", "ncaaf"], ["nhl"]);
  assert.deepEqual([...out], ["nhl"]);
});

test("slateAwarePrioritySports keeps hard-named CFB ask exclusive", () => {
  const out = slateAwarePrioritySports(["ncaaf"], ["ncaaf", "nhl", "tennis"]);
  assert.deepEqual([...out], ["ncaaf"]);
});

test("sportsPresentOnSlate dedupes provider sports", () => {
  assert.deepEqual(
    sportsPresentOnSlate([
      { sport: "nhl" },
      { sport: "NHL" },
      { sport: "wnba" },
      { sport: "" },
    ]),
    ["nhl", "wnba"],
  );
});

test("interleaveEntriesBySport round-robins sim coverage across leagues", () => {
  const entries: Array<[string, { sport: string }[]]> = [
    ["A @ B", [{ sport: "tennis" }]],
    ["C @ D", [{ sport: "tennis" }]],
    ["E @ F", [{ sport: "tennis" }]],
    ["G @ H", [{ sport: "nhl" }]],
    ["I @ J", [{ sport: "wnba" }]],
  ];
  const out = interleaveEntriesBySport(entries, (_g, lines) => lines[0]!.sport);
  const sports = out.map(([, lines]) => lines[0]!.sport);
  // First three slots should cover three distinct sports when available.
  assert.deepEqual(new Set(sports.slice(0, 3)).size, 3);
  assert.ok(sports.includes("nhl"));
  assert.ok(sports.includes("wnba"));
  assert.ok(sports.includes("tennis"));
});

test("injectPrioritySportsIntoTicket pulls NHL/WNBA when they are priority on thin slate", () => {
  const tennisHeavy = Array.from({ length: 6 }, (_, i) =>
    makePick({
      sport: "tennis",
      game: `P${i} @ Q${i}`,
      pick: `P${i} +3.5`,
      composite: 8 - i * 0.1,
    }),
  );
  const nhl = makePick({
    sport: "nhl",
    game: "Bruins @ Leafs",
    pick: "Bruins +1.5",
    composite: 7.4,
  });
  const wnba = makePick({
    sport: "wnba",
    game: "Aces @ Liberty",
    pick: "Aces -3.5",
    composite: 7.3,
  });
  const pool = [
    ...tennisHeavy.map((p, i) => scored(p, 90 - i)),
    scored(nhl, 85),
    scored(wnba, 84),
  ];
  const priority = slateAwarePrioritySports(
    ["nfl", "ncaaf"],
    ["tennis", "nhl", "wnba"],
  );
  const out = injectPrioritySportsIntoTicket(tennisHeavy, pool, 6, priority);
  const sports = new Set(out.map((p) => p.sport));
  assert.ok(sports.has("nhl"), `expected NHL on ticket, got ${[...sports]}`);
  assert.ok(sports.has("wnba"), `expected WNBA on ticket, got ${[...sports]}`);
  assert.equal(out.length, 6);
});

/** Deterministic mixed-sport fixtures for 5 / 9 / 15-leg all-sports asks. */
function mixedSportPool(target: number): {
  ticket: ParsedPick[];
  pool: BoardScoredLeg[];
  priority: readonly string[];
} {
  const tennis = Array.from({ length: target }, (_, i) =>
    makePick({
      sport: "tennis",
      game: `T${i}a @ T${i}b`,
      pick: `T${i}a +2.5`,
      composite: 9 - i * 0.05,
    }),
  );
  const extras = [
    makePick({ sport: "nhl", game: "Rangers @ Caps", pick: "Rangers ML", composite: 7.5 }),
    makePick({ sport: "wnba", game: "Sky @ Sun", pick: "Sky +4.5", composite: 7.4 }),
    makePick({
      sport: "ncaaf",
      game: "Alabama @ Georgia",
      pick: "J. Milroe Over 224.5 Pass Yds",
      composite: 7.3,
      isProp: true,
    }),
    makePick({ sport: "nba", game: "Lakers @ Celtics", pick: "Lakers +3.5", composite: 7.2 }),
  ];
  const pool = [
    ...tennis.map((p, i) => scored(p, 100 - i)),
    ...extras.map((p, i) => scored(p, 80 - i)),
  ];
  const priority = slateAwarePrioritySports(
    ["nfl", "ncaaf"],
    sportsPresentOnSlate([...tennis, ...extras]),
  );
  return { ticket: tennis, pool, priority };
}

for (const n of [5, 9, 15] as const) {
  test(`${n}-leg all-sports: slate-aware inject surfaces non-tennis qualified sports`, () => {
    const { ticket, pool, priority } = mixedSportPool(n);
    assert.ok(priority.includes("nhl") || priority.includes("wnba") || priority.includes("ncaaf"));
    const injected = injectPrioritySportsIntoTicket(ticket, pool, n, priority);
    const floored =
      n >= 6
        ? enforceMultiSportFloorOnTicket(injected, pool, n, priority)
        : injected;
    const sports = new Set(floored.map((p) => p.sport));
    assert.equal(floored.length, n);
    assert.ok(
      sports.size >= 2 || n < 6,
      `${n}-leg expected multi-sport mix, got ${[...sports]}`,
    );
    if (n >= 6) {
      assert.ok(
        [...sports].some((s) => s !== "tennis"),
        `${n}-leg must not remain tennis-only when NHL/WNBA/NCAAF qualify`,
      );
    }
    // Never invent NFL when absent from the qualified pool.
    assert.ok(!sports.has("nfl") || pool.some((l) => l.pick.sport === "nfl"));
  });
}

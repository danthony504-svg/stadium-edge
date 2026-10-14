/**
 * Sport-scope leakage regressions — "8 leg college" must never seat MLB/NFL.
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { ParsedPick } from "../components/PickCard.tsx";
import {
  bareCollegeClarificationNote,
  canonicalizeCoachAskSport,
  filterPicksForAskSports,
  filterScoredLegsForAskSports,
  hardLockedSportsFromAsk,
  isAmbiguousCollegeSportAsk,
  sportScopeShortfallNote,
} from "./coachAskSportScope.ts";
import { coachBuildSports, prioritySportsForAsk } from "./chatContextPriority.ts";
import {
  enforceMultiSportFloorOnTicket,
  injectPrioritySportsIntoTicket,
} from "./coachPrioritySports.ts";
import {
  clearParlayVarietyMemory,
  recentParlayVarietyContext,
  rememberParlayBuild,
} from "./parlayVarietyMemory.ts";
import { topUpAfterMlLean } from "./postLeanFinalFill.ts";
import { topUpTicketFromQualifiedScored, type BoardScoredLeg } from "./ticketStaging.ts";

const ALL = [
  "mlb",
  "wnba",
  "nba",
  "nhl",
  "soccer",
  "ufc",
  "tennis",
  "nfl",
  "ncaaf",
  "ncaab",
];

/** Scores that clear Coach sim/quality floors so top-up can seat them. */
function qualifiedScore(
  overrides: Partial<NonNullable<ParsedPick["finalAiScore"]>> = {},
): NonNullable<ParsedPick["finalAiScore"]> {
  return {
    composite: 8,
    grade: "B+",
    confidencePct: 58,
    edgePct: 4,
    simHit: 0.56,
    simAligned: true,
    highRiskValuePlay: false,
    recommends: true,
    factors: [],
    rubric: {
      composite: 8,
      grade: "B+",
      confidencePct: 58,
      edgePct: 4,
      scores: {} as never,
    },
    ...overrides,
  } as NonNullable<ParsedPick["finalAiScore"]>;
}

function pick(
  partial: Partial<ParsedPick> & Pick<ParsedPick, "game" | "market" | "pick" | "sport">,
): ParsedPick {
  return {
    odds: -110,
    isProp: false,
    finalAiScore: qualifiedScore(),
    ...partial,
  };
}

function scored(p: ParsedPick, rankScore = 60): BoardScoredLeg {
  return {
    pick: p,
    evPct: p.finalAiScore?.edgePct ?? 4,
    edgePct: p.finalAiScore?.edgePct ?? 4,
    confidencePct: p.finalAiScore?.confidencePct ?? 58,
    impliedProbPct: 50,
    lineShoppingScore: 1,
    grade: p.finalAiScore?.grade ?? "B+",
    simHit: p.finalAiScore?.simHit ?? 0.56,
    composite: p.finalAiScore?.composite ?? 8,
    rankScore,
  };
}

test("aliases: college football / CFB / NCAAF / collage football lock ncaaf only", () => {
  for (const ask of [
    "8 leg college football",
    "8 leg CFB",
    "8 leg NCAAF",
    "8 leg Collage Football",
  ]) {
    assert.deepEqual(hardLockedSportsFromAsk(ask), ["ncaaf"]);
    assert.deepEqual(coachBuildSports(ask, 8, ALL), ["ncaaf"]);
    assert.deepEqual([...prioritySportsForAsk(ask)], ["ncaaf"]);
  }
});

test("bare college is ambiguous, locks ncaaf board, never pro sports", () => {
  const ask = "8 leg college";
  assert.equal(isAmbiguousCollegeSportAsk(ask), true);
  assert.deepEqual(hardLockedSportsFromAsk(ask), ["ncaaf"]);
  assert.deepEqual(coachBuildSports(ask, 8, ALL), ["ncaaf"]);
  assert.match(bareCollegeClarificationNote(ask) ?? "", /college football/i);
  assert.doesNotMatch(bareCollegeClarificationNote(ask) ?? "", /\bMLB\b.*return/i);
});

test("canonicalizeCoachAskSport maps cfb → ncaaf", () => {
  assert.equal(canonicalizeCoachAskSport("cfb"), "ncaaf");
  assert.equal(canonicalizeCoachAskSport("americanfootball_ncaaf"), "ncaaf");
});

test("selection + multi-sport floor cannot seat MLB/NFL into college pool belt", () => {
  const ask = "8 leg college";
  const locked = hardLockedSportsFromAsk(ask)!;
  const ncaafA = pick({
    game: "Iowa @ Minnesota",
    market: "Spread",
    pick: "Iowa +3.5",
    sport: "ncaaf",
  });
  const ncaafB = pick({
    game: "Duke @ Wake",
    market: "Spread",
    pick: "Duke +7",
    sport: "ncaaf",
  });
  const mlb = pick({
    game: "NYY @ BOS",
    market: "Spread",
    pick: "Yankees -1.5",
    sport: "mlb",
    finalAiScore: qualifiedScore({
      composite: 90,
      edgePct: 8,
      confidencePct: 90,
      simHit: 0.7,
      grade: "A",
    }),
  });
  const nfl = pick({
    game: "DEN @ KC",
    market: "Spread",
    pick: "Broncos +3",
    sport: "nfl",
    finalAiScore: qualifiedScore({
      composite: 88,
      edgePct: 7,
      confidencePct: 85,
      simHit: 0.66,
      grade: "A",
    }),
  });
  const pool = [ncaafA, ncaafB, mlb, nfl].map((p, i) =>
    scored(p, 80 - i),
  );
  const sportSafe = filterScoredLegsForAskSports(pool, locked);
  assert.equal(sportSafe.length, 2);
  assert.ok(sportSafe.every((l) => l.pick.sport === "ncaaf"));

  // Contaminated pool + floor would previously force foreign seats on N≥6.
  const contaminatedTicket = [ncaafA, ncaafB, mlb, nfl, ncaafA, ncaafB, mlb, nfl];
  const floored = enforceMultiSportFloorOnTicket(
    contaminatedTicket,
    pool,
    8,
    ["nfl", "ncaaf"],
  );
  // After our belt (caller skips floor when locked) — belt the floored result too.
  const belted = filterPicksForAskSports(floored, locked);
  assert.ok(belted.every((p) => p.sport === "ncaaf"));
  assert.equal(
    belted.some((p) => p.sport === "mlb" || p.sport === "nfl"),
    false,
  );

  const injected = injectPrioritySportsIntoTicket(
    [ncaafA, ncaafB],
    pool,
    8,
    ["nfl", "ncaaf"],
  );
  assert.ok(
    filterPicksForAskSports(injected, locked).every((p) => p.sport === "ncaaf"),
  );
});

test("ALT top-up / backfill stay inside locked sports (no foreign fill)", () => {
  // NBA avoids NCAAF P0 game-line fail-closed emptying the pool — asserts allowlist.
  const locked = ["nba"];
  const short = [
    pick({ game: "LAL @ BOS", market: "Spread", pick: "Lakers +3.5", sport: "nba" }),
    pick({ game: "NYK @ MIA", market: "Spread", pick: "Knicks +2.5", sport: "nba" }),
  ];
  const leftovers = [
    scored(
      pick({
        game: "CHI @ MIL",
        market: "Alt Spread",
        pick: "Bulls +8.5",
        sport: "nba",
        finalAiScore: qualifiedScore({
          composite: 70,
          edgePct: 5,
          confidencePct: 60,
          simHit: 0.58,
          grade: "B",
        }),
      }),
      70,
    ),
    scored(
      pick({
        game: "DET @ IND",
        market: "Spread",
        pick: "Pistons +4.5",
        sport: "nba",
        finalAiScore: qualifiedScore({
          composite: 68,
          edgePct: 4.5,
          confidencePct: 57,
          simHit: 0.57,
          grade: "B",
        }),
      }),
      68,
    ),
    scored(
      pick({
        game: "NYY @ BOS",
        market: "Alt Spread",
        pick: "Yankees -1.5",
        sport: "mlb",
        finalAiScore: qualifiedScore({
          composite: 95,
          edgePct: 10,
          confidencePct: 90,
          simHit: 0.7,
          grade: "A",
        }),
      }),
      95,
    ),
    scored(
      pick({
        game: "DEN @ KC",
        market: "Alt Spread",
        pick: "Broncos +6.5",
        sport: "nfl",
        finalAiScore: qualifiedScore({
          composite: 93,
          edgePct: 9,
          confidencePct: 88,
          simHit: 0.68,
          grade: "A",
        }),
      }),
      93,
    ),
  ];
  const topped = topUpTicketFromQualifiedScored(short, leftovers, 8, "nba-topup", 4, {
    allowedSports: locked,
  });
  assert.ok(topped.every((p) => p.sport === "nba"), `got sports ${topped.map((p) => p.sport)}`);
  assert.ok(topped.length >= 3, `expected NBA top-up, got ${topped.length}`);
  assert.equal(
    topped.some((p) => p.sport === "mlb" || p.sport === "nfl"),
    false,
  );
  assert.ok(
    topped.some((p) => /Bulls|Pistons/i.test(p.pick)),
    "must seat in-sport leftovers, not just keep the short ticket",
  );

  const afterLean = topUpAfterMlLean({
    picks: short,
    qualifiedCandidates: leftovers.map((l) => l.pick),
    target: 8,
    varietySeed: "nba-lean",
    legsPerGameCap: 4,
    allowedSports: locked,
  });
  assert.ok(afterLean.every((p) => p.sport === "nba"));
  assert.equal(
    afterLean.some((p) => p.sport === "mlb" || p.sport === "nfl"),
    false,
  );
});

test("college filter drops MLB/NFL even when they outrank NCAAF in a contaminated list", () => {
  const locked = hardLockedSportsFromAsk("8 leg college")!;
  const mixed = [
    pick({
      game: "NYY @ BOS",
      market: "Spread",
      pick: "Yankees -1.5",
      sport: "mlb",
      finalAiScore: qualifiedScore({
        composite: 99,
        edgePct: 12,
        confidencePct: 99,
        simHit: 0.8,
        grade: "A+",
      }),
    }),
    pick({
      game: "DEN @ KC",
      market: "Spread",
      pick: "Broncos +3",
      sport: "nfl",
      finalAiScore: qualifiedScore({
        composite: 98,
        edgePct: 11,
        confidencePct: 98,
        simHit: 0.78,
        grade: "A+",
      }),
    }),
    pick({
      game: "Iowa @ Minn",
      market: "Spread",
      pick: "Iowa +3.5",
      sport: "ncaaf",
      finalAiScore: qualifiedScore({
        composite: 55,
        edgePct: 2,
        confidencePct: 55,
        simHit: 0.54,
        grade: "C+",
      }),
    }),
  ];
  const belted = filterPicksForAskSports(mixed, locked);
  assert.deepEqual(
    belted.map((p) => p.sport),
    ["ncaaf"],
  );
});

test("shortfall note when college inventory < N — no invent / no pro fill", () => {
  const note = sportScopeShortfallNote("8 leg college", 8, 3, ["ncaaf"]);
  assert.match(note ?? "", /Only 3 of 8/i);
  assert.match(note ?? "", /NCAAF/);
  assert.match(note ?? "", /other sports/i);
});

test("variety cache from MLB ticket does not steer a college ask", () => {
  clearParlayVarietyMemory();
  rememberParlayBuild([
    pick({
      game: "NYY @ BOS",
      market: "Spread",
      pick: "Yankees -1.5",
      sport: "mlb",
      player: "Judge",
    }),
  ]);
  rememberParlayBuild([
    pick({
      game: "Iowa @ Minn",
      market: "Spread",
      pick: "Iowa +3.5",
      sport: "ncaaf",
    }),
  ]);
  const collegeCtx = recentParlayVarietyContext({ allowedSports: ["ncaaf"] });
  // MLB ticket shapes must be excluded from college variety memory.
  assert.equal(collegeCtx.recentTickets.length, 1);
  assert.ok(collegeCtx.recentTickets[0]!.some((k) => /iowa/i.test(k)));
  assert.ok(!collegeCtx.recentTickets[0]!.some((k) => /nyy|yankees|judge/i.test(k)));
});

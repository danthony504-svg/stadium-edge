/**
 * Ticket-integrity regressions for the production Cowboys screenshot and
 * related lean / ladder / copy failures.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { ParsedPick } from "../components/PickCard.tsx";
import {
  p0UnvalidatedSimDecision,
  p0UnvalidatedSimTotalDecision,
  P0_UNVALIDATED_NCAAF_GAME_LINE_REASON,
} from "./coachP0UnvalidatedTotals.ts";
import { pickHasSimGrade } from "./simMarketSupport.ts";
import { COACH_FULL_BOARD_SCAN_POLICY } from "./coachScanPolicy.ts";
import { fullBoardScanShortfallNote } from "./fullBoardMarketCopy.ts";
import {
  dedupePicksByMarketLadder,
  marketLadderKey,
  marketLadderScoreKey,
  wouldRepeatMarketLadder,
} from "./marketLadderKey.ts";
import {
  enforceMlLeanOnPicks,
  isLeanQualifiedSubstitute,
} from "./mlLeanEnforcement.ts";
import { buildFullBoardShortfallNote } from "./parlayReachCore.ts";
import {
  collapseSameTeamGameLineSides,
  selectGreedyBoardLegs,
  topUpTicketFromQualifiedScored,
  type BoardScoredLeg,
} from "./ticketStaging.ts";

function qualifiedScore(overrides: Record<string, unknown> = {}) {
  return {
    composite: 7.5,
    grade: "B",
    confidencePct: 60,
    edgePct: 5,
    simHit: 0.58,
    simAligned: true,
    highRiskValuePlay: false,
    recommends: true,
    factors: [],
    rubric: {
      composite: 7.5,
      grade: "B",
      confidencePct: 60,
      edgePct: 5,
      scores: {} as never,
    },
    ...overrides,
  };
}

function scoredLeg(pick: ParsedPick, rank: number): BoardScoredLeg {
  return {
    pick: { ...pick, finalAiScore: pick.finalAiScore ?? (qualifiedScore({ composite: rank }) as never) },
    evPct: 2,
    edgePct: 5,
    confidencePct: 60,
    impliedProbPct: 52,
    lineShoppingScore: 1,
    grade: "B",
    simHit: 0.58,
    composite: rank,
    rankScore: rank,
  };
}

// --- B: Spread ladder normalization across sports ---

const SPORT_CASES: Array<{
  sport: string;
  gameNick: string;
  gameFull: string;
  market: string;
  pickNick: string;
  pickFull: string;
  altMarket: string;
  altPick: string;
}> = [
  {
    sport: "nfl",
    gameNick: "Cowboys @ Giants",
    gameFull: "Dallas Cowboys @ New York Giants",
    market: "Spread",
    pickNick: "Cowboys -5.5",
    pickFull: "Dallas Cowboys -5.5",
    altMarket: "Alt Spread",
    altPick: "Dallas Cowboys -8.5",
  },
  {
    sport: "ncaaf",
    gameNick: "Buckeyes @ Hawkeyes",
    gameFull: "Ohio State Buckeyes @ Iowa Hawkeyes",
    market: "Spread",
    pickNick: "Buckeyes -7.5",
    pickFull: "Ohio State Buckeyes -7.5",
    altMarket: "Alt Spread",
    altPick: "Ohio State Buckeyes -10.5",
  },
  {
    sport: "nba",
    gameNick: "Lakers @ Celtics",
    gameFull: "Los Angeles Lakers @ Boston Celtics",
    market: "Spread",
    pickNick: "Lakers -3.5",
    pickFull: "Los Angeles Lakers -3.5",
    altMarket: "Alt Spread",
    altPick: "Los Angeles Lakers -6.5",
  },
  {
    sport: "wnba",
    gameNick: "Aces @ Liberty",
    gameFull: "Las Vegas Aces @ New York Liberty",
    market: "Spread",
    pickNick: "Aces -4.5",
    pickFull: "Las Vegas Aces -4.5",
    altMarket: "Alt Spread",
    altPick: "Las Vegas Aces -7.5",
  },
  {
    sport: "mlb",
    gameNick: "Yankees @ Red Sox",
    gameFull: "New York Yankees @ Boston Red Sox",
    market: "Run Line",
    pickNick: "Yankees -1.5",
    pickFull: "New York Yankees -1.5",
    altMarket: "Alt Run Line",
    altPick: "New York Yankees -2.5",
  },
  {
    sport: "nhl",
    gameNick: "Rangers @ Bruins",
    gameFull: "New York Rangers @ Boston Bruins",
    market: "Puck Line",
    pickNick: "Rangers -1.5",
    pickFull: "New York Rangers -1.5",
    altMarket: "Alt Puck Line",
    altPick: "New York Rangers -2.5",
  },
];

for (const c of SPORT_CASES) {
  test(`${c.sport}: nick vs full-name FG spreads share one seating ladder`, () => {
    const a = {
      game: c.gameNick,
      market: c.market,
      pick: c.pickNick,
      isProp: false,
      sport: c.sport,
    };
    const b = {
      game: c.gameFull,
      market: c.altMarket,
      pick: c.altPick,
      isProp: false,
      sport: c.sport,
    };
    assert.equal(marketLadderKey(a), marketLadderKey(b), marketLadderKey(a));
    assert.equal(wouldRepeatMarketLadder(b, [a]), true);
    assert.notEqual(marketLadderScoreKey(a), marketLadderScoreKey(b));
  });
}

test("phone: Cowboys -5.5 and Dallas Cowboys -8.5 cannot both survive dedupe", () => {
  const picks: ParsedPick[] = [
    {
      game: "Cowboys @ Giants",
      market: "Spread",
      pick: "Cowboys -5.5",
      odds: -108,
      sport: "nfl",
      finalAiScore: qualifiedScore({ composite: 80 }) as never,
    },
    {
      game: "Cowboys @ Giants",
      market: "Alt Spread",
      pick: "Dallas Cowboys -8.5",
      odds: -103,
      sport: "nfl",
      finalAiScore: qualifiedScore({ composite: 78 }) as never,
    },
    {
      game: "Cowboys @ Giants",
      market: "Q2 Spread",
      pick: "Cowboys -3.5",
      odds: 105,
      sport: "nfl",
      finalAiScore: qualifiedScore({ composite: 72 }) as never,
    },
  ];
  const out = dedupePicksByMarketLadder(picks);
  const fg = out.filter((p) => !/q2/i.test(p.market));
  assert.equal(fg.length, 1, `expected one FG Cowboys spread, got ${fg.map((p) => p.pick)}`);
  assert.equal(fg[0]!.pick, "Cowboys -5.5");
  // Q2 remains a distinct period ladder.
  assert.ok(out.some((p) => /q2/i.test(p.market)));
});

test("opposite sides and different events stay separate ladders", () => {
  const cowboys = {
    game: "Cowboys @ Giants",
    market: "Spread",
    pick: "Cowboys -5.5",
    isProp: false,
  };
  const giants = {
    game: "Cowboys @ Giants",
    market: "Spread",
    pick: "Giants +5.5",
    isProp: false,
  };
  const other = {
    game: "Eagles @ Chiefs",
    market: "Spread",
    pick: "Eagles -3.5",
    isProp: false,
  };
  assert.notEqual(marketLadderKey(cowboys), marketLadderKey(giants));
  assert.notEqual(marketLadderKey(cowboys), marketLadderKey(other));
});

test("NFL mix top-up cannot reintroduce Cowboys -5.5 / -8.5 after collapse", () => {
  const g = "Cowboys @ Giants";
  const a: ParsedPick = {
    game: g,
    market: "Spread",
    pick: "Cowboys -5.5",
    odds: -108,
    isProp: false,
    sport: "nfl",
    finalAiScore: qualifiedScore({ composite: 80, recommends: true }) as never,
  };
  const c: ParsedPick = {
    game: g,
    market: "Alt Spread",
    pick: "Dallas Cowboys -8.5",
    odds: -103,
    isProp: false,
    sport: "nfl",
    finalAiScore: qualifiedScore({ composite: 78, recommends: true }) as never,
  };
  const q: ParsedPick = {
    game: g,
    market: "Q2 Spread",
    pick: "Cowboys -3.5",
    odds: 105,
    isProp: false,
    sport: "nfl",
    finalAiScore: qualifiedScore({ composite: 76, recommends: true }) as never,
  };
  const fillers: ParsedPick[] = [
    {
      game: "A @ B",
      market: "Moneyline",
      pick: "A",
      odds: -120,
      isProp: false,
      sport: "nfl",
      finalAiScore: qualifiedScore({ composite: 50, recommends: true }) as never,
    },
    {
      game: "C @ D",
      market: "Moneyline",
      pick: "C",
      odds: -110,
      isProp: false,
      sport: "nfl",
      finalAiScore: qualifiedScore({ composite: 49, recommends: true }) as never,
    },
  ];
  const short = collapseSameTeamGameLineSides([a, c, q, ...fillers]);
  const scored = [a, c, q, ...fillers].map((p, i) => scoredLeg(p, 80 - i));
  const topped = topUpTicketFromQualifiedScored(short, scored, 7, undefined, null, undefined);
  const fgCowboys = topped.filter(
    (p) => /cowboys/i.test(p.pick) && /spread/i.test(p.market) && !/q2/i.test(p.market),
  );
  assert.equal(
    fgCowboys.length,
    1,
    `expected ≤1 FG Cowboys spread after top-up, got ${fgCowboys.map((p) => `${p.market}:${p.pick}`)}`,
  );
});

test("greedy top-up with raised per-game cap still keeps one FG Cowboys ladder", () => {
  const g = "Cowboys @ Giants";
  const a: ParsedPick = {
    game: g,
    market: "Spread",
    pick: "Cowboys -5.5",
    odds: -108,
    isProp: false,
    sport: "nfl",
    finalAiScore: qualifiedScore({ composite: 80 }) as never,
  };
  const c: ParsedPick = {
    game: g,
    market: "Alt Spread",
    pick: "Dallas Cowboys -8.5",
    odds: -103,
    isProp: false,
    sport: "nfl",
    finalAiScore: qualifiedScore({ composite: 78 }) as never,
  };
  const q: ParsedPick = {
    game: g,
    market: "Q2 Spread",
    pick: "Cowboys -3.5",
    odds: 105,
    isProp: false,
    sport: "nfl",
    finalAiScore: qualifiedScore({ composite: 76 }) as never,
  };
  const extra = selectGreedyBoardLegs(
    [c, q].map((p) => scoredLeg(p, p.finalAiScore!.composite!)),
    2,
    undefined,
    [a],
    7,
    3,
  );
  const merged = dedupePicksByMarketLadder([a, ...extra]);
  const fg = merged.filter((p) => /cowboys/i.test(p.pick) && !/q2/i.test(p.market));
  assert.equal(fg.length, 1);
});

test("ungraded lean substitution is dropped (no fabricated score)", () => {
  const g = "Dallas Cowboys @ New York Giants";
  const history = {
    [g]: {
      home: null,
      away: null,
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
      mlLean: { side: "Dallas Cowboys", edge: 9, reasons: ["lean"] },
    },
  };
  const { picks, swapped, dropped } = enforceMlLeanOnPicks(
    [
      {
        game: g,
        market: "Spread",
        pick: "Giants +5.5",
        odds: -110,
        sport: "nfl",
      },
    ],
    {
      matchupHistory: history as never,
      realOdds: [
        {
          sport: "nfl",
          game: g,
          market: "Alt Spread",
          pick: "Dallas Cowboys -8.5",
          odds: -103,
        },
      ],
      qualifiedCandidates: [],
    },
  );
  assert.equal(swapped, 0);
  assert.equal(dropped, 1);
  assert.equal(picks.length, 0);
});

test("P0 blocked NFL team total cannot qualify as lean substitute", () => {
  const blocked: ParsedPick = {
    game: "Cowboys @ Giants",
    market: "Team Total",
    pick: "Cowboys Over 24.5",
    odds: -110,
    sport: "nfl",
    isProp: false,
    finalAiScore: qualifiedScore() as never,
  };
  assert.ok(p0UnvalidatedSimTotalDecision(blocked));
  assert.equal(isLeanQualifiedSubstitute(blocked), false);
});

test("P0 NCAAF spreads/ML cannot lean-swap, top-up, or keep final seats", () => {
  const g = "Iowa Hawkeyes @ Washington Huskies";
  const ncaafSpread: ParsedPick = {
    game: g,
    market: "Spread",
    pick: "Iowa Hawkeyes +3",
    odds: -105,
    sport: "ncaaf",
    isProp: false,
    finalAiScore: qualifiedScore({ simHit: 0.62, edgePct: 10.8, grade: "A", confidencePct: 88 }) as never,
  };
  const ncaafMl: ParsedPick = {
    game: g,
    market: "Moneyline",
    pick: "Iowa Hawkeyes ML",
    odds: 130,
    sport: "ncaaf",
    isProp: false,
    finalAiScore: qualifiedScore({ simHit: 0.53, edgePct: 9, grade: "B+", confidencePct: 70 }) as never,
  };
  assert.equal(
    p0UnvalidatedSimDecision(ncaafSpread)?.reason,
    P0_UNVALIDATED_NCAAF_GAME_LINE_REASON,
  );
  assert.equal(pickHasSimGrade(ncaafSpread, 0.62), false);
  assert.equal(isLeanQualifiedSubstitute(ncaafSpread), false);
  assert.equal(isLeanQualifiedSubstitute(ncaafMl), false);

  const topped = topUpTicketFromQualifiedScored(
    [ncaafSpread, ncaafMl],
    [ncaafSpread, ncaafMl].map((p, i) => ({
      pick: p,
      evPct: 10,
      edgePct: 10,
      confidencePct: 80,
      impliedProbPct: 50,
      lineShoppingScore: 1,
      grade: "A",
      simHit: 0.62,
      composite: 9,
      rankScore: 100 - i,
    })) as BoardScoredLeg[],
    7,
  );
  assert.equal(topped.length, 0, "NCAAF game lines must shortfall, not seat");

  const lean = enforceMlLeanOnPicks([ncaafSpread], {
    matchupHistory: {
      [g]: { mlLean: { side: "Washington Huskies", edge: 5, reasons: ["form"] } },
    } as never,
    qualifiedCandidates: [ncaafMl],
  });
  assert.equal(lean.picks.length, 0);
  assert.ok(lean.dropped >= 1);
});

test("scan copy no longer claims 10k sim on every posted market", () => {
  const note = buildFullBoardShortfallNote(7, 6, 2214, 40, "today's real odds", undefined, {
    mainQualified: 20,
    altQualified: 20,
    mainOnTicket: 3,
    altOnTicket: 3,
  });
  assert.match(note, /evaluated 2214 posted lines/i);
  assert.match(note, /no filler was added/i);
  assert.match(note, /3 main picks and 3 alt picks/i);
  assert.doesNotMatch(note, /10k sim on each/i);
  assert.doesNotMatch(note, /10k sim each/i);

  const scanNote = fullBoardScanShortfallNote(
    2214,
    40,
    6,
    { mainQualified: 20, altQualified: 20, mainOnTicket: 3, altOnTicket: 3 },
    { requested: 7 },
  );
  assert.doesNotMatch(scanNote, /10k sim each/i);
  assert.match(COACH_FULL_BOARD_SCAN_POLICY, /capped prop batches/i);
});

test("Safe/Best/Value remain within-card alternatives (PickCard contract)", async () => {
  const { readFileSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const dir = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(dir, "../components/PickCard.tsx"), "utf8");
  assert.match(src, /alternatives, not independent legs/);
  assert.match(src, /siblingLegKeys/);
  assert.match(src, /one leg per card/i);
});

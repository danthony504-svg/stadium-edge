import assert from "node:assert/strict";
import { test } from "node:test";

import type { ParsedPick } from "../components/PickCard.tsx";
import {
  enforceMlLeanOnPicks,
  isGameSideMlOrSpread,
  isLeanQualifiedSubstitute,
  mlLeanEnforcementNote,
  passesLeanTicketConstraints,
  teamsMatch,
} from "./mlLeanEnforcement.ts";
import { marketLadderKey, wouldRepeatMarketLadder } from "./marketLadderKey.ts";
import { maxLegsPerGame, wouldExceedMaxLegsPerGame } from "./parlayCorrelationScore.ts";
import { p0UnvalidatedSimTotalDecision } from "./coachP0UnvalidatedTotals.ts";
import { collapseSameTeamGameLineSides } from "./ticketStaging.ts";

const GAME = "New York Yankees @ Boston Red Sox";
const HISTORY = {
  [GAME]: {
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
    mlLean: { side: "Boston Red Sox", edge: 11.8, reasons: ["Sox 6-4 L10"] },
  },
};

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

test("teamsMatch: nicknames and full names", () => {
  assert.equal(teamsMatch("Sox", "Boston Red Sox"), true);
  assert.equal(teamsMatch("Yankees", "New York Yankees"), true);
  assert.equal(teamsMatch("Yankees", "Boston Red Sox"), false);
});

test("isGameSideMlOrSpread: ML and spread yes, total no", () => {
  assert.equal(
    isGameSideMlOrSpread({ game: GAME, market: "Moneyline", pick: "Yankees ML", odds: -104 }),
    true,
  );
  assert.equal(
    isGameSideMlOrSpread({ game: GAME, market: "Spread", pick: "Yankees -1.5", odds: 165 }),
    true,
  );
  assert.equal(
    isGameSideMlOrSpread({ game: GAME, market: "Total", pick: "Over 8.5", odds: -110 }),
    false,
  );
});

test("T4: qualified opposing spread with no lean replacement → preserve original", () => {
  const original: ParsedPick = {
    game: GAME,
    market: "Spread",
    pick: "Yankees -1.5",
    odds: 165,
    finalAiScore: qualifiedScore({ simHit: 0.52 }) as never,
  };
  const picks: ParsedPick[] = [original];
  const { picks: out, swapped, dropped } = enforceMlLeanOnPicks(picks, {
    matchupHistory: HISTORY as never,
    qualifiedCandidates: [],
  });
  assert.equal(swapped, 0);
  assert.equal(dropped, 0);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.pick, "Yankees -1.5");
  assert.equal(out[0]!.finalAiScore, original.finalAiScore);
  assert.ok(isLeanQualifiedSubstitute(out[0]!));
});

test("ungraded/invalid opposing with no lean replacement → still drop", () => {
  const picks: ParsedPick[] = [
    {
      game: GAME,
      market: "Spread",
      pick: "Yankees -1.5",
      odds: 165,
      // Has a score object but fails staging gates (no recommend / weak sim).
      finalAiScore: qualifiedScore({
        simHit: 0.4,
        recommends: false,
        edgePct: -2,
        grade: "D",
        confidencePct: 30,
        simAligned: false,
      }) as never,
    },
  ];
  const { picks: out, swapped, dropped } = enforceMlLeanOnPicks(picks, {
    matchupHistory: HISTORY as never,
    qualifiedCandidates: [],
  });
  assert.equal(swapped, 0);
  assert.equal(dropped, 1);
  assert.equal(out.length, 0);
});

test("T5: qualified lean-side candidate swap preserves finalAiScore", () => {
  const leanScore = qualifiedScore({
    simHit: 0.62,
    edgePct: 6.2,
    grade: "B+",
    confidencePct: 60,
  });
  const lean: ParsedPick = {
    game: GAME,
    market: "Spread",
    pick: "Sox +1.5",
    odds: -110,
    finalAiScore: leanScore as never,
    eventId: "mlb-1",
    sportsbook: "DraftKings",
    oddsFetchedAt: new Date().toISOString(),
  };
  const picks: ParsedPick[] = [
    {
      game: GAME,
      market: "Spread",
      pick: "Yankees -1.5",
      odds: 165,
      finalAiScore: qualifiedScore({ simHit: 0.4 }) as never,
    },
  ];
  const { picks: out, swapped, dropped } = enforceMlLeanOnPicks(picks, {
    matchupHistory: HISTORY as never,
    qualifiedCandidates: [lean],
  });
  assert.equal(swapped, 1);
  assert.equal(dropped, 0);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.pick, "Sox +1.5");
  assert.equal(out[0]!.finalAiScore, leanScore);
  assert.equal(out[0]!.finalAiScore?.simHit, 0.62);
});

test("ungraded opposing lean is never promoted from raw odds", () => {
  const picks: ParsedPick[] = [
    { game: GAME, market: "Moneyline", pick: "Yankees ML", odds: -104 },
  ];
  const { picks: out, swapped, dropped } = enforceMlLeanOnPicks(picks, {
    matchupHistory: HISTORY as never,
    realOdds: [
      { sport: "mlb", game: GAME, market: "Moneyline", pick: "Sox ML", odds: -105 },
    ],
  });
  assert.equal(swapped, 0);
  assert.equal(dropped, 1);
  assert.equal(out.length, 0);
});

test("enforceMlLeanOnPicks: leaves aligned Sox legs untouched", () => {
  const picks: ParsedPick[] = [
    {
      game: GAME,
      market: "Spread",
      pick: "Sox +1.5",
      odds: -110,
      finalAiScore: qualifiedScore({ simHit: 0.62 }) as never,
    },
  ];
  const { picks: out, swapped, dropped } = enforceMlLeanOnPicks(picks, {
    matchupHistory: HISTORY as never,
    qualifiedCandidates: picks,
  });
  assert.equal(swapped, 0);
  assert.equal(dropped, 0);
  assert.equal(out[0]!.pick, "Sox +1.5");
});

test("enforceMlLeanOnPicks: totals and props pass through", () => {
  const picks: ParsedPick[] = [
    { game: GAME, market: "Total", pick: "Over 8.5", odds: -110 },
    {
      game: GAME,
      market: "Strikeouts",
      pick: "Cole Over 6.5 Strikeouts",
      odds: -120,
      isProp: true,
    },
  ];
  const { picks: out, swapped, dropped } = enforceMlLeanOnPicks(picks, {
    matchupHistory: HISTORY as never,
  });
  assert.equal(swapped, 0);
  assert.equal(dropped, 0);
  assert.equal(out.length, 2);
});

test("lean swap cannot double-seat same FG ladder (Cowboys nick vs full name)", () => {
  const g = "Dallas Cowboys @ New York Giants";
  const history = {
    [g]: {
      ...HISTORY[GAME],
      mlLean: { side: "Dallas Cowboys", edge: 8, reasons: ["lean"] },
    },
  };
  const seated: ParsedPick = {
    game: g,
    market: "Spread",
    pick: "Cowboys -5.5",
    odds: -108,
    sport: "nfl",
    finalAiScore: qualifiedScore({ simHit: 0.6 }) as never,
  };
  const opposing: ParsedPick = {
    game: g,
    market: "Spread",
    pick: "Giants +5.5",
    odds: -110,
    sport: "nfl",
    finalAiScore: qualifiedScore({ simHit: 0.45 }) as never,
  };
  const leanAlt: ParsedPick = {
    game: g,
    market: "Alt Spread",
    pick: "Dallas Cowboys -8.5",
    odds: -103,
    sport: "nfl",
    finalAiScore: qualifiedScore({ simHit: 0.57 }) as never,
  };
  assert.equal(wouldRepeatMarketLadder(leanAlt, [seated]), true);
  assert.equal(marketLadderKey(seated), marketLadderKey(leanAlt));

  const { picks: out, swapped, dropped } = enforceMlLeanOnPicks([seated, opposing], {
    matchupHistory: history as never,
    qualifiedCandidates: [seated, leanAlt],
  });
  assert.equal(swapped, 0);
  assert.equal(dropped, 1);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.pick, "Cowboys -5.5");
  assert.ok(isLeanQualifiedSubstitute(out[0]!));
});

test("mlLeanEnforcementNote: qualified wording, no Markdown", () => {
  assert.equal(mlLeanEnforcementNote({ picks: [], swapped: 0, dropped: 0 }), "");
  const note = mlLeanEnforcementNote({ picks: [], swapped: 2, dropped: 1 });
  assert.match(note, /Updated 2 moneyline\/spread picks to a qualified analytics-lean selection/);
  assert.match(note, /Dropped 1 moneyline\/spread pick that opposed/);
  assert.match(note, /not staging-qualified/);
  assert.equal(note.includes("_"), false);
});

// --- TNF 7-leg reproduction: staged Bucs period spreads + Flournoy/Javonte props ---

const TNF = "Tampa Bay Buccaneers @ Dallas Cowboys";
const TNF_HISTORY = {
  [TNF]: {
    ...HISTORY[GAME],
    mlLean: { side: "Dallas Cowboys", edge: 9, reasons: ["Cowboys lean"] },
  },
};

function tnfStagedSix(includeProps = true): ParsedPick[] {
  const gls: ParsedPick[] = [
    {
      game: TNF,
      sport: "nfl",
      market: "Q1 Alt Spread",
      pick: "Buccaneers +6.5",
      odds: -242,
      finalAiScore: qualifiedScore({ grade: "B+", edgePct: 8, simHit: 0.72 }) as never,
      ticketRole: "alt",
    },
    {
      game: TNF,
      sport: "nfl",
      market: "1H Alt Spread",
      pick: "Buccaneers +13.5",
      odds: -375,
      finalAiScore: qualifiedScore({ grade: "B", simHit: 0.85 }) as never,
      ticketRole: "alt",
    },
    {
      game: TNF,
      sport: "nfl",
      market: "Q2 Spread",
      pick: "Buccaneers +3.5",
      odds: -108,
      finalAiScore: qualifiedScore({ grade: "B-", simHit: 0.54, edgePct: 4 }) as never,
      ticketRole: "main",
    },
    {
      game: TNF,
      sport: "nfl",
      market: "2H Alt Spread",
      pick: "Buccaneers +9.5",
      odds: -254,
      finalAiScore: qualifiedScore({ grade: "B", simHit: 0.8 }) as never,
      ticketRole: "alt",
    },
  ];
  if (!includeProps) return gls;
  return [
    gls[0]!,
    {
      game: TNF,
      sport: "nfl",
      market: "Rec Yds",
      pick: "Ryan Flournoy Under 31.5 Rec Yds",
      player: "Ryan Flournoy",
      odds: -112,
      isProp: true,
      propLine: 31.5,
      propSide: "Under",
      propMarketKey: "player_reception_yds",
      finalAiScore: qualifiedScore({ grade: "B", edgePct: 26.8, simHit: 0.79 }) as never,
    },
    {
      game: TNF,
      sport: "nfl",
      market: "Rec Yds",
      pick: "Javonte Williams Over 14.5 Rec Yds",
      player: "Javonte Williams",
      odds: -113,
      isProp: true,
      propLine: 14.5,
      propSide: "Over",
      propMarketKey: "player_reception_yds",
      finalAiScore: qualifiedScore({ grade: "B", edgePct: 12.6, simHit: 0.66 }) as never,
    },
    gls[1]!,
    gls[2]!,
    gls[3]!,
  ];
}

function cowboysPeriodSubs(): ParsedPick[] {
  return [
    {
      game: TNF,
      sport: "nfl",
      market: "Q1 Alt Spread",
      pick: "Cowboys +2.5",
      odds: -387,
      finalAiScore: qualifiedScore({ grade: "B+", edgePct: 5.5, simHit: 0.9 }) as never,
      ticketRole: "alt",
    },
    {
      game: TNF,
      sport: "nfl",
      market: "1H Alt Spread",
      pick: "Cowboys +4.5",
      odds: -200,
      finalAiScore: qualifiedScore({ grade: "B", edgePct: 6, simHit: 0.7 }) as never,
      ticketRole: "alt",
    },
    {
      game: TNF,
      sport: "nfl",
      market: "Q2 Spread",
      pick: "Cowboys -3.5",
      odds: -110,
      finalAiScore: qualifiedScore({ grade: "B", edgePct: 5, simHit: 0.58 }) as never,
      ticketRole: "main",
    },
    {
      game: TNF,
      sport: "nfl",
      market: "2H Alt Spread",
      pick: "Cowboys +3.5",
      odds: -180,
      finalAiScore: qualifiedScore({ grade: "B", edgePct: 5, simHit: 0.65 }) as never,
      ticketRole: "alt",
    },
  ];
}

test("period coexistence: Q1/Q2/1H/2H are ladder-distinct but hard maxLegsPerGame(7)=2", () => {
  const gls = tnfStagedSix(false);
  assert.equal(maxLegsPerGame(7), 2);
  // Soft ladder: all period keys distinct.
  for (let i = 0; i < gls.length; i++) {
    for (let j = i + 1; j < gls.length; j++) {
      assert.equal(wouldRepeatMarketLadder(gls[j]!, [gls[i]!]), false);
    }
  }
  // Hard same-team collapse (correlation select) → 1 Bucs GL.
  assert.equal(collapseSameTeamGameLineSides(gls).length, 1);
  // Hard per-game GL cap without progressive raise → 2.
  let on: ParsedPick[] = [];
  for (const p of gls) {
    if (!wouldExceedMaxLegsPerGame(p, on, maxLegsPerGame(7))) on.push(p);
  }
  assert.equal(on.length, 2);
});

test("valid original with no replacement → preserve (under hard caps)", () => {
  const original: ParsedPick = {
    game: TNF,
    sport: "nfl",
    market: "Q1 Alt Spread",
    pick: "Buccaneers +6.5",
    odds: -242,
    finalAiScore: qualifiedScore({ grade: "B+", edgePct: 8, simHit: 0.72 }) as never,
  };
  const { picks: out, swapped, dropped } = enforceMlLeanOnPicks([original], {
    matchupHistory: TNF_HISTORY as never,
    qualifiedCandidates: [],
    requestedLegs: 7,
  });
  assert.equal(swapped, 0);
  assert.equal(dropped, 0);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.pick, "Buccaneers +6.5");
  assert.equal(out[0]!.odds, -242);
  assert.equal(out[0]!.finalAiScore?.grade, "B+");
});

test("valid original with qualified replacement → swap preserves grade evidence", () => {
  const opposing = tnfStagedSix(false)[0]!;
  const lean = cowboysPeriodSubs()[0]!;
  const { picks: out, swapped, dropped } = enforceMlLeanOnPicks([opposing], {
    matchupHistory: TNF_HISTORY as never,
    qualifiedCandidates: [lean],
    requestedLegs: 7,
  });
  assert.equal(swapped, 1);
  assert.equal(dropped, 0);
  assert.equal(out[0]!.pick, "Cowboys +2.5");
  assert.equal(out[0]!.odds, -387);
  assert.equal(out[0]!.finalAiScore?.simHit, 0.9);
  assert.ok(isLeanQualifiedSubstitute(out[0]!));
});

test("invalid original with no replacement → drop", () => {
  const bad: ParsedPick = {
    game: TNF,
    sport: "nfl",
    market: "Q1 Alt Spread",
    pick: "Buccaneers +6.5",
    odds: -242,
  };
  const { picks: out, swapped, dropped } = enforceMlLeanOnPicks([bad], {
    matchupHistory: TNF_HISTORY as never,
    qualifiedCandidates: [],
    requestedLegs: 7,
  });
  assert.equal(swapped, 0);
  assert.equal(dropped, 1);
  assert.equal(out.length, 0);
});

test("P0-blocked original cannot be preserved or swapped in", () => {
  const blocked: ParsedPick = {
    game: TNF,
    sport: "nfl",
    market: "1H Team Total",
    pick: "Buccaneers Over 9.5",
    odds: -110,
    finalAiScore: qualifiedScore({ simHit: 0.72 }) as never,
  };
  assert.ok(p0UnvalidatedSimTotalDecision(blocked));
  assert.equal(isLeanQualifiedSubstitute(blocked), false);
  assert.equal(passesLeanTicketConstraints(blocked, []), false);
  // Totals are not game-side ML/spread — lean leaves them alone in the loop,
  // but finalize/constraints still reject P0 if somehow seated via swap path.
  const opposingSpread: ParsedPick = {
    game: TNF,
    sport: "nfl",
    market: "Q1 Alt Spread",
    pick: "Buccaneers +6.5",
    odds: -242,
    finalAiScore: qualifiedScore({ simHit: 0.72 }) as never,
  };
  const { picks: out, swapped } = enforceMlLeanOnPicks([opposingSpread], {
    matchupHistory: TNF_HISTORY as never,
    // P0 total must never qualify as a lean substitute.
    qualifiedCandidates: [blocked],
    requestedLegs: 7,
  });
  assert.equal(swapped, 0);
  assert.ok(out.every((p) => !/team total/i.test(p.market)));
});

test("duplicate ladder: nick vs full-name lean alt cannot double-seat", () => {
  const g = "Dallas Cowboys @ New York Giants";
  const history = {
    [g]: {
      ...HISTORY[GAME],
      mlLean: { side: "Dallas Cowboys", edge: 8, reasons: ["lean"] },
    },
  };
  const seated: ParsedPick = {
    game: g,
    market: "Spread",
    pick: "Cowboys -5.5",
    odds: -108,
    sport: "nfl",
    finalAiScore: qualifiedScore({ simHit: 0.6 }) as never,
  };
  const opposing: ParsedPick = {
    game: g,
    market: "Spread",
    pick: "Giants +5.5",
    odds: -110,
    sport: "nfl",
    finalAiScore: qualifiedScore({ simHit: 0.45 }) as never,
  };
  const leanAlt: ParsedPick = {
    game: g,
    market: "Alt Spread",
    pick: "Dallas Cowboys -8.5",
    odds: -103,
    sport: "nfl",
    finalAiScore: qualifiedScore({ simHit: 0.57 }) as never,
  };
  assert.equal(marketLadderKey(seated), marketLadderKey(leanAlt));
  const { picks: out, swapped, dropped } = enforceMlLeanOnPicks([seated, opposing], {
    matchupHistory: history as never,
    qualifiedCandidates: [seated, leanAlt],
    requestedLegs: 7,
  });
  assert.equal(swapped, 0);
  assert.equal(dropped, 1);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.pick, "Cowboys -5.5");
});

test("same-game period correlation: hard maxLegs keeps ≤2 GLs on TNF (not all 4 Bucs)", () => {
  const staged = tnfStagedSix();
  for (const p of staged.filter((x) => !x.isProp)) {
    assert.ok(isLeanQualifiedSubstitute(p), `pre-lean valid: ${p.pick}`);
  }
  const { picks: out, swapped, dropped } = enforceMlLeanOnPicks(staged, {
    matchupHistory: TNF_HISTORY as never,
    qualifiedCandidates: staged,
    requestedLegs: 7,
  });
  assert.equal(swapped, 0);
  assert.equal(out.filter((p) => p.isProp).length, 2);
  assert.equal(out.filter((p) => !p.isProp).length, 2);
  assert.equal(out.length, 4);
  assert.ok(dropped >= 2); // Q2 + 2H exceed hard per-game GL cap
  assert.ok(out.some((p) => p.pick === "Buccaneers +6.5"));
  assert.ok(out.some((p) => p.pick === "Buccaneers +13.5"));
  assert.equal(
    out.some((p) => p.pick === "Buccaneers +3.5"),
    false,
  );
  assert.equal(
    out.some((p) => p.pick === "Buccaneers +9.5"),
    false,
  );
});

/**
 * Original destructive outcomes (pre-fix): staged-only→2, live→3, four-subs→6.
 * After preserve + hard maxLegsPerGame(7)=2 revalidation:
 */
test("scenario was-2-pick (staged-only): preserve under cap → 4 (2 props + 2 Bucs)", () => {
  const staged = tnfStagedSix();
  const { picks: out, swapped, dropped } = enforceMlLeanOnPicks(staged, {
    matchupHistory: TNF_HISTORY as never,
    qualifiedCandidates: staged,
    requestedLegs: 7,
  });
  assert.equal(swapped, 0);
  assert.ok(dropped >= 2);
  assert.equal(out.length, 4);
  const labels = out.map((p) => `${p.market}|${p.pick}|${p.odds}|${p.finalAiScore?.grade}`);
  assert.deepEqual(labels, [
    "Q1 Alt Spread|Buccaneers +6.5|-242|B+",
    "Rec Yds|Ryan Flournoy Under 31.5 Rec Yds|-112|B",
    "Rec Yds|Javonte Williams Over 14.5 Rec Yds|-113|B",
    "1H Alt Spread|Buccaneers +13.5|-375|B",
  ]);
});

test("scenario was-3-pick (live 1 Q1 sub): 1 swap + 1 Bucs keep → 4", () => {
  const staged = tnfStagedSix();
  const q1 = cowboysPeriodSubs()[0]!;
  const { picks: out, swapped, dropped } = enforceMlLeanOnPicks(staged, {
    matchupHistory: TNF_HISTORY as never,
    qualifiedCandidates: [...staged, q1],
    requestedLegs: 7,
  });
  assert.equal(swapped, 1);
  assert.ok(dropped >= 2);
  assert.equal(out.length, 4);
  assert.ok(out.some((p) => p.pick === "Cowboys +2.5" && p.odds === -387));
  assert.ok(out.some((p) => p.pick === "Buccaneers +13.5"));
  assert.equal(out.filter((p) => p.isProp).length, 2);
});

test("scenario was-6-pick (four subs): hard cap seats 2 Cowboys GLs + 2 props → 4", () => {
  const staged = tnfStagedSix();
  const subs = cowboysPeriodSubs();
  const { picks: out, swapped, dropped } = enforceMlLeanOnPicks(staged, {
    matchupHistory: TNF_HISTORY as never,
    qualifiedCandidates: [...staged, ...subs],
    requestedLegs: 7,
  });
  // First two period families swap; remaining two fail per-game cap → drop.
  assert.equal(swapped, 2);
  assert.ok(dropped >= 2);
  assert.equal(out.length, 4);
  assert.equal(out.filter((p) => p.isProp).length, 2);
  assert.ok(out.every((p) => p.isProp || /Cowboys/i.test(p.pick)));
  for (const p of out.filter((x) => !x.isProp)) {
    assert.ok(isLeanQualifiedSubstitute(p));
    assert.ok(p.finalAiScore?.simHit != null);
  }
});

test("lean replacement without grading evidence is rejected; qualified original preserved", () => {
  const opposing: ParsedPick = {
    game: GAME,
    market: "Spread",
    pick: "Yankees -1.5",
    odds: 165,
    finalAiScore: qualifiedScore({ simHit: 0.55 }) as never,
  };
  const ungradedLean: ParsedPick = {
    game: GAME,
    market: "Spread",
    pick: "Sox +1.5",
    odds: -110,
  };
  const { picks: out, swapped, dropped } = enforceMlLeanOnPicks([opposing], {
    matchupHistory: HISTORY as never,
    qualifiedCandidates: [ungradedLean],
    requestedLegs: 7,
  });
  assert.equal(swapped, 0);
  assert.equal(dropped, 0);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.pick, "Yankees -1.5");
});

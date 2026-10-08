import assert from "node:assert/strict";
import { test } from "node:test";

import type { ParsedPick } from "../components/PickCard.tsx";
import {
  enforceMlLeanOnPicks,
  isGameSideMlOrSpread,
  isLeanQualifiedSubstitute,
  mlLeanEnforcementNote,
  teamsMatch,
} from "./mlLeanEnforcement.ts";
import { marketLadderKey, wouldRepeatMarketLadder } from "./marketLadderKey.ts";

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

test("T4 Cowboys class: opposing spread with no qualified lean replacement → drop", () => {
  const picks: ParsedPick[] = [
    {
      game: GAME,
      market: "Spread",
      pick: "Yankees -1.5",
      odds: 165,
      finalAiScore: qualifiedScore({ simHit: 0.52 }) as never,
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
  assert.equal(note.includes("_"), false);
});

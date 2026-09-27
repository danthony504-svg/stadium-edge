import assert from "node:assert/strict";
import test from "node:test";

import {
  boardScanNonPropPreviewCap,
  boardScanPropSlotCount,
  buildFinalCoachParlayNote,
  fillReservedPropSlots,
  finalizeFootballPropMixPicks,
  footballSkillPropFamily,
  footballSkillPropRank,
  selectFinalCoachParlayPicks,
  shouldKeepAwaitingPropSlots,
  shouldReservePropSeats,
  applyReservedPropSeatCap,
  askRequiresFootballPropMix,
  skillPropFamily,
  skillPropRank,
} from "./boardScanPropDelivery.ts";
import {
  boardScanGamePhaseBudgetMs,
  boardScanMixGamePhaseBudgetMs,
  boardScanMaxPropsToSimForMix,
  boardScanPropPhaseDeadlineMs,
  shouldOverlapPropPhaseWithGames,
} from "./boardScanScope.ts";
import { buildFixedLegCountShortfallLead } from "./coachScanPolicy.ts";
import { coachShortfallNote } from "./coach/session.ts";

/** Dead #469 wipe formula — kept only so the regression proves it stays dead. */
function buggyWipeOnAwaitingPropSlots<T extends { isProp?: boolean }>(
  rawPicks: T[],
  propPoolSize: number,
  awaitingPropSlots: boolean,
): T[] {
  const propLike = rawPicks.filter((p) => p.isProp).length;
  return propPoolSize > 0 && propLike === 0 && awaitingPropSlots ? [] : rawPicks;
}

test("5-leg reserved prop slots leave exactly 2 game-line preview capacity", () => {
  assert.equal(boardScanPropSlotCount(5), 3);
  assert.equal(boardScanNonPropPreviewCap(5), 2);
});

test("askRequiresFootballPropMix: bare NFL/NCAAF asks need a prop mix", () => {
  assert.equal(askRequiresFootballPropMix("10 leg nfl"), true);
  assert.equal(askRequiresFootballPropMix("10-leg NCAAF"), true);
  assert.equal(askRequiresFootballPropMix("8 leg college football"), true);
  assert.equal(askRequiresFootballPropMix("10 leg nfl with no player props"), false);
  assert.equal(askRequiresFootballPropMix("10 leg mlb"), false);
  assert.equal(askRequiresFootballPropMix("6 leg nba"), false);
});

test("phone screenshot: final football mix with 0 props refuses GL-only board", () => {
  // Rebuild: never publish "6 game-line picks" when props did not finish.
  assert.equal(
    shouldReservePropSeats({
      targetLegs: 10,
      propCount: 0,
      requirePropMix: true,
    }),
    true,
  );
  const gameHeavy = Array.from({ length: 10 }, (_, i) => ({
    isProp: false,
    sport: "nfl",
    market: "Spread",
    pick: `Team${i} +3.5`,
  }));
  const preview = finalizeFootballPropMixPicks(gameHeavy, 10, { preview: true });
  assert.equal(preview.length, boardScanNonPropPreviewCap(10, 0.4));
  assert.equal(preview.filter((p) => p.isProp).length, 0);

  const final = finalizeFootballPropMixPicks(gameHeavy, 10);
  assert.equal(final.length, 0, "final must refuse spreads-only when mix required");
});

test("final football ticket with scored props keeps them and still caps GL fill", () => {
  const picks = [
    ...Array.from({ length: 8 }, (_, i) => ({
      isProp: false,
      sport: "nfl",
      market: "Total",
      pick: `Over ${40 + i}.5`,
    })),
    {
      isProp: true,
      sport: "nfl",
      market: "player_anytime_td",
      pick: "Hill Over 0.5",
    },
    {
      isProp: true,
      sport: "nfl",
      market: "player_pass_yds",
      pick: "Allen Over 250.5",
    },
  ];
  assert.equal(
    shouldReservePropSeats({
      targetLegs: 10,
      propCount: 2,
      requirePropMix: true,
    }),
    true, // 2 < 4 reserved seats
  );
  const capped = finalizeFootballPropMixPicks(picks, 10);
  assert.equal(capped.filter((p) => p.isProp).length, 2);
  assert.ok(capped.length <= 10);
  assert.ok(
    capped.filter((p) => !p.isProp).length <= boardScanNonPropPreviewCap(10, 0.4),
  );
  assert.ok(capped.length > 0, "mixed ticket with props must publish");
});

test("football mix note never says showing N game-line picks", () => {
  const note = buildFinalCoachParlayNote({
    target: 10,
    picks: [],
    propPoolSize: 200,
    propsPending: true,
    requirePropMix: true,
    shortfallLead: buildFixedLegCountShortfallLead(10, 0),
  });
  assert.match(note, /no game-line filler was added/i);
  assert.doesNotMatch(note, /showing \d+ game-line/i);
});

test("7-leg reserved prop slots leave exactly 3 game-line preview capacity", () => {
  assert.equal(boardScanPropSlotCount(7), 4);
  assert.equal(boardScanNonPropPreviewCap(7), 3);
});

test("prefetched prop pools overlap prop scoring with game lines", () => {
  assert.equal(shouldOverlapPropPhaseWithGames(true, 120), true);
  assert.equal(shouldOverlapPropPhaseWithGames(true, 0), false);
  assert.equal(shouldOverlapPropPhaseWithGames(false, 120), false);
  assert.equal(shouldOverlapPropPhaseWithGames(true, 120, true), false);
});

test("football mix budgets favor props then room for parallel game phase", () => {
  assert.equal(boardScanPropPhaseDeadlineMs(10, { requirePropMix: true }), 65_000);
  assert.equal(boardScanMixGamePhaseBudgetMs(10), 28_000);
  assert.ok(boardScanMaxPropsToSimForMix(10, 800) <= 360);
  assert.ok(boardScanMaxPropsToSimForMix(10, 800) >= 200);
});

test("game-phase budget leaves room for prop-phase deadline inside Coach wall", () => {
  assert.equal(boardScanGamePhaseBudgetMs(7), 28_000);
  assert.equal(boardScanPropPhaseDeadlineMs(7), 65_000);
  assert.ok(boardScanGamePhaseBudgetMs(7) + boardScanPropPhaseDeadlineMs(7) > 60_000);
});

test("final incomplete prop phase does NOT keep awaitingPropSlots (no instant empty wipe)", () => {
  // Regression: treating finals as awaiting wiped cleared game lines to 0-of-7.
  assert.equal(
    shouldKeepAwaitingPropSlots({
      targetLegs: 7,
      propCount: 0,
      propPhaseIncomplete: true,
    }),
    false,
  );
  assert.equal(
    shouldKeepAwaitingPropSlots({
      targetLegs: 7,
      propCount: 0,
      propPhaseIncomplete: false,
    }),
    false,
  );
});

test("preview with zero props awaits prop slots", () => {
  assert.equal(
    shouldKeepAwaitingPropSlots({
      preview: true,
      targetLegs: 7,
      propCount: 0,
    }),
    true,
  );
  assert.equal(
    shouldKeepAwaitingPropSlots({
      preview: true,
      targetLegs: 7,
      propCount: 1,
    }),
    false,
  );
});

test("shortfall copy does not claim every posted market was scanned", () => {
  assert.doesNotMatch(buildFixedLegCountShortfallLead(7, 0), /every posted market/i);
  assert.doesNotMatch(buildFixedLegCountShortfallLead(7, 3), /every posted market/i);
  assert.match(buildFixedLegCountShortfallLead(7, 0), /no AI-backed picks/i);
  assert.match(buildFixedLegCountShortfallLead(7, 3), /only \*\*3\*\*/);
  assert.doesNotMatch(coachShortfallNote(7, 3), /every posted market/i);
});

test("phone 0-of-7 regression: incomplete props keep 3 game lines, honest note", () => {
  // Inputs matching the post-#469 phone failure: final scan, props incomplete,
  // 3 cleared F5/game lines, large prop pool, target 7.
  const rawPicks = [
    { isProp: false, market: "F5 totals" },
    { isProp: false, market: "F5 totals" },
    { isProp: false, market: "F5 totals" },
  ];
  const propPoolSize = 240;
  const awaitingOnFinal = shouldKeepAwaitingPropSlots({
    targetLegs: 7,
    propCount: 0,
    propPhaseIncomplete: true,
  });
  assert.equal(awaitingOnFinal, false);

  // Prove the old wipe would have produced the screenshot (0 legs).
  assert.equal(
    buggyWipeOnAwaitingPropSlots(rawPicks, propPoolSize, true).length,
    0,
  );

  const picks = selectFinalCoachParlayPicks(rawPicks);
  assert.equal(picks.length, 3);

  const note = buildFinalCoachParlayNote({
    target: 7,
    picks,
    propPoolSize,
    propsPending: true,
    shortfallLead: buildFixedLegCountShortfallLead(7, picks.length),
  });
  assert.match(note, /only \*\*3\*\*/);
  assert.match(note, /props did not finish scoring/i);
  assert.doesNotMatch(note, /every posted market/i);
  assert.doesNotMatch(note, /only \*\*0\*\*/);
});

test("empty final with incomplete props does not claim every market scanned", () => {
  const picks = selectFinalCoachParlayPicks([]);
  const note = buildFinalCoachParlayNote({
    target: 7,
    picks,
    propPoolSize: 240,
    propsPending: true,
    shortfallLead: buildFixedLegCountShortfallLead(7, 0),
  });
  assert.match(note, /no AI-backed picks/i);
  assert.match(note, /prop scoring did not finish/i);
  assert.doesNotMatch(note, /every posted market/i);
});

test("props-only incomplete note never claims game-line fallback", () => {
  const note = buildFinalCoachParlayNote({
    target: 10,
    picks: [],
    propPoolSize: 180,
    propsPending: true,
    propsOnly: true,
    shortfallLead: buildFixedLegCountShortfallLead(10, 0),
  });
  assert.match(note, /props-only ticket/i);
  assert.doesNotMatch(note, /game-line/i);
});



test("footballSkillPropRank prefers TD / pass / rec / rush yards over sack and misc", () => {
  assert.ok(footballSkillPropRank("player_anytime_td") > footballSkillPropRank("player_sacks"));
  assert.ok(footballSkillPropRank("player_rush_tds") > footballSkillPropRank("player_sacks"));
  assert.ok(footballSkillPropRank("player_pass_yds") > footballSkillPropRank("player_tackles"));
  assert.ok(footballSkillPropRank("player_reception_yds") > 0);
  assert.ok(footballSkillPropRank("player_rush_yds") > 0);
  assert.ok(footballSkillPropRank("player_first_td") >= footballSkillPropRank("player_pass_yds"));
});

test("fillReservedPropSlots swaps game lines for rush/pass props to hit ~50% mix", () => {
  const target = 8;
  const gameHeavy = Array.from({ length: 8 }, (_, i) => ({
    isProp: false,
    market: "moneyline",
    game: `G${i}`,
    player: null as string | null,
    pick: `Team${i}`,
    side: null as string | null,
    scores: { composite: 90 - i },
  }));
  const scored = [
    ...gameHeavy.map((pick, i) => ({ pick, rankScore: 90 - i })),
    {
      pick: {
        isProp: true,
        market: "player_rush_yds",
        game: "DAL @ PHI",
        player: "Saquon Barkley",
        pick: "Over 75.5",
        side: "Over",
        scores: { composite: 70 },
      },
      rankScore: 80,
    },
    {
      pick: {
        isProp: true,
        market: "player_pass_yds",
        game: "KC @ BUF",
        player: "Josh Allen",
        pick: "Over 265.5",
        side: "Over",
        scores: { composite: 68 },
      },
      rankScore: 78,
    },
    {
      pick: {
        isProp: true,
        market: "player_reception_yds",
        game: "SF @ SEA",
        player: "George Kittle",
        pick: "Over 45.5",
        side: "Over",
        scores: { composite: 66 },
      },
      rankScore: 76,
    },
    {
      pick: {
        isProp: true,
        market: "player_sacks",
        game: "BAL @ CIN",
        player: "Myles Garrett",
        pick: "Over 0.5",
        side: "Over",
        scores: { composite: 64 },
      },
      rankScore: 74,
    },
  ];
  const out = fillReservedPropSlots(gameHeavy, scored, target);
  const propCount = out.filter((p) => p.isProp).length;
  assert.equal(propCount, boardScanPropSlotCount(8)); // 4 of 8
  assert.ok(out.some((p) => /rush/i.test(p.market || "")));
  assert.ok(out.some((p) => /pass/i.test(p.market || "")));
  assert.ok(out.some((p) => /sack|receiv|reception/i.test(p.market || "")));
});

test("fillReservedPropSlots does not invent props when none scored", () => {
  const games = [
    { isProp: false, market: "total", game: "A @ B", pick: "Over 45.5", scores: { composite: 80 } },
    { isProp: false, market: "moneyline", game: "C @ D", pick: "C", scores: { composite: 78 } },
  ];
  const out = fillReservedPropSlots(games, games.map((pick) => ({ pick, rankScore: 1 })), 8);
  assert.equal(out.filter((p) => p.isProp).length, 0);
  assert.equal(out.length, 2);
});


test("footballSkillPropRank ranks alt rush/pass/rec and TD markets", () => {
  assert.ok(footballSkillPropRank("player_rush_yds_alternate") > 0);
  assert.ok(footballSkillPropRank("player_pass_yds_alternate") > 0);
  assert.ok(footballSkillPropRank("player_reception_yds_alternate") > 0);
  assert.ok(footballSkillPropRank("player_anytime_td") > footballSkillPropRank("player_sacks_alternate"));
  assert.equal(footballSkillPropFamily("player_pass_yds_alternate"), "pass");
  assert.equal(footballSkillPropFamily("player_rush_yds"), "rush");
  assert.equal(footballSkillPropFamily("player_rush_tds"), "td");
  assert.equal(footballSkillPropFamily("player_anytime_td"), "td");
  assert.equal(footballSkillPropFamily("player_sacks"), "sack");
  assert.equal(footballSkillPropFamily("moneyline"), null);
});

test("fillReservedPropSlots diversifies TD / pass / rec / rush alts over ML-only", () => {
  const target = 8;
  const gameHeavy = Array.from({ length: 8 }, (_, i) => ({
    isProp: false,
    market: i % 2 === 0 ? "moneyline" : "alternate_spreads",
    game: `G${i}`,
    player: null as string | null,
    pick: `Team${i}`,
    side: null as string | null,
    scores: { composite: 95 - i },
  }));
  const skill = [
    ["player_anytime_td", "Hill", 0.5],
    ["player_pass_yds", "Allen", 265.5],
    ["player_reception_yds", "Kittle", 45.5],
    ["player_rush_yds_alternate", "Henry", 50.5],
    ["player_sacks", "Garrett", 0.5],
  ] as const;
  const scored = [
    ...gameHeavy.map((pick, i) => ({ pick, rankScore: 95 - i })),
    ...skill.map(([market, player, line], i) => ({
      pick: {
        isProp: true,
        market,
        propMarketKey: market,
        propLine: line,
        game: `F${i} @ H${i}`,
        player,
        pick: `Over ${line}`,
        side: "Over",
        scores: { composite: 60 + i },
      },
      rankScore: 70 + i,
    })),
  ];
  const out = fillReservedPropSlots(gameHeavy, scored, target);
  const props = out.filter((p) => p.isProp);
  assert.equal(props.length, boardScanPropSlotCount(8));
  assert.ok(out.some((p) => !p.isProp), "still keeps some game lines");
  assert.ok(props.some((p) => footballSkillPropFamily(p.market) === "td"), "includes TD props");
  assert.ok(props.some((p) => /pass/i.test(p.market || "")), "includes passing yards");
  assert.ok(props.some((p) => /receiv|reception/i.test(p.market || "")), "includes receiving yards");
  assert.ok(props.some((p) => /rush/i.test(p.market || "")), "includes rush yards / alts");
  const families = new Set(
    props.map((p) => footballSkillPropFamily(p.propMarketKey || p.market)).filter(Boolean),
  );
  assert.ok(families.size >= 3, `expected diverse skill families, got ${[...families]}`);
});

test("fillReservedPropSlots swaps a full 10-leg NFL spread/total ticket for skill props", () => {
  const target = 10;
  const gameHeavy = Array.from({ length: 10 }, (_, i) => ({
    isProp: false,
    sport: "nfl",
    market: i % 3 === 0 ? "Spread" : i % 3 === 1 ? "Total" : "Moneyline",
    game: `Away${i} @ Home${i}`,
    player: null as string | null,
    pick: i % 3 === 1 ? `Over ${40 + i}.5` : `Team${i} +3.5`,
    side: null as string | null,
    scores: { composite: 40 },
  }));
  const skill = [
    { market: "player_anytime_td", player: "A", line: 0.5 },
    { market: "player_pass_yds", player: "B", line: 250.5 },
    { market: "player_reception_yds", player: "C", line: 60.5 },
    { market: "player_rush_yds_alternate", player: "D", line: 49.5 },
    { market: "player_pass_yds_alternate", player: "E", line: 299.5 },
    { market: "player_rush_yds", player: "F", line: 75.5 },
  ];
  const scored = [
    ...gameHeavy.map((pick, i) => ({ pick, rankScore: 50 - i })),
    ...skill.map((s, i) => ({
      pick: {
        isProp: true,
        sport: "nfl",
        market: s.market,
        propMarketKey: s.market,
        propLine: s.line,
        game: `PropAway${i} @ PropHome${i}`,
        player: s.player,
        pick: `Over ${s.line}`,
        side: "Over",
        scores: { composite: 80 },
        finalAiScore: {
          composite: 8,
          grade: "B+",
          confidencePct: 58,
          edgePct: 4,
          simHit: 0.56,
          simAligned: true,
          highRiskValuePlay: false,
          recommends: true,
          factors: [],
          rubric: { composite: 8, grade: "B+", confidencePct: 58, edgePct: 4, scores: {} as never },
        },
      },
      rankScore: 90 - i,
    })),
  ];
  const out = fillReservedPropSlots(gameHeavy, scored, target);
  const props = out.filter((p) => p.isProp);
  assert.ok(props.length >= boardScanPropSlotCount(10, 0.4), `expected ≥4 props, got ${props.length}`);
  assert.ok(props.some((p) => footballSkillPropFamily(p.market) === "td"));
  assert.ok(props.some((p) => /pass/i.test(p.market || "")));
  assert.ok(props.some((p) => /rush/i.test(p.market || "")));
});

test("skillPropRank covers MLB / NBA / NHL / soccer families (not football-only)", () => {
  assert.ok(skillPropRank("batter_home_runs") > skillPropRank("pitcher_outs"));
  assert.ok(skillPropRank("batter_hits") > 0);
  assert.ok(skillPropRank("pitcher_strikeouts") > 0);
  assert.ok(skillPropRank("player_points") > skillPropRank("player_double_double"));
  assert.ok(skillPropRank("player_rebounds") > 0);
  assert.ok(skillPropRank("player_assists") > 0);
  assert.ok(skillPropRank("player_goals") > 0);
  assert.ok(skillPropRank("player_goal_scorer_anytime") > 0);
  assert.equal(skillPropFamily("batter_home_runs"), "hr");
  assert.equal(skillPropFamily("pitcher_strikeouts"), "strikeouts");
  assert.equal(skillPropFamily("batter_hits"), "hits");
  assert.equal(skillPropFamily("player_points"), "points");
  assert.equal(skillPropFamily("player_rebounds"), "rebounds");
  assert.equal(skillPropFamily("player_assists"), "assists");
  assert.equal(skillPropFamily("player_goals"), "goals");
  assert.equal(skillPropFamily("player_goal_scorer_anytime"), "goals");
  // NCAAF reuses football families
  assert.equal(skillPropFamily("player_anytime_td"), "td");
  assert.equal(skillPropFamily("player_pass_yds"), "pass");
  assert.ok(skillPropRank("player_pass_yds") > 0);
});

test("fillReservedPropSlots swaps college football game lines for TD / yards props", () => {
  const target = 8;
  const gameHeavy = Array.from({ length: 8 }, (_, i) => ({
    isProp: false,
    sport: "ncaaf",
    market: i % 2 === 0 ? "Spread" : "Total",
    game: `CFBAway${i} @ CFBHome${i}`,
    player: null as string | null,
    pick: i % 2 === 0 ? `Team${i} -3.5` : `Over ${48 + i}.5`,
    side: null as string | null,
    scores: { composite: 40 },
  }));
  const skill = [
    { market: "player_anytime_td", player: "Hunter", line: 0.5 },
    { market: "player_pass_yds", player: "Nix", line: 245.5 },
    { market: "player_reception_yds", player: "Worthy", line: 55.5 },
    { market: "player_rush_yds_alternate", player: "Jeanty", line: 99.5 },
  ];
  const scored = [
    ...gameHeavy.map((pick, i) => ({ pick, rankScore: 50 - i })),
    ...skill.map((s, i) => ({
      pick: {
        isProp: true,
        sport: "ncaaf",
        market: s.market,
        propMarketKey: s.market,
        propLine: s.line,
        game: `CFBProp${i} @ CFBOpp${i}`,
        player: s.player,
        pick: `Over ${s.line}`,
        side: "Over",
        scores: { composite: 80 },
      },
      rankScore: 90 - i,
    })),
  ];
  const out = fillReservedPropSlots(gameHeavy, scored, target);
  const props = out.filter((p) => p.isProp);
  assert.ok(props.length >= boardScanPropSlotCount(8, 0.4), `expected ≥3 NCAAF props, got ${props.length}`);
  assert.ok(props.some((p) => skillPropFamily(p.market) === "td"), "includes CFB TD props");
  assert.ok(props.some((p) => /pass/i.test(p.market || "")), "includes CFB pass yards");
  assert.ok(props.some((p) => /rush/i.test(p.market || "")), "includes CFB rush alts");
  const families = new Set(props.map((p) => skillPropFamily(p.market)).filter(Boolean));
  assert.ok(families.size >= 2, `expected diverse CFB families, got ${[...families]}`);
});

test("fillReservedPropSlots swaps MLB game lines for HR / hits / K props", () => {
  const target = 8;
  const gameHeavy = Array.from({ length: 8 }, (_, i) => ({
    isProp: false,
    sport: "mlb",
    market: i % 2 === 0 ? "moneyline" : "totals",
    game: `MLBAway${i} @ MLBHome${i}`,
    player: null as string | null,
    pick: i % 2 === 0 ? `Team${i}` : `Over ${8.5 + (i % 3)}`,
    side: null as string | null,
    scores: { composite: 40 },
  }));
  const skill = [
    { market: "batter_home_runs", player: "Judge", line: 0.5 },
    { market: "batter_hits", player: "Soto", line: 1.5 },
    { market: "pitcher_strikeouts", player: "Cole", line: 6.5 },
    { market: "batter_rbis", player: "Alvarez", line: 0.5 },
    { market: "batter_hits_runs_rbis", player: "Ohtani", line: 2.5 },
  ];
  const scored = [
    ...gameHeavy.map((pick, i) => ({ pick, rankScore: 50 - i })),
    ...skill.map((s, i) => ({
      pick: {
        isProp: true,
        sport: "mlb",
        market: s.market,
        propMarketKey: s.market,
        propLine: s.line,
        game: `MLBProp${i} @ MLBOpp${i}`,
        player: s.player,
        pick: `Over ${s.line}`,
        side: "Over",
        scores: { composite: 80 },
      },
      rankScore: 90 - i,
    })),
  ];
  const out = fillReservedPropSlots(gameHeavy, scored, target);
  const props = out.filter((p) => p.isProp);
  assert.equal(props.length, boardScanPropSlotCount(8)); // 4 of 8 (~50%)
  assert.ok(props.some((p) => skillPropFamily(p.market) === "hr"), "includes HR props");
  assert.ok(props.some((p) => skillPropFamily(p.market) === "strikeouts"), "includes K props");
  assert.ok(
    props.some((p) => skillPropFamily(p.market) === "hits" || skillPropFamily(p.market) === "rbi"),
    "includes hits or RBI props",
  );
  const families = new Set(props.map((p) => skillPropFamily(p.market)).filter(Boolean));
  assert.ok(families.size >= 3, `expected diverse MLB families, got ${[...families]}`);
});

test("fillReservedPropSlots swaps NBA game lines for points / reb / ast props", () => {
  const target = 8;
  const gameHeavy = Array.from({ length: 8 }, (_, i) => ({
    isProp: false,
    sport: "nba",
    market: i % 2 === 0 ? "Spread" : "Total",
    game: `NBAAway${i} @ NBAHome${i}`,
    player: null as string | null,
    pick: i % 2 === 0 ? `Team${i} -4.5` : `Over ${220 + i}.5`,
    side: null as string | null,
    scores: { composite: 40 },
  }));
  const skill = [
    { market: "player_points", player: "Jokic", line: 27.5 },
    { market: "player_rebounds", player: "Gobert", line: 11.5 },
    { market: "player_assists", player: "Haliburton", line: 9.5 },
    { market: "player_threes", player: "Curry", line: 4.5 },
    { market: "player_points_rebounds_assists", player: "Tatum", line: 42.5 },
  ];
  const scored = [
    ...gameHeavy.map((pick, i) => ({ pick, rankScore: 50 - i })),
    ...skill.map((s, i) => ({
      pick: {
        isProp: true,
        sport: "nba",
        market: s.market,
        propMarketKey: s.market,
        propLine: s.line,
        game: `NBAProp${i} @ NBAOpp${i}`,
        player: s.player,
        pick: `Over ${s.line}`,
        side: "Over",
        scores: { composite: 80 },
      },
      rankScore: 90 - i,
    })),
  ];
  const out = fillReservedPropSlots(gameHeavy, scored, target);
  const props = out.filter((p) => p.isProp);
  assert.equal(props.length, boardScanPropSlotCount(8));
  assert.ok(props.some((p) => skillPropFamily(p.market) === "points"), "includes points props");
  assert.ok(props.some((p) => skillPropFamily(p.market) === "rebounds"), "includes rebound props");
  assert.ok(props.some((p) => skillPropFamily(p.market) === "assists"), "includes assist props");
  const families = new Set(props.map((p) => skillPropFamily(p.market)).filter(Boolean));
  assert.ok(families.size >= 3, `expected diverse NBA families, got ${[...families]}`);
});

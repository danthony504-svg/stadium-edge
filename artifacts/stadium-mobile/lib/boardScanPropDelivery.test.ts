import assert from "node:assert/strict";
import test from "node:test";

import {
  boardScanNonPropPreviewCap,
  boardScanPropSlotCount,
  buildFinalCoachParlayNote,
  fillReservedPropSlots,
  footballSkillPropFamily,
  footballSkillPropRank,
  selectFinalCoachParlayPicks,
  shouldKeepAwaitingPropSlots,
} from "./boardScanPropDelivery.ts";
import {
  boardScanGamePhaseBudgetMs,
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

test("game-phase budget leaves room for prop-phase deadline inside Coach wall", () => {
  assert.equal(boardScanGamePhaseBudgetMs(7), 28_000);
  assert.equal(boardScanPropPhaseDeadlineMs(7), 45_000);
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



test("footballSkillPropRank prefers rush/pass/rec/sack over generic props", () => {
  assert.ok(footballSkillPropRank("player_rush_yds") > footballSkillPropRank("player_points"));
  assert.ok(footballSkillPropRank("player_sacks") >= footballSkillPropRank("player_rush_yds"));
  assert.ok(footballSkillPropRank("player_reception_yds") > 0);
  assert.ok(footballSkillPropRank("player_pass_yds") > 0);
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


test("footballSkillPropRank ranks alt rush/pass/rec/sack markets", () => {
  assert.ok(footballSkillPropRank("player_rush_yds_alternate") > 0);
  assert.ok(footballSkillPropRank("player_pass_yds_alternate") > 0);
  assert.ok(footballSkillPropRank("player_reception_yds_alternate") > 0);
  assert.ok(footballSkillPropRank("player_sacks_alternate") >= footballSkillPropRank("player_rush_yds"));
  assert.equal(footballSkillPropFamily("player_pass_yds_alternate"), "pass");
  assert.equal(footballSkillPropFamily("player_rush_yds"), "rush");
  assert.equal(footballSkillPropFamily("player_sacks"), "sack");
  assert.equal(footballSkillPropFamily("moneyline"), null);
});

test("fillReservedPropSlots diversifies rush/pass/rec/sack and keeps alt skill props over ML-only", () => {
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
    ["player_rush_yds", "Barkley", "rush"],
    ["player_pass_yds_alternate", "Allen", "pass"],
    ["player_reception_yds", "Kittle", "rec"],
    ["player_sacks", "Garrett", "sack"],
    ["player_rush_yds_alternate", "Henry", "rush2"],
  ] as const;
  const scored = [
    ...gameHeavy.map((pick, i) => ({ pick, rankScore: 95 - i })),
    ...skill.map(([market, player], i) => ({
      pick: {
        isProp: true,
        market,
        game: `F${i} @ H${i}`,
        player,
        pick: `Over ${i + 1}.5`,
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
  assert.ok(props.some((p) => /rush/i.test(p.market || "")), "includes rush yards");
  assert.ok(props.some((p) => /pass/i.test(p.market || "")), "includes passing yards");
  assert.ok(props.some((p) => /receiv|reception/i.test(p.market || "")), "includes receiving yards");
  assert.ok(props.some((p) => /sack/i.test(p.market || "")), "includes sacks");
  assert.ok(
    props.some((p) => /alternate|alt/i.test(p.market || "")),
    "includes alt skill props when posted",
  );
  const families = new Set(
    props.map((p) => footballSkillPropFamily(p.market)).filter(Boolean),
  );
  assert.ok(families.size >= 3, `expected diverse skill families, got ${[...families]}`);
});

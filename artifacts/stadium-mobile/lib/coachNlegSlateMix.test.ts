/**
 * Parameterized regression: bare N-leg + slate day is always a full-board MIX
 * ask for every supported leg count — never props-only / market-locked.
 *
 * Run: node --experimental-strip-types --test lib/coachNlegSlateMix.test.ts
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  parseCoachAskMarketConstraint,
} from "./coachAskMarketFilter.ts";
import {
  parseRequestedLegs,
  resolveBuildLegTarget,
  isParlayBuildAsk,
} from "./coach/parseAsk.ts";
import { askHasExplicitMarketLock } from "./explicitMarketLock.ts";
import {
  wantsPropsOnly,
  wantsTonightSlate,
  wantsTomorrowSlate,
  slateDayFromThread,
} from "./slate.ts";
import { coachShortfallNote } from "./coach/session.ts";

/** Representative counts — not special-cased in parser code. */
const LEG_COUNTS = [3, 4, 5, 7, 9, 12, 15] as const;

type SlateCase = {
  label: string;
  phrase: (n: number) => string;
  slate: "tonight" | "tomorrow";
};

const SLATE_CASES: SlateCase[] = [
  { label: "N leg tonight", phrase: (n) => `${n} leg tonight`, slate: "tonight" },
  { label: "N legs tonight", phrase: (n) => `${n} legs tonight`, slate: "tonight" },
  { label: "N leg today", phrase: (n) => `${n} leg today`, slate: "tonight" },
  { label: "N leg for today", phrase: (n) => `${n} leg for today`, slate: "tonight" },
  { label: "N leg for tonight", phrase: (n) => `${n} leg for tonight`, slate: "tonight" },
  { label: "N leg tomorrow", phrase: (n) => `${n} leg tomorrow`, slate: "tomorrow" },
  { label: "N leg for tomorrow", phrase: (n) => `${n} leg for tomorrow`, slate: "tomorrow" },
  {
    label: "N leg parlay tonight",
    phrase: (n) => `${n} leg parlay tonight`,
    slate: "tonight",
  },
  {
    label: "N-leg parlay for tonight",
    phrase: (n) => `${n}-leg parlay for tonight`,
    slate: "tonight",
  },
  { label: "N picks tonight", phrase: (n) => `${n} picks tonight`, slate: "tonight" },
];

function assertFullBoardMix(ask: string, n: number, slate: "tonight" | "tomorrow") {
  assert.equal(parseRequestedLegs(ask), n, `${ask}: requestedLegs`);
  assert.equal(resolveBuildLegTarget(ask), n, `${ask}: build target`);
  assert.equal(isParlayBuildAsk(ask), true, `${ask}: parlay build`);
  assert.equal(wantsPropsOnly(ask), false, `${ask}: wantsPropsOnly`);
  const c = parseCoachAskMarketConstraint(ask);
  assert.equal(c.propsOnly, false, `${ask}: propsOnly`);
  assert.equal(c.allowedMarketKeys, null, `${ask}: allowedMarketKeys`);
  assert.equal(c.gameLinesOnly, false, `${ask}: gameLinesOnly`);
  assert.equal(askHasExplicitMarketLock(ask), false, `${ask}: market lock`);
  assert.equal(slateDayFromThread(ask, []), slate, `${ask}: slateDay`);
  if (slate === "tonight") {
    assert.equal(wantsTonightSlate(ask), true, `${ask}: wantsTonightSlate`);
    assert.equal(wantsTomorrowSlate(ask), false, `${ask}: wantsTomorrowSlate`);
  } else {
    assert.equal(wantsTomorrowSlate(ask), true, `${ask}: wantsTomorrowSlate`);
    assert.equal(wantsTonightSlate(ask), false, `${ask}: wantsTonightSlate`);
  }
}

test("parameterized: N-leg + slate day → full-board mix for every supported count", () => {
  for (const n of LEG_COUNTS) {
    for (const sc of SLATE_CASES) {
      assertFullBoardMix(sc.phrase(n), n, sc.slate);
    }
  }
});

test("parameterized: explicit prop-family asks stay locked (contrast with bare N-leg)", () => {
  const explicit: Array<{ ask: string; n: number; keyIncludes: string }> = [
    { ask: "4 player props tonight", n: 4, keyIncludes: "" },
    { ask: "3 touchdowns tonight", n: 3, keyIncludes: "player_anytime_td" },
    { ask: "6 home runs tonight", n: 6, keyIncludes: "batter_home_runs" },
    { ask: "5 receiving yards props tonight", n: 5, keyIncludes: "player_reception_yds" },
  ];
  for (const { ask, n, keyIncludes } of explicit) {
    assert.equal(parseRequestedLegs(ask), n, ask);
    assert.equal(wantsTonightSlate(ask), true, ask);
    const c = parseCoachAskMarketConstraint(ask);
    assert.equal(c.propsOnly, true, ask);
    if (keyIncludes) {
      assert.ok(
        c.allowedMarketKeys != null && c.allowedMarketKeys.includes(keyIncludes),
        `${ask}: expected key ${keyIncludes}, got ${JSON.stringify(c.allowedMarketKeys)}`,
      );
      assert.equal(askHasExplicitMarketLock(ask), true, ask);
    } else {
      // Bare "player props" → propsOnly with open allowlist (no family lock).
      assert.equal(c.allowedMarketKeys, null, ask);
    }
  }
});

test("honest shortfall copy stays under-count (never fabricates to reach N)", () => {
  // 12 requested, 9 cleared quality gates → honest 9/12 note.
  const note = coachShortfallNote(12, 9);
  assert.match(note, /\*\*12\*\*/);
  assert.match(note, /\*\*9\*\*/);
  assert.match(note, /No ungraded filler was added/i);
  assert.equal(coachShortfallNote(12, 12), "");
  // Same pattern for other counts — not hard-coded to 5/7.
  for (const [asked, got] of [
    [5, 3],
    [7, 4],
    [9, 9],
    [15, 11],
  ] as const) {
    if (got >= asked) {
      assert.equal(coachShortfallNote(asked, got), "");
    } else {
      assert.match(coachShortfallNote(asked, got), new RegExp(`\\*\\*${asked}\\*\\*`));
      assert.match(coachShortfallNote(asked, got), new RegExp(`\\*\\*${got}\\*\\*`));
      assert.match(coachShortfallNote(asked, got), /No ungraded filler was added/i);
    }
  }
});

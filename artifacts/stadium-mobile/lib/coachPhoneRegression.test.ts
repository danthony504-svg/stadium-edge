/**
 * Phone regression gate — every ask that broke on-device this week.
 * Run before production OTA: node --experimental-strip-types --test lib/coachPhoneRegression.test.ts
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  parseCoachAskMarketConstraint,
  wantsGameLinesOnlyAsk,
} from "./coachAskMarketFilter.ts";
import { coachPropsAskGameLineMismatchNote } from "./coach/parseAsk.ts";
import {
  wantsPropsOnly,
  wantsMixedSportsAsk,
  threadWantsPropsOnly,
  slateDayFromThread,
} from "./slate.ts";
import {
  maxPropsPerGame,
  selectCorrelationAwareBoardLegs,
  wouldRepeatPlayerProp,
  wouldExceedMaxPropsPerGame,
} from "./parlayCorrelationScore.ts";

// ---------- Routing: ask → propsOnly / gameLinesOnly ----------

test("phone: 5 leg NHL team props → game lines, not player Unders", () => {
  const ask = "5 leg NHL team props";
  assert.equal(wantsPropsOnly(ask), false);
  assert.equal(wantsGameLinesOnlyAsk(ask), true);
  const c = parseCoachAskMarketConstraint(ask);
  assert.equal(c.propsOnly, false);
  assert.equal(c.gameLinesOnly, true);
  assert.equal(
    coachPropsAskGameLineMismatchNote({
      askText: ask,
      propsOnly: false,
      picks: [
        { isProp: false, market: "Spread" },
        { isProp: false, market: "Puck Line" },
        { isProp: false, market: "Moneyline" },
      ],
    }),
    "",
    "must not claim user asked for player props",
  );
});

test("phone: 4 leg NHL team prop (singular) → game lines, quiet mismatch note", () => {
  const ask = "4 leg NHL team prop";
  assert.equal(wantsPropsOnly(ask), false);
  assert.equal(wantsGameLinesOnlyAsk(ask), true);
  assert.equal(
    coachPropsAskGameLineMismatchNote({
      askText: ask,
      propsOnly: false,
      picks: [
        { isProp: false, market: "Spread" },
        { isProp: false, market: "Alt Spread" },
        { isProp: false, market: "Moneyline" },
        { isProp: false, market: "Puck Line" },
      ],
    }),
    "",
  );
});

test("phone: 5 leg NHL player props still props-only", () => {
  const ask = "5 leg NHL player props";
  assert.equal(wantsPropsOnly(ask), true);
  const c = parseCoachAskMarketConstraint(ask);
  assert.equal(c.propsOnly, true);
  assert.equal(c.gameLinesOnly, false);
});

test("phone: 9 leg tonight mixed sports → mix path, not props-only HR stack", () => {
  const ask = "9 leg tonight mixed sports";
  assert.equal(wantsMixedSportsAsk(ask), true);
  assert.equal(wantsPropsOnly(ask), false);
  const c = parseCoachAskMarketConstraint(ask);
  assert.equal(c.propsOnly, false, "was PROPS_ONLY_STAGED_SHORT with 4 HR / 1 game");
  assert.equal(c.gameLinesOnly, false);
  // Prior props-only turn must not stick.
  assert.equal(
    threadWantsPropsOnly(ask, ["7 leg NFL player props"]),
    false,
  );
  // Mix ticket with game lines must not show false player-props warning.
  assert.equal(
    coachPropsAskGameLineMismatchNote({
      askText: ask,
      propsOnly: false,
      picks: [
        { isProp: false, market: "Q2 Spread" },
        { isProp: false, market: "F5 Run Line" },
        { isProp: true, market: "Hits" },
        { isProp: true, market: "Home Runs" },
        { isProp: false, market: "Total" },
        { isProp: false, market: "Spread" },
        { isProp: true, market: "Points" },
        { isProp: true, market: "Rec Yds" },
        { isProp: false, market: "Q4 Spread" },
      ],
    }),
    "",
    "was PROPS_ASK_GOT_GAME_LINES on a correct mix",
  );
});

test("phone: bare N legs + slate day is mix (not props-only)", () => {
  assert.equal(wantsPropsOnly("8 legs tonight"), false);
  assert.equal(wantsPropsOnly("5 leg for tomorrow"), false);
  assert.equal(parseCoachAskMarketConstraint("8 legs tonight").propsOnly, false);
  assert.equal(parseCoachAskMarketConstraint("5 leg for tomorrow").propsOnly, false);
});

test("phone: 7 leg NFL after tonight keeps 48h board (does not inherit tonight)", () => {
  // Screenshot: prior tonight ticket (college ALT) then "7 leg NFL" → empty
  // quality-bar note because inherited tonight wiped Monday NFL games.
  assert.equal(slateDayFromThread("7 leg NFL", ["7 leg tonight"]), null);
  assert.equal(slateDayFromThread("7 leg NFL", ["5 leg for today"]), null);
  assert.equal(wantsPropsOnly("7 leg NFL"), false);
  assert.equal(parseCoachAskMarketConstraint("7 leg NFL").propsOnly, false);
  assert.equal(parseCoachAskMarketConstraint("7 leg NFL").allowedMarketKeys, null);
});

test("phone: Bet365 no O/U NHL → game lines + exclude totals", () => {
  const ask = "Bet365 doesn't have over or under for NHL so give me 4 different ones";
  const c = parseCoachAskMarketConstraint(ask);
  assert.equal(c.gameLinesOnly, true);
  assert.equal(c.excludeTotals, true);
  assert.equal(c.propsOnly, false);
});

// ---------- Diversity: same player / same game props ----------

const leg = (
  game: string,
  market: string,
  pick: string,
  isProp = false,
  player = "",
) => ({
  game,
  market,
  pick,
  odds: -110,
  isProp,
  player: isProp ? player : undefined,
});

test("phone: Chase Meidroth cannot stack Hits + Total Bases + HRR on one ticket", () => {
  const g = "Chicago White Sox @ Cleveland Guardians";
  const hits = leg(g, "Hits", "Chase Meidroth Over 0.5 Hits", true, "Chase Meidroth");
  const tb = leg(g, "Total Bases", "Chase Meidroth Over 0.5 Total Bases", true, "Chase Meidroth");
  const hrr = leg(
    g,
    "Hits+Runs+RBIs",
    "Chase Meidroth Over 0.5 Hits+Runs+RBIs",
    true,
    "Chase Meidroth",
  );
  assert.equal(wouldRepeatPlayerProp(tb, [hits]), true);
  assert.equal(wouldRepeatPlayerProp(hrr, [hits]), true);

  const ranked = [
    { pick: hits, rankScore: 100 },
    { pick: tb, rankScore: 99 },
    { pick: hrr, rankScore: 98 },
    {
      pick: leg(g, "Hits", "Colson Montgomery Under 0.5 Hits", true, "Colson Montgomery"),
      rankScore: 90,
    },
    {
      pick: leg(g, "Hits+Runs+RBIs", "Miguel Vargas Over 1.5", true, "Miguel Vargas"),
      rankScore: 85,
    },
    {
      pick: leg("A @ B", "Points", "Player X Over 20.5", true, "Player X"),
      rankScore: 80,
    },
    { pick: leg("Yankees @ Rays", "F5 Run Line", "Yankees +0.5"), rankScore: 75 },
    { pick: leg("BC @ SMU", "Spread", "Eagles +21.5"), rankScore: 70 },
    { pick: leg("MSU @ Wisconsin", "Total", "Over 43"), rankScore: 65 },
  ];
  const out = selectCorrelationAwareBoardLegs(ranked, 9);
  const meidroth = out.filter((p) => /meidroth/i.test(String(p.player ?? "")));
  assert.equal(meidroth.length, 1, `expected 1 Meidroth, got ${meidroth.length}`);

  // Max 2 props from White Sox @ Guardians.
  const soxProps = out.filter(
    (p) => p.isProp && /white sox/i.test(p.game) && /guardians/i.test(p.game),
  );
  assert.ok(
    soxProps.length <= maxPropsPerGame(9),
    `expected ≤${maxPropsPerGame(9)} props from one game, got ${soxProps.length}`,
  );
});

test("phone: White Sox game cannot take a 3rd prop on a 9-leg mix", () => {
  const g = "Chicago White Sox @ Cleveland Guardians";
  const ticket = [
    leg(g, "Hits", "A Over 0.5", true, "Player A"),
    leg(g, "Hits", "B Under 0.5", true, "Player B"),
  ];
  assert.equal(maxPropsPerGame(9), 2);
  assert.equal(
    wouldExceedMaxPropsPerGame(leg(g, "Hits", "C Over 0.5", true, "Player C"), ticket, 2),
    true,
  );
});

test("phone: NHL Under 0.5 Points stack — multi-game prefers one market+side per game first", async () => {
  // Coverage lives in coachFootballPropsOnly.test.ts; assert the ask still
  // routes correctly so props-only diversity applies when they DO ask player props.
  assert.equal(wantsPropsOnly("5 leg NHL"), true);
  assert.equal(wantsPropsOnly("5 leg NHL team props"), false);
});

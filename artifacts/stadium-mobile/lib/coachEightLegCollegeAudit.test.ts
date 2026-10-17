/**
 * Regression: exact ask "8 leg college" through parse → scope → P0 gate → copy.
 *
 * Funnel (while NCAAF_GAME_LINE_SIM_VALIDATED=false):
 *   parse → gameLinesOnly + NCAAF lock (team markets, not player props)
 *   provider board → would load NCAAF game lines only
 *   normalized candidates → every FG side/total is P0-blocked
 *   simulation → short-circuited (ask-only early exit; no slate MC)
 *   qualification → 0
 *   final delivery → empty ticket + unvalidated-sim note (not "quality bar")
 */
import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  askAllowsNcaafPlayerProps,
  askIsCollegeFootballOnly,
  askRequiresFootballPropMix,
} from "./boardScanPropDelivery.ts";
import { parseCoachAskMarketConstraint } from "./coachAskMarketFilter.ts";
import {
  bareCollegeClarificationNote,
  hardLockedSportsFromAsk,
  isAmbiguousCollegeSportAsk,
  isBareCollegeTokenAsk,
} from "./coachAskSportScope.ts";
import {
  NCAAF_GAME_LINE_SIM_VALIDATED,
  ncaafGameLineAskIsP0Blocked,
  p0BlockedNcaafGameLineAskNote,
  isP0UnvalidatedNcaafGameLineMarket,
  gameLineCandidatesFullyP0Blocked,
} from "./coachP0UnvalidatedTotals.ts";
import { sanitizeCoachUserNote } from "./sanitizeCoachUserNote.ts";
import { resolveBuildLegTarget } from "./coach/parseAsk.ts";
import { coachBoardSportsForAsk } from "./coachPropBoardCoverage.ts";
import { DEFAULT_SPORTS } from "./sports.ts";

const ASK = "8 leg college";

test("8 leg college: parse scopes to NCAAF team markets (not player props)", () => {
  const target = resolveBuildLegTarget(ASK);
  const market = parseCoachAskMarketConstraint(ASK);
  assert.equal(target, 8);
  assert.equal(askIsCollegeFootballOnly(ASK), true);
  assert.equal(askAllowsNcaafPlayerProps(ASK), false);
  assert.equal(askRequiresFootballPropMix(ASK), false);
  assert.equal(market.gameLinesOnly, true);
  assert.equal(market.propsOnly, false);
  assert.deepEqual(hardLockedSportsFromAsk(ASK), ["ncaaf"]);
  assert.deepEqual(coachBoardSportsForAsk(ASK, 8, DEFAULT_SPORTS), ["ncaaf"]);
});

test("8 leg college: ambiguous college clarifies FB vs BB (does not silently pick CBB)", () => {
  assert.equal(isBareCollegeTokenAsk(ASK), true);
  assert.equal(isAmbiguousCollegeSportAsk(ASK), true);
  const clar = bareCollegeClarificationNote(ASK);
  assert.ok(clar);
  assert.match(clar!, /college football \(NCAAF\)/i);
  assert.match(clar!, /college basketball/i);
  assert.doesNotMatch(clar!, /quality bar/i);
  // Explicit CBB is not ambiguous and must not lock to NCAAF-only.
  assert.equal(isAmbiguousCollegeSportAsk("8 leg college basketball"), false);
  assert.deepEqual(hardLockedSportsFromAsk("8 leg college basketball"), ["ncaab"]);
});

test("8 leg college: NCAAF_GAME_LINE_SIM_VALIDATED=false causes empty P0 path", () => {
  assert.equal(
    NCAAF_GAME_LINE_SIM_VALIDATED,
    false,
    "keep Phase E armed until validation supports enabling it",
  );
  const market = parseCoachAskMarketConstraint(ASK);
  const gameLinesOnly = market.gameLinesOnly && !market.propsOnly;
  const lockedSports = hardLockedSportsFromAsk(ASK);
  assert.equal(
    ncaafGameLineAskIsP0Blocked({ gameLinesOnly, lockedSports }),
    true,
  );
  // Supported team markets are still recognized as P0-blocked candidates
  // (sides via game-line gate; totals via totals gate — combined decision).
  for (const marketName of ["Spread", "Moneyline", "Alt Spread"]) {
    assert.equal(
      isP0UnvalidatedNcaafGameLineMarket({ market: marketName, sport: "ncaaf" }),
      true,
      marketName,
    );
  }
  assert.equal(
    gameLineCandidatesFullyP0Blocked([
      { market: "Spread", sport: "ncaaf", isProp: false },
      { market: "Moneyline", sport: "ncaaf", isProp: false },
      { market: "Total", sport: "ncaaf", isProp: false },
    ]),
    true,
    "full NCAAF game-line board is P0-blocked under the flag",
  );
  // Unavailable college player props stay outside this gate (open when asked).
  assert.equal(
    isP0UnvalidatedNcaafGameLineMarket({
      market: "Passing Yards",
      sport: "ncaaf",
      isProp: true,
      propMarketKey: "player_pass_yds",
    }),
    false,
  );
  assert.equal(
    ncaafGameLineAskIsP0Blocked({
      gameLinesOnly: false,
      lockedSports: ["ncaaf"],
    }),
    false,
    "explicit props / mix path must still run sims",
  );
});

test("8 leg college: user note is short unavailable copy, not quality-bar failure", () => {
  const t0 = performance.now();
  const target = resolveBuildLegTarget(ASK) ?? 8;
  const market = parseCoachAskMarketConstraint(ASK);
  const gameLinesOnly = market.gameLinesOnly && !market.propsOnly;
  const lockedSports = hardLockedSportsFromAsk(ASK);
  const blocked = ncaafGameLineAskIsP0Blocked({ gameLinesOnly, lockedSports });
  const note = sanitizeCoachUserNote(p0BlockedNcaafGameLineAskNote(target));
  const ms = performance.now() - t0;

  assert.equal(blocked, true);
  assert.equal(target, 8);
  assert.equal(
    note,
    "College football team picks are temporarily unavailable while validation is completed. No ticket was built.",
  );
  assert.doesNotMatch(note, /quality bar/i);
  assert.doesNotMatch(note, /cleared the AI/i);
  assert.doesNotMatch(note, /player props/i);
  assert.ok(ms < 500, `ask-only P0 path must be <500ms (got ${ms.toFixed(1)}ms)`);
});

test("buildParlay wires 8-leg-college P0 gate before loadScanInputs", () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "coach/buildParlay.ts"),
    "utf8",
  );
  assert.match(src, /ncaafGameLineAskIsP0Blocked/);
  assert.match(src, /p0BlockedNcaafGameLineAskNote/);
  assert.match(src, /blocked_unvalidated_market|BLOCKED_UNVALIDATED_MARKET_REASON/);
  assert.doesNotMatch(
    src.slice(src.indexOf("ncaafGameLineAskIsP0Blocked"), src.indexOf("await loadScanInputs")),
    /bareCollegeClarificationNote/,
  );
  const gateAt = src.indexOf("ncaafGameLineAskIsP0Blocked");
  const loadAt = src.indexOf("await loadScanInputs");
  assert.ok(gateAt > 0 && loadAt > gateAt, "P0 gate must precede loadScanInputs");
});

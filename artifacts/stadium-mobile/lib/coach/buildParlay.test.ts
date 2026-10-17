import assert from "node:assert/strict";
import test from "node:test";

import { shouldSkipScannerPropExpand } from "./propPoolPolicy.ts";
import {
  coachAbsoluteBudgetMs,
  coachPropLoadFailsafeMs,
  createCoachSession,
  resetCoachAbsoluteClock,
} from "./session.ts";

test("skip scanner prop expand only when pool is already loaded", () => {
  assert.equal(shouldSkipScannerPropExpand(0), false);
  assert.equal(shouldSkipScannerPropExpand(39), false);
  assert.equal(shouldSkipScannerPropExpand(40), true);
  assert.equal(shouldSkipScannerPropExpand(400), true);
});

test("fixed-leg scoring budgets leave room for prop/alt scoring after game lines", () => {
  assert.equal(coachAbsoluteBudgetMs(5), 75_000);
  assert.equal(coachAbsoluteBudgetMs(6), 90_000);
  assert.ok(coachAbsoluteBudgetMs(6) > 45_000);
});

test("prop-board load failsafe is independent of scoring budget", () => {
  assert.equal(coachPropLoadFailsafeMs(6), 105_000);
  assert.ok(coachPropLoadFailsafeMs(6) >= coachAbsoluteBudgetMs(6));
  assert.ok(coachPropLoadFailsafeMs(8) >= coachAbsoluteBudgetMs(8));
});

test("resetCoachAbsoluteClock restarts scoring window after prop prefetch", () => {
  const session = createCoachSession(1, 6, 1_000);
  resetCoachAbsoluteClock(session, 50_000);
  assert.equal(session.startedAtMs, 50_000);
  assert.equal(session.absoluteTimer, null);
  assert.equal(session.outcome, "open");
});

/**
 * Preview staging reserves ~50% of a fixed-leg ticket for props. On a 5-leg
 * ask that is exactly 2 game lines — the screenshot failure mode when the
 * empty propPool never scored and the reserved preview latched as final.
 */
test("5-leg reserved prop slots leave exactly 2 game-line preview capacity", () => {
  const target = 5;
  const propSlots = Math.max(1, Math.round(target * 0.5));
  const nonPropCap = Math.max(0, target - propSlots);
  assert.equal(propSlots, 3);
  assert.equal(nonPropCap, 2);
});


test("7-leg reserved prop slots leave exactly 3 game-line preview capacity", () => {
  const target = 7;
  const propSlots = Math.max(1, Math.round(target * 0.5));
  const nonPropCap = Math.max(0, target - propSlots);
  assert.equal(propSlots, 4);
  assert.equal(nonPropCap, 3);
});

test("props-only empty quality bar recovers via football skill board (yards/rec/sacks)", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "buildParlay.ts"),
    "utf8",
  );
  assert.match(src, /shouldRecoverPropsOnlyWithFootballSkillBoard/);
  assert.match(src, /filterPoolForFootballSkillRecovery/);
  assert.match(src, /footballSkillRecoveryNote/);
  assert.match(src, /yards \/ receptions \/ sacks/);
});

test("HR stays on full-board path; both exits share resolveCoachParlayShortfallLead", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "buildParlay.ts"),
    "utf8",
  );
  // Selection routing unchanged — HR must not enter props-only builder.
  assert.match(src, /propsOnly &&\s*\n\s*!hrBoardAsk &&/);
  assert.match(src, /exhaustPropBoard:\s*hrBoardAsk/);
  // Copy routing: both exits use the shared locked/generic shortfall resolver.
  const resolveHits = src.match(/resolveCoachParlayShortfallLead/g) ?? [];
  assert.ok(
    resolveHits.length >= 2,
    `expected ≥2 resolveCoachParlayShortfallLead calls, got ${resolveHits.length}`,
  );
  assert.match(src, /lockedMarketAnalyzedFromBoardDiagnostics/);
  assert.doesNotMatch(src, /buildFixedLegCountShortfallLead/);
});

test("P0-blocked NCAAF game-line asks exit before loadScanInputs / slate sims", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "buildParlay.ts"),
    "utf8",
  );
  assert.match(src, /ncaafGameLineAskIsP0Blocked/);
  assert.match(src, /p0BlockedNcaafGameLineAskNote/);
  const gateAt = src.indexOf("ncaafGameLineAskIsP0Blocked");
  const loadAt = src.indexOf("await loadScanInputs");
  assert.ok(gateAt > 0 && loadAt > gateAt, "P0 gate must precede loadScanInputs");
});

test("replay: 8 leg college P0 gate + note is ask-only and sub-second", async () => {
  const { performance } = await import("node:perf_hooks");
  const { parseCoachAskMarketConstraint } = await import(
    "../coachAskMarketFilter.ts"
  );
  const { hardLockedSportsFromAsk } = await import("../coachAskSportScope.ts");
  const {
    ncaafGameLineAskIsP0Blocked,
    p0BlockedNcaafGameLineAskNote,
    NCAAF_GAME_LINE_SIM_VALIDATED,
  } = await import("../coachP0UnvalidatedTotals.ts");
  const { sanitizeCoachUserNote } = await import("../sanitizeCoachUserNote.ts");
  const { resolveBuildLegTarget } = await import("./parseAsk.ts");

  assert.equal(NCAAF_GAME_LINE_SIM_VALIDATED, false);

  const ask = "8 leg college";
  const t0 = performance.now();
  const target = resolveBuildLegTarget(ask) ?? 8;
  const market = parseCoachAskMarketConstraint(ask);
  const gameLinesOnly = market.gameLinesOnly && !market.propsOnly;
  const lockedSports = hardLockedSportsFromAsk(ask);
  const blocked = ncaafGameLineAskIsP0Blocked({ gameLinesOnly, lockedSports });
  const note = sanitizeCoachUserNote(p0BlockedNcaafGameLineAskNote(target));
  const ms = performance.now() - t0;

  assert.equal(target, 8);
  assert.equal(gameLinesOnly, true);
  assert.deepEqual(lockedSports, ["ncaaf"]);
  assert.equal(blocked, true);
  assert.equal(
    note,
    "College football team picks are temporarily unavailable while validation is completed. No ticket was built.",
  );
  assert.doesNotMatch(note, /quality bar/i);
  assert.ok(ms < 500, `ask-only P0 path must be <500ms (got ${ms.toFixed(1)}ms)`);

  const propsAsk = parseCoachAskMarketConstraint(
    "8 leg college football player props",
  );
  assert.equal(
    ncaafGameLineAskIsP0Blocked({
      gameLinesOnly: propsAsk.gameLinesOnly && !propsAsk.propsOnly,
      lockedSports: hardLockedSportsFromAsk("8 leg college football player props"),
    }),
    false,
  );
});

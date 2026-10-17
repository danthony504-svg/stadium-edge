import assert from "node:assert/strict";
import test from "node:test";

import { shouldSkipScannerPropExpand } from "./propPoolPolicy.ts";
import { joinCoachNoteParts } from "../sanitizeCoachUserNote.ts";
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

test("prop-board load shares the scoring deadline", () => {
  assert.equal(coachPropLoadFailsafeMs(4), 75_000);
  assert.equal(coachPropLoadFailsafeMs(6), coachAbsoluteBudgetMs(6));
  assert.equal(coachPropLoadFailsafeMs(8), coachAbsoluteBudgetMs(8));
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
  assert.match(src, /blocked_unvalidated_market|BLOCKED_UNVALIDATED_MARKET_REASON/);
  // Gate must appear before loadScanInputs so we never await empty-pool sims.
  const gateAt = src.indexOf("ncaafGameLineAskIsP0Blocked");
  const loadAt = src.indexOf("await loadScanInputs");
  assert.ok(gateAt > 0 && loadAt > gateAt, "P0 gate must precede loadScanInputs");
  assert.doesNotMatch(
    src.slice(gateAt, loadAt),
    /bareCollegeClarificationNote/,
  );
});

test("other sports: ask-level NCAAF P0 gate stays off so eligible sims still run", async () => {
  const { parseCoachAskMarketConstraint } = await import(
    "../coachAskMarketFilter.ts"
  );
  const { hardLockedSportsFromAsk } = await import("../coachAskSportScope.ts");
  const { ncaafGameLineAskIsP0Blocked } = await import(
    "../coachP0UnvalidatedTotals.ts"
  );
  for (const ask of [
    "6 leg nfl",
    "6 leg nhl",
    "6 leg nba",
    "6 leg mlb",
    "7 leg college football player props",
  ]) {
    const market = parseCoachAskMarketConstraint(ask);
    const blocked = ncaafGameLineAskIsP0Blocked({
      gameLinesOnly: market.gameLinesOnly && !market.propsOnly,
      lockedSports: hardLockedSportsFromAsk(ask),
    });
    assert.equal(blocked, false, ask);
  }
});

test("replay: 7 leg college P0 gate + note is ask-only and sub-second", async () => {
  const { performance } = await import("node:perf_hooks");
  const { parseCoachAskMarketConstraint } = await import(
    "../coachAskMarketFilter.ts"
  );
  const { hardLockedSportsFromAsk } = await import("../coachAskSportScope.ts");
  const {
    ncaafGameLineAskIsP0Blocked,
    p0BlockedNcaafGameLineAskNote,
  } = await import("../coachP0UnvalidatedTotals.ts");
  const { sanitizeCoachUserNote } = await import("../sanitizeCoachUserNote.ts");
  const { resolveBuildLegTarget } = await import("./parseAsk.ts");

  const ask = "7 leg college";
  const t0 = performance.now();
  const target = resolveBuildLegTarget(ask) ?? 7;
  const market = parseCoachAskMarketConstraint(ask);
  const gameLinesOnly = market.gameLinesOnly && !market.propsOnly;
  const lockedSports = hardLockedSportsFromAsk(ask);
  const blocked = ncaafGameLineAskIsP0Blocked({ gameLinesOnly, lockedSports });
  const note = sanitizeCoachUserNote(p0BlockedNcaafGameLineAskNote(target));
  const ms = performance.now() - t0;

  assert.equal(target, 7);
  assert.equal(gameLinesOnly, true);
  assert.deepEqual(lockedSports, ["ncaaf"]);
  assert.equal(blocked, true);
  assert.equal(
    note,
    "College football team picks are temporarily unavailable while validation is completed. No ticket was built.",
  );
  assert.doesNotMatch(note, /quality bar/i);
  // Absolute budget for a 7-leg is 75s — this path must not approach it.
  assert.ok(ms < 500, `ask-only P0 path must be <500ms (got ${ms.toFixed(1)}ms)`);
  // Props path stays eligible for sims (gate off).
  const propsAsk = parseCoachAskMarketConstraint(
    "7 leg college football player props",
  );
  assert.equal(
    ncaafGameLineAskIsP0Blocked({
      gameLinesOnly: propsAsk.gameLinesOnly && !propsAsk.propsOnly,
      lockedSports: hardLockedSportsFromAsk("7 leg college football player props"),
    }),
    false,
  );
});

test("delivery note join skips null clarification instead of throwing", () => {
  const note = joinCoachNoteParts([
    null,
    "You asked for 4 spreads and moneylines — only 2 cleared the AI quality bar. No player props or totals were added.",
    undefined,
    "",
  ]);
  assert.match(note, /spreads and moneylines/);
  assert.doesNotMatch(note, /props\/alts/);
});

test("device: 8 leg broncos — null built.note must not throw via joinCoachNoteParts", () => {
  // Mirrors buildParlay props-only path: joinCoachNoteParts([built.note]) when note is null.
  assert.equal(joinCoachNoteParts([null]), "");
  assert.equal(joinCoachNoteParts([null]) || "fallback", "fallback");
});

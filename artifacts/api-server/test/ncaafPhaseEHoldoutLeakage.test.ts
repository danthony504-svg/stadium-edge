/**
 * Prove Phase E holdout venue/L10 inputs use only games strictly before the
 * evaluated kickoff (no same-game or future leakage).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { blendVenueAndL10 } from "../src/lib/sportSim/footballDriveMatchup.ts";
import {
  footballFormMayIncludePriorGame,
  FOOTBALL_PRIOR_GAME_COMPLETE_MS,
  walkHoldoutGames,
} from "../src/lib/sportSim/footballCalibration.ts";

const here = dirname(fileURLToPath(import.meta.url));

type EspnGame = {
  eventId: string;
  season: number;
  week: number;
  kickoffIso?: string;
  homeTeamId: string;
  awayTeamId: string;
  homeFg: number;
  awayFg: number;
};

type TeamForm = {
  ptsFor: number[];
  ptsAgainst: number[];
  homeFor: number[];
  homeAgainst: number[];
  awayFor: number[];
  awayAgainst: number[];
  /** Kickoffs that contributed to the arrays (parallel audit trail). */
  contribKickoffs: string[];
};

function mean(xs: number[], fallback: number): number {
  if (!xs.length) return fallback;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function gameKey(g: EspnGame): string {
  return `${g.season}-${String(g.week).padStart(2, "0")}-${g.kickoffIso ?? ""}-${g.eventId}`;
}

test("holdout form inputs are strictly pre-kickoff (no leakage)", () => {
  const raw = JSON.parse(
    readFileSync(join(here, "fixtures/ncaaf-phase-e-games.json"), "utf8"),
  ) as { games?: EspnGame[] } | EspnGame[];
  const games = Array.isArray(raw) ? raw : (raw.games ?? []);

  let scored = 0;
  let checkedContributors = 0;
  let firstKick: string | null = null;
  let lastKick: string | null = null;
  const HOLDOUT = 2024;

  walkHoldoutGames(games, (g, forms) => {
    const home = forms.get(g.homeTeamId);
    const away = forms.get(g.awayTeamId);
    if (g.season !== HOLDOUT || !home || !away) return;
    if (home.ptsFor.length < 2 || away.ptsFor.length < 2) return;
    const selectionMs = Date.parse(String(g.kickoffIso ?? ""));
    assert.ok(Number.isFinite(selectionMs), `missing kickoff on ${g.eventId}`);
    for (const [kick, eventId] of [
      ...home.contribKickoffs.map((kickoff, i) => [kickoff, home.contribEventIds[i]] as const),
      ...away.contribKickoffs.map((kickoff, i) => [kickoff, away.contribEventIds[i]] as const),
    ]) {
      assert.notEqual(eventId, g.eventId, `evaluated game ${g.eventId} is inside its own form`);
      const priorMs = Date.parse(kick);
      assert.ok(Number.isFinite(priorMs), `contributor ${eventId} has no kickoff`);
      assert.ok(
        priorMs + FOOTBALL_PRIOR_GAME_COMPLETE_MS <= selectionMs,
        `form game ${eventId} at ${kick} is not complete before ${g.kickoffIso}`,
      );
      assert.equal(footballFormMayIncludePriorGame(kick, g.kickoffIso), true);
      checkedContributors += 1;
    }
    const homeVenue = {
      games: Math.min(10, home.homeFor.length),
      ptsFor: home.homeFor.length ? mean(home.homeFor.slice(-10), 24) : null,
      ptsAgainst: home.homeAgainst.length ? mean(home.homeAgainst.slice(-10), 24) : null,
    };
    const awayVenue = {
      games: Math.min(10, away.awayFor.length),
      ptsFor: away.awayFor.length ? mean(away.awayFor.slice(-10), 24) : null,
      ptsAgainst: away.awayAgainst.length ? mean(away.awayAgainst.slice(-10), 24) : null,
    };
    const homeL10 = {
      games: Math.min(10, home.ptsFor.length),
      ptsFor: mean(home.ptsFor.slice(-10), 24),
      ptsAgainst: mean(home.ptsAgainst.slice(-10), 24),
    };
    const awayL10 = {
      games: Math.min(10, away.ptsFor.length),
      ptsFor: mean(away.ptsFor.slice(-10), 24),
      ptsAgainst: mean(away.ptsAgainst.slice(-10), 24),
    };
    assert.ok(blendVenueAndL10(homeVenue, homeL10).ptsFor != null);
    assert.ok(blendVenueAndL10(awayVenue, awayL10).ptsFor != null);
    scored += 1;
    firstKick = firstKick ?? String(g.kickoffIso);
    lastKick = String(g.kickoffIso);
  });
  assert.ok(checkedContributors > 1000, `expected timestamped contributors, got ${checkedContributors}`);

  assert.ok(scored >= 200, `expected ≥200 holdout scored games, got ${scored}`);
  const report = JSON.parse(
    readFileSync(join(here, "fixtures/ncaaf-phase-e-calibration-report.json"), "utf8"),
  ) as {
    generatedAt?: string;
    engine?: string;
    calibrationSeed?: number;
    simulationsPerGame?: number;
    nHoldoutScored?: number;
    metrics?: { meanP?: number; meanY?: number; homeWinBias?: number };
    verdicts?: Record<string, string>;
    keepP0Armed?: boolean;
    flagFlipAllowed?: boolean;
    closingLineArchive?: { present?: boolean; joinedHoldoutRows?: number };
    priorE2aClaim?: { status?: string; restored?: boolean; reportGeneratedAt?: string };
  };
  assert.equal(report.priorE2aClaim?.status, "WITHDRAWN");
  assert.equal(report.priorE2aClaim?.restored, false);
  assert.equal(report.priorE2aClaim?.reportGeneratedAt, "2026-10-14T21:24:31.034Z");
  assert.match(String(report.engine), /ppg-per-drive-v1/);
  assert.equal(report.calibrationSeed, 20241015);
  assert.equal(report.simulationsPerGame, 10000);
  assert.notEqual(report.generatedAt, "2026-10-14T21:24:31.034Z");
  assert.ok(
    report.verdicts?.E2_outcomeVsCoin === "PASS" ||
      report.verdicts?.E2_outcomeVsCoin === "FAIL",
    `new E2a measurement must be PASS or FAIL, got ${report.verdicts?.E2_outcomeVsCoin}`,
  );
  assert.notEqual(report.verdicts?.E2_closingLineClv, "PASS");
  assert.equal(report.closingLineArchive?.present, true);
  assert.ok((report.closingLineArchive?.joinedHoldoutRows ?? 0) >= 200);
  const provenance = (report.closingLineArchive as { provenance?: { commit?: string; restored?: boolean; verdict?: string; coachPickClv?: string } }).provenance;
  assert.equal(provenance?.commit, "7fbf065a607899c49d2e5aa1d636160b74ca0eb4");
  assert.equal(provenance?.verdict, "PASS");
  assert.equal(provenance?.coachPickClv, "COMPUTED_NO_PASS_LABEL");
  assert.equal(provenance?.restored, false);
  assert.equal(report.keepP0Armed, true);
  assert.equal(report.flagFlipAllowed, false);
  assert.match(String(report.verdicts?.NCAAF_GAME_LINE_SIM_VALIDATED), /false/i);

  // Emit audit line for the agent report (stdout).
  console.log(
    JSON.stringify({
      holdoutSeason: HOLDOUT,
      scoredLeakChecked: scored,
      reportScored: report.nHoldoutScored,
      firstKickoff: firstKick,
      lastKickoff: lastKick,
      meanP: report.metrics?.meanP,
      meanY: report.metrics?.meanY,
      homeWinBias: report.metrics?.homeWinBias,
      E2a: report.verdicts?.E2_outcomeVsCoin,
      flag: report.verdicts?.NCAAF_GAME_LINE_SIM_VALIDATED,
    }),
  );
});

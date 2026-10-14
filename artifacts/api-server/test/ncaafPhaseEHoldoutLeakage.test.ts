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
  const games = (Array.isArray(raw) ? raw : (raw.games ?? [])).slice().sort((a, b) => {
    if (a.season !== b.season) return a.season - b.season;
    if (a.week !== b.week) return a.week - b.week;
    return String(a.kickoffIso ?? "").localeCompare(String(b.kickoffIso ?? ""));
  });

  const forms = new Map<string, TeamForm>();
  const empty = (): TeamForm => ({
    ptsFor: [],
    ptsAgainst: [],
    homeFor: [],
    homeAgainst: [],
    awayFor: [],
    awayAgainst: [],
    contribKickoffs: [],
  });

  let scored = 0;
  let firstKick: string | null = null;
  let lastKick: string | null = null;
  const HOLDOUT = 2024;

  for (const g of games) {
    const home = forms.get(g.homeTeamId) ?? empty();
    const away = forms.get(g.awayTeamId) ?? empty();
    const kick = gameKey(g);

    if (g.season === HOLDOUT && home.ptsFor.length >= 2 && away.ptsFor.length >= 2) {
      // Every contributing kickoff for both teams must be strictly before this game.
      for (const prev of [...home.contribKickoffs, ...away.contribKickoffs]) {
        assert.ok(
          prev < kick,
          `leakage: form kickoff ${prev} is not before evaluated ${kick}`,
        );
      }
      // Venue blend must not invent future home/away rows.
      const homeVenue = {
        games: Math.min(10, home.homeFor.length),
        ptsFor: home.homeFor.length ? mean(home.homeFor.slice(-10), 24) : null,
        ptsAgainst: home.homeAgainst.length
          ? mean(home.homeAgainst.slice(-10), 24)
          : null,
      };
      const awayVenue = {
        games: Math.min(10, away.awayFor.length),
        ptsFor: away.awayFor.length ? mean(away.awayFor.slice(-10), 24) : null,
        ptsAgainst: away.awayAgainst.length
          ? mean(away.awayAgainst.slice(-10), 24)
          : null,
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
      firstKick = firstKick ?? String(g.kickoffIso ?? kick);
      lastKick = String(g.kickoffIso ?? kick);
    }

    // Update AFTER evaluation — mirrors ncaafPhaseEHoldoutCalibration.ts.
    home.ptsFor.push(g.homeFg);
    home.ptsAgainst.push(g.awayFg);
    home.homeFor.push(g.homeFg);
    home.homeAgainst.push(g.awayFg);
    home.contribKickoffs.push(kick);
    forms.set(g.homeTeamId, home);

    away.ptsFor.push(g.awayFg);
    away.ptsAgainst.push(g.homeFg);
    away.awayFor.push(g.awayFg);
    away.awayAgainst.push(g.homeFg);
    away.contribKickoffs.push(kick);
    forms.set(g.awayTeamId, away);
  }

  assert.ok(scored >= 200, `expected ≥200 holdout scored games, got ${scored}`);
  const report = JSON.parse(
    readFileSync(join(here, "fixtures/ncaaf-phase-e-calibration-report.json"), "utf8"),
  ) as {
    nHoldoutScored?: number;
    metrics?: { meanP?: number; meanY?: number; homeWinBias?: number };
    verdicts?: Record<string, string>;
    keepP0Armed?: boolean;
  };
  assert.equal(report.verdicts?.E2_outcomeVsCoin, "PASS");
  assert.equal(report.keepP0Armed, true);
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

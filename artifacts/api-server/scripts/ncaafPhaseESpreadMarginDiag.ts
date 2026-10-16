/**
 * Pre-cutoff-only margin dispersion / bias diagnostic for NCAAF ATS.
 * Uses kickoffs STRICTLY before UNTOUCHED_CUTOFF so the untouched holdout
 * stays unused for any model tuning decision.
 *
 * Does NOT flip NCAAF_GAME_LINE_SIM_VALIDATED.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runNflDriveSim } from "../src/lib/sportSim/nflDriveSim.ts";
import { blendVenueAndL10 } from "../src/lib/sportSim/footballDriveMatchup.ts";
import {
  FOOTBALL_CALIBRATION_PRIMARY_SEED,
  loadClosingLineArchive,
  loadFootballCompletionStamps,
  mulberry32,
  walkHoldoutGames,
  type HoldoutWalkForm,
} from "../src/lib/sportSim/footballCalibration.ts";

const here = dirname(fileURLToPath(import.meta.url));
const SIMS = Number(process.env.NCAAF_PHASE_E_SIMS ?? 2_500);
const UNTOUCHED_CUTOFF = process.env.NCAAF_UNTOUCHED_CUTOFF ?? "2024-10-15T00:00:00Z";
const HOLDOUT_SEASON = 2024;

type EspnGame = {
  eventId: string;
  season: number;
  week: number;
  kickoffIso?: string;
  completedAtIso?: string | null;
  homeTeamId: string;
  awayTeamId: string;
  homeFg: number;
  awayFg: number;
};

function mean(xs: number[], fb = 0): number {
  if (!xs.length) return fb;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function sd(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return Math.sqrt(s / (xs.length - 1));
}

function teamSimInput(form: HoldoutWalkForm | undefined, venue: "home" | "away") {
  const l10For = form?.ptsFor.slice(-10) ?? [];
  const l10Against = form?.ptsAgainst.slice(-10) ?? [];
  const venueFor =
    venue === "home" ? form?.homeFor.slice(-10) ?? [] : form?.awayFor.slice(-10) ?? [];
  const venueAgainst =
    venue === "home"
      ? form?.homeAgainst.slice(-10) ?? []
      : form?.awayAgainst.slice(-10) ?? [];
  const l10 = {
    games: l10For.length,
    ptsFor: l10For.length >= 2 ? mean(l10For, 24) : null,
    ptsAgainst: l10Against.length >= 2 ? mean(l10Against, 24) : null,
  };
  const vs = {
    games: venueFor.length,
    ptsFor: venueFor.length ? mean(venueFor, 24) : null,
    ptsAgainst: venueAgainst.length ? mean(venueAgainst, 24) : null,
  };
  const blended = blendVenueAndL10(vs, l10);
  return {
    ptsFor: blended.ptsFor,
    ptsAgainst: blended.ptsAgainst,
    recentScores: l10For.slice(),
  };
}

function main() {
  const fix = join(here, "../test/fixtures");
  const art = "/opt/cursor/artifacts";
  mkdirSync(art, { recursive: true });

  const gamesRaw = JSON.parse(
    readFileSync(join(fix, "ncaaf-phase-e-games.json"), "utf8"),
  ) as { games: EspnGame[] };
  const stamps = loadFootballCompletionStamps(
    join(fix, "football-completion-timestamps.json"),
  );
  const archive = loadClosingLineArchive(join(fix, "ncaaf-phase-e-closing-lines.json"));
  const closeById = new Map(
    archive.rows.map((g) => [String(g.eventId), g] as const),
  );

  const games = gamesRaw.games
    .filter(
      (g) =>
        g.season === HOLDOUT_SEASON &&
        g.kickoffIso &&
        g.homeTeamId &&
        g.awayTeamId &&
        Number.isFinite(g.homeFg) &&
        Number.isFinite(g.awayFg),
    )
    .map((g) => ({
      ...g,
      completedAtIso: stamps.get(String(g.eventId)) ?? g.completedAtIso ?? null,
    }));

  type Row = {
    eventId: string;
    line: number;
    actualMargin: number;
    projMargin: number;
    simMarginSd: number;
    residual: number;
    pCover: number;
    yCover: number | null;
  };
  const pre: Row[] = [];
  const rng = mulberry32(FOOTBALL_CALIBRATION_PRIMARY_SEED);

  walkHoldoutGames(games, (g, forms) => {
    const kick = String(g.kickoffIso ?? "");
    if (kick >= UNTOUCHED_CUTOFF) return; // pre-cutoff only
    const close = closeById.get(String(g.eventId));
    if (!close || close.closeSpreadHome == null || !Number.isFinite(close.closeSpreadHome)) {
      return;
    }
    const homeIn = teamSimInput(forms.get(g.homeTeamId), "home");
    const awayIn = teamSimInput(forms.get(g.awayTeamId), "away");
    if (homeIn.ptsFor == null || awayIn.ptsFor == null) return;

    const line = Number(close.closeSpreadHome);
    const result = runNflDriveSim({
      sport: "ncaaf",
      ncaafResearchCalibration: true,
      simulations: SIMS,
      random: rng,
      home: {
        ptsFor: homeIn.ptsFor,
        ptsAgainst: homeIn.ptsAgainst,
        recentScores: homeIn.recentScores,
      },
      away: {
        ptsFor: awayIn.ptsFor,
        ptsAgainst: awayIn.ptsAgainst,
        recentScores: awayIn.recentScores,
      },
      coverQueries: [
        { id: "home-ats", kind: "spread", teamSide: "home", line },
      ],
      retainOutcomes: true,
    });
    if (!result?.outcomes?.homeScores?.length) return;

    const hs = result.outcomes.homeScores;
    const as = result.outcomes.awayScores;
    const margins = hs.map((h, i) => h - (as[i] ?? 0));
    const projMargin = mean(margins);
    const simMarginSd = sd(margins) ?? 0;
    const actualMargin = g.homeFg - g.awayFg;
    const residual = actualMargin - projMargin;
    const adj = actualMargin + line;
    const yCover = Math.abs(adj) < 1e-9 ? null : adj > 0 ? 1 : 0;
    const pCover = result.coverHitRates?.["home-ats"] ?? null;
    if (pCover == null) return;

    pre.push({
      eventId: String(g.eventId),
      line,
      actualMargin,
      projMargin,
      simMarginSd,
      residual,
      pCover,
      yCover,
    });
  });

  const residuals = pre.map((r) => r.residual);
  const simSds = pre.map((r) => r.simMarginSd);
  const decided = pre.filter((r) => r.yCover != null);
  const meanBias = mean(pre.map((r) => r.projMargin - r.actualMargin));
  const residualSd = sd(residuals);
  const meanSimSd = mean(simSds);
  const ratio =
    residualSd != null && meanSimSd > 0 ? residualSd / meanSimSd : null;

  // Magnitude bands on pre-cutoff only
  const bands: Record<string, { n: number; meanP: number; meanY: number; meanBias: number }> = {};
  for (const [name, lo, hi] of [
    ["0_3.5", 0, 3.5],
    ["4_7.5", 4, 7.5],
    ["8_14", 8, 14],
    ["14.5_21", 14.5, 21],
    ["21plus", 21.5, 99],
  ] as const) {
    const rows = decided.filter((r) => {
      const a = Math.abs(r.line);
      return a >= lo && a <= hi;
    });
    bands[name] = {
      n: rows.length,
      meanP: mean(rows.map((r) => r.pCover)),
      meanY: mean(rows.map((r) => r.yCover!)),
      meanBias: mean(rows.map((r) => r.projMargin - r.actualMargin)),
    };
  }

  const report = {
    generatedAt: new Date().toISOString(),
    scope: "pre_cutoff_only — untouched holdout unused",
    untouchedCutoff: UNTOUCHED_CUTOFF,
    simulationsPerGame: SIMS,
    calibrationSeed: FOOTBALL_CALIBRATION_PRIMARY_SEED,
    nPreCutoffJoined: pre.length,
    nDecided: decided.length,
    meanProjectedMinusActualMargin: meanBias,
    empiricalResidualSd: residualSd,
    meanSimMarginSd: meanSimSd,
    residualOverSimSdRatio: ratio,
    interpretation: {
      underdispersed:
        ratio != null && ratio > 1.15
          ? "OPEN — empirical residual SD exceeds mean sim margin SD; score draws may be too peaked"
          : "NOT_CONFIRMED_UNDERDISPERSION",
      meanBias:
        Math.abs(meanBias) > 1.5
          ? "OPEN — systematic projected-margin bias vs finals"
          : "MEAN_BIAS_SMALL",
      note: "Do not tune on untouched. Any residual-noise fix must be locked on pre-cutoff evidence only, then re-evaluated on untouched.",
    },
    byAbsLine: bands,
    keepP0Armed: true,
    flagFlipAllowed: false,
  };

  const outFix = join(fix, "ncaaf-phase-e-spread-margin-diag.json");
  const outArt = join(art, "ncaaf-phase-e-spread-margin-diag.json");
  writeFileSync(outFix, JSON.stringify(report, null, 2));
  writeFileSync(outArt, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main();

/**
 * Phase E — market-family holdout on nfl-drive:ppg-per-drive-v1.
 *
 * Validates spreads, moneylines, supported ALT spreads, and totals against
 * held-out 2024 outcomes with selection-time (pre-kickoff) form only.
 *
 * Closing totals / ALT posted prices are NOT in the E2b archive — those
 * stay INSUFFICIENT_DATA for CLV. Totals here are engine-vs-final calibration.
 *
 * Does NOT flip NCAAF_GAME_LINE_SIM_VALIDATED.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runNflDriveSim } from "../src/lib/sportSim/nflDriveSim.ts";
import {
  blendVenueAndL10,
  FOOTBALL_DRIVE_ENGINE_VERSION,
} from "../src/lib/sportSim/footballDriveMatchup.ts";
import {
  FOOTBALL_CALIBRATION_PRIMARY_SEED,
  loadClosingLineArchive,
  loadFootballCompletionStamps,
  mulberry32,
  walkHoldoutGames,
  type HoldoutWalkForm,
} from "../src/lib/sportSim/footballCalibration.ts";

const here = dirname(fileURLToPath(import.meta.url));
const SIMS = Number(process.env.NCAAF_PHASE_E_SIMS ?? 10_000);
const HOLDOUT_SEASON = 2024;
const ALT_AWAY_LINES = [3.5, 7.5, 10.5, 14, 17.5, 21] as const;

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

function brier(ps: number[], ys: number[]): number {
  let s = 0;
  for (let i = 0; i < ps.length; i++) s += (ps[i]! - ys[i]!) ** 2;
  return s / ps.length;
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
    provenance: blended.provenance,
  };
}

function loadGames(): EspnGame[] {
  const fixture = join(here, "../test/fixtures/ncaaf-phase-e-games.json");
  const raw = JSON.parse(readFileSync(fixture, "utf8")) as { games: EspnGame[] };
  const stamps = loadFootballCompletionStamps(
    join(here, "../test/fixtures/football-completion-timestamps.json"),
  );
  return (raw.games ?? [])
    .filter(
      (g) =>
        g?.homeTeamId &&
        g?.awayTeamId &&
        Number.isFinite(g.homeFg) &&
        Number.isFinite(g.awayFg),
    )
    .map((g) => ({
      ...g,
      completedAtIso: stamps.get(g.eventId) ?? null,
    }))
    .sort((a, b) => String(a.kickoffIso ?? "").localeCompare(String(b.kickoffIso ?? "")));
}

function main(): number {
  console.log("══ NCAAF Phase E market families (spread/ML/ALT/totals) ══");
  console.log(`engine=nfl-drive:${FOOTBALL_DRIVE_ENGINE_VERSION} sims=${SIMS}`);
  console.log("NCAAF_GAME_LINE_SIM_VALIDATED is NOT flipped.");

  const games = loadGames();
  const closingPath = join(here, "../test/fixtures/ncaaf-phase-e-closing-lines.json");
  const closingArchive = loadClosingLineArchive(closingPath);
  const closingByEvent = new Map(
    closingArchive.rows.map((row) => [
      row.eventId,
      { closeSpreadHome: row.closeSpreadHome, closeMlHome: row.closeMlHome },
    ]),
  );

  const rng = mulberry32(FOOTBALL_CALIBRATION_PRIMARY_SEED);
  const mlP: number[] = [];
  const mlY: number[] = [];
  const spreadP: number[] = [];
  const spreadY: number[] = [];
  const totalAbsErr: number[] = [];
  const totalOverAtProj: number[] = [];
  const totalOverY: number[] = [];
  const alt: Record<
    string,
    { p: number[]; y: number[]; n: number; coverRate: number | null; meanP: number | null; brier: number | null }
  > = {};
  for (const line of ALT_AWAY_LINES) {
    alt[`away_+${line}`] = { p: [], y: [], n: 0, coverRate: null, meanP: null, brier: null };
  }
  alt["home_close"] = { p: [], y: [], n: 0, coverRate: null, meanP: null, brier: null };
  alt["home_close_plus_3.5"] = { p: [], y: [], n: 0, coverRate: null, meanP: null, brier: null };
  alt["home_close_minus_3.5"] = { p: [], y: [], n: 0, coverRate: null, meanP: null, brier: null };

  let scored = 0;
  let skippedThin = 0;

  walkHoldoutGames(games, (g, forms) => {
    if (g.season !== HOLDOUT_SEASON) return;
    const homeIn = teamSimInput(forms.get(g.homeTeamId), "home");
    const awayIn = teamSimInput(forms.get(g.awayTeamId), "away");
    if (homeIn.ptsFor == null || awayIn.ptsFor == null) {
      skippedThin += 1;
      return;
    }
    const close = closingByEvent.get(g.eventId);
    const coverQueries: Array<{
      id: string;
      kind: "ml" | "spread" | "total";
      teamSide?: "home" | "away";
      line?: number;
      totalSide?: "over" | "under";
    }> = [
      { id: "home-ml", kind: "ml", teamSide: "home" },
      ...ALT_AWAY_LINES.map((line) => ({
        id: `away-alt-${line}`,
        kind: "spread" as const,
        teamSide: "away" as const,
        line,
      })),
    ];
    if (close) {
      coverQueries.push(
        {
          id: "home-close",
          kind: "spread",
          teamSide: "home",
          line: close.closeSpreadHome,
        },
        {
          id: "home-close-p35",
          kind: "spread",
          teamSide: "home",
          line: close.closeSpreadHome + 3.5,
        },
        {
          id: "home-close-m35",
          kind: "spread",
          teamSide: "home",
          line: close.closeSpreadHome - 3.5,
        },
      );
    }
    // Totals graded at projected mean after first pass — use placeholder then re-score from outcomes
    coverQueries.push({
      id: "over-proj-placeholder",
      kind: "total",
      totalSide: "over",
      line: 50,
    });

    const result = runNflDriveSim({
      sport: "ncaaf",
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
      coverQueries,
      retainOutcomes: false,
    });
    if (!result?.coverHitRates) return;

    const yHome = g.homeFg > g.awayFg ? 1 : g.homeFg < g.awayFg ? 0 : 0.5;
    if (yHome !== 0 && yHome !== 1) return;
    const pHome = result.coverHitRates["home-ml"] ?? result.homeWinProbability;
    mlP.push(pHome);
    mlY.push(yHome);

    const projTotal =
      (result.homeProjectedScore ?? 0) + (result.awayProjectedScore ?? 0);
    const actualTotal = g.homeFg + g.awayFg;
    totalAbsErr.push(Math.abs(projTotal - actualTotal));

    // Second sim for over@projected mean (same seed stream continues)
    const totalResult = runNflDriveSim({
      sport: "ncaaf",
      simulations: Math.min(SIMS, 2500),
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
        {
          id: "over-proj",
          kind: "total",
          totalSide: "over",
          line: Math.round(projTotal * 2) / 2,
        },
      ],
      retainOutcomes: false,
    });
    if (totalResult?.coverHitRates?.["over-proj"] != null) {
      totalOverAtProj.push(totalResult.coverHitRates["over-proj"]);
      totalOverY.push(actualTotal > Math.round(projTotal * 2) / 2 ? 1 : 0);
    }

    for (const line of ALT_AWAY_LINES) {
      const p = result.coverHitRates[`away-alt-${line}`];
      if (p == null) continue;
      const y = g.awayFg + line > g.homeFg ? 1 : g.awayFg + line < g.homeFg ? 0 : null;
      if (y == null) continue;
      const bucket = alt[`away_+${line}`]!;
      bucket.p.push(p);
      bucket.y.push(y);
    }

    if (close) {
      const margin = g.homeFg - g.awayFg;
      const scoreClose = (id: string, line: number, key: string) => {
        const p = result.coverHitRates?.[id];
        if (p == null) return;
        const adj = margin + line;
        if (Math.abs(adj) < 1e-9) return;
        const y = adj > 0 ? 1 : 0;
        alt[key]!.p.push(p);
        alt[key]!.y.push(y);
        if (key === "home_close") {
          spreadP.push(p);
          spreadY.push(y);
        }
      };
      scoreClose("home-close", close.closeSpreadHome, "home_close");
      scoreClose("home-close-p35", close.closeSpreadHome + 3.5, "home_close_plus_3.5");
      scoreClose("home-close-m35", close.closeSpreadHome - 3.5, "home_close_minus_3.5");
    }

    scored += 1;
    if (scored % 100 === 0) console.log(`scored ${scored}`);
  });

  for (const bucket of Object.values(alt)) {
    bucket.n = bucket.p.length;
    bucket.coverRate = bucket.y.length ? mean(bucket.y) : null;
    bucket.meanP = bucket.p.length ? mean(bucket.p) : null;
    bucket.brier = bucket.p.length ? brier(bucket.p, bucket.y) : null;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    engine: `nfl-drive:${FOOTBALL_DRIVE_ENGINE_VERSION}`,
    calibrationSeed: FOOTBALL_CALIBRATION_PRIMARY_SEED,
    simulationsPerGame: SIMS,
    nHoldoutScored: scored,
    nHoldoutSkippedThinForm: skippedThin,
    moneyline: {
      n: mlP.length,
      brier: mlP.length ? brier(mlP, mlY) : null,
      brierCoin: 0.25,
      meanP: mlP.length ? mean(mlP) : null,
      meanY: mlY.length ? mean(mlY) : null,
      homeWinBias: mlP.length ? mean(mlP) - mean(mlY) : null,
      verdict:
        mlP.length >= 200 && brier(mlP, mlY) < 0.25 ? "PASS_VS_COIN" : "INSUFFICIENT_OR_FAIL",
    },
    closingSpread: {
      n: spreadP.length,
      brier: spreadP.length ? brier(spreadP, spreadY) : null,
      brierCoin: 0.25,
      meanP: spreadP.length ? mean(spreadP) : null,
      meanY: spreadY.length ? mean(spreadY) : null,
      coverBias: spreadP.length ? mean(spreadP) - mean(spreadY) : null,
      verdict:
        spreadP.length >= 200 && brier(spreadP, spreadY) < 0.25
          ? "PASS_VS_COIN"
          : "INSUFFICIENT_OR_FAIL",
      note: "Home ATS at archived closing spread (pre-kickoff close).",
    },
    altSpreads: Object.fromEntries(
      Object.entries(alt).map(([k, v]) => [
        k,
        {
          n: v.n,
          meanP: v.meanP,
          coverRate: v.coverRate,
          brier: v.brier,
          bias: v.meanP != null && v.coverRate != null ? v.meanP - v.coverRate : null,
        },
      ]),
    ),
    totals: {
      closingTotalsInArchive: false,
      closingTotalsClv: "INSUFFICIENT_DATA",
      note:
        "E2b closing archive has no totals. Engine totals validated vs finals only (MAE + over@projected-mean calibration).",
      n: totalAbsErr.length,
      maeProjectedVsActual: totalAbsErr.length ? mean(totalAbsErr) : null,
      overAtProjectedMean: {
        n: totalOverAtProj.length,
        meanP: totalOverAtProj.length ? mean(totalOverAtProj) : null,
        actualOverRate: totalOverY.length ? mean(totalOverY) : null,
        brier:
          totalOverAtProj.length && totalOverY.length
            ? brier(totalOverAtProj, totalOverY)
            : null,
        expectedMeanPNear: 0.5,
      },
    },
    closingLineArchive: {
      present: closingArchive.present,
      parsedRows: closingArchive.rows.length,
      fields: ["closeSpreadHome", "closeMlHome"],
      missingForValidation: ["closeTotal", "altPostedPrices", "injuryKnown_non_null"],
    },
    verdicts: {
      ML: "see moneyline.verdict",
      Spread: "see closingSpread.verdict",
      ALT: "MEASURED — fixed away ALTs + close±3.5; no posted ALT CLV archive",
      Totals: "ENGINE_VS_FINAL_ONLY — closing totals INSUFFICIENT_DATA",
      NCAAF_GAME_LINE_SIM_VALIDATED: "false — do not flip",
    },
    keepP0Armed: true,
    flagFlipAllowed: false,
  };

  const outDir = join(here, "../test/fixtures");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "ncaaf-phase-e-market-families-report.json");
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  try {
    mkdirSync("/opt/cursor/artifacts", { recursive: true });
    writeFileSync(
      "/opt/cursor/artifacts/ncaaf-phase-e-market-families-report.json",
      `${JSON.stringify(report, null, 2)}\n`,
    );
  } catch {
    /* optional */
  }
  console.log(JSON.stringify(report, null, 2));
  console.log(`Wrote ${outPath}`);
  return 2;
}

if (!existsSync(join(here, "../test/fixtures/ncaaf-phase-e-games.json"))) {
  console.error("missing games fixture");
  process.exit(2);
}
process.exit(main());

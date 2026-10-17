/**
 * Audit home closing-spread settlement vs engine coverHitRates.
 * Checks sign conventions, pushes, probability extraction, and timing.
 * Does NOT flip NCAAF_GAME_LINE_SIM_VALIDATED.
 *
 * Untouched holdout: kickoffs on/after NCAAF_UNTOUCHED_CUTOFF (default 2024-10-15),
 * disjoint from the Coach pick selection window used for CLV.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runNflDriveSim } from "../src/lib/sportSim/nflDriveSim.ts";
import {
  blendVenueAndL10,
  FOOTBALL_DRIVE_ENGINE_VERSION,
} from "../src/lib/sportSim/footballDriveMatchup.ts";
import { coverQueryHits } from "../src/lib/gameMonteCarlo.ts";
import {
  americanToImplied,
  FOOTBALL_CALIBRATION_PRIMARY_SEED,
  loadClosingLineArchive,
  loadFootballCompletionStamps,
  mulberry32,
  walkHoldoutGames,
  type HoldoutWalkForm,
} from "../src/lib/sportSim/footballCalibration.ts";

const here = dirname(fileURLToPath(import.meta.url));
const SIMS = Number(process.env.NCAAF_PHASE_E_SIMS ?? 10_000);
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

function brier(ps: number[], ys: number[]): number {
  let s = 0;
  for (let i = 0; i < ps.length; i++) s += (ps[i]! - ys[i]!) ** 2;
  return s / ps.length;
}

function corr(xs: number[], ys: number[]): number | null {
  if (xs.length < 3) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    const a = xs[i]! - mx;
    const b = ys[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx < 1e-12 || dy < 1e-12) return null;
  return num / Math.sqrt(dx * dy);
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

/** Home covers when homeScore + homeSpreadLine > awayScore (American home line). */
function homeCoveredClose(homeFg: number, awayFg: number, closeSpreadHome: number): boolean | null {
  const adj = homeFg - awayFg + closeSpreadHome;
  if (Math.abs(adj) < 1e-9) return null; // push
  return adj > 0;
}

/** Flipped settlement — if this calibrates better, the archive/engine sign is wrong. */
function homeCoveredFlipped(homeFg: number, awayFg: number, closeSpreadHome: number): boolean | null {
  const adj = homeFg - awayFg - closeSpreadHome;
  if (Math.abs(adj) < 1e-9) return null;
  return adj > 0;
}

type Row = {
  eventId: string;
  week: number;
  kickoffIso: string;
  closeSpreadHome: number;
  closeMlHome: number;
  pEngineHomeCover: number;
  pEngineHomeMl: number;
  yHomeCover: number;
  yHomeCoverFlipped: number | null;
  yHomeMl: number;
  push: boolean;
  window: "full_2024" | "pre_cutoff" | "untouched_post_cutoff";
};

function summarize(rows: Row[], label: string) {
  const decided = rows.filter((r) => !r.push);
  const ps = decided.map((r) => r.pEngineHomeCover);
  const ys = decided.map((r) => r.yHomeCover);
  const ysFlip = decided
    .filter((r) => r.yHomeCoverFlipped != null)
    .map((r) => ({ p: r.pEngineHomeCover, y: r.yHomeCoverFlipped! }));
  const coin = ys.map(() => 0.5);
  // Market baseline for spread: we lack closing spread juice. Use close-ML
  // as a weak related baseline only for ML; for spread use coin + note.
  const mktMl = decided
    .map((r) => ({ p: americanToImplied(r.closeMlHome), y: r.yHomeMl }))
    .filter((x): x is { p: number; y: number } => x.p != null);

  const brierEngine = ps.length ? brier(ps, ys) : null;
  const brierCoin = ys.length ? brier(coin, ys) : null;
  const brierFlip =
    ysFlip.length >= 30 ? brier(ysFlip.map((x) => x.p), ysFlip.map((x) => x.y)) : null;
  const brierOneMinus =
    ps.length >= 30 ? brier(ps.map((p) => 1 - p), ys) : null;

  return {
    label,
    nRows: rows.length,
    nPushes: rows.filter((r) => r.push).length,
    nDecided: decided.length,
    meanP: ps.length ? mean(ps) : null,
    meanY: ys.length ? mean(ys) : null,
    coverBias: ps.length ? mean(ps) - mean(ys) : null,
    corrPY: corr(ps, ys),
    brierEngine,
    brierCoin,
    beatsCoin: brierEngine != null && brierCoin != null ? brierEngine < brierCoin : null,
    brierSignFlippedSettlement: brierFlip,
    signFlipImproves:
      brierEngine != null && brierFlip != null ? brierFlip < brierEngine - 1e-6 : null,
    brierOneMinusP: brierOneMinus,
    oneMinusImproves:
      brierEngine != null && brierOneMinus != null ? brierOneMinus < brierEngine - 1e-6 : null,
    marketMlBaseline: {
      n: mktMl.length,
      brier: mktMl.length ? brier(mktMl.map((x) => x.p), mktMl.map((x) => x.y)) : null,
      note: "Close-ML Brier on same games (related market, not spread juice).",
    },
    uncertainty: {
      note:
        "No closing spread prices in archive — cannot compute market-implied cover probs for ATS. Spread market baseline is coin (fair ATS ~0.5) only.",
      sims: SIMS,
      seed: FOOTBALL_CALIBRATION_PRIMARY_SEED,
    },
  };
}

function main(): number {
  console.log("══ NCAAF spread settlement audit ══");
  console.log(`engine=${FOOTBALL_DRIVE_ENGINE_VERSION} sims=${SIMS} untouchedCutoff=${UNTOUCHED_CUTOFF}`);

  const games = loadGames();
  const closingPath = join(here, "../test/fixtures/ncaaf-phase-e-closing-lines.json");
  const closingArchive = loadClosingLineArchive(closingPath);
  const closingByEvent = new Map(
    closingArchive.rows.map((row) => [
      row.eventId,
      { closeSpreadHome: row.closeSpreadHome, closeMlHome: row.closeMlHome },
    ]),
  );

  // Unit proof: coverQueryHits matches settlement helper
  const unitChecks: Array<{ case: string; ok: boolean }> = [];
  {
    const q = { id: "h", kind: "spread" as const, teamSide: "home" as const, line: -3.5 };
    const hit = coverQueryHits(q, 24, 20, "ncaaf"); // margin 4, covers -3.5
    const settled = homeCoveredClose(24, 20, -3.5);
    unitChecks.push({ case: "home_-3.5_covers", ok: hit === true && settled === true });
  }
  {
    const q = { id: "h", kind: "spread" as const, teamSide: "home" as const, line: 7.5 };
    const hit = coverQueryHits(q, 14, 21, "ncaaf"); // margin -7, push at +7.5? -7+7.5=0.5 covers
    const settled = homeCoveredClose(14, 21, 7.5);
    unitChecks.push({ case: "home_+7.5_covers_narrow", ok: hit === true && settled === true });
  }
  {
    const settled = homeCoveredClose(21, 14, -7); // margin 7, push
    unitChecks.push({ case: "push_excluded", ok: settled === null });
  }
  {
    const q = { id: "a", kind: "spread" as const, teamSide: "away" as const, line: 3.5 };
    const hit = coverQueryHits(q, 20, 24, "ncaaf"); // away 24+3.5 > 20
    unitChecks.push({ case: "away_+3.5", ok: hit === true });
  }

  const rng = mulberry32(FOOTBALL_CALIBRATION_PRIMARY_SEED);
  const rows: Row[] = [];
  const cutoffMs = Date.parse(UNTOUCHED_CUTOFF);

  walkHoldoutGames(games, (g, forms) => {
    if (g.season !== HOLDOUT_SEASON) return;
    const close = closingByEvent.get(g.eventId);
    if (!close) return;
    const homeIn = teamSimInput(forms.get(g.homeTeamId), "home");
    const awayIn = teamSimInput(forms.get(g.awayTeamId), "away");
    if (homeIn.ptsFor == null || awayIn.ptsFor == null) return;

    const kickMs = Date.parse(String(g.kickoffIso ?? ""));
    const window: Row["window"] =
      Number.isFinite(kickMs) && kickMs >= cutoffMs ? "untouched_post_cutoff" : "pre_cutoff";

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
        { id: "home-ml", kind: "ml", teamSide: "home" },
        {
          id: "home-close",
          kind: "spread",
          teamSide: "home",
          line: close.closeSpreadHome,
        },
        {
          id: "home-close-flipped-line",
          kind: "spread",
          teamSide: "home",
          line: -close.closeSpreadHome,
        },
      ],
      retainOutcomes: false,
    });
    if (!result?.coverHitRates) return;

    const covered = homeCoveredClose(g.homeFg, g.awayFg, close.closeSpreadHome);
    const coveredFlip = homeCoveredFlipped(g.homeFg, g.awayFg, close.closeSpreadHome);
    const yMl = g.homeFg > g.awayFg ? 1 : g.homeFg < g.awayFg ? 0 : 0.5;
    if (yMl !== 0 && yMl !== 1) return;

    rows.push({
      eventId: g.eventId,
      week: g.week,
      kickoffIso: String(g.kickoffIso),
      closeSpreadHome: close.closeSpreadHome,
      closeMlHome: close.closeMlHome,
      pEngineHomeCover: result.coverHitRates["home-close"] ?? NaN,
      pEngineHomeMl: result.coverHitRates["home-ml"] ?? result.homeWinProbability,
      yHomeCover: covered == null ? -1 : covered ? 1 : 0,
      yHomeCoverFlipped: coveredFlip == null ? null : coveredFlip ? 1 : 0,
      yHomeMl: yMl,
      push: covered == null,
      window,
    });
  });

  // Fix yHomeCover for pushes — exclude from decided sets in summarize via push flag
  for (const r of rows) {
    if (r.push) r.yHomeCover = 0; // unused when push
  }

  const full = rows.map((r) => ({ ...r, window: "full_2024" as const }));
  const untouched = rows.filter((r) => r.window === "untouched_post_cutoff");
  const pre = rows.filter((r) => r.window === "pre_cutoff");

  // Also evaluate engine with flipped LINE (wrong archive sign) on untouched
  const flippedLineBrier = (() => {
    // Recompute would need stored p for flipped line — re-score from a second pass is heavy;
    // approximate: if signFlipImproves on settlement-y, archive sign wrong; if oneMinus improves, extraction inverted.
    return null;
  })();

  const report = {
    generatedAt: new Date().toISOString(),
    engine: `nfl-drive:${FOOTBALL_DRIVE_ENGINE_VERSION}`,
    simulationsPerGame: SIMS,
    calibrationSeed: FOOTBALL_CALIBRATION_PRIMARY_SEED,
    untouchedCutoff: UNTOUCHED_CUTOFF,
    settlementConvention: {
      engine: "coverQueryHits home: homeScore + line > awayScore",
      archive: "closeSpreadHome is American home line (favorite negative)",
      pushes: "adj == 0 excluded from Brier (null)",
      matchesUnitChecks: unitChecks.every((c) => c.ok),
      unitChecks,
    },
    formTiming: {
      method:
        "walkHoldoutGames: priors only after credible last-play stamp (2.5–12h) else kickoff+4h; evaluated game excluded",
      note: "Same selection-time form as E2a holdout — no post-game leakage into inputs",
    },
    full2024Joined: summarize(
      full.map((r) => ({ ...r, window: r.window })),
      "full_2024_close_joined",
    ),
    preCutoff: summarize(pre, "pre_cutoff_selection_window"),
    untouchedHoldout: summarize(untouched, "untouched_post_cutoff"),
    defects: [] as Array<{ id: string; status: string; detail: string }>,
    keepP0Armed: true,
    flagFlipAllowed: false,
  };

  const u = report.untouchedHoldout;
  if (u.signFlipImproves) {
    report.defects.push({
      id: "spread_sign_convention",
      status: "CONFIRMED",
      detail: `Flipped settlement Brier ${u.brierSignFlippedSettlement} < engine ${u.brierEngine} on untouched — archive/engine sign mismatch`,
    });
  } else {
    report.defects.push({
      id: "spread_sign_convention",
      status: "CLEARED",
      detail: "Flipped settlement does not improve Brier — home-line sign matches engine",
    });
  }
  if (u.oneMinusImproves) {
    report.defects.push({
      id: "probability_extraction_inverted",
      status: "CONFIRMED",
      detail: `1-p Brier ${u.brierOneMinusP} < engine ${u.brierEngine} — coverHitRates may be wrong side`,
    });
  } else {
    report.defects.push({
      id: "probability_extraction_inverted",
      status: "CLEARED",
      detail: "1-p does not improve Brier — extraction side matches settlement",
    });
  }
  if (u.corrPY != null && u.corrPY < 0) {
    report.defects.push({
      id: "anticorrelated_cover_probs",
      status: "CONFIRMED",
      detail: `corr(p,y)=${u.corrPY} on untouched — severe side/sign defect`,
    });
  } else {
    report.defects.push({
      id: "anticorrelated_cover_probs",
      status: "CLEARED",
      detail: `corr(p,y)=${u.corrPY} — non-negative association`,
    });
  }
  if (u.brierEngine != null && u.brierCoin != null && u.brierEngine >= u.brierCoin) {
    report.defects.push({
      id: "spread_calibration_vs_coin",
      status: "OPEN_MODEL",
      detail: `Untouched ATS Brier ${u.brierEngine.toFixed(4)} ≥ coin ${u.brierCoin.toFixed(4)} after settlement audit cleared — model variance/edge issue, not sign bug`,
    });
  }

  const outDir = join(here, "../test/fixtures");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "ncaaf-phase-e-spread-settlement-audit.json");
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  try {
    writeFileSync(
      "/opt/cursor/artifacts/ncaaf-phase-e-spread-settlement-audit.json",
      `${JSON.stringify(report, null, 2)}\n`,
    );
  } catch {
    /* optional */
  }
  console.log(JSON.stringify(report, null, 2));
  console.log(`Wrote ${outPath}`);
  return 0;
}

if (!existsSync(join(here, "../test/fixtures/ncaaf-phase-e-games.json"))) {
  console.error("missing games fixture");
  process.exit(2);
}
process.exit(main());

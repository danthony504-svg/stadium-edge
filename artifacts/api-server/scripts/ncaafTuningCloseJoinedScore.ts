/**
 * TUNING close-joined M3/S2 score at LOCKED research parameters.
 *
 * Locked (do not retune from these results without a new lock doc):
 *   residual 14.5 · shrink 2.0 · gap scale 1.0 · blend 0.5
 *   M3: brierEngine ≤ brierMarketClose + 0.02
 *   S2: brierEngine ATS < 0.25
 *
 * FINAL_EVAL never loaded. NCAAF_GAME_LINE_SIM_VALIDATED not flipped.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runNflDriveSim } from "../src/lib/sportSim/nflDriveSim.ts";
import {
  blendVenueAndL10,
  FOOTBALL_NCAAF_RESEARCH_ENGINE_VERSION,
  FOOTBALL_NCAAF_MARGIN_RESIDUAL_SD,
  FOOTBALL_NCAAF_HOME_MARGIN_SHRINK,
  FOOTBALL_NCAAF_RESEARCH_MARGIN_GAP_SCALE_DEFAULT,
} from "../src/lib/sportSim/footballDriveMatchup.ts";
import {
  FOOTBALL_CALIBRATION_PRIMARY_SEED,
  mulberry32,
  walkHoldoutGames,
  type HoldoutWalkForm,
} from "../src/lib/sportSim/footballCalibration.ts";

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, "../test/fixtures");
const ART = "/opt/cursor/artifacts";
const SIMS = Number(process.env.NCAAF_TUNING_SIMS ?? 2_500);
/** Locked blend — do not sweep here. */
const OFFENSE_WEIGHT = 0.5;

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

type CloseRow = {
  gameId: string;
  closeMlHome: number | null;
  closeSpreadHome: number | null;
  homeScore: number;
  awayScore: number;
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

function americanToImplied(american: number): number {
  if (!Number.isFinite(american) || american === 0) return 0.5;
  if (american < 0) return (-american) / (-american + 100);
  return 100 / (american + 100);
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

function weightedTeamMean(
  forPts: number | null,
  oppAgainst: number | null,
  offenseWeight: number,
  fallback: number,
): number {
  if (forPts != null && Number.isFinite(forPts) && oppAgainst != null && Number.isFinite(oppAgainst)) {
    return offenseWeight * forPts + (1 - offenseWeight) * oppAgainst;
  }
  if (forPts != null && Number.isFinite(forPts)) return forPts;
  if (oppAgainst != null && Number.isFinite(oppAgainst)) return oppAgainst;
  return fallback;
}

function loadJsonGames(path: string): EspnGame[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as { games: EspnGame[] };
  return (raw.games ?? []).filter(
    (g) =>
      g?.homeTeamId &&
      g?.awayTeamId &&
      Number.isFinite(g.homeFg) &&
      Number.isFinite(g.awayFg) &&
      g.kickoffIso,
  );
}

function loadCloses(path: string): Map<string, CloseRow> {
  const raw = JSON.parse(readFileSync(path, "utf8")) as { games: CloseRow[] };
  const m = new Map<string, CloseRow>();
  for (const g of raw.games ?? []) {
    if (g?.gameId) m.set(String(g.gameId), g);
  }
  return m;
}

function main(): number {
  mkdirSync(ART, { recursive: true });
  // Ensure locked gap scale (default 1.0) — do not set candidate overrides.
  delete process.env.NCAAF_RESEARCH_MARGIN_GAP_SCALE;
  process.env.NCAAF_RESEARCH_CALIBRATION = "1";

  const tuningPath = join(FIX, "ncaaf-tuning-2025-w1-7-games.json");
  const closesPath = join(FIX, "ncaaf-tuning-2025-w1-7-closing-lines.json");
  const priorPath = join(FIX, "ncaaf-phase-e-games.json");
  for (const p of [tuningPath, closesPath, priorPath]) {
    if (!existsSync(p)) {
      console.error("Missing fixture", p);
      return 2;
    }
  }

  const tuning = loadJsonGames(tuningPath).filter(
    (g) => g.season === 2025 && g.week >= 1 && g.week <= 7,
  );
  const prior = loadJsonGames(priorPath).filter((g) => g.season === 2023 || g.season === 2024);
  const closes = loadCloses(closesPath);
  const tuningIds = new Set(tuning.map((g) => g.eventId));
  const all = [...prior, ...tuning].sort((a, b) =>
    String(a.kickoffIso).localeCompare(String(b.kickoffIso)),
  );

  const rng = mulberry32(FOOTBALL_CALIBRATION_PRIMARY_SEED);
  const mlEngine: number[] = [];
  const mlMarket: number[] = [];
  const mlY: number[] = [];
  const atsEngine: number[] = [];
  const atsY: number[] = [];
  let scoredMl = 0;
  let scoredAts = 0;
  let skippedThin = 0;
  let skippedNoClose = 0;
  let skippedPush = 0;

  console.log("══ NCAAF TUNING close-joined M3/S2 (locked params) ══");
  console.log(
    JSON.stringify({
      residualSd: FOOTBALL_NCAAF_MARGIN_RESIDUAL_SD,
      homeMarginShrink: FOOTBALL_NCAAF_HOME_MARGIN_SHRINK,
      gapScale: FOOTBALL_NCAAF_RESEARCH_MARGIN_GAP_SCALE_DEFAULT,
      offenseWeight: OFFENSE_WEIGHT,
      stamp: FOOTBALL_NCAAF_RESEARCH_ENGINE_VERSION,
      sims: SIMS,
      finalEval: "UNTOUCHED",
      gate: "NCAAF_GAME_LINE_SIM_VALIDATED=false",
    }),
  );

  walkHoldoutGames(all, (g, forms) => {
    if (!tuningIds.has(g.eventId)) return;
    if (g.homeFg === g.awayFg) return;
    const close = closes.get(g.eventId);
    if (
      !close ||
      close.closeMlHome == null ||
      !Number.isFinite(close.closeMlHome) ||
      close.closeSpreadHome == null ||
      !Number.isFinite(close.closeSpreadHome)
    ) {
      skippedNoClose += 1;
      return;
    }
    const homeIn = teamSimInput(forms.get(g.homeTeamId), "home");
    const awayIn = teamSimInput(forms.get(g.awayTeamId), "away");
    if (homeIn.ptsFor == null || awayIn.ptsFor == null) {
      skippedThin += 1;
      return;
    }
    const homeOff = weightedTeamMean(homeIn.ptsFor, awayIn.ptsAgainst, OFFENSE_WEIGHT, 24);
    const awayOff = weightedTeamMean(awayIn.ptsFor, homeIn.ptsAgainst, OFFENSE_WEIGHT, 24);
    const result = runNflDriveSim({
      sport: "ncaaf",
      ncaafResearchCalibration: true,
      simulations: SIMS,
      random: rng,
      home: {
        ptsFor: homeOff,
        ptsAgainst: awayOff,
        recentScores: homeIn.recentScores,
      },
      away: {
        ptsFor: awayOff,
        ptsAgainst: homeOff,
        recentScores: awayIn.recentScores,
      },
      coverQueries: [
        { id: "home-ml", kind: "ml", teamSide: "home" },
        {
          id: "home-close-spread",
          kind: "spread",
          teamSide: "home",
          line: close.closeSpreadHome,
        },
      ],
      retainOutcomes: false,
    });
    if (!result) return;
    const pMl = result.coverHitRates?.["home-ml"] ?? result.homeWinProbability ?? null;
    if (pMl == null || !Number.isFinite(pMl)) return;
    const yMl = g.homeFg > g.awayFg ? 1 : 0;
    mlEngine.push(pMl);
    mlMarket.push(americanToImplied(close.closeMlHome));
    mlY.push(yMl);
    scoredMl += 1;

    const adj = g.homeFg - g.awayFg + close.closeSpreadHome;
    if (Math.abs(adj) < 1e-9) {
      skippedPush += 1;
      return;
    }
    const pAts = result.coverHitRates?.["home-close-spread"];
    if (pAts == null || !Number.isFinite(pAts)) return;
    atsEngine.push(pAts);
    atsY.push(adj > 0 ? 1 : 0);
    scoredAts += 1;
    if (scoredMl % 50 === 0) console.log(`scored_ml=${scoredMl} scored_ats=${scoredAts}`);
  });

  const brierEngineMl = mlEngine.length ? brier(mlEngine, mlY) : null;
  const brierMarketClose = mlMarket.length ? brier(mlMarket, mlY) : null;
  const brierEngineAts = atsEngine.length ? brier(atsEngine, atsY) : null;
  const m3Pass =
    brierEngineMl != null &&
    brierMarketClose != null &&
    brierEngineMl <= brierMarketClose + 0.02;
  const s2Pass = brierEngineAts != null && brierEngineAts < 0.25;

  const report = {
    generatedAt: new Date().toISOString(),
    split: "TUNING",
    window: "2025 weeks 1–7",
    finalEvalUntouched: true,
    liveGate: "NCAAF_GAME_LINE_SIM_VALIDATED=false",
    researchStamp: FOOTBALL_NCAAF_RESEARCH_ENGINE_VERSION,
    lockedParams: {
      residualSd: FOOTBALL_NCAAF_MARGIN_RESIDUAL_SD,
      homeMarginShrink: FOOTBALL_NCAAF_HOME_MARGIN_SHRINK,
      gapScale: FOOTBALL_NCAAF_RESEARCH_MARGIN_GAP_SCALE_DEFAULT,
      offenseWeight: OFFENSE_WEIGHT,
    },
    simsPerGame: SIMS,
    coverage: {
      tuningGames: tuning.length,
      closesMatchedFullPrices: scoredMl + skippedThin + skippedNoClose, // rough
      scoredMl,
      scoredAts,
      skippedThin,
      skippedNoClose,
      skippedPush,
    },
    moneyline: {
      n: scoredMl,
      brierEngine: brierEngineMl,
      brierMarketClose,
      deltaEngineMinusMarket:
        brierEngineMl != null && brierMarketClose != null
          ? brierEngineMl - brierMarketClose
          : null,
      meanP: mlEngine.length ? mean(mlEngine) : null,
      meanY: mlY.length ? mean(mlY) : null,
      meanMarketP: mlMarket.length ? mean(mlMarket) : null,
      M3: {
        criterion: "brierEngine <= brierMarketClose + 0.02",
        pass: m3Pass,
      },
    },
    spreadsAts: {
      n: scoredAts,
      brierEngine: brierEngineAts,
      brierCoin: 0.25,
      S2: {
        criterion: "brierEngine < 0.25",
        pass: s2Pass,
      },
    },
    restoreReadiness: {
      moneyline: m3Pass ? "PASS_M3_ON_TUNING" : "FAIL_M3_ON_TUNING",
      spreads: s2Pass ? "PASS_S2_ON_TUNING" : "FAIL_S2_ON_TUNING",
      note: "TUNING only — FINAL_EVAL still required before any gate flip",
      gateFlipAllowed: false,
    },
  };

  const outArt = join(ART, "ncaaf-tuning-close-joined-m3s2.json");
  const outFix = join(FIX, "ncaaf-tuning-close-joined-m3s2.json");
  writeFileSync(outArt, JSON.stringify(report, null, 2));
  writeFileSync(outFix, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log("FINAL_EVAL untouched. Gate not flipped.");
  return m3Pass && s2Pass ? 0 : 2;
}

process.exit(main());

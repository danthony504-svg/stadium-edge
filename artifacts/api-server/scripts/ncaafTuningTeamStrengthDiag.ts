/**
 * TUNING-only NCAAF team-strength / matchup discrimination diagnostic.
 *
 * Split (locked): TUNING = 2025 weeks 1–7. FINAL_EVAL (weeks 8+ / 2026) is
 * never loaded or scored here.
 *
 * Uses free ESPN finals. No Odds closes → cannot claim locked M3/S2 market
 * criteria; reports engine-vs-coin + discrimination only.
 *
 * Research path only (`ncaafResearchCalibration: true`). Does not flip
 * NCAAF_GAME_LINE_SIM_VALIDATED. Does not retune residual/shrink locked on
 * USED 2024. Matchup blend weights are script-local experiments.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runNflDriveSim } from "../src/lib/sportSim/nflDriveSim.ts";
import {
  blendVenueAndL10,
  FOOTBALL_NCAAF_RESEARCH_ENGINE_VERSION,
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
/** Script-local: weight on own ptsFor vs opponent ptsAgainst (default engine = 0.5). */
const OFFENSE_WEIGHTS = String(process.env.NCAAF_TUNING_OFFENSE_WEIGHTS ?? "0.35,0.5,0.65")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0 && n < 1);

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

function mean(xs: number[], fb = 0): number {
  if (!xs.length) return fb;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function brier(ps: number[], ys: number[]): number {
  let s = 0;
  for (let i = 0; i < ps.length; i++) s += (ps[i]! - ys[i]!) ** 2;
  return s / ps.length;
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
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
    provenance: blended.provenance,
  };
}

/** Script-local mean: offenseWeight on own for, (1-w) on opp against. */
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

function quintileLift(ps: number[], ys: number[]): Array<{
  q: number;
  n: number;
  meanP: number;
  meanY: number;
  lift: number;
}> {
  const n = ps.length;
  if (n < 10) return [];
  const idx = [...Array(n).keys()].sort((a, b) => ps[a]! - ps[b]!);
  const size = Math.floor(n / 5);
  const out = [];
  for (let q = 0; q < 5; q++) {
    const start = q * size;
    const end = q === 4 ? n : (q + 1) * size;
    const slice = idx.slice(start, end);
    const meanP = mean(slice.map((i) => ps[i]!));
    const meanY = mean(slice.map((i) => ys[i]!));
    out.push({ q: q + 1, n: slice.length, meanP, meanY, lift: meanY - 0.5 });
  }
  return out;
}

function evaluateWeight(
  formHistory: EspnGame[],
  tuning: EspnGame[],
  offenseWeight: number,
): Record<string, unknown> {
  const tuningIds = new Set(tuning.map((g) => g.eventId));
  const all = [...formHistory, ...tuning].sort((a, b) =>
    String(a.kickoffIso).localeCompare(String(b.kickoffIso)),
  );
  const rng = mulberry32(FOOTBALL_CALIBRATION_PRIMARY_SEED + Math.round(offenseWeight * 1000));
  const mlP: number[] = [];
  const mlY: number[] = [];
  const marginPred: number[] = [];
  const marginAct: number[] = [];
  const strengthGap: number[] = [];
  let scored = 0;
  let skippedThin = 0;

  walkHoldoutGames(all, (g, forms) => {
    if (!tuningIds.has(g.eventId)) return;
    if (g.homeFg === g.awayFg) return;
    const homeIn = teamSimInput(forms.get(g.homeTeamId), "home");
    const awayIn = teamSimInput(forms.get(g.awayTeamId), "away");
    if (homeIn.ptsFor == null || awayIn.ptsFor == null) {
      skippedThin += 1;
      return;
    }
    // Script-local blend. runNflDriveSim's teamMean is 50/50 for/against —
    // mirror both sides to the weighted mean so the engine does not re-blend.
    const homeOff = weightedTeamMean(
      homeIn.ptsFor,
      awayIn.ptsAgainst,
      offenseWeight,
      24,
    );
    const awayOff = weightedTeamMean(
      awayIn.ptsFor,
      homeIn.ptsAgainst,
      offenseWeight,
      24,
    );
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
      coverQueries: [{ id: "home-ml", kind: "ml", teamSide: "home" }],
      retainOutcomes: false,
    });
    if (!result) return;
    const p =
      result.coverHitRates?.["home-ml"] ?? result.homeWinProbability ?? null;
    if (p == null || !Number.isFinite(p)) return;
    const y = g.homeFg > g.awayFg ? 1 : 0;
    mlP.push(p);
    mlY.push(y);
    const predMargin =
      (result.expectedHomeScore ?? homeOff) - (result.expectedAwayScore ?? awayOff);
    marginPred.push(predMargin);
    marginAct.push(g.homeFg - g.awayFg);
    strengthGap.push(homeOff - awayOff);
    scored += 1;
  });

  const corrPy = pearson(mlP, mlY);
  const corrMargin = pearson(marginPred, marginAct);
  const corrGapY = pearson(
    strengthGap,
    mlY.map((y) => y),
  );
  const brierEngine = mlP.length ? brier(mlP, mlY) : null;
  const quintiles = quintileLift(mlP, mlY);
  const mono =
    quintiles.length === 5 &&
    quintiles.every((q, i) => i === 0 || q.meanY >= quintiles[i - 1]!.meanY - 0.02);

  return {
    offenseWeight,
    engineStamp: FOOTBALL_NCAAF_RESEARCH_ENGINE_VERSION,
    nTuningGames: tuning.length,
    scored,
    skippedThin,
    brierEngine,
    brierCoin: 0.25,
    beatsCoin: brierEngine != null ? brierEngine < 0.25 : null,
    meanP: mlP.length ? mean(mlP) : null,
    meanY: mlY.length ? mean(mlY) : null,
    bias: mlP.length ? mean(mlP) - mean(mlY) : null,
    corrP_Y: corrPy,
    corrPredMargin_Actual: corrMargin,
    corrStrengthGap_HomeWin: corrGapY,
    meanAbsMarginError: marginPred.length
      ? mean(marginPred.map((p, i) => Math.abs(p - marginAct[i]!)))
      : null,
    probabilityQuintiles: quintiles,
    quintileMeanYMonotoneSoft: mono,
    note:
      "Score-only TUNING diagnostic — no Odds closes; locked M3/S* market criteria not evaluated.",
  };
}

function main(): number {
  mkdirSync(ART, { recursive: true });
  const tuningPath = join(FIX, "ncaaf-tuning-2025-w1-7-games.json");
  if (!existsSync(tuningPath)) {
    console.error("Missing TUNING fixture", tuningPath);
    return 2;
  }
  const priorPath = join(FIX, "ncaaf-phase-e-games.json");
  const tuning = loadJsonGames(tuningPath).filter((g) => g.season === 2025 && g.week >= 1 && g.week <= 7);
  // Prior form only — 2023–2024 ESPN finals already USED; never scored as TUNING labels.
  const prior = loadJsonGames(priorPath).filter((g) => g.season === 2023 || g.season === 2024);

  console.log("══ NCAAF TUNING team-strength / matchup diag ══");
  console.log(`tuning_n=${tuning.length} prior_form_n=${prior.length} sims=${SIMS}`);
  console.log("FINAL_EVAL not loaded. Gate not flipped. Residual/shrink not retuned.");

  const byWeight = OFFENSE_WEIGHTS.map((w) => evaluateWeight(prior, tuning, w));
  const baseline = byWeight.find((r) => Math.abs(Number(r.offenseWeight) - 0.5) < 1e-9) ?? byWeight[0];
  const ranked = [...byWeight].sort((a, b) => {
    const ba = Number(a.brierEngine ?? 9);
    const bb = Number(b.brierEngine ?? 9);
    if (ba !== bb) return ba - bb;
    return Number(b.corrP_Y ?? -1) - Number(a.corrP_Y ?? -1);
  });
  const best = ranked[0]!;

  const report = {
    generatedAt: new Date().toISOString(),
    split: "TUNING",
    window: "2025 weeks 1–7",
    finalEvalUntouched: true,
    liveGate: "NCAAF_GAME_LINE_SIM_VALIDATED=false",
    researchStamp: FOOTBALL_NCAAF_RESEARCH_ENGINE_VERSION,
    simsPerGame: SIMS,
    priorFormSeasons: [2023, 2024],
    priorFormNote: "USED 2024 scores supply form history only — not acceptance labels",
    baselineEqualBlend: baseline,
    weightSweep: byWeight,
    bestOnTuning: {
      offenseWeight: best.offenseWeight,
      brierEngine: best.brierEngine,
      corrP_Y: best.corrP_Y,
      beatsCoin: best.beatsCoin,
    },
    diagnosis: {
      weakDiscrimination:
        Number(baseline?.corrP_Y ?? 0) < 0.15
          ? "LOW_CORR_P_Y — projected home-win prob weakly ranks outcomes"
          : "MODERATE_OR_BETTER_CORR",
      matchupHypothesis:
        "Equal 50/50 for/against blend may under-weight opponent defense (ptsAgainst) for FBS; sweep tests script-local weights without changing locked residual/shrink.",
      used2024HoldoutAsFreshEvidence: false,
    },
    proposedChange: {
      id: "ncaaf_research_matchup_offense_weight",
      scope: "research-only (ncaafResearchCalibration)",
      description:
        "Expose configurable offense vs opponent-against blend for NCAAF research means (live teamMean 50/50 unchanged).",
      candidateWeight: best.offenseWeight,
      evidenceSplit: "TUNING 2025 w1–7 score-only",
      doNotLockUntil:
        "Odds closes on TUNING meet M1–M4 / S1–S4; FINAL_EVAL still untouched for acceptance",
      liveImpact: "none until research flag + explicit code land",
    },
    restoreReadiness: {
      moneyline: "NO — no Odds closes on TUNING; cannot evaluate M3 vs market",
      spreads: "NO — no close spreads/ATS juice on TUNING",
      totals: "BLOCKED — MISSING_DATA",
      alts: "BLOCKED — MISSING_DATA",
    },
  };

  const outArt = join(ART, "ncaaf-tuning-team-strength-diag.json");
  const outFix = join(FIX, "ncaaf-tuning-team-strength-diag.json");
  writeFileSync(outArt, JSON.stringify(report, null, 2));
  writeFileSync(outFix, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    scored: baseline?.scored,
    brierEngine: baseline?.brierEngine,
    corrP_Y: baseline?.corrP_Y,
    bestWeight: best.offenseWeight,
    bestBrier: best.brierEngine,
    outArt,
  }, null, 2));
  return 0;
}

process.exit(main());

/**
 * NFL historical calibration on frozen ESPN regular-season finals.
 * Selection-time venue/L10 form, 10,000 sims, precommitted seeds.
 * Does not read sportsbook prices. Market cover is omitted when no close exists.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runNflDriveSim } from "../src/lib/sportSim/nflDriveSim.ts";
import {
  blendVenueAndL10,
  FOOTBALL_DRIVE_ENGINE_VERSION,
} from "../src/lib/sportSim/footballDriveMatchup.ts";
import {
  boundarySensitiveCount,
  DOG_COHORT_BOUNDARY_SWEEP,
  dogCohort,
  FOOTBALL_CALIBRATION_PRIMARY_SEED,
  FOOTBALL_CALIBRATION_SEEDS,
  mulberry32,
  type HoldoutProbRow,
} from "../src/lib/sportSim/footballCalibration.ts";

const here = dirname(fileURLToPath(import.meta.url));
const SIMS = Number(process.env.NFL_HISTORICAL_SIMS ?? 10000);
const HOLDOUT_SEASON = Number(process.env.NFL_HISTORICAL_HOLDOUT_SEASON ?? 2024);

type Game = {
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
};

function mean(xs: number[]): number | null {
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function sd(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs)!;
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

function brier(ps: number[], ys: number[]): number {
  let s = 0;
  for (let i = 0; i < ps.length; i++) s += (ps[i]! - ys[i]!) ** 2;
  return s / ps.length;
}

function ece(ps: number[], ys: number[], bins = 10): number {
  const bucket = Array.from({ length: bins }, () => ({ n: 0, pSum: 0, ySum: 0 }));
  for (let i = 0; i < ps.length; i++) {
    const b = Math.min(bins - 1, Math.floor(ps[i]! * bins));
    bucket[b]!.n += 1;
    bucket[b]!.pSum += ps[i]!;
    bucket[b]!.ySum += ys[i]!;
  }
  let e = 0;
  for (const b of bucket) {
    if (!b.n) continue;
    e += (b.n / ps.length) * Math.abs(b.ySum / b.n - b.pSum / b.n);
  }
  return e;
}

function formSlice(form: TeamForm | undefined, n = 10) {
  const pf = form?.ptsFor.slice(-n) ?? [];
  const pa = form?.ptsAgainst.slice(-n) ?? [];
  if (pf.length < 2) return { ptsFor: null as number | null, ptsAgainst: null as number | null, recentScores: pf.slice(), games: pf.length };
  return {
    ptsFor: mean(pf),
    ptsAgainst: mean(pa),
    recentScores: pf.slice(),
    games: pf.length,
  };
}

function venueSlice(forArr: number[] | undefined, againstArr: number[] | undefined, n = 10) {
  const pf = (forArr ?? []).slice(-n);
  const pa = (againstArr ?? []).slice(-n);
  if (!pf.length) return { games: 0, ptsFor: null as number | null, ptsAgainst: null as number | null };
  return { games: pf.length, ptsFor: mean(pf), ptsAgainst: pa.length ? mean(pa) : null };
}

function teamSimInput(form: TeamForm | undefined, venue: "home" | "away") {
  const l10 = formSlice(form);
  const venueForm =
    venue === "home"
      ? venueSlice(form?.homeFor, form?.homeAgainst)
      : venueSlice(form?.awayFor, form?.awayAgainst);
  const blended = blendVenueAndL10(
    { games: venueForm.games, ptsFor: venueForm.ptsFor, ptsAgainst: venueForm.ptsAgainst },
    { games: l10.games, ptsFor: l10.ptsFor, ptsAgainst: l10.ptsAgainst },
  );
  return {
    ptsFor: blended.ptsFor,
    ptsAgainst: blended.ptsAgainst,
    recentScores: l10.recentScores,
    provenance: blended.provenance,
  };
}

function emptyForm(): TeamForm {
  return { ptsFor: [], ptsAgainst: [], homeFor: [], homeAgainst: [], awayFor: [], awayAgainst: [] };
}

function pushForm(forms: Map<string, TeamForm>, g: Game): void {
  const hf = forms.get(g.homeTeamId) ?? emptyForm();
  hf.ptsFor.push(g.homeFg);
  hf.ptsAgainst.push(g.awayFg);
  hf.homeFor.push(g.homeFg);
  hf.homeAgainst.push(g.awayFg);
  forms.set(g.homeTeamId, hf);
  const af = forms.get(g.awayTeamId) ?? emptyForm();
  af.ptsFor.push(g.awayFg);
  af.ptsAgainst.push(g.homeFg);
  af.awayFor.push(g.awayFg);
  af.awayAgainst.push(g.homeFg);
  forms.set(g.awayTeamId, af);
}

function loadGames(): Game[] {
  const path = join(here, "../test/fixtures/nfl-historical-games.json");
  const raw = JSON.parse(readFileSync(path, "utf8")) as { games?: Game[] } | Game[];
  const games = Array.isArray(raw) ? raw : (raw.games ?? []);
  return games.sort((a, b) => {
    if (a.season !== b.season) return a.season - b.season;
    if (a.week !== b.week) return a.week - b.week;
    return String(a.kickoffIso ?? "").localeCompare(String(b.kickoffIso ?? ""));
  });
}

type Detail = {
  zHome: number;
  zAway: number;
  zMargin: number;
  homeCoveredFairLine: number;
  actualMargin: number;
  simMargin: number;
  actualHome: number;
  actualAway: number;
  simHome: number;
  simAway: number;
  pBlowoutHome: number;
  yBlowoutHome: number;
  pBlowoutAway: number;
  yBlowoutAway: number;
  pHighTotal: number;
  yHighTotal: number;
};

function reliability(ps: number[], ys: number[], bins = 5): { n: number; ece: number } {
  return { n: ps.length, ece: ps.length ? ece(ps, ys, bins) : 0 };
}

function runSeed(games: Game[], seed: number, detailed: boolean): {
  rows: HoldoutProbRow[];
  mlP: number[];
  mlY: number[];
  scored: number;
  skipped: number;
  details: Detail[];
} {
  const rng = mulberry32(seed);
  const forms = new Map<string, TeamForm>();
  const rows: HoldoutProbRow[] = [];
  const mlP: number[] = [];
  const mlY: number[] = [];
  const details: Detail[] = [];
  let scored = 0;
  let skipped = 0;

  for (const g of games) {
    const homeIn = teamSimInput(forms.get(g.homeTeamId), "home");
    const awayIn = teamSimInput(forms.get(g.awayTeamId), "away");
    const isHoldout = g.season === HOLDOUT_SEASON;
    if (isHoldout && homeIn.ptsFor != null && awayIn.ptsFor != null) {
      const result = runNflDriveSim({
        sport: "nfl",
        simulations: SIMS,
        random: rng,
        home: { ptsFor: homeIn.ptsFor, ptsAgainst: homeIn.ptsAgainst, recentScores: homeIn.recentScores },
        away: { ptsFor: awayIn.ptsFor, ptsAgainst: awayIn.ptsAgainst, recentScores: awayIn.recentScores },
        coverQueries: [
          { id: "home-ml", kind: "ml", teamSide: "home" },
          { id: "away-sp75", kind: "spread", teamSide: "away", line: 7.5 },
        ],
        retainOutcomes: detailed,
      });
      if (result?.coverHitRates) {
        const pHome = result.coverHitRates["home-ml"] ?? result.homeWinProbability;
        const yHome = g.homeFg > g.awayFg ? 1 : g.homeFg < g.awayFg ? 0 : 0.5;
        if (yHome === 0 || yHome === 1) {
          mlP.push(pHome);
          mlY.push(yHome);
          rows.push({
            eventId: g.eventId,
            pHome,
            yHome,
            awayCovered75: g.awayFg + 7.5 > g.homeFg ? 1 : 0,
          });
          scored += 1;
          if (detailed && result.outcomes) {
            const hs = result.outcomes.homeScores;
            const as = result.outcomes.awayScores;
            const margins = hs.map((h, i) => h - as[i]!);
            const totals = hs.map((h, i) => h + as[i]!);
            const simHome = mean(hs)!;
            const simAway = mean(as)!;
            const simMargin = mean(margins)!;
            const sdH = sd(hs)!;
            const sdA = sd(as)!;
            const sdM = sd(margins)!;
            const simTotal = mean(totals)!;
            const actualMargin = g.homeFg - g.awayFg;
            details.push({
              zHome: sdH > 0 ? (g.homeFg - simHome) / sdH : 0,
              zAway: sdA > 0 ? (g.awayFg - simAway) / sdA : 0,
              zMargin: sdM > 0 ? (actualMargin - simMargin) / sdM : 0,
              homeCoveredFairLine: actualMargin > simMargin ? 1 : 0,
              actualMargin,
              simMargin,
              actualHome: g.homeFg,
              actualAway: g.awayFg,
              simHome,
              simAway,
              pBlowoutHome: margins.filter((m) => m >= 14).length / margins.length,
              yBlowoutHome: actualMargin >= 14 ? 1 : 0,
              pBlowoutAway: margins.filter((m) => m <= -14).length / margins.length,
              yBlowoutAway: actualMargin <= -14 ? 1 : 0,
              pHighTotal: totals.filter((t) => t >= simTotal + 14).length / totals.length,
              yHighTotal: g.homeFg + g.awayFg >= simTotal + 14 ? 1 : 0,
            });
          }
          if (scored % 50 === 0) console.log(`seed ${seed} scored ${scored}`);
        }
      }
    } else if (isHoldout) {
      skipped += 1;
    }
    pushForm(forms, g);
  }
  return { rows, mlP, mlY, scored, skipped, details };
}

function summarizeDetails(details: Detail[]) {
  const zAll = details.flatMap((d) => [d.zHome, d.zAway]);
  const fairCovers = details.reduce((a, d) => a + d.homeCoveredFairLine, 0);
  return {
    n: details.length,
    scoreMeanErrorHome: mean(details.map((d) => d.simHome - d.actualHome)),
    scoreMeanErrorAway: mean(details.map((d) => d.simAway - d.actualAway)),
    actualTeamScoreSd: sd(details.flatMap((d) => [d.actualHome, d.actualAway])),
    marginMeanError: mean(details.map((d) => d.simMargin - d.actualMargin)),
    actualMarginSd: sd(details.map((d) => d.actualMargin)),
    zScoreSd: sd(zAll),
    zMarginSd: sd(details.map((d) => d.zMargin)),
    zAbsTailRate: zAll.filter((z) => Math.abs(z) > 2).length / zAll.length,
    fairLineHomeCoverRate: details.length ? fairCovers / details.length : null,
    blowoutHome: reliability(
      details.map((d) => d.pBlowoutHome),
      details.map((d) => d.yBlowoutHome),
    ),
    blowoutAway: reliability(
      details.map((d) => d.pBlowoutAway),
      details.map((d) => d.yBlowoutAway),
    ),
    highTotalTail: reliability(
      details.map((d) => d.pHighTotal),
      details.map((d) => d.yHighTotal),
    ),
    actualBlowoutHomeRate: mean(details.map((d) => d.yBlowoutHome)),
    meanPredictedBlowoutHome: mean(details.map((d) => d.pBlowoutHome)),
    actualBlowoutAwayRate: mean(details.map((d) => d.yBlowoutAway)),
    meanPredictedBlowoutAway: mean(details.map((d) => d.pBlowoutAway)),
    actualHighTotalRate: mean(details.map((d) => d.yHighTotal)),
    meanPredictedHighTotal: mean(details.map((d) => d.pHighTotal)),
  };
}

function main(): number {
  console.log(`NFL historical calibration sims=${SIMS} holdout=${HOLDOUT_SEASON}`);
  const games = loadGames();
  const primary = runSeed(games, FOOTBALL_CALIBRATION_PRIMARY_SEED, true);
  const otherSeeds = FOOTBALL_CALIBRATION_SEEDS.filter((s) => s !== FOOTBALL_CALIBRATION_PRIMARY_SEED).map(
    (seed) => {
      const pass = runSeed(games, seed, false);
      return { seed, ...dogCohort(pass.rows) };
    },
  );
  const primaryCohort = dogCohort(primary.rows);
  const seedCohorts = [
    { seed: FOOTBALL_CALIBRATION_PRIMARY_SEED, primary: true, ...primaryCohort },
    ...otherSeeds.map((c) => ({ ...c, primary: false })),
  ];
  const rates = seedCohorts.map((c) => c.awayCoverRate).filter((v): v is number => v != null);
  const coin = primary.mlP.map(() => 0.5);
  const report = {
    generatedAt: new Date().toISOString(),
    engine: `nfl-drive:${FOOTBALL_DRIVE_ENGINE_VERSION}`,
    sport: "nfl",
    holdoutSeason: HOLDOUT_SEASON,
    simulationsPerGame: SIMS,
    calibrationSeed: FOOTBALL_CALIBRATION_PRIMARY_SEED,
    calibrationSeeds: [...FOOTBALL_CALIBRATION_SEEDS],
    seedPolicy:
      "Primary seed is the first precommitted value. Seeds were not searched for a passing dog-cover rate.",
    selectionTimeInputs: true,
    formMethodology: "venue_split blended with L10; form updates after each game",
    marketLines: "ABSENT — ESPN completed scoreboard and summary odds were empty. Cover below is the sim fair line, not a sportsbook close.",
    nHoldoutScored: primary.scored,
    nHoldoutSkippedThinForm: primary.skipped,
    winCalibration: {
      brier: brier(primary.mlP, primary.mlY),
      brierCoin: brier(coin, primary.mlY),
      ece10: ece(primary.mlP, primary.mlY, 10),
      meanP: mean(primary.mlP),
      meanY: mean(primary.mlY),
      homeWinBias: (mean(primary.mlP) ?? 0) - (mean(primary.mlY) ?? 0),
    },
    distribution: summarizeDetails(primary.details),
    dogCohortOfficial: primaryCohort,
    dogCohortByBoundary: DOG_COHORT_BOUNDARY_SWEEP.map((b) => dogCohort(primary.rows, b.lo, b.hi)),
    dogCohortBySeed: seedCohorts,
    dogCohortSeedRange: rates.length
      ? { min: Math.min(...rates), max: Math.max(...rates), mean: rates.reduce((a, b) => a + b, 0) / rates.length }
      : null,
    boundarySensitiveGames: boundarySensitiveCount(primary.rows),
    thresholdsUnchanged: { dogCohortLo: 0.45, dogCohortHi: 0.55, dogCoverMax: 0.7 },
  };
  const out = join(here, "../test/fixtures/nfl-historical-calibration-report.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  console.log(`Wrote ${out}`);
  return 0;
}

process.exit(main());

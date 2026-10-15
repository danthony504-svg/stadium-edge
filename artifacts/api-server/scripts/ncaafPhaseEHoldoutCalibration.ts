/**
 * Phase E2/E4 holdout calibration for NCAAF nfl-drive (coach engine).
 *
 * Uses frozen ESPN scoreboard games (2023–2024) from the simulator-v2 eval
 * cache when present, else artifacts/api-server/test/fixtures/ncaaf-phase-e-games.json.
 *
 * Does NOT flip NCAAF_GAME_LINE_SIM_VALIDATED. Writes a JSON report and exits:
 *   0 = E2 metrics meet thresholds (still needs E6 human sign-off)
 *   2 = OPEN / FAIL / insufficient data — keep P0 armed
 *
 * Closing-line CLV requires a licensed odds archive — reported INSUFFICIENT_DATA
 * when absent (ODDS_API_KEY historical not configured here).
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
  boundarySensitiveCount,
  DOG_COHORT_BOUNDARY_SWEEP,
  DOG_COHORT_COVER_MAX,
  DOG_COHORT_HI,
  DOG_COHORT_LO,
  dogCohort,
  evaluateClosingLines,
  FOOTBALL_CALIBRATION_PRIMARY_SEED,
  FOOTBALL_CALIBRATION_SEEDS,
  loadClosingLineArchive,
  mulberry32,
  type ClosingJoin,
  type HoldoutProbRow,
} from "../src/lib/sportSim/footballCalibration.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../..");

type EspnGame = {
  eventId: string;
  season: number;
  week: number;
  kickoffIso?: string;
  homeTeamId: string;
  awayTeamId: string;
  homeName?: string;
  awayName?: string;
  homeFg: number;
  awayFg: number;
  source?: string;
};

/** Rolling form with venue splits — matches production footballGameSimInputs. */
type TeamForm = {
  ptsFor: number[];
  ptsAgainst: number[];
  homeFor: number[];
  homeAgainst: number[];
  awayFor: number[];
  awayAgainst: number[];
};

const SIMS = Number(process.env.NCAAF_PHASE_E_SIMS ?? 2500);
const HOLDOUT_SEASON = Number(process.env.NCAAF_PHASE_E_HOLDOUT_SEASON ?? 2024);

function loadGames(): EspnGame[] {
  const fixture = join(here, "../test/fixtures/ncaaf-phase-e-games.json");
  const cache = join(
    repoRoot,
    "artifacts/simulator-v2/eval/cache/ncaaf_9ac26272eaa7.json",
  );
  const path = existsSync(fixture) ? fixture : cache;
  if (!existsSync(path)) {
    throw new Error(`No NCAAF games fixture at ${fixture} or cache ${cache}`);
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as {
    games?: EspnGame[];
  } | EspnGame[];
  const games = Array.isArray(raw) ? raw : (raw.games ?? []);
  return games
    .filter(
      (g) =>
        g?.homeTeamId &&
        g?.awayTeamId &&
        Number.isFinite(g.homeFg) &&
        Number.isFinite(g.awayFg),
    )
    .sort((a, b) => {
      if (a.season !== b.season) return a.season - b.season;
      if (a.week !== b.week) return a.week - b.week;
      return String(a.kickoffIso ?? "").localeCompare(String(b.kickoffIso ?? ""));
    });
}

function mean(xs: number[], fallback: number): number {
  if (!xs.length) return fallback;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function formSlice(form: TeamForm | undefined, n = 10): {
  ptsFor: number | null;
  ptsAgainst: number | null;
  recentScores: number[];
  games: number;
} {
  const pf = form?.ptsFor.slice(-n) ?? [];
  const pa = form?.ptsAgainst.slice(-n) ?? [];
  if (pf.length < 2) {
    return { ptsFor: null, ptsAgainst: null, recentScores: pf.slice(), games: pf.length };
  }
  return {
    ptsFor: mean(pf, 24),
    ptsAgainst: mean(pa, 24),
    recentScores: pf.slice(),
    games: pf.length,
  };
}

function venueSlice(
  forArr: number[] | undefined,
  againstArr: number[] | undefined,
  n = 10,
): { games: number; ptsFor: number | null; ptsAgainst: number | null } {
  const pf = (forArr ?? []).slice(-n);
  const pa = (againstArr ?? []).slice(-n);
  if (!pf.length) return { games: 0, ptsFor: null, ptsAgainst: null };
  return {
    games: pf.length,
    ptsFor: mean(pf, 24),
    ptsAgainst: pa.length ? mean(pa, 24) : null,
  };
}

/** Production-parity inputs: venue split blended with L10 (no invented HFA constant). */
function teamSimInput(
  form: TeamForm | undefined,
  venue: "home" | "away",
): {
  ptsFor: number | null;
  ptsAgainst: number | null;
  recentScores: number[];
  provenance: string;
} {
  const l10 = formSlice(form);
  const venueForm =
    venue === "home"
      ? venueSlice(form?.homeFor, form?.homeAgainst)
      : venueSlice(form?.awayFor, form?.awayAgainst);
  const blended = blendVenueAndL10(
    {
      games: venueForm.games,
      ptsFor: venueForm.ptsFor,
      ptsAgainst: venueForm.ptsAgainst,
    },
    {
      games: l10.games,
      ptsFor: l10.ptsFor,
      ptsAgainst: l10.ptsAgainst,
    },
  );
  return {
    ptsFor: blended.ptsFor,
    ptsAgainst: blended.ptsAgainst,
    recentScores: l10.recentScores,
    provenance: blended.provenance,
  };
}

function brier(ps: number[], ys: number[]): number {
  let s = 0;
  for (let i = 0; i < ps.length; i++) s += (ps[i] - ys[i]) ** 2;
  return s / ps.length;
}

function logLoss(ps: number[], ys: number[]): number {
  const eps = 1e-6;
  let s = 0;
  for (let i = 0; i < ps.length; i++) {
    const p = Math.min(1 - eps, Math.max(eps, ps[i]));
    s += ys[i] ? -Math.log(p) : -Math.log(1 - p);
  }
  return s / ps.length;
}

/** 10-bin ECE */
function ece(ps: number[], ys: number[], bins = 10): number {
  const bucket: { n: number; pSum: number; ySum: number }[] = Array.from(
    { length: bins },
    () => ({ n: 0, pSum: 0, ySum: 0 }),
  );
  for (let i = 0; i < ps.length; i++) {
    const b = Math.min(bins - 1, Math.floor(ps[i] * bins));
    bucket[b].n += 1;
    bucket[b].pSum += ps[i];
    bucket[b].ySum += ys[i];
  }
  let e = 0;
  for (const b of bucket) {
    if (!b.n) continue;
    e += (b.n / ps.length) * Math.abs(b.ySum / b.n - b.pSum / b.n);
  }
  return e;
}

type SeedPass = {
  seed: number;
  scored: number;
  skippedThin: number;
  provenanceCounts: Record<string, number>;
  mlP: number[];
  mlY: number[];
  rows: HoldoutProbRow[];
  closingJoins: ClosingJoin[];
};

function simulateHoldout(games: EspnGame[], seed: number, closingByEvent: Map<string, { closeSpreadHome: number; closeMlHome: number }>): SeedPass {
  const rng = mulberry32(seed);
  const forms = new Map<string, TeamForm>();
  const mlP: number[] = [];
  const mlY: number[] = [];
  const rows: HoldoutProbRow[] = [];
  const closingJoins: ClosingJoin[] = [];
  const provenanceCounts: Record<string, number> = {};
  let skippedThin = 0;
  let scored = 0;
  const emptyForm = (): TeamForm => ({
    ptsFor: [],
    ptsAgainst: [],
    homeFor: [],
    homeAgainst: [],
    awayFor: [],
    awayAgainst: [],
  });

  for (const g of games) {
    const homeIn = teamSimInput(forms.get(g.homeTeamId), "home");
    const awayIn = teamSimInput(forms.get(g.awayTeamId), "away");
    const isHoldout = g.season === HOLDOUT_SEASON;
    const close = closingByEvent.get(g.eventId);
    if (isHoldout && homeIn.ptsFor != null && awayIn.ptsFor != null) {
      const coverQueries: Array<{
        id: string;
        kind: "ml" | "spread";
        teamSide: "home" | "away";
        line?: number;
      }> = [
        { id: "home-ml", kind: "ml", teamSide: "home" },
        { id: "away-sp75", kind: "spread", teamSide: "away", line: 7.5 },
      ];
      if (close) {
        coverQueries.push({
          id: "home-close-spread",
          kind: "spread",
          teamSide: "home",
          line: close.closeSpreadHome,
        });
      }
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
      if (result?.coverHitRates) {
        const pHome = result.coverHitRates["home-ml"] ?? result.homeWinProbability;
        const yHome = g.homeFg > g.awayFg ? 1 : g.homeFg < g.awayFg ? 0 : 0.5;
        if (yHome === 0 || yHome === 1) {
          mlP.push(pHome);
          mlY.push(yHome);
          const awayCovered = g.awayFg + 7.5 > g.homeFg ? 1 : 0;
          rows.push({ eventId: g.eventId, pHome, yHome, awayCovered75: awayCovered });
          scored += 1;
          const provKey = `${homeIn.provenance}+${awayIn.provenance}`;
          provenanceCounts[provKey] = (provenanceCounts[provKey] ?? 0) + 1;
          if (scored % 100 === 0) console.log(`seed ${seed} scored ${scored} holdout games`);
          if (close) {
            const margin = g.homeFg - g.awayFg;
            const covered = margin + close.closeSpreadHome > 0 ? 1 : margin + close.closeSpreadHome < 0 ? 0 : null;
            closingJoins.push({
              eventId: g.eventId,
              pHome,
              yHome,
              closeSpreadHome: close.closeSpreadHome,
              closeMlHome: close.closeMlHome,
              pHomeCoverClose: result.coverHitRates["home-close-spread"] ?? null,
              homeCoveredClose: covered,
            });
          }
        }
      }
    } else if (isHoldout) {
      skippedThin += 1;
    }

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

  return { seed, scored, skippedThin, provenanceCounts, mlP, mlY, rows, closingJoins };
}

function main(): number {
  console.log("══ NCAAF Phase E holdout calibration (nfl-drive) ══");
  console.log(`holdoutSeason=${HOLDOUT_SEASON} sims=${SIMS} primarySeed=${FOOTBALL_CALIBRATION_PRIMARY_SEED}`);
  console.log("NCAAF_GAME_LINE_SIM_VALIDATED is NOT flipped by this script.");
  console.log("Seeds are precommitted. The primary seed is not chosen for a PASS.");

  const games = loadGames();
  const closingPath = join(here, "../test/fixtures/ncaaf-phase-e-closing-lines.json");
  const closingArchive = loadClosingLineArchive(closingPath);
  const closingByEvent = new Map(
    closingArchive.rows.map((row) => [
      row.eventId,
      { closeSpreadHome: row.closeSpreadHome, closeMlHome: row.closeMlHome },
    ]),
  );
  const passes = FOOTBALL_CALIBRATION_SEEDS.map((seed) =>
    simulateHoldout(games, seed, closingByEvent),
  );
  const primary = passes.find((p) => p.seed === FOOTBALL_CALIBRATION_PRIMARY_SEED) ?? passes[0]!;
  const mlP = primary.mlP;
  const mlY = primary.mlY;
  const scored = primary.scored;
  const skippedThin = primary.skippedThin;
  const provenanceCounts = primary.provenanceCounts;
  const officialCohort = dogCohort(primary.rows, DOG_COHORT_LO, DOG_COHORT_HI);
  const dog75 = primary.rows
    .filter((r) => r.pHome > DOG_COHORT_LO && r.pHome < DOG_COHORT_HI)
    .map((r) => ({ cover: r.awayCovered75, ml: r.pHome }));
  const closingEval = evaluateClosingLines(primary.closingJoins);
  const seedCohorts = passes.map((p) => ({
    seed: p.seed,
    primary: p.seed === FOOTBALL_CALIBRATION_PRIMARY_SEED,
    ...dogCohort(p.rows),
  }));
  const seedRates = seedCohorts
    .map((c) => c.awayCoverRate)
    .filter((v): v is number => v != null);
  const coinP = mlP.map(() => 0.5);
  const report = {
    generatedAt: new Date().toISOString(),
    engine: `nfl-drive:${FOOTBALL_DRIVE_ENGINE_VERSION}`,
    inputUnits:
      "Selection-time points per game, converted to points per drive by the shared drive count. Touchdown = 6 plus one extra-point attempt. Field goal = 3. Events are mutually exclusive. Late-clock touchdowns are funded from the same points-per-game budget.",
    selectionTimeInputs: true,
    calibrationSeed: FOOTBALL_CALIBRATION_PRIMARY_SEED,
    calibrationSeeds: [...FOOTBALL_CALIBRATION_SEEDS],
    seedPolicy:
      "Primary seed is the first precommitted value (20241015). Seeds were listed before the run and were not reordered or dropped to obtain a PASS.",
    officialDogCohort: officialCohort,
    dogCohortByBoundary: DOG_COHORT_BOUNDARY_SWEEP.map((b) => dogCohort(primary.rows, b.lo, b.hi)),
    dogCohortBySeed: seedCohorts,
    dogCohortSeedRange: seedRates.length
      ? {
          min: Math.min(...seedRates),
          max: Math.max(...seedRates),
          mean: seedRates.reduce((a, b) => a + b, 0) / seedRates.length,
        }
      : null,
    boundarySensitiveGames: boundarySensitiveCount(primary.rows),
    boundarySensitiveNote:
      "Count of primary-seed games whose home ML sits within 0.01 of 0.45 or 0.55. Those games can enter or leave the official cohort when the draw noise moves.",
    priorE2aClaim: {
      status: "WITHDRAWN",
      restored: false,
      reportGeneratedAt: "2026-10-14T21:24:31.034Z",
      simulationsPerGame: 1500,
      nHoldoutScored: 865,
      recordedBrier: 0.1989518554913293,
      recordedHomeWinBias: 0.019813872832370683,
      engine:
        "nfl-drive before ppg-per-drive-v1: points per game were passed in as points per drive, then NCAAF inputs were multiplied by 0.48",
      reason:
        "The 2026-10-14 PASS used the same unit mismatch as the NFL draws that sat near 42 points per team. The 0.48 college scale was a patch on that mismatch, not a separate engine. This run is a new measurement. A numeric PASS does not restore that claim.",
    },
    holdoutSeason: HOLDOUT_SEASON,
    simulationsPerGame: SIMS,
    nHoldoutScored: scored,
    nHoldoutSkippedThinForm: skippedThin,
    formMethodology:
      "venue_split blended with L10 via blendVenueAndL10 (production footballGameSimInputs parity); no invented HFA constant",
    formProvenanceCounts: provenanceCounts,
    closingLineArchive: {
      expectedPath: "artifacts/api-server/test/fixtures/ncaaf-phase-e-closing-lines.json",
      present: closingArchive.present,
      parseError: closingArchive.parseError,
      parsedRows: closingArchive.rows.length,
      droppedRows: closingArchive.dropped,
      joinedHoldoutRows: primary.closingJoins.length,
      oddsApiKey: process.env.ODDS_API_KEY ? "set" : "unset",
      espnCompletedScoreboardOdds: "empty",
      espnSummaryPickcenter: "empty",
      designDoc:
        "CLOSING_LINE_ARCHIVE.md at f494c3a5 is a design note and is not on this branch. No E2b PASS exists in prior calibration reports.",
      priorE2bClaims: [
        {
          reportGeneratedAt: "2026-10-14T21:24:31.034Z",
          verdict: "INSUFFICIENT_DATA",
          note: "The withdrawn E2a PASS did not include an E2b PASS.",
        },
      ],
    },
    closingLineData: closingEval.verdict === "INSUFFICIENT_DATA" ? "INSUFFICIENT_DATA" : "MEASURED_OPEN",
    closingLineMetrics: closingEval,
    closingLineNote:
      closingEval.reason +
      " Dependency if the archive is still empty: ODDS_API_KEY historical odds for americanfootball_ncaaf, or ncaaf-phase-e-closing-lines.json with eventId, closeSpreadHome, closeMlHome.",
    injurySegmentData: "INSUFFICIENT_DATA",
    injuryNote:
      "ESPN scoreboard fixture (ncaaf-phase-e-games.json) has no QB/injury flags — E4 cannot PASS. " +
      "Dependency: injury-segmented holdout rows (injuryKnown + optional qbOut) via NCAAF_PHASE_E_FIXTURE, " +
      "or a historical ESPN injury snapshot keyed by eventId/teamId before kickoff.",
    metrics: scored
      ? {
          brier: brier(mlP, mlY),
          brierCoin: brier(coinP, mlY),
          logLoss: logLoss(mlP, mlY),
          ece10: ece(mlP, mlY, 10),
          meanP: mean(mlP, 0.5),
          meanY: mean(mlY, 0.5),
          homeWinBias: mean(mlP, 0.5) - mean(mlY, 0.5),
          nearCoinFlipDog75: {
            n: dog75.length,
            awayCoverRate: dog75.length
              ? dog75.reduce((a, r) => a + r.cover, 0) / dog75.length
              : null,
          },
        }
      : null,
    thresholds: {
      minGames: 200,
      brierMustBeatCoin: true,
      eceMax: 0.12,
      biasMaxAbs: 0.08,
      dog75CoverMaxWhenMlNearHalf: 0.7,
    },
    verdicts: {} as Record<string, string>,
    keepP0Armed: true,
    flagFlipAllowed: false,
  };

  const t = report.thresholds;
  const m = report.metrics;
  let e2Outcome: "PASS" | "FAIL" | "INSUFFICIENT_DATA" = "INSUFFICIENT_DATA";
  const reasons: string[] = [];

  if (!m || scored < t.minGames) {
    e2Outcome = "INSUFFICIENT_DATA";
    reasons.push(`need ≥${t.minGames} scored holdout games, got ${scored}`);
  } else {
    const beatCoin = m.brier < m.brierCoin - 1e-6;
    const eceOk = m.ece10 <= t.eceMax;
    const bias = Math.abs(m.meanP - m.meanY);
    const biasOk = bias <= t.biasMaxAbs;
    const dogN = m.nearCoinFlipDog75.n;
    const dogRate = m.nearCoinFlipDog75.awayCoverRate;
    const dogOk =
      dogN < 30 ||
      (dogRate != null && dogRate <= t.dog75CoverMaxWhenMlNearHalf);
    if (!beatCoin) reasons.push(`brier ${m.brier.toFixed(4)} did not beat coin ${m.brierCoin.toFixed(4)}`);
    if (!eceOk) reasons.push(`ece10 ${m.ece10.toFixed(4)} > ${t.eceMax}`);
    if (!biasOk)
      reasons.push(
        `|meanP-meanY|=${bias.toFixed(4)} > ${t.biasMaxAbs} (home-win bias)`,
      );
    if (!dogOk)
      reasons.push(
        `near-coin-flip +7.5 dog cover ${dogRate?.toFixed(3)} > ${t.dog75CoverMaxWhenMlNearHalf} (n=${dogN})`,
      );
    e2Outcome = beatCoin && eceOk && biasOk && dogOk ? "PASS" : "FAIL";
  }

  // Full E2 for restore also requires closing-line CLV (licensed archive).
  const e2Restore =
    e2Outcome === "PASS" ? "OPEN_NEEDS_CLOSING_LINES" : e2Outcome;

  report.verdicts = {
    E2_outcomeVsCoin: e2Outcome,
    E2_reasons: reasons.join("; ") || "ok",
    E2_closingLineClv: closingEval.verdict,
    E2_readyForRestore: e2Restore,
    E4_injuryConservatism: "INSUFFICIENT_DATA",
    E6_humanSignOff: "OPEN",
    NCAAF_GAME_LINE_SIM_VALIDATED: "false — do not flip",
  };

  const outDir = join(here, "../test/fixtures");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "ncaaf-phase-e-calibration-report.json");
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  console.log(`Wrote ${outPath}`);

  // Keep P0 armed until outcome calibration + CLV + E4 + E6 all clear.
  if (e2Outcome === "PASS" && e2Restore === "OPEN_NEEDS_CLOSING_LINES") {
    console.log(
      "Outcome metrics cleared coin/ECE/dog gates, but closing-line CLV is INSUFFICIENT_DATA.",
    );
    console.log("E4/E6 still OPEN — do not flip NCAAF_GAME_LINE_SIM_VALIDATED.");
    return 2;
  }
  console.error(
    `E2_outcomeVsCoin=${e2Outcome} E2_readyForRestore=${e2Restore}; keep college game lines P0-blocked.`,
  );
  return 2;
}

process.exit(main());

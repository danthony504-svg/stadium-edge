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
 * Closing-line CLV loads fixtures/ncaaf-phase-e-closing-lines.json when present
 * (true pre-kickoff Odds API snapshots joined to ESPN finals). Midday slate
 * dumps alone are not closes. injuryKnown is never inferred as false.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runNflDriveSim } from "../src/lib/sportSim/nflDriveSim.ts";
import { blendVenueAndL10 } from "../src/lib/sportSim/footballDriveMatchup.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../..");

type ClosingRow = {
  gameId: string;
  closeSpreadHome: number | null;
  closeMlHome: number | null;
  homeScore: number;
  awayScore: number;
  closeSnapshotTimestamp?: string;
  oddsCommenceTime?: string;
  injuryKnown?: boolean | null;
};

function mlToProb(american: number): number {
  if (!Number.isFinite(american) || american === 0) return 0.5;
  if (american < 0) return (-american) / (-american + 100);
  return 100 / (american + 100);
}

function loadClosingLines(): Map<string, ClosingRow> {
  const path = join(here, "../test/fixtures/ncaaf-phase-e-closing-lines.json");
  const out = new Map<string, ClosingRow>();
  if (!existsSync(path)) return out;
  const raw = JSON.parse(readFileSync(path, "utf8")) as {
    games?: ClosingRow[];
  };
  for (const g of raw.games ?? []) {
    if (g?.gameId) out.set(String(g.gameId), g);
  }
  return out;
}

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

function main(): number {
  console.log("══ NCAAF Phase E holdout calibration (nfl-drive) ══");
  console.log(`holdoutSeason=${HOLDOUT_SEASON} sims=${SIMS}`);
  console.log("NCAAF_GAME_LINE_SIM_VALIDATED is NOT flipped by this script.");

  const games = loadGames();
  const closes = loadClosingLines();
  const forms = new Map<string, TeamForm>();
  const mlP: number[] = [];
  const mlY: number[] = [];
  const dog75: { cover: number; ml: number }[] = [];
  const provenanceCounts: Record<string, number> = {};
  let skippedThin = 0;
  let scored = 0;
  /** Engine vs close — only holdout games with closing ML + scored sim. */
  const clvEngineP: number[] = [];
  const clvMarketP: number[] = [];
  const clvY: number[] = [];
  let closeMatched = 0;
  let closeMissingOnScored = 0;

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
    if (isHoldout && homeIn.ptsFor != null && awayIn.ptsFor != null) {
      const result = runNflDriveSim({
        sport: "ncaaf",
        simulations: SIMS,
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
            id: "away-sp75",
            kind: "spread",
            teamSide: "away",
            line: 7.5,
          },
        ],
        retainOutcomes: false,
      });
      if (result?.coverHitRates) {
        const pHome = result.coverHitRates["home-ml"] ?? result.homeWinProbability;
        const yHome = g.homeFg > g.awayFg ? 1 : g.homeFg < g.awayFg ? 0 : 0.5;
        if (yHome === 0 || yHome === 1) {
          mlP.push(pHome);
          mlY.push(yHome);
          scored += 1;
          const provKey = `${homeIn.provenance}+${awayIn.provenance}`;
          provenanceCounts[provKey] = (provenanceCounts[provKey] ?? 0) + 1;
          // Pathology: near coin-flip ML with huge dog — cover must not sit at 70%+.
          if (pHome > 0.45 && pHome < 0.55) {
            const awayCovered = g.awayFg + 7.5 > g.homeFg ? 1 : 0;
            dog75.push({ cover: awayCovered, ml: pHome });
          }
          const cl = closes.get(String(g.eventId));
          if (
            cl &&
            cl.closeMlHome != null &&
            Number.isFinite(Number(cl.closeMlHome))
          ) {
            closeMatched += 1;
            const mkt = mlToProb(Number(cl.closeMlHome));
            clvEngineP.push(pHome);
            clvMarketP.push(mkt);
            clvY.push(yHome);
          } else {
            closeMissingOnScored += 1;
          }
        }
      }
    } else if (isHoldout) {
      skippedThin += 1;
    }

    // Update rolling form AFTER the game (chrono — no leakage).
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

  const coinP = mlP.map(() => 0.5);
  const report = {
    generatedAt: new Date().toISOString(),
    engine: "nfl-drive",
    holdoutSeason: HOLDOUT_SEASON,
    simulationsPerGame: SIMS,
    nHoldoutScored: scored,
    nHoldoutSkippedThinForm: skippedThin,
    formMethodology:
      "venue_split blended with L10 via blendVenueAndL10 (production footballGameSimInputs parity); no invented HFA constant",
    formProvenanceCounts: provenanceCounts,
    closingLineData: closes.size
      ? "LOADED_PREKICKOFF_ODDS_ARCHIVE"
      : "INSUFFICIENT_DATA",
    closingLineNote: closes.size
      ? "ncaaf-phase-e-closing-lines.json — per-game Odds API historical snapshot at date=kickoff (last ≤ commence); midday slate fixtures are not closes."
      : "No closing-line archive; run scripts/ncaafPhaseE2bClosingLines.py with ODDS_API_KEY.",
    closingLineJoin: {
      archiveRows: closes.size,
      scoredHoldoutWithCloseMl: closeMatched,
      scoredHoldoutMissingClose: closeMissingOnScored,
    },
    injurySegmentData: "INSUFFICIENT_DATA",
    injuryNote:
      "injuryKnown left unset — missing records are NOT treated as no-injury. " +
      "E4 needs SportsDataIO CFB Vault box-score PlayerGame.InjuryStatus (game-start snapshot, from 2018) " +
      "or an equivalent licensed pregame archive. CFBD documents no injury family. ESPN live /injuries is current-only.",
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

  // E2b soft gates: close archive join + outcome Briers + engine-vs-close Δp.
  // These are NOT closing-line value. True price CLV is computed separately
  // (scripts/fixtures ncaaf-phase-e-true-clv-*).
  let e2bClv: "PASS" | "FAIL" | "INSUFFICIENT_DATA" | "OPEN" = "INSUFFICIENT_DATA";
  const clvReasons: string[] = [];
  let clvMetrics: Record<string, number | boolean | null | string> | null = null;
  if (closeMatched >= 200) {
    const engBrier = brier(clvEngineP, clvY);
    const mktBrier = brier(clvMarketP, clvY);
    const coin = 0.25;
    let edgeSum = 0;
    for (let i = 0; i < clvEngineP.length; i++) {
      edgeSum += clvEngineP[i] - clvMarketP[i];
    }
    const meanEdge = edgeSum / clvEngineP.length;
    clvMetrics = {
      n: closeMatched,
      engineBrier: engBrier,
      marketBrier: mktBrier,
      coinBrier: coin,
      engineBeatsCoin: engBrier < coin,
      marketBeatsCoin: mktBrier < coin,
      /**
       * mean(engineP_home − marketP_home_at_close):
       * unit = probability points in [0,1] (NOT percent, NOT CLV).
       * For each close-joined scored holdout game i:
       *   engineP_i = nfl-drive home-ML hit rate
       *   marketP_i = American close ML → implied win prob
       *   mean = (1/n) Σ (engineP_i − marketP_i)
       * Positive ⇒ engine is more bullish on home than the closing market, on average.
       */
      meanEngineMinusMarket: meanEdge,
      meanEngineMinusMarketUnit: "probability_points_0_to_1",
      isClosingLineValue: false,
      truePriceClvFixture: "ncaaf-phase-e-true-clv-report.json",
      absMeanEdgeMax: 0.15,
    };
    (report as { metrics: Record<string, unknown> | null }).metrics = {
      ...(m ?? {}),
      closingLineSoftGates: clvMetrics,
      // keep old key as alias for existing tests/docs readers
      closingLineClv: clvMetrics,
    };
    const mktOk = mktBrier < coin;
    const engOk = engBrier < coin;
    const edgeOk = Math.abs(meanEdge) <= 0.15;
    if (!mktOk) clvReasons.push(`marketBrier ${mktBrier.toFixed(4)} did not beat coin`);
    if (!engOk) clvReasons.push(`engineBrier ${engBrier.toFixed(4)} did not beat coin on close-joined set`);
    if (!edgeOk)
      clvReasons.push(
        `|mean(engineP-marketP)|=${Math.abs(meanEdge).toFixed(4)} > 0.15`,
      );
    e2bClv = mktOk && engOk && edgeOk ? "PASS" : "FAIL";
  } else {
    clvReasons.push(`need ≥200 close-joined scored games, got ${closeMatched}`);
  }

  // Soft close-archive gates only. Coach pick CLV is a separate report with no PASS label.
  // Full restore still needs E4 + E6 (+ human review of coach-pick CLV).
  const e2Restore =
    e2Outcome === "PASS" && e2bClv === "PASS"
      ? "OPEN_NEEDS_E4_E6"
      : e2Outcome === "PASS" && e2bClv !== "PASS"
        ? "OPEN_NEEDS_CLOSE_ARCHIVE_SOFT_GATES"
        : e2Outcome;

  report.verdicts = {
    E2_outcomeVsCoin: e2Outcome,
    E2_reasons: reasons.join("; ") || "ok",
    // Soft close-archive gates only — NOT Coach pick CLV. See coach-pick-clv report.
    E2_closeArchiveSoftGates: e2bClv,
    E2_closeArchiveSoftGateReasons: clvReasons.join("; ") || "ok",
    E2_coachPickClv: "see ncaaf-phase-e-coach-pick-clv-report.json — no PASS label here",
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

  // Keep P0 armed until outcome calibration + soft gates + coach-pick CLV review + E4 + E6.
  if (e2Outcome === "PASS" && e2bClv === "PASS") {
    console.log(
      "E2a + close-archive soft gates cleared (NOT Coach pick CLV). E4/E6 still OPEN.",
    );
    console.log("Do not flip NCAAF_GAME_LINE_SIM_VALIDATED.");
    return 2;
  }
  if (e2Outcome === "PASS" && e2bClv !== "PASS") {
    console.log(
      `Outcome metrics PASS but E2_closeArchiveSoftGates=${e2bClv}: ${clvReasons.join("; ")}`,
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

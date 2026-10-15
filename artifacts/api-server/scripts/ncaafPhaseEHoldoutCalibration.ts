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

type TeamForm = { ptsFor: number[]; ptsAgainst: number[] };

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
} {
  const pf = form?.ptsFor.slice(-n) ?? [];
  const pa = form?.ptsAgainst.slice(-n) ?? [];
  if (pf.length < 2) {
    return { ptsFor: null, ptsAgainst: null, recentScores: pf.slice() };
  }
  return {
    ptsFor: mean(pf, 24),
    ptsAgainst: mean(pa, 24),
    recentScores: pf.slice(),
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
  const forms = new Map<string, TeamForm>();
  const mlP: number[] = [];
  const mlY: number[] = [];
  const dog75: { cover: number; ml: number }[] = [];
  let skippedThin = 0;
  let scored = 0;

  for (const g of games) {
    const homeForm = formSlice(forms.get(g.homeTeamId));
    const awayForm = formSlice(forms.get(g.awayTeamId));

    const isHoldout = g.season === HOLDOUT_SEASON;
    if (
      isHoldout &&
      homeForm.ptsFor != null &&
      awayForm.ptsFor != null
    ) {
      const result = runNflDriveSim({
        sport: "ncaaf",
        simulations: SIMS,
        home: {
          ptsFor: homeForm.ptsFor,
          ptsAgainst: homeForm.ptsAgainst,
          recentScores: homeForm.recentScores,
        },
        away: {
          ptsFor: awayForm.ptsFor,
          ptsAgainst: awayForm.ptsAgainst,
          recentScores: awayForm.recentScores,
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
          // Pathology: near coin-flip ML with huge dog — cover must not sit at 70%+.
          if (pHome > 0.45 && pHome < 0.55) {
            const awayCovered = g.awayFg + 7.5 > g.homeFg ? 1 : 0;
            dog75.push({ cover: awayCovered, ml: pHome });
          }
        }
      }
    } else if (isHoldout) {
      skippedThin += 1;
    }

    // Update rolling form AFTER the game (chrono — no leakage).
    const hf = forms.get(g.homeTeamId) ?? { ptsFor: [], ptsAgainst: [] };
    hf.ptsFor.push(g.homeFg);
    hf.ptsAgainst.push(g.awayFg);
    forms.set(g.homeTeamId, hf);
    const af = forms.get(g.awayTeamId) ?? { ptsFor: [], ptsAgainst: [] };
    af.ptsFor.push(g.awayFg);
    af.ptsAgainst.push(g.homeFg);
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
    closingLineData: "INSUFFICIENT_DATA",
    closingLineNote:
      "No licensed closing-line archive in this environment; CLV / market-Brier not computed.",
    injurySegmentData: "INSUFFICIENT_DATA",
    injuryNote:
      "ESPN scoreboard cache has no QB/injury flags — E4 cannot PASS without an injury-segmented universe.",
    metrics: scored
      ? {
          brier: brier(mlP, mlY),
          brierCoin: brier(coinP, mlY),
          logLoss: logLoss(mlP, mlY),
          ece10: ece(mlP, mlY, 10),
          meanP: mean(mlP, 0.5),
          meanY: mean(mlY, 0.5),
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
    E2_closingLineClv: "INSUFFICIENT_DATA",
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

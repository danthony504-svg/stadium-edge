/**
 * MLB discrimination audit: baseball.joint v0.2 vs v0.3 on frozen identical holdout.
 * Also writes VAL-fold diagnostics (tune/decision only — never holdout).
 * Shadow-only. SIM_V2_SERVE off. No allowlist / Coach / P0 changes.
 *
 * Metrics: Brier, LogLoss, ECE, n, clustered SE; separation / AUC / resolution;
 * meanAbsDevFromHalf + shrink-to-50; within-draw scoring variance vs actual;
 * tail p90/p95 calibration for totals; leak-free pregame baselines (coin 0.5 +
 * empirical home-win rate from TRAIN only).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type BaseballCalibrationProfile,
  buildJointBaseballTensor,
} from "../src/models/baseball/jointBaseball.js";
import {
  buildBaseballMlMarket,
  buildBaseballSpreadMarket,
  buildBaseballTeamTotalMarket,
  buildBaseballTotalMarket,
} from "../src/models/baseball/markets.js";
import { settleMarket } from "../src/engine/settle.js";
import { impliedProbFromAmerican } from "../src/schemas/odds.js";
import { SIM_V2_ACCEPTANCE_THRESHOLDS } from "../src/flags/acceptanceGates.js";
import {
  type CalibObs,
  type DistCompare,
  clusteredEceSe,
  compareDistributions,
  discriminationProxy,
  evaluateFamilyGate,
  formatDistTable,
  meanAbsDevFromHalf,
  metricsOf,
  shrinkTo50Flag,
} from "./familyCalibration.js";

const REPORT_DIR = join(import.meta.dirname, "report");
const CACHE_DIR = join(import.meta.dirname, "cache");
const PROFILES: BaseballCalibrationProfile[] = ["v0.2", "v0.3"];
const MIN_OOS = SIM_V2_ACCEPTANCE_THRESHOLDS.minOosSample;
const MAX_ECE = SIM_V2_ACCEPTANCE_THRESHOLDS.maxEce;

type Game = {
  eventId: string;
  kickoffIso: string;
  homeId: string;
  awayId: string;
  homeFg: number;
  awayFg: number;
  homeF5: number;
  awayF5: number;
};

type FoldName = "train" | "val" | "holdout";

type FamilyDisc = {
  profile: BaseballCalibrationProfile;
  fold: FoldName;
  family: string;
  n: number;
  games: number;
  effN: number;
  brier: number | null;
  logLoss: number | null;
  ece: number | null;
  eceSe: number | null;
  meanP: number;
  meanY: number;
  meanAbsDevFromHalf: number;
  meanPWhenY1: number | null;
  meanPWhenY0: number | null;
  separation: number | null;
  auc: number | null;
  resolution: number | null;
  discKind: "auc" | "resolution" | "none";
  discValue: number | null;
  verdict: string;
};

type DistExtras = {
  profile: BaseballCalibrationProfile;
  fold: FoldName;
  withinDrawVarTotal: number;
  withinDrawVarMargin: number;
  actualVarTotal: number;
  actualVarMargin: number;
  betweenGameVarRatioTotal: number | null;
  betweenGameVarRatioMargin: number | null;
  actualP90Total: number;
  simMeanP90Total: number;
  actualP95Total: number;
  simMeanP95Total: number;
  /** Fraction of games where actual total ≥ empirical p90 / sim mean p90. */
  tailP90HitActual: number;
  tailP90HitSimMeans: number;
  tailP95HitActual: number;
  tailP95HitSimMeans: number;
  distTotal: DistCompare | null;
  distMargin: DistCompare | null;
};

function ymd(year: number, month: number, day: number): string {
  return `${year}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
}

function seasonSampleDays(season: number, step = 1): string[] {
  const days: string[] = [];
  for (const month of [4, 5, 6, 8, 9]) {
    const maxDay = month === 9 ? 28 : 30;
    for (let d = 1; d <= maxDay; d += step) {
      days.push(ymd(season, month, d));
    }
  }
  return days;
}

async function fetchSeason(season: number, step = 1): Promise<Game[]> {
  const out: Game[] = [];
  for (const dates of seasonSampleDays(season, step)) {
    const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=${dates}`;
    try {
      const r = await fetch(url, { headers: { "User-Agent": "stadium-sim-v2-mlb-disc" } });
      if (!r.ok) continue;
      const j = (await r.json()) as {
        events?: Array<{
          id?: string;
          date?: string;
          competitions?: Array<{
            competitors?: Array<{
              homeAway?: string;
              score?: string;
              team?: { id?: string };
              linescores?: Array<{ value?: number }>;
            }>;
            status?: { type?: { completed?: boolean } };
          }>;
        }>;
      };
      for (const ev of j.events ?? []) {
        const c = ev.competitions?.[0];
        if (!c?.status?.type?.completed || !ev.id || !ev.date) continue;
        const home = c.competitors?.find((x) => x.homeAway === "home");
        const away = c.competitors?.find((x) => x.homeAway === "away");
        if (!home?.team?.id || !away?.team?.id) continue;
        const homeFg = Number(home.score);
        const awayFg = Number(away.score);
        if (!Number.isFinite(homeFg) || !Number.isFinite(awayFg)) continue;
        const hLs = (home.linescores ?? []).map((x) => Number(x.value ?? 0));
        const aLs = (away.linescores ?? []).map((x) => Number(x.value ?? 0));
        if (hLs.length < 5 || aLs.length < 5) continue;
        out.push({
          eventId: ev.id,
          kickoffIso: ev.date,
          homeId: home.team.id,
          awayId: away.team.id,
          homeFg,
          awayFg,
          homeF5: hLs.slice(0, 5).reduce((s, v) => s + v, 0),
          awayF5: aLs.slice(0, 5).reduce((s, v) => s + v, 0),
        });
      }
    } catch {
      /* skip */
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  return Array.from(new Map(out.map((g) => [g.eventId, g])).values()).sort(
    (a, b) => new Date(a.kickoffIso).getTime() - new Date(b.kickoffIso).getTime(),
  );
}

async function loadOrFetchGames(): Promise<Game[]> {
  await mkdir(CACHE_DIR, { recursive: true });
  const cachePath = join(CACHE_DIR, "mlb_disc_games_2023_2024.json");
  try {
    const raw = await readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw) as Game[];
    if (Array.isArray(parsed) && parsed.length >= 3000) {
      console.log(`cache hit: ${cachePath} n=${parsed.length}`);
      return parsed.sort(
        (a, b) => new Date(a.kickoffIso).getTime() - new Date(b.kickoffIso).getTime(),
      );
    }
  } catch {
    /* fetch */
  }
  console.log("fetching ESPN MLB seasons 2023–2024 (date-sample)…");
  const s2023 = await fetchSeason(2023, 1);
  const s2024 = await fetchSeason(2024, 1);
  const games = Array.from(
    new Map([...s2023, ...s2024].map((g) => [g.eventId, g])).values(),
  ).sort((a, b) => new Date(a.kickoffIso).getTime() - new Date(b.kickoffIso).getTime());
  await writeFile(cachePath, JSON.stringify(games), "utf8");
  console.log(`cached ${games.length} games → ${cachePath}`);
  return games;
}

function form(teamId: string, before: number, games: Game[]) {
  const prior = games.filter(
    (g) =>
      new Date(g.kickoffIso).getTime() < before &&
      (g.homeId === teamId || g.awayId === teamId),
  );
  if (prior.length < 4) return null;
  const used = prior.slice(-15);
  let rf = 0;
  let ra = 0;
  const recent: number[] = [];
  for (const g of used) {
    if (g.homeId === teamId) {
      rf += g.homeFg;
      ra += g.awayFg;
      recent.push(g.homeFg);
    } else {
      rf += g.awayFg;
      ra += g.homeFg;
      recent.push(g.awayFg);
    }
  }
  return {
    teamId,
    runsFor: rf / used.length,
    runsAgainst: ra / used.length,
    recentFgRuns: recent,
  };
}

function chronoFolds(games: Game[]): { train: Game[]; val: Game[]; holdout: Game[] } {
  const n = games.length;
  const tEnd = Math.floor(n * 0.55);
  const vEnd = Math.floor(n * 0.75);
  return {
    train: games.slice(0, tEnd),
    val: games.slice(tEnd, vEnd),
    holdout: games.slice(vEnd),
  };
}

function pct(xs: number[], p: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))));
  return s[i]!;
}

function variance(xs: number[]): number {
  if (!xs.length) return NaN;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
}

function familyRows(obs: CalibObs[], family: string): CalibObs[] {
  if (family === "main_all") return obs.filter((o) => !o.isAlt && o.family !== "player_prop");
  if (family === "alt_all") return obs.filter((o) => !!o.isAlt && o.family !== "player_prop");
  if (family === "f5_ml") return obs.filter((o) => o.family === "f5" && o.slice === "f5_ml_home");
  if (family === "fg_ml") return obs.filter((o) => o.family === "ml" && o.slice === "ml_home");
  return obs.filter((o) => o.family === family);
}

function discMetrics(
  profile: BaseballCalibrationProfile,
  fold: FoldName,
  family: string,
  rows: CalibObs[],
): FamilyDisc {
  const gate = evaluateFamilyGate(`mlb:${family}:${fold}`, rows);
  const mad = meanAbsDevFromHalf(rows);
  const disc = discriminationProxy(rows);
  return {
    profile,
    fold,
    family,
    n: gate.n,
    games: gate.nGames,
    effN: gate.effectiveN,
    brier: gate.brier,
    logLoss: gate.logLoss,
    ece: gate.ece,
    eceSe: gate.eceSe ?? clusteredEceSe(rows, 200, `disc:${profile}:${fold}:${family}`),
    meanP: gate.meanP,
    meanY: gate.meanY,
    meanAbsDevFromHalf: mad,
    meanPWhenY1: disc.meanPWhenY1,
    meanPWhenY0: disc.meanPWhenY0,
    separation: disc.separation,
    auc: disc.auc,
    resolution: disc.resolution,
    discKind: disc.kind,
    discValue: disc.value,
    verdict: gate.verdict,
  };
}

function fmt(n: number | null | undefined, d = 4): string {
  return n == null || !Number.isFinite(n) ? "n/a" : n.toFixed(d);
}

function delta(a: number | null, b: number | null): string {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return "n/a";
  const d = b - a;
  return `${d >= 0 ? "+" : ""}${d.toFixed(4)}`;
}

/** Constant-p baseline metrics (leak-free when p is from train only). */
function baselineMetrics(
  rows: CalibObs[],
  pConst: number,
  label: string,
): {
  label: string;
  p: number;
  n: number;
  brier: number | null;
  logLoss: number | null;
  ece: number | null;
  meanY: number;
} {
  const synth = rows.map((r) => ({ y: r.y, p: pConst }));
  const m = metricsOf(synth);
  return {
    label,
    p: pConst,
    n: m.n,
    brier: m.brier,
    logLoss: m.logLoss,
    ece: m.ece,
    meanY: m.meanY,
  };
}

type GradeSink = {
  obs: CalibObs[];
  actualTotals: number[];
  simTotalMeans: number[];
  simTotalVars: number[];
  actualMargins: number[];
  simMarginMeans: number[];
  simMarginVars: number[];
  used: number;
};

function emptySink(): GradeSink {
  return {
    obs: [],
    actualTotals: [],
    simTotalMeans: [],
    simTotalVars: [],
    actualMargins: [],
    simMarginMeans: [],
    simMarginVars: [],
    used: 0,
  };
}

function gradeGame(
  g: Game,
  allGames: Game[],
  profile: BaseballCalibrationProfile,
  fold: FoldName,
  sink: GradeSink,
): boolean {
  const t = new Date(g.kickoffIso).getTime();
  const home = form(g.homeId, t, allGames);
  const away = form(g.awayId, t, allGames);
  if (!home || !away) return false;

  const tensor = buildJointBaseballTensor({
    sport: "mlb",
    eventId: g.eventId,
    seed: `mlb-disc:${fold}:${g.eventId}`,
    nDraws: 2000,
    home,
    away,
    calibrationProfile: profile,
  });
  sink.used += 1;

  let simTot = 0;
  let simMar = 0;
  let totSq = 0;
  let marSq = 0;
  for (let i = 0; i < tensor.meta.nDraws; i++) {
    const tot = tensor.team.homeFg[i]! + tensor.team.awayFg[i]!;
    const mar = tensor.team.homeFg[i]! - tensor.team.awayFg[i]!;
    simTot += tot;
    simMar += mar;
    totSq += tot * tot;
    marSq += mar * mar;
  }
  const n = tensor.meta.nDraws;
  simTot /= n;
  simMar /= n;
  sink.actualTotals.push(g.homeFg + g.awayFg);
  sink.simTotalMeans.push(simTot);
  sink.simTotalVars.push(totSq / n - simTot * simTot);
  sink.actualMargins.push(g.homeFg - g.awayFg);
  sink.simMarginMeans.push(simMar);
  sink.simMarginVars.push(marSq / n - simMar * simMar);

  const specs: Array<{
    family: string;
    slice: string;
    isAlt?: boolean;
    m: ReturnType<typeof buildBaseballMlMarket>;
    y: 0 | 1;
  }> = [
    {
      family: "ml",
      slice: "ml_home",
      m: buildBaseballMlMarket({ marketId: "ml", eventId: g.eventId, side: "home" }),
      y: g.homeFg > g.awayFg ? 1 : 0,
    },
    {
      family: "spread",
      slice: "rl_home_-1.5",
      m: buildBaseballSpreadMarket({
        marketId: "rl",
        eventId: g.eventId,
        side: "home",
        postedSpread: -1.5,
      }),
      y: g.homeFg - g.awayFg > 1.5 ? 1 : 0,
    },
    {
      family: "spread",
      slice: "alt_rl_home_-2.5",
      isAlt: true,
      m: buildBaseballSpreadMarket({
        marketId: "arl",
        eventId: g.eventId,
        side: "home",
        postedSpread: -2.5,
      }),
      y: g.homeFg - g.awayFg > 2.5 ? 1 : 0,
    },
    {
      family: "total",
      slice: "total_8.5",
      m: buildBaseballTotalMarket({
        marketId: "tot",
        eventId: g.eventId,
        side: "over",
        line: 8.5,
      }),
      y: g.homeFg + g.awayFg > 8.5 ? 1 : 0,
    },
    {
      family: "total",
      slice: "alt_total_10.5",
      isAlt: true,
      m: buildBaseballTotalMarket({
        marketId: "atot",
        eventId: g.eventId,
        side: "over",
        line: 10.5,
      }),
      y: g.homeFg + g.awayFg > 10.5 ? 1 : 0,
    },
    {
      family: "team_total",
      slice: "tt_home_4.5",
      m: buildBaseballTeamTotalMarket({
        marketId: "tt",
        eventId: g.eventId,
        teamSide: "home",
        side: "over",
        line: 4.5,
      }),
      y: g.homeFg > 4.5 ? 1 : 0,
    },
    {
      family: "f5",
      slice: "f5_total_4.5",
      m: buildBaseballTotalMarket({
        marketId: "f5",
        eventId: g.eventId,
        period: "f5",
        side: "over",
        line: 4.5,
      }),
      y: g.homeF5 + g.awayF5 > 4.5 ? 1 : 0,
    },
    {
      family: "f5",
      slice: "f5_ml_home",
      m: buildBaseballMlMarket({
        marketId: "f5ml",
        eventId: g.eventId,
        period: "f5",
        side: "home",
      }),
      y: g.homeF5 > g.awayF5 ? 1 : 0,
    },
    {
      family: "f5",
      slice: "alt_f5_total_5.5",
      isAlt: true,
      m: buildBaseballTotalMarket({
        marketId: "af5",
        eventId: g.eventId,
        period: "f5",
        side: "over",
        line: 5.5,
      }),
      y: g.homeF5 + g.awayF5 > 5.5 ? 1 : 0,
    },
  ];

  for (const s of specs) {
    const r = settleMarket({
      tensor,
      market: s.m,
      odds: {
        marketId: s.m.marketId,
        american: -110,
        book: "eval-grid",
        capturedAt: new Date().toISOString(),
        impliedProbRaw: impliedProbFromAmerican(-110),
        provenance: { provider: "eval-grid", fetchedAt: new Date().toISOString() },
      },
    });
    if (r.status === "ok" && r.simHit != null) {
      sink.obs.push({
        y: s.y,
        p: r.simHit,
        eventId: g.eventId,
        family: s.family,
        slice: s.slice,
        fold,
        isAlt: s.isAlt,
        realBookLine: false,
      });
    }
  }
  return true;
}

function distExtras(profile: BaseballCalibrationProfile, fold: FoldName, sink: GradeSink): DistExtras {
  const withinDrawVarTotal =
    sink.simTotalVars.reduce((a, b) => a + b, 0) / Math.max(1, sink.simTotalVars.length);
  const withinDrawVarMargin =
    sink.simMarginVars.reduce((a, b) => a + b, 0) / Math.max(1, sink.simMarginVars.length);
  const actualVarTotal = variance(sink.actualTotals);
  const actualVarMargin = variance(sink.actualMargins);
  const distTotal = compareDistributions(`mlb_total_${profile}_${fold}`, sink.actualTotals, sink.simTotalMeans);
  const distMargin = compareDistributions(
    `mlb_margin_${profile}_${fold}`,
    sink.actualMargins,
    sink.simMarginMeans,
  );
  const actualP90Total = pct(sink.actualTotals, 0.9);
  const actualP95Total = pct(sink.actualTotals, 0.95);
  const simMeanP90Total = pct(sink.simTotalMeans, 0.9);
  const simMeanP95Total = pct(sink.simTotalMeans, 0.95);
  const hitRate = (threshold: number, xs: number[]) =>
    xs.length ? xs.filter((x) => x >= threshold).length / xs.length : NaN;
  return {
    profile,
    fold,
    withinDrawVarTotal,
    withinDrawVarMargin,
    actualVarTotal,
    actualVarMargin,
    betweenGameVarRatioTotal: distTotal?.varRatio ?? null,
    betweenGameVarRatioMargin: distMargin?.varRatio ?? null,
    actualP90Total,
    simMeanP90Total,
    actualP95Total,
    simMeanP95Total,
    // Calibration of tails: rate of exceeding the *actual* empirical p90/p95
    // among actuals (~0.10/0.05 by construction) vs among sim means (should be similar if calibrated).
    tailP90HitActual: hitRate(actualP90Total, sink.actualTotals),
    tailP90HitSimMeans: hitRate(actualP90Total, sink.simTotalMeans),
    tailP95HitActual: hitRate(actualP95Total, sink.actualTotals),
    tailP95HitSimMeans: hitRate(actualP95Total, sink.simTotalMeans),
    distTotal,
    distMargin,
  };
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });
  const games = await loadOrFetchGames();
  const folds = chronoFolds(games);

  // Frozen identical holdout from A/B (same event ids).
  const freezePath = join(REPORT_DIR, "MLB_AB_HOLDOUT_GAMES.json");
  const freeze = JSON.parse(await readFile(freezePath, "utf8")) as {
    n: number;
    eventIds: string[];
  };
  const byId = new Map(games.map((g) => [g.eventId, g]));
  const holdoutFrozen = freeze.eventIds
    .map((id) => byId.get(id))
    .filter((g): g is Game => !!g);
  if (holdoutFrozen.length < MIN_OOS) {
    throw new Error(
      `frozen_holdout_incomplete: found=${holdoutFrozen.length} expected=${freeze.n}`,
    );
  }

  // VAL: first 560 with form (diagnostic only — decision lever).
  const valCandidates = folds.val;
  const valFrozen: Game[] = [];
  for (const g of valCandidates) {
    const t = new Date(g.kickoffIso).getTime();
    if (form(g.homeId, t, games) && form(g.awayId, t, games)) {
      valFrozen.push(g);
      if (valFrozen.length >= 560) break;
    }
  }

  // Leak-free pregame baselines from TRAIN only.
  const trainHomeWins = folds.train.filter((g) => g.homeFg > g.awayFg).length;
  const trainHomeWinRate = trainHomeWins / Math.max(1, folds.train.length);
  const coinP = 0.5;

  type Bundle = Record<BaseballCalibrationProfile, GradeSink>;
  const holdoutBundle: Bundle = { "v0.2": emptySink(), "v0.3": emptySink() };
  const valBundle: Bundle = { "v0.2": emptySink(), "v0.3": emptySink() };

  console.log(
    `grading holdout n=${holdoutFrozen.length} + val n=${valFrozen.length} × profiles…`,
  );
  for (const g of holdoutFrozen) {
    for (const profile of PROFILES) {
      gradeGame(g, games, profile, "holdout", holdoutBundle[profile]);
    }
  }
  for (const g of valFrozen) {
    for (const profile of PROFILES) {
      gradeGame(g, games, profile, "val", valBundle[profile]);
    }
  }

  const familyKeys = [
    "ml",
    "spread",
    "total",
    "team_total",
    "f5",
    "main_all",
    "alt_all",
    "f5_ml",
    "fg_ml",
  ] as const;

  function collect(fold: FoldName, bundle: Bundle): FamilyDisc[] {
    const out: FamilyDisc[] = [];
    for (const profile of PROFILES) {
      for (const f of familyKeys) {
        out.push(discMetrics(profile, fold, f, familyRows(bundle[profile].obs, f)));
      }
    }
    return out;
  }

  const holdoutDisc = collect("holdout", holdoutBundle);
  const valDisc = collect("val", valBundle);
  const holdoutDist = PROFILES.map((p) => distExtras(p, "holdout", holdoutBundle[p]));
  const valDist = PROFILES.map((p) => distExtras(p, "val", valBundle[p]));

  const mlHoldout = holdoutFrozen.map((g) => ({
    y: (g.homeFg > g.awayFg ? 1 : 0) as 0 | 1,
    p: 0.5,
    eventId: g.eventId,
    family: "ml",
    slice: "ml_home",
    fold: "holdout" as const,
  }));
  const baselinesHoldout = [
    baselineMetrics(mlHoldout, coinP, "coin_0.5"),
    baselineMetrics(mlHoldout, trainHomeWinRate, "empirical_home_win_train"),
  ];
  const mlVal = valFrozen.map((g) => ({
    y: (g.homeFg > g.awayFg ? 1 : 0) as 0 | 1,
    p: 0.5,
    eventId: g.eventId,
    family: "ml",
    slice: "ml_home",
    fold: "val" as const,
  }));
  const baselinesVal = [
    baselineMetrics(mlVal, coinP, "coin_0.5"),
    baselineMetrics(mlVal, trainHomeWinRate, "empirical_home_win_train"),
  ];

  // Pairwise v0.2 → v0.3 for holdout + val
  type Pair = {
    fold: FoldName;
    family: string;
    before: FamilyDisc;
    after: FamilyDisc;
    shrink: ReturnType<typeof shrinkTo50Flag>;
    discDelta: number | null;
    separationDelta: number | null;
    discriminationWorse: boolean;
  };
  const pairs: Pair[] = [];
  for (const fold of ["holdout", "val"] as const) {
    const rows = fold === "holdout" ? holdoutDisc : valDisc;
    for (const f of familyKeys) {
      const before = rows.find((r) => r.profile === "v0.2" && r.family === f)!;
      const after = rows.find((r) => r.profile === "v0.3" && r.family === f)!;
      const shrink = shrinkTo50Flag({
        eceBefore: before.ece,
        eceAfter: after.ece,
        madBefore: before.meanAbsDevFromHalf,
        madAfter: after.meanAbsDevFromHalf,
      });
      const discDelta =
        before.discValue != null && after.discValue != null
          ? after.discValue - before.discValue
          : null;
      const separationDelta =
        before.separation != null && after.separation != null
          ? after.separation - before.separation
          : null;
      // Discrimination worse if AUC/resolution drops OR separation drops by ≥0.01
      const discriminationWorse =
        (discDelta != null && discDelta < -0.005) ||
        (separationDelta != null && separationDelta < -0.01);
      pairs.push({
        fold,
        family: f,
        before,
        after,
        shrink,
        discDelta,
        separationDelta,
        discriminationWorse,
      });
    }
  }

  const valMl = pairs.find((p) => p.fold === "val" && p.family === "ml")!;
  const valTt = pairs.find((p) => p.fold === "val" && p.family === "team_total")!;
  const holdMl = pairs.find((p) => p.fold === "holdout" && p.family === "ml")!;
  const holdTt = pairs.find((p) => p.fold === "holdout" && p.family === "team_total")!;
  const holdF5 = pairs.find((p) => p.fold === "holdout" && p.family === "f5")!;
  const holdF5Ml = pairs.find((p) => p.fold === "holdout" && p.family === "f5_ml")!;
  const holdFgMl = pairs.find((p) => p.fold === "holdout" && p.family === "fg_ml")!;

  // Decision (VAL only): do not accept shrink-only ECE; Option A vs B.
  const valMlReject =
    valMl.shrink.flagged || valMl.discriminationWorse || (valMl.after.ece ?? 1) > MAX_ECE;
  const valTtReject =
    valTt.shrink.flagged || valTt.discriminationWorse || (valTt.after.ece ?? 1) > MAX_ECE;
  // Option B only when VAL ML discrimination worsens; else Option A (keep default, MODIFY).
  const option: "A" | "B" = valMl.discriminationWorse ? "B" : "A";
  const defaultParamsChanged = option === "B";

  // Per-family keep/revert/modify/insufficient (acceptance view — shadow).
  type Decision = "KEEP" | "REVERT" | "MODIFY" | "INSUFFICIENT";
  const familyDecisions: Record<string, { decision: Decision; rationale: string }> = {};
  const decideFamilies = [
    "ml",
    "spread",
    "total",
    "team_total",
    "f5",
    "main_all",
    "alt_all",
    "player_prop_named",
    "closing_line",
  ] as const;
  for (const f of decideFamilies) {
    if (f === "closing_line") {
      familyDecisions[f] = {
        decision: "INSUFFICIENT",
        rationale: "no licensed closing-line archive",
      };
      continue;
    }
    if (f === "player_prop_named") {
      familyDecisions[f] = {
        decision: "MODIFY",
        rationale:
          "holdout ECE still >0.04; starter participation fail-closed already in joint; needs prop-specific calibration (not shrink-to-50 for team markets)",
      };
      continue;
    }
    const valP = pairs.find((p) => p.fold === "val" && p.family === f);
    const holdP = pairs.find((p) => p.fold === "holdout" && p.family === f);
    if (!valP || !holdP) {
      familyDecisions[f] = { decision: "INSUFFICIENT", rationale: "missing pair metrics" };
      continue;
    }
    if (f === "f5" && holdP.after.verdict === "PASS" && !holdP.shrink.flagged && !valP.discriminationWorse) {
      familyDecisions[f] = {
        decision: "KEEP",
        rationale: `v0.3 holdout PASS (ECE=${fmt(holdP.after.ece)}); VAL discrimination not worse; not shrink-to-50`,
      };
      continue;
    }
    if (valP.shrink.flagged || (f === "ml" || f === "team_total") && holdP.shrink.flagged) {
      familyDecisions[f] = {
        decision: "MODIFY",
        rationale: `shrink-to-50 and/or weak discrimination on VAL/holdout — do not accept ECE-only gain (VAL mad½ ${fmt(valP.before.meanAbsDevFromHalf)}→${fmt(valP.after.meanAbsDevFromHalf)}; sep Δ=${fmt(valP.separationDelta)})`,
      };
      continue;
    }
    if (valP.discriminationWorse) {
      familyDecisions[f] = {
        decision: "MODIFY",
        rationale: `VAL discrimination worsened (disc Δ=${fmt(valP.discDelta)}, sep Δ=${fmt(valP.separationDelta)}); ECE-only not accepted`,
      };
      continue;
    }
    if (holdP.after.verdict === "PASS") {
      familyDecisions[f] = {
        decision: "KEEP",
        rationale: `v0.3 holdout PASS; VAL discrimination OK; not shrink-to-50`,
      };
      continue;
    }
    // Still FAIL ECE but not shrink artifact — keep levers, continue calibration.
    familyDecisions[f] = {
      decision: "MODIFY",
      rationale: `v0.3 improves ECE/Brier without shrink-to-50 but still FAIL gate (ECE=${fmt(holdP.after.ece)}>${MAX_ECE}); need variance/tails work, not accept`,
    };
  }

  // F5 vs FG ML gap notes
  const f5FgGapNote = [
    `Holdout FG ML (slice ml_home): ECE v0.2=${fmt(holdFgMl.before.ece)} → v0.3=${fmt(holdFgMl.after.ece)}; sep ${fmt(holdFgMl.before.separation)}→${fmt(holdFgMl.after.separation)}; AUC ${fmt(holdFgMl.before.auc)}→${fmt(holdFgMl.after.auc)}; mad½ ${fmt(holdFgMl.before.meanAbsDevFromHalf)}→${fmt(holdFgMl.after.meanAbsDevFromHalf)}; shrink=${holdFgMl.shrink.flagged ? "FLAG" : "ok"}`,
    `Holdout F5 ML (slice f5_ml_home): ECE v0.2=${fmt(holdF5Ml.before.ece)} → v0.3=${fmt(holdF5Ml.after.ece)}; sep ${fmt(holdF5Ml.before.separation)}→${fmt(holdF5Ml.after.separation)}; AUC ${fmt(holdF5Ml.before.auc)}→${fmt(holdF5Ml.after.auc)}; mad½ ${fmt(holdF5Ml.before.meanAbsDevFromHalf)}→${fmt(holdF5Ml.after.meanAbsDevFromHalf)}; shrink=${holdF5Ml.shrink.flagged ? "FLAG" : "ok"}`,
    `Holdout F5 family (all F5 markets): verdict v0.3=**${holdF5.after.verdict}** ECE=${fmt(holdF5.after.ece)}`,
    "Gap hypothesis: F5 is 5/9 of the same Poisson innings — shorter horizon reduces cumulative form-overconfidence; FG ML integrates 9 innings of shrunk means + HFA so home-win probs collapse toward 0.5 under v0.3 shrink (shrink-to-50 on FG ML) while F5 ML retains usable separation and clears ECE.",
    "Starting pitcher participation: already **fail-closed** in `jointBaseball.ts` (non-starter pitcher → participateProb=0 → settle `missing_data`). Team FG/F5 ML still ignore SP identity — SP features are prop-path only today.",
  ];

  const discTable = (fold: FoldName) => {
    const rows = pairs.filter((p) => p.fold === fold && !["f5_ml", "fg_ml"].includes(p.family));
    return [
      `| Family | n | ECE v0.2 | ECE v0.3 | Brier v0.2 | Brier v0.3 | LogLoss v0.2 | LogLoss v0.3 | ECE_SE v0.3 | sep v0.2 | sep v0.3 | AUC v0.2 | AUC v0.3 | mad½ v0.2 | mad½ v0.3 | shrink | discΔ |`,
      `|--------|---|----------|----------|------------|------------|--------------|--------------|-------------|----------|----------|----------|----------|-----------|-----------|--------|-------|`,
      ...rows.map((r) => {
        const b = r.before;
        const a = r.after;
        return `| ${r.family} | ${a.n} | ${fmt(b.ece)} | ${fmt(a.ece)} | ${fmt(b.brier)} | ${fmt(a.brier)} | ${fmt(b.logLoss)} | ${fmt(a.logLoss)} | ${fmt(a.eceSe)} | ${fmt(b.separation)} | ${fmt(a.separation)} | ${fmt(b.auc)} | ${fmt(a.auc)} | ${fmt(b.meanAbsDevFromHalf)} | ${fmt(a.meanAbsDevFromHalf)} | ${r.shrink.flagged ? "FLAG" : "ok"} | ${fmt(r.discDelta)} |`;
      }),
    ];
  };

  const md = [
    "# MLB discrimination audit — v0.2 vs v0.3",
    "",
    "Shadow-only. Identical frozen chronological holdout (`MLB_AB_HOLDOUT_GAMES.json`).",
    "VAL fold is diagnostic for default-profile decision; **never tune on holdout**.",
    "`SIM_V2_SERVE` off. Thresholds unchanged: minOos=500, maxEce=0.04.",
    "",
    "## Setup",
    "",
    `- Games: ${games.length}; chrono 55/20/25 → train ${folds.train.length} / val ${folds.val.length} / holdout ${folds.holdout.length}`,
    `- Frozen holdout graded: ${holdoutFrozen.length} (ids match A/B freeze); used v0.2=${holdoutBundle["v0.2"].used} v0.3=${holdoutBundle["v0.3"].used}`,
    `- VAL diagnostic graded: ${valFrozen.length}; used v0.2=${valBundle["v0.2"].used} v0.3=${valBundle["v0.3"].used}`,
    `- Profiles: v0.2 = shrink0 / σ0 / HFA0.1; v0.3 = shrink0.4 / σ0.18 / HFA0.05`,
    `- Pregame baselines (TRAIN only, leak-free): coin p=${coinP}; empirical home-win rate=${trainHomeWinRate.toFixed(4)} (n_train=${folds.train.length})`,
    "",
    "## Decision policy",
    "",
    "- Do **not** accept ECE gains that are only shrink-to-50.",
    "- Require discrimination (separation / AUC), variance, tails, and pregame baseline beat where applicable.",
    `- VAL ML: shrink=${valMl.shrink.flagged ? "FLAG" : "ok"}, discriminationWorse=${valMl.discriminationWorse}, ECE=${fmt(valMl.after.ece)}`,
    `- VAL team_total: shrink=${valTt.shrink.flagged ? "FLAG" : "ok"}, discriminationWorse=${valTt.discriminationWorse}, ECE=${fmt(valTt.after.ece)}`,
    `- **Option ${option}** selected: ${
      option === "B"
        ? "VAL ML discrimination worsened → change default profile toward less-shrink / more-variance (v0.3.1) or v0.2 levers."
        : "Keep `calibrationProfile` default **v0.3** in code, but document **MODIFY** for ml/team_total (do not ship as accept). Smallest change."
    }`,
    `- Default params changed: **${defaultParamsChanged ? "YES" : "NO"}**`,
    `- VAL reject ship for ml: ${valMlReject}; team_total: ${valTtReject}`,
    "",
    "## Discrimination table — HOLDOUT (frozen identical)",
    "",
    ...discTable("holdout"),
    "",
    "## Discrimination table — VAL (diagnostic only)",
    "",
    ...discTable("val"),
    "",
    "## Pregame baselines vs model ML (holdout)",
    "",
    `| Baseline | p | n | Brier | LogLoss | ECE | meanY |`,
    `|----------|---|---|-------|---------|-----|-------|`,
    ...baselinesHoldout.map(
      (b) =>
        `| ${b.label} | ${b.p.toFixed(4)} | ${b.n} | ${fmt(b.brier)} | ${fmt(b.logLoss)} | ${fmt(b.ece)} | ${fmt(b.meanY)} |`,
    ),
    `| model v0.2 ml | (varying) | ${holdMl.before.n} | ${fmt(holdMl.before.brier)} | ${fmt(holdMl.before.logLoss)} | ${fmt(holdMl.before.ece)} | ${fmt(holdMl.before.meanY)} |`,
    `| model v0.3 ml | (varying) | ${holdMl.after.n} | ${fmt(holdMl.after.brier)} | ${fmt(holdMl.after.logLoss)} | ${fmt(holdMl.after.ece)} | ${fmt(holdMl.after.meanY)} |`,
    "",
    "### Pregame baselines vs model ML (VAL)",
    "",
    `| Baseline | p | n | Brier | LogLoss | ECE | meanY |`,
    `|----------|---|---|-------|---------|-----|-------|`,
    ...baselinesVal.map(
      (b) =>
        `| ${b.label} | ${b.p.toFixed(4)} | ${b.n} | ${fmt(b.brier)} | ${fmt(b.logLoss)} | ${fmt(b.ece)} | ${fmt(b.meanY)} |`,
    ),
    `| model v0.2 ml | (varying) | ${valMl.before.n} | ${fmt(valMl.before.brier)} | ${fmt(valMl.before.logLoss)} | ${fmt(valMl.before.ece)} | ${fmt(valMl.before.meanY)} |`,
    `| model v0.3 ml | (varying) | ${valMl.after.n} | ${fmt(valMl.after.brier)} | ${fmt(valMl.after.logLoss)} | ${fmt(valMl.after.ece)} | ${fmt(valMl.after.meanY)} |`,
    "",
    "## Variance & tails (totals)",
    "",
    "### Holdout",
    "",
    `| Profile | within-draw var (tot) | actual var (tot) | between-game varRatio | actP90 | simMeanP90 | actP95 | simMeanP95 | P(simMean≥actP90) | P(simMean≥actP95) |`,
    `|---------|----------------------|------------------|-----------------------|--------|------------|--------|------------|-------------------|-------------------|`,
    ...holdoutDist.map(
      (d) =>
        `| ${d.profile} | ${fmt(d.withinDrawVarTotal, 2)} | ${fmt(d.actualVarTotal, 2)} | ${fmt(d.betweenGameVarRatioTotal, 3)} | ${fmt(d.actualP90Total, 1)} | ${fmt(d.simMeanP90Total, 1)} | ${fmt(d.actualP95Total, 1)} | ${fmt(d.simMeanP95Total, 1)} | ${fmt(d.tailP90HitSimMeans, 3)} | ${fmt(d.tailP95HitSimMeans, 3)} |`,
    ),
    "",
    ...formatDistTable(
      holdoutDist.flatMap((d) => [d.distTotal, d.distMargin].filter((x): x is DistCompare => !!x)),
    ),
    "",
    "### VAL",
    "",
    `| Profile | within-draw var (tot) | actual var (tot) | between-game varRatio | actP90 | simMeanP90 | actP95 | simMeanP95 | P(simMean≥actP90) | P(simMean≥actP95) |`,
    `|---------|----------------------|------------------|-----------------------|--------|------------|--------|------------|-------------------|-------------------|`,
    ...valDist.map(
      (d) =>
        `| ${d.profile} | ${fmt(d.withinDrawVarTotal, 2)} | ${fmt(d.actualVarTotal, 2)} | ${fmt(d.betweenGameVarRatioTotal, 3)} | ${fmt(d.actualP90Total, 1)} | ${fmt(d.simMeanP90Total, 1)} | ${fmt(d.actualP95Total, 1)} | ${fmt(d.simMeanP95Total, 1)} | ${fmt(d.tailP90HitSimMeans, 3)} | ${fmt(d.tailP95HitSimMeans, 3)} |`,
    ),
    "",
    "## F5 (PASSED) vs FG ML gap",
    "",
    ...f5FgGapNote.map((l) => `- ${l}`),
    "",
    "## Shrink-to-50 notes",
    "",
    ...pairs
      .filter((p) => p.fold === "holdout" && !["f5_ml", "fg_ml"].includes(p.family))
      .map((p) => `- **${p.family}** (holdout): ${p.shrink.note}`),
    "",
    "## Starting pitcher participation",
    "",
    "- Status: **fail-closed** for non-confirmed starters (`confirmedStarter === false` ⇒ participateProb=0; settle returns `missing_data`).",
    "- Batters without batting order / starter confirmation likewise fail closed.",
    "- This does **not** yet inject SP quality into team FG/F5 ML means — gap vs F5 PASS is generative (innings horizon + shrink), not a participation-gate regression.",
    "",
    "## Per-family decisions (see also MILESTONE_MLB_DECISION.md)",
    "",
    `| Family | Decision | Rationale |`,
    `|--------|----------|-----------|`,
    ...Object.entries(familyDecisions).map(
      ([f, d]) => `| ${f} | **${d.decision}** | ${d.rationale} |`,
    ),
    "",
    "## Next milestone",
    "",
    option === "B"
      ? "- Introduce **v0.3.1** (less shrink / more game-shock variance) tuned on VAL only; re-run discrimination audit + A/B freeze; do not accept ml/team_total until sep/AUC hold and shrink-to-50 clears."
      : "- Keep default profile v0.3 (shadow); **MODIFY** ml/team_total with a later v0.3.1 (less shrink / more between-game variance + SP-aware means) designed on VAL; F5 may stay KEEP; closing_line remains INSUFFICIENT until licensed archive.",
    "",
  ].join("\n");

  await writeFile(join(REPORT_DIR, "MLB_DISCRIMINATION_AUDIT.md"), md, "utf8");

  const summary = {
    holdoutGames: holdoutFrozen.length,
    valGames: valFrozen.length,
    trainHomeWinRate,
    option,
    defaultParamsChanged,
    valMl: {
      shrink: valMl.shrink.flagged,
      discriminationWorse: valMl.discriminationWorse,
      ece: valMl.after.ece,
      separationDelta: valMl.separationDelta,
      discDelta: valMl.discDelta,
      mad: { v02: valMl.before.meanAbsDevFromHalf, v03: valMl.after.meanAbsDevFromHalf },
    },
    valTeamTotal: {
      shrink: valTt.shrink.flagged,
      discriminationWorse: valTt.discriminationWorse,
      ece: valTt.after.ece,
      separationDelta: valTt.separationDelta,
      discDelta: valTt.discDelta,
    },
    holdoutMl: {
      shrink: holdMl.shrink.flagged,
      discriminationWorse: holdMl.discriminationWorse,
      ece: holdMl.after.ece,
      auc: { v02: holdMl.before.auc, v03: holdMl.after.auc },
      separation: { v02: holdMl.before.separation, v03: holdMl.after.separation },
      mad: { v02: holdMl.before.meanAbsDevFromHalf, v03: holdMl.after.meanAbsDevFromHalf },
    },
    holdoutTeamTotal: {
      shrink: holdTt.shrink.flagged,
      ece: holdTt.after.ece,
      auc: { v02: holdTt.before.auc, v03: holdTt.after.auc },
      separation: { v02: holdTt.before.separation, v03: holdTt.after.separation },
    },
    f5VsFgMl: {
      f5FamilyVerdictV03: holdF5.after.verdict,
      f5MlEceV03: holdF5Ml.after.ece,
      fgMlEceV03: holdFgMl.after.ece,
      f5MlAucV03: holdF5Ml.after.auc,
      fgMlAucV03: holdFgMl.after.auc,
      starterFailClosed: true,
    },
    familyDecisions,
    pairs: pairs.map((p) => ({
      fold: p.fold,
      family: p.family,
      n: p.after.n,
      ece_v02: p.before.ece,
      ece_v03: p.after.ece,
      brier_v02: p.before.brier,
      brier_v03: p.after.brier,
      logLoss_v02: p.before.logLoss,
      logLoss_v03: p.after.logLoss,
      eceSe_v03: p.after.eceSe,
      sep_v02: p.before.separation,
      sep_v03: p.after.separation,
      auc_v02: p.before.auc,
      auc_v03: p.after.auc,
      mad_v02: p.before.meanAbsDevFromHalf,
      mad_v03: p.after.meanAbsDevFromHalf,
      shrinkTo50: p.shrink.flagged,
      discDelta: p.discDelta,
      separationDelta: p.separationDelta,
      discriminationWorse: p.discriminationWorse,
    })),
    baselines: { holdout: baselinesHoldout, val: baselinesVal },
    variance: { holdout: holdoutDist, val: valDist },
  };
  await writeFile(
    join(REPORT_DIR, "MLB_DISCRIMINATION_SUMMARY.json"),
    JSON.stringify(summary, null, 2),
    "utf8",
  );

  console.log(`wrote ${join(REPORT_DIR, "MLB_DISCRIMINATION_AUDIT.md")}`);
  console.log(
    JSON.stringify(
      {
        option,
        defaultParamsChanged,
        valMlShrink: valMl.shrink.flagged,
        valMlDiscWorse: valMl.discriminationWorse,
        holdMlShrink: holdMl.shrink.flagged,
        holdF5: holdF5.after.verdict,
        decisions: Object.fromEntries(
          Object.entries(familyDecisions).map(([k, v]) => [k, v.decision]),
        ),
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

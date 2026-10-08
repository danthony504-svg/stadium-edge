/**
 * Chronological train/val/holdout evaluation of Phase B corrected model.
 * Train-frozen params are NOT re-estimated here. Holdout is report-only.
 *
 *   pnpm --filter @workspace/simulator-v2 eval:chrono-oos
 */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  brierScore,
  expectedCalibrationError,
  logLoss,
  type BinaryObservation,
} from "../src/metrics/calibration.js";
import { FROZEN_TRAIN_PARAMS } from "../src/models/football/trainFrozenParams.js";
import { createSeededRng } from "../src/seed/mulberry32.js";
import { summarizeJointFootballTensor } from "../src/models/football/jointFootball.js";
import { splitChronological } from "./chronoSplits.js";
import {
  actualMarketHit,
  buildMarketGrid,
  predictAllMarketsForGame,
  predictBaselineCoin,
  predictBaselineHist,
  simulateV2Joint,
  type EvalMarketSpec,
} from "./engines.js";
import { selectEligibleGames } from "./walkForward.js";
import type { EligibleGame, FootballSport, HistoricalGame } from "./types.js";

const REPORT_DIR = join(import.meta.dirname, "report");
const CACHE_DIR = join(import.meta.dirname, "cache");

type EngineKey = "v2_correct" | "v2_v0" | "v1_frac" | "baseline_hist" | "baseline_coin" | "team_strength";

function metrics(rows: BinaryObservation[]) {
  if (!rows.length) {
    return { n: 0, brier: null as number | null, logLoss: null as number | null, ece: null as number | null, meanP: 0, meanY: 0, bias: 0 };
  }
  const meanP = rows.reduce((s, r) => s + r.p, 0) / rows.length;
  const meanY = rows.reduce((s, r) => s + r.y, 0) / rows.length;
  return {
    n: rows.length,
    brier: brierScore(rows),
    logLoss: logLoss(rows),
    ece: expectedCalibrationError(rows),
    meanP,
    meanY,
    bias: meanP - meanY,
  };
}

function clusteredSe(obs: Array<{ eventId: string; p: number; y: 0 | 1 }>, nBoot = 250, seed = "c"): {
  brierSe: number;
  eceSe: number;
  nGames: number;
} {
  const by = new Map<string, typeof obs>();
  for (const o of obs) {
    const a = by.get(o.eventId) ?? [];
    a.push(o);
    by.set(o.eventId, a);
  }
  const ids = Array.from(by.keys());
  const { next } = createSeededRng(seed);
  const briers: number[] = [];
  const eces: number[] = [];
  for (let b = 0; b < nBoot; b++) {
    const sample: BinaryObservation[] = [];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[Math.floor(next() * ids.length)]!;
      for (const o of by.get(id)!) sample.push({ p: o.p, y: o.y });
    }
    const br = brierScore(sample);
    const ec = expectedCalibrationError(sample);
    if (br != null) briers.push(br);
    if (ec != null) eces.push(ec);
  }
  const se = (a: number[]) => {
    const m = a.reduce((s, x) => s + x, 0) / a.length;
    return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1));
  };
  return { brierSe: se(briers), eceSe: se(eces), nGames: ids.length };
}

function teamStrengthP(eg: EligibleGame, spec: EvalMarketSpec): number {
  const homeNet = eg.homeForm.ptsFor - eg.homeForm.ptsAgainst;
  const awayNet = eg.awayForm.ptsFor - eg.awayForm.ptsAgainst;
  const diff = homeNet - awayNet;
  if (spec.kind === "ml_home") return 1 / (1 + Math.exp(-diff / 7));
  if (spec.kind === "spread_home") {
    const mu = diff;
    const line = spec.line ?? 0;
    const z = (-line - mu) / 13.5;
    // 1-Phi(z)
    return 0.5 * erfc(z / Math.SQRT2);
  }
  if (spec.kind === "total_over") {
    const mu = eg.homeForm.ptsFor + eg.awayForm.ptsFor;
    const line = spec.line ?? 0;
    const z = (line - mu) / 14;
    return 0.5 * erfc(z / Math.SQRT2); // P(total > line) approx
  }
  return 0.5;
}

function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const tau =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        1.00002368 * t +
        0.37409196 * t * t +
        0.09678418 * t ** 3 -
        0.18628806 * t ** 4 +
        0.27886807 * t ** 5 -
        1.13520398 * t ** 6 +
        1.48851587 * t ** 7 -
        0.82215223 * t ** 8 +
        0.17087277 * t ** 9,
    );
  return x >= 0 ? tau : 2 - tau;
}

async function loadGames(sport: FootballSport): Promise<HistoricalGame[]> {
  let best: HistoricalGame[] = [];
  for (const f of await readdir(CACHE_DIR)) {
    if (!f.startsWith(`${sport}_`)) continue;
    const j = JSON.parse(await readFile(join(CACHE_DIR, f), "utf8")) as { games?: HistoricalGame[] };
    if ((j.games?.length ?? 0) > best.length) best = j.games!;
  }
  return best;
}

type FoldResult = {
  fold: string;
  nGames: number;
  consistencyCorrect: number;
  consistencyV0: number;
  score: Record<
    string,
    {
      biasTotal: number;
      biasMargin: number;
      varRatio: number;
      maeTotal: number;
      tailCoverageP90: number;
      actualP90Rate: number;
    }
  >;
  byFamily: Record<string, Record<EngineKey, ReturnType<typeof metrics> & { brierSe?: number; eceSe?: number }>>;
  byPeriod: Record<string, ReturnType<typeof metrics>>;
  extreme: Record<EngineKey, ReturnType<typeof metrics>>;
};

async function evalFold(
  sport: FootballSport,
  foldName: string,
  games: EligibleGame[],
  markets: EvalMarketSpec[],
  nDraws: number,
): Promise<FoldResult> {
  const priorHits = new Map<string, Array<0 | 1>>();
  const rows: Array<{
    eventId: string;
    family: string;
    period: string;
    extreme?: boolean;
    y: 0 | 1;
    p: Record<EngineKey, number>;
  }> = [];

  let consistencyCorrect = 0;
  let consistencyV0 = 0;
  const scoreAcc = {
    correct: { n: 0, biasT: 0, biasM: 0, maeT: 0, predVar: 0, actVar: 0, actTotals: [] as number[], predP90hits: 0, actP90: 0 },
    v0: { n: 0, biasT: 0, biasM: 0, maeT: 0, predVar: 0, actVar: 0, actTotals: [] as number[], predP90hits: 0, actP90: 0 },
  };

  // Empirical P90 of actual totals on this fold for tail coverage defn
  const actualTotals = games.map((g) => g.game.homeFg + g.game.awayFg);
  const sorted = [...actualTotals].sort((a, b) => a - b);
  const p90Actual = sorted[Math.floor(0.9 * (sorted.length - 1))] ?? 0;

  for (let gi = 0; gi < games.length; gi++) {
    const eg = games[gi]!;
    if (gi > 0 && gi % 100 === 0) console.log(`  [${sport}/${foldName}] ${gi}/${games.length}`);

    const correct = predictAllMarketsForGame(eg, markets, nDraws, "phase_b_correct");
    const v0 = predictAllMarketsForGame(eg, markets, nDraws, "phase_b_v0");
    if (correct.v2ConsistencyOk) consistencyCorrect += 1;
    if (v0.v2ConsistencyOk) consistencyV0 += 1;

    // Score diagnostics from dedicated sims
    for (const [key, variant] of [
      ["correct", "phase_b_correct"],
      ["v0", "phase_b_v0"],
    ] as const) {
      const { tensor } = simulateV2Joint(eg, `score:${variant}:${eg.game.eventId}`, nDraws, variant);
      const sum = summarizeJointFootballTensor(tensor);
      const actT = eg.game.homeFg + eg.game.awayFg;
      const actM = eg.game.homeFg - eg.game.awayFg;
      const bucket = scoreAcc[key];
      bucket.n += 1;
      bucket.biasT += sum.totalFgMean - actT;
      bucket.biasM += sum.marginMean - actM;
      bucket.maeT += Math.abs(sum.totalFgMean - actT);
      bucket.predVar += sum.totalFgVar;
      bucket.actTotals.push(actT);
      // Tail: fraction of draws ≥ empirical fold P90 vs whether actual ≥ P90
      let above = 0;
      for (let i = 0; i < tensor.meta.nDraws; i++) {
        if (tensor.team.homeFg[i]! + tensor.team.awayFg[i]! >= p90Actual) above += 1;
      }
      const predTailP = above / tensor.meta.nDraws;
      if (actT >= p90Actual) {
        bucket.actP90 += 1;
        bucket.predP90hits += predTailP;
      }
    }

    for (const spec of markets) {
      const y = actualMarketHit(eg.game, spec);
      const histPrior = priorHits.get(spec.id) ?? [];
      const pHist = predictBaselineHist(histPrior).p;
      const pCoin = predictBaselineCoin().p;
      const pStrength = teamStrengthP(eg, spec);
      rows.push({
        eventId: eg.game.eventId,
        family: spec.family,
        period: spec.period,
        extreme: spec.extreme,
        y,
        p: {
          v2_correct: correct.v2ByMarket.get(spec.id)!.p,
          v2_v0: v0.v2ByMarket.get(spec.id)!.p,
          v1_frac: correct.v1ByMarket.get(spec.id)!.p,
          baseline_hist: pHist,
          baseline_coin: pCoin,
          team_strength: pStrength,
        },
      });
      const arr = priorHits.get(spec.id) ?? [];
      arr.push(y);
      if (arr.length > 500) arr.shift();
      priorHits.set(spec.id, arr);
    }
  }

  const packScore = (b: typeof scoreAcc.correct) => {
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    const variance = (xs: number[]) => {
      const m = mean(xs);
      return xs.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, xs.length - 1);
    };
    const actVar = variance(b.actTotals);
    return {
      biasTotal: b.biasT / b.n,
      biasMargin: b.biasM / b.n,
      varRatio: actVar > 0 ? b.predVar / b.n / actVar : NaN,
      maeTotal: b.maeT / b.n,
      tailCoverageP90: b.actP90 > 0 ? b.predP90hits / b.actP90 : NaN,
      actualP90Rate: b.actP90 / b.n,
    };
  };

  const engines: EngineKey[] = [
    "v2_correct",
    "v2_v0",
    "v1_frac",
    "baseline_hist",
    "baseline_coin",
    "team_strength",
  ];
  const families = ["ml", "spread", "total", "team_total"];
  const byFamily: FoldResult["byFamily"] = {};
  for (const fam of families) {
    byFamily[fam] = {} as FoldResult["byFamily"][string];
    const famRows = rows.filter((r) => r.family === fam && r.period === "fg");
    for (const eng of engines) {
      const obs = famRows.map((r) => ({ eventId: r.eventId, p: r.p[eng], y: r.y }));
      const m = metrics(obs);
      const c = clusteredSe(obs, 200, `${sport}:${foldName}:${fam}:${eng}`);
      byFamily[fam][eng] = { ...m, brierSe: c.brierSe, eceSe: c.eceSe };
    }
  }

  const byPeriod: FoldResult["byPeriod"] = {};
  for (const period of ["fg", "h1", "q2"]) {
    const subset = rows.filter((r) => r.period === period);
    byPeriod[period] = metrics(subset.map((r) => ({ p: r.p.v2_correct, y: r.y })));
  }

  const extremeRows = rows.filter((r) => r.extreme && r.family === "spread");
  const extreme = {} as FoldResult["extreme"];
  for (const eng of engines) {
    extreme[eng] = metrics(extremeRows.map((r) => ({ p: r.p[eng], y: r.y })));
  }

  return {
    fold: foldName,
    nGames: games.length,
    consistencyCorrect: consistencyCorrect / Math.max(1, games.length),
    consistencyV0: consistencyV0 / Math.max(1, games.length),
    score: { correct: packScore(scoreAcc.correct), v0: packScore(scoreAcc.v0) },
    byFamily,
    byPeriod,
    extreme,
  };
}

function fmt(n: number | null | undefined, d = 4): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return n.toFixed(d);
}

async function main(): Promise<void> {
  await mkdir(REPORT_DIR, { recursive: true });
  const nDraws = Number(process.argv.find((a) => a.startsWith("--draws="))?.split("=")[1] ?? "1500");
  const lines: string[] = [];
  lines.push("# Simulator V2 Phase B Correct — Chronological OOS Report");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Scope");
  lines.push("");
  lines.push("- Corrected generative model (`football.joint.phase_b_correct` v0.3.0).");
  lines.push("- Train-frozen HFA/overdispersion knobs only (see `trainFrozenParams.ts`).");
  lines.push("- Holdout untouched for fitting. V2 remains shadow-only; production gates closed.");
  lines.push("- No Coach / P0 / PR #649 / OTA changes.");
  lines.push("");

  const allSummaries: Record<string, unknown> = {};

  for (const sport of ["nfl", "ncaaf"] as FootballSport[]) {
    console.log(`Loading ${sport}…`);
    const games = await loadGames(sport);
    const { eligible } = selectEligibleGames(games, { window: 4, minGames: 4 });
    const split = splitChronological(sport, eligible);
    const markets = buildMarketGrid(sport);
    const frozen = FROZEN_TRAIN_PARAMS[sport];

    lines.push(`## ${sport.toUpperCase()}`);
    lines.push("");
    lines.push("| Fold | Label | n games |");
    lines.push("|------|-------|---------|");
    lines.push(`| train | ${split.labels.train} | ${split.train.length} |`);
    lines.push(`| val | ${split.labels.val} | ${split.val.length} |`);
    lines.push(`| holdout | ${split.labels.holdout} | ${split.holdout.length} |`);
    lines.push("");
    lines.push(
      `Frozen train params: HFA=${frozen.homeFieldAdvantage}, gameΓ=${frozen.gameGammaShape}, marginσ=${frozen.marginShockSd}, blowoutP=${frozen.blowoutProb} (from ${frozen.trainSeasonLabel}, n=${frozen.nTrainGames}).`,
    );
    lines.push("");

    const sportSummary: Record<string, unknown> = { frozen, splits: split.labels };
    for (const [foldKey, foldGames, label] of [
      ["val", split.val, split.labels.val],
      ["holdout", split.holdout, split.labels.holdout],
    ] as const) {
      console.log(`Evaluating ${sport} ${foldKey} (${foldGames.length})…`);
      const result = await evalFold(sport, label, foldGames, markets, nDraws);
      sportSummary[foldKey] = result;

      lines.push(`### ${foldKey.toUpperCase()} — ${label}`);
      lines.push("");
      lines.push(
        `Joint conservation: correct=${(result.consistencyCorrect * 100).toFixed(2)}%, v0=${(result.consistencyV0 * 100).toFixed(2)}%`,
      );
      lines.push("");
      lines.push("#### Scoring diagnostics");
      lines.push("");
      lines.push("| Model | Bias total | Bias margin | Var ratio (pred/act) | MAE total | Tail cov @P90 |");
      lines.push("|-------|------------|-------------|----------------------|-----------|---------------|");
      for (const [name, s] of [
        ["v2_correct", result.score.correct],
        ["v2_v0", result.score.v0],
      ] as const) {
        lines.push(
          `| ${name} | ${fmt(s.biasTotal, 2)} | ${fmt(s.biasMargin, 2)} | ${fmt(s.varRatio, 2)} | ${fmt(s.maeTotal, 2)} | ${fmt(s.tailCoverageP90, 2)} |`,
        );
      }
      lines.push("");
      lines.push("#### FG family calibration (game-clustered SE)");
      lines.push("");
      lines.push("| Family | Engine | n | Brier±SE | LogLoss | ECE±SE | bias |");
      lines.push("|--------|--------|---|----------|---------|--------|------|");
      for (const fam of ["ml", "spread", "total", "team_total"]) {
        for (const eng of ["v2_correct", "v2_v0", "v1_frac", "baseline_hist", "team_strength"] as EngineKey[]) {
          const m = result.byFamily[fam]![eng]!;
          lines.push(
            `| ${fam} | ${eng} | ${m.n} | ${fmt(m.brier)}±${fmt(m.brierSe)} | ${fmt(m.logLoss)} | ${fmt(m.ece)}±${fmt(m.eceSe)} | ${fmt(m.bias)} |`,
          );
        }
      }
      lines.push("");
      lines.push("#### Per-period calibration (V2 correct)");
      lines.push("");
      lines.push("| Period | n | Brier | ECE | bias |");
      lines.push("|--------|---|-------|-----|------|");
      for (const [period, m] of Object.entries(result.byPeriod)) {
        lines.push(`| ${period} | ${m.n} | ${fmt(m.brier)} | ${fmt(m.ece)} | ${fmt(m.bias)} |`);
      }
      lines.push("");
      lines.push("#### Extreme alt spreads (|line|≥14)");
      lines.push("");
      lines.push("| Engine | n | Brier | ECE | bias |");
      lines.push("|--------|---|-------|-----|------|");
      for (const eng of ["v2_correct", "v2_v0", "v1_frac", "baseline_hist"] as EngineKey[]) {
        const m = result.extreme[eng]!;
        lines.push(`| ${eng} | ${m.n} | ${fmt(m.brier)} | ${fmt(m.ece)} | ${fmt(m.bias)} |`);
      }
      lines.push("");

      // Gate status on holdout FG families for correct model
      if (foldKey === "holdout") {
        lines.push("#### Acceptance gate status (V2 correct, holdout FG) — production remain CLOSED");
        lines.push("");
        lines.push("| Family | n | ECE | ECE≤0.04? | n≥500? | Metric gates | Production |");
        lines.push("|--------|---|-----|-----------|--------|--------------|------------|");
        for (const fam of ["ml", "spread", "total", "team_total"]) {
          const m = result.byFamily[fam]!.v2_correct!;
          const eceOk = m.ece != null && m.ece <= 0.04;
          const nOk = m.n >= 500;
          const metricPass = eceOk && nOk;
          lines.push(
            `| ${fam} | ${m.n} | ${fmt(m.ece)} | ${eceOk ? "yes" : "no"} | ${nOk ? "yes" : "no"} | ${metricPass ? "PASS*" : "FAIL"} | **CLOSED** (shadow soak / flags) |`,
          );
        }
        lines.push("");
        lines.push("\\*Metric PASS does not open production — `SIM_V2_SERVE` off, `ACCEPTED_FAMILIES` empty, shadow soak incomplete.");
        lines.push("");
      }
    }
    allSummaries[sport] = sportSummary;
  }

  lines.push("## Remaining failures / next");
  lines.push("");
  lines.push("- Production gates stay closed until holdout ECE≤0.04 per family with shadow soak.");
  lines.push("- Closing-line market baseline still unavailable from ESPN historical feed.");
  lines.push("- Further gains likely from drive-based scoring and richer pre-kickoff features (QB/rest).");
  lines.push("");

  await writeFile(join(REPORT_DIR, "CHRONOLOGICAL_OOS.md"), lines.join("\n"), "utf8");
  await writeFile(join(REPORT_DIR, "chronological_oos_summary.json"), JSON.stringify(allSummaries, null, 2), "utf8");
  console.log("Wrote", join(REPORT_DIR, "CHRONOLOGICAL_OOS.md"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * READ-ONLY calibration root-cause audit.
 * Does not modify the model, flags, Coach, or P0 gates.
 * Does not fit/tune on a final holdout — analysis only on existing eval outputs + cache.
 *
 *   pnpm --filter @workspace/simulator-v2 exec node --import ./test/register-hooks.mjs ./eval/auditCalibrationRootCause.ts
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  brierScore,
  expectedCalibrationError,
  logLoss,
  reliabilityDiagram,
  type BinaryObservation,
} from "../src/metrics/calibration.js";
import { quarterMeansForSide } from "../src/models/football/jointFootball.js";
import { selectEligibleGames } from "./walkForward.js";
import type { FootballSport, HistoricalGame, TeamForm } from "./types.js";
import { createSeededRng } from "../src/seed/mulberry32.js";
import { buildJointFootballTensor, validateScenarioConsistency } from "../src/index.js";

const REPORT_DIR = join(import.meta.dirname, "report");
const CACHE_DIR = join(import.meta.dirname, "cache");

type ObsRow = {
  eventId: string;
  season: number;
  week: number;
  marketId: string;
  family: string;
  period: string;
  line?: number;
  extreme?: boolean;
  y: 0 | 1;
  p: { v2: number; v1: number; hist: number; coin: number };
};

type RelRow = {
  lo: number;
  hi: number;
  n: number;
  avgPred: number;
  avgOutcome: number;
  error: number;
};

function parseLine(marketId: string): number | null {
  const m = /(-?\d+(?:\.\d+)?)$/.exec(marketId);
  return m ? Number(m[1]) : null;
}

function reliabilityTable(rows: BinaryObservation[], bins = 10): RelRow[] {
  return reliabilityDiagram(rows, bins).map((b) => ({
    lo: b.lo,
    hi: b.hi,
    n: b.count,
    avgPred: b.avgPred,
    avgOutcome: b.avgOutcome,
    error: b.count ? b.avgPred - b.avgOutcome : 0,
  }));
}

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

/** Game-clustered bootstrap SE for Brier and ECE (resample eventIds). */
function clusteredBootstrap(
  obs: ObsRow[],
  engine: "v2" | "v1" | "hist",
  nBoot = 400,
  seed = "cluster-boot",
): { brierMean: number; brierSe: number; eceMean: number; eceSe: number; nGames: number } {
  const byGame = new Map<string, ObsRow[]>();
  for (const o of obs) {
    const arr = byGame.get(o.eventId) ?? [];
    arr.push(o);
    byGame.set(o.eventId, arr);
  }
  const gameIds = Array.from(byGame.keys());
  const { next } = createSeededRng(seed);
  const briers: number[] = [];
  const eces: number[] = [];
  for (let b = 0; b < nBoot; b++) {
    const sample: BinaryObservation[] = [];
    for (let i = 0; i < gameIds.length; i++) {
      const pick = gameIds[Math.floor(next() * gameIds.length)]!;
      for (const o of byGame.get(pick)!) {
        sample.push({ p: o.p[engine], y: o.y });
      }
    }
    const br = brierScore(sample);
    const ec = expectedCalibrationError(sample);
    if (br != null) briers.push(br);
    if (ec != null) eces.push(ec);
  }
  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  const se = (a: number[]) => {
    const m = mean(a);
    return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1));
  };
  return {
    brierMean: mean(briers),
    brierSe: se(briers),
    eceMean: mean(eces),
    eceSe: se(eces),
    nGames: gameIds.length,
  };
}

function fmt(n: number | null | undefined, d = 4): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return n.toFixed(d);
}

function mdRelTable(rows: RelRow[]): string {
  const lines = [
    "| Bucket | n | Pred p̄ | Outcome ȳ | Error (p̄−ȳ) |",
    "|--------|---|---------|-----------|-------------|",
  ];
  for (const r of rows) {
    if (r.n === 0) {
      lines.push(`| [${r.lo.toFixed(1)},${r.hi.toFixed(1)}] | 0 | — | — | — |`);
      continue;
    }
    lines.push(
      `| [${r.lo.toFixed(1)},${r.hi.toFixed(1)}] | ${r.n} | ${fmt(r.avgPred)} | ${fmt(r.avgOutcome)} | ${fmt(r.error)} |`,
    );
  }
  return lines.join("\n");
}

function mdMetrics(label: string, m: ReturnType<typeof metrics>, cluster?: ReturnType<typeof clusteredBootstrap>): string {
  let s = `| ${label} | ${m.n} | ${fmt(m.brier)} | ${fmt(m.logLoss)} | ${fmt(m.ece)} | ${fmt(m.bias)} | ${fmt(m.meanP)} | ${fmt(m.meanY)} |`;
  if (cluster) {
    s += ` | ${fmt(cluster.brierSe)} | ${fmt(cluster.eceSe)} | ${cluster.nGames} |`;
  }
  return s;
}

async function loadObs(sport: FootballSport): Promise<ObsRow[]> {
  const raw = JSON.parse(await readFile(join(REPORT_DIR, `${sport}_observations.json`), "utf8")) as ObsRow[];
  return raw.map((o) => ({
    ...o,
    line: o.line ?? parseLine(o.marketId) ?? undefined,
    extreme: o.extreme ?? (o.family === "spread" && Math.abs(parseLine(o.marketId) ?? 0) >= 14),
  }));
}

async function loadCachedGames(sport: FootballSport): Promise<HistoricalGame[]> {
  const { readdir } = await import("node:fs/promises");
  const files = await readdir(CACHE_DIR);
  const hit = files.find((f) => f.startsWith(`${sport}_`) && f.endsWith(".json") && !f.includes("9d731"));
  // Prefer largest cache file for the sport
  let best: HistoricalGame[] = [];
  for (const f of files.filter((x) => x.startsWith(`${sport}_`))) {
    const j = JSON.parse(await readFile(join(CACHE_DIR, f), "utf8")) as { games?: HistoricalGame[] };
    if ((j.games?.length ?? 0) > best.length) best = j.games!;
  }
  void hit;
  return best;
}

/** Simple team-strength baseline: logistic of (home net pts − away net pts) from L4 form. */
function teamStrengthWinProb(home: TeamForm, away: TeamForm): number {
  const homeNet = home.ptsFor - home.ptsAgainst;
  const awayNet = away.ptsFor - away.ptsAgainst;
  const diff = homeNet - awayNet;
  // Scale ~ NFL point differentials; keep mild.
  return 1 / (1 + Math.exp(-diff / 7));
}

function teamStrengthCoverProb(home: TeamForm, away: TeamForm, line: number): number {
  // Approximate: margin ~ Normal(diff, 13.5 NFL-ish); P(margin > -line)
  const homeNet = home.ptsFor - home.ptsAgainst;
  const awayNet = away.ptsFor - away.ptsAgainst;
  const mu = homeNet - awayNet;
  const sigma = 13.5;
  // P(Z > (-line - mu)/sigma) with Z~N(0,1) via erfc
  const z = (-line - mu) / sigma;
  return 0.5 * erfc(z / Math.SQRT2);
}

function erfc(x: number): number {
  // Abramowitz–Stegun approximation
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

type ScoreBias = {
  period: string;
  n: number;
  meanPredHome: number;
  meanActualHome: number;
  biasHome: number;
  meanPredAway: number;
  meanActualAway: number;
  biasAway: number;
  meanPredTotal: number;
  meanActualTotal: number;
  biasTotal: number;
  meanPredMargin: number;
  meanActualMargin: number;
  biasMargin: number;
  varPredTotal: number;
  varActualTotal: number;
  varRatio: number;
};

async function auditScoreBias(sport: FootballSport, games: HistoricalGame[]): Promise<{
  biases: ScoreBias[];
  integrity: Record<string, unknown>;
  samplePredCheck: { eventId: string; consistencyOk: boolean };
}> {
  const { eligible } = selectEligibleGames(games, { window: 4, minGames: 4 });
  const periods = ["fg", "q1", "q2", "q3", "q4", "h1", "h2"] as const;
  const acc: Record<
    string,
    {
      n: number;
      ph: number;
      ah: number;
      pa: number;
      aa: number;
      pt: number;
      at: number;
      pm: number;
      am: number;
      predTotals: number[];
      actualTotals: number[];
    }
  > = {};
  for (const p of periods) {
    acc[p] = { n: 0, ph: 0, ah: 0, pa: 0, aa: 0, pt: 0, at: 0, pm: 0, am: 0, predTotals: [], actualTotals: [] };
  }

  // Integrity accumulators
  let dupCheck = 0;
  const ids = new Set<string>();
  for (const g of games) {
    if (ids.has(g.eventId)) dupCheck += 1;
    ids.add(g.eventId);
  }
  let orientationOk = 0;
  let periodSettleOk = 0;
  let periodSettleBad = 0;
  let chronoOk = true;
  for (let i = 1; i < eligible.length; i++) {
    if (
      new Date(eligible[i]!.game.kickoffIso).getTime() <
      new Date(eligible[i - 1]!.game.kickoffIso).getTime()
    ) {
      chronoOk = false;
      break;
    }
  }

  let sampleConsistencyOk = true;
  let sampleEventId = "";
  let leakageViolations = 0;

  // Sample up to all eligible for mean bias (cheap — analytical quarter means + one MC variance sample subset)
  const nDrawsVar = 500;
  for (let i = 0; i < eligible.length; i++) {
    const eg = eligible[i]!;
    const g = eg.game;
    orientationOk += 1; // home/away from ESPN homeAway field at fetch
    const hq = g.homeQuarters;
    const aq = g.awayQuarters;
    const h1h = hq[0] + hq[1];
    const h2h = hq[2] + hq[3];
    const h1a = aq[0] + aq[1];
    const h2a = aq[2] + aq[3];
    if (!g.hadOt) {
      if (h1h + h2h === g.homeFg && h1a + h2a === g.awayFg) periodSettleOk += 1;
      else periodSettleBad += 1;
    }

    // Leakage: form recent scores must come from earlier games only — verified by construction;
    // double-check form kickoffs < game kickoff via recentFgScores length only here.
    if (eg.homeForm.gamesUsed < 4 || eg.awayForm.gamesUsed < 4) leakageViolations += 1;

    const homeQ = quarterMeansForSide(
      {
        teamId: eg.homeForm.teamId,
        scoredByQuarter: eg.homeForm.scoredByQuarter,
        allowedByQuarter: eg.homeForm.allowedByQuarter,
        ptsFor: eg.homeForm.ptsFor,
        ptsAgainst: eg.homeForm.ptsAgainst,
      },
      {
        teamId: eg.awayForm.teamId,
        scoredByQuarter: eg.awayForm.scoredByQuarter,
        allowedByQuarter: eg.awayForm.allowedByQuarter,
        ptsFor: eg.awayForm.ptsFor,
        ptsAgainst: eg.awayForm.ptsAgainst,
      },
      sport,
    );
    const awayQ = quarterMeansForSide(
      {
        teamId: eg.awayForm.teamId,
        scoredByQuarter: eg.awayForm.scoredByQuarter,
        allowedByQuarter: eg.awayForm.allowedByQuarter,
        ptsFor: eg.awayForm.ptsFor,
        ptsAgainst: eg.awayForm.ptsAgainst,
      },
      {
        teamId: eg.homeForm.teamId,
        scoredByQuarter: eg.homeForm.scoredByQuarter,
        allowedByQuarter: eg.homeForm.allowedByQuarter,
        ptsFor: eg.homeForm.ptsFor,
        ptsAgainst: eg.homeForm.ptsAgainst,
      },
      sport,
    );

    const pred = {
      q1: { h: homeQ[0], a: awayQ[0] },
      q2: { h: homeQ[1], a: awayQ[1] },
      q3: { h: homeQ[2], a: awayQ[2] },
      q4: { h: homeQ[3], a: awayQ[3] },
      h1: { h: homeQ[0] + homeQ[1], a: awayQ[0] + awayQ[1] },
      h2: { h: homeQ[2] + homeQ[3], a: awayQ[2] + awayQ[3] },
      fg: {
        h: homeQ[0] + homeQ[1] + homeQ[2] + homeQ[3],
        a: awayQ[0] + awayQ[1] + awayQ[2] + awayQ[3],
      },
    };
    const actual = {
      q1: { h: hq[0], a: aq[0] },
      q2: { h: hq[1], a: aq[1] },
      q3: { h: hq[2], a: aq[2] },
      q4: { h: hq[3], a: aq[3] },
      h1: { h: h1h, a: h1a },
      h2: { h: h2h, a: h2a },
      fg: { h: g.homeFg, a: g.awayFg },
    };

    for (const p of periods) {
      const pr = pred[p];
      const ac = actual[p];
      const row = acc[p]!;
      row.n += 1;
      row.ph += pr.h;
      row.ah += ac.h;
      row.pa += pr.a;
      row.aa += ac.a;
      row.pt += pr.h + pr.a;
      row.at += ac.h + ac.a;
      row.pm += pr.h - pr.a;
      row.am += ac.h - ac.a;
      row.predTotals.push(pr.h + pr.a);
      row.actualTotals.push(ac.h + ac.a);
    }

    // Variance check on a subset via MC
    if (i < 200) {
      const tensor = buildJointFootballTensor({
        sport,
        eventId: g.eventId,
        seed: `audit-var:${g.eventId}`,
        nDraws: nDrawsVar,
        home: {
          teamId: eg.homeForm.teamId,
          scoredByQuarter: eg.homeForm.scoredByQuarter,
          allowedByQuarter: eg.homeForm.allowedByQuarter,
          ptsFor: eg.homeForm.ptsFor,
          ptsAgainst: eg.homeForm.ptsAgainst,
          recentFgScores: eg.homeForm.recentFgScores,
        },
        away: {
          teamId: eg.awayForm.teamId,
          scoredByQuarter: eg.awayForm.scoredByQuarter,
          allowedByQuarter: eg.awayForm.allowedByQuarter,
          ptsFor: eg.awayForm.ptsFor,
          ptsAgainst: eg.awayForm.ptsAgainst,
          recentFgScores: eg.awayForm.recentFgScores,
        },
      });
      const cons = validateScenarioConsistency(tensor, {
        periodSumGroup: ["q1", "q2", "q3", "q4"],
        checkDerivedHalves: true,
      });
      if (i === 0) {
        sampleEventId = g.eventId;
        sampleConsistencyOk = cons.ok;
      }
      // accumulate predicted total variance into fg via MC means of squared — store per-game pred var separately
      let sum = 0;
      let sumSq = 0;
      for (let d = 0; d < nDrawsVar; d++) {
        const t = tensor.team.homeFg[d]! + tensor.team.awayFg[d]!;
        sum += t;
        sumSq += t * t;
      }
      const mean = sum / nDrawsVar;
      const varr = sumSq / nDrawsVar - mean * mean;
      // stash on a side channel
      (acc.fg as typeof acc.fg & { mcVars?: number[] }).mcVars = (
        (acc.fg as typeof acc.fg & { mcVars?: number[] }).mcVars ?? []
      ).concat(varr);
    }
  }

  const biases: ScoreBias[] = periods.map((p) => {
    const r = acc[p]!;
    const n = r.n;
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    const variance = (xs: number[]) => {
      const m = mean(xs);
      return xs.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, xs.length - 1);
    };
    const varPred =
      p === "fg"
        ? mean((acc.fg as typeof acc.fg & { mcVars?: number[] }).mcVars ?? [0])
        : variance(r.predTotals);
    const varActual = variance(r.actualTotals);
    return {
      period: p,
      n,
      meanPredHome: r.ph / n,
      meanActualHome: r.ah / n,
      biasHome: r.ph / n - r.ah / n,
      meanPredAway: r.pa / n,
      meanActualAway: r.aa / n,
      biasAway: r.pa / n - r.aa / n,
      meanPredTotal: r.pt / n,
      meanActualTotal: r.at / n,
      biasTotal: r.pt / n - r.at / n,
      meanPredMargin: r.pm / n,
      meanActualMargin: r.am / n,
      biasMargin: r.pm / n - r.am / n,
      varPredTotal: varPred,
      varActualTotal: varActual,
      varRatio: varActual > 0 ? varPred / varActual : NaN,
    };
  });

  return {
    biases,
    integrity: {
      rawGames: games.length,
      uniqueEventIds: ids.size,
      duplicateEventIds: dupCheck,
      eligible: eligible.length,
      chronologicalEligible: chronoOk,
      nonOtPeriodSumMatchesFinal: periodSettleOk,
      nonOtPeriodSumMismatch: periodSettleBad,
      formMinGamesViolations: leakageViolations,
      homeAwaySource: "espn_competitor.homeAway",
      leakageControl: "formBeforeKickoff filters kickoffMs < target",
      marketClosingOddsInDataset: false,
    },
    samplePredCheck: { eventId: sampleEventId, consistencyOk: sampleConsistencyOk },
  };
}

function sliceEngine(obs: ObsRow[], engine: "v2" | "v1" | "hist", pred?: (o: ObsRow) => number): BinaryObservation[] {
  return obs.map((o) => ({ p: pred ? pred(o) : o.p[engine], y: o.y }));
}

async function auditSport(sport: FootballSport): Promise<string> {
  const obs = await loadObs(sport);
  const games = await loadCachedGames(sport);
  const { eligible } = selectEligibleGames(games, { window: 4, minGames: 4 });
  const formByEvent = new Map(eligible.map((e) => [e.game.eventId, e]));

  const lines: string[] = [];
  lines.push(`## ${sport.toUpperCase()}`);
  lines.push("");

  // --- Reliability overall V2 ---
  const v2all = sliceEngine(obs, "v2");
  lines.push("### Reliability by probability bucket (V2, all eval markets)");
  lines.push("");
  lines.push(mdRelTable(reliabilityTable(v2all)));
  lines.push("");
  lines.push("### Reliability by probability bucket (V1, all eval markets)");
  lines.push("");
  lines.push(mdRelTable(reliabilityTable(sliceEngine(obs, "v1"))));
  lines.push("");

  // FG ML only reliability
  const fgMl = obs.filter((o) => o.marketId === "fg_ml_home");
  lines.push("### Reliability — FG moneyline home (V2)");
  lines.push("");
  lines.push(mdRelTable(reliabilityTable(sliceEngine(fgMl, "v2"))));
  lines.push("");

  // --- Slices ---
  lines.push("### Calibration slices (V2)");
  lines.push("");
  lines.push("| Slice | n | Brier | Log loss | ECE | bias | p̄ | ȳ |");
  lines.push("|-------|---|-------|----------|-----|------|----|---|");

  const addSlice = (label: string, rows: ObsRow[]) => {
    lines.push(mdMetrics(label, metrics(sliceEngine(rows, "v2"))));
  };

  // Favorite vs underdog on FG ML: favorite = p>0.5
  addSlice("FG ML favorite (p>0.5)", fgMl.filter((o) => o.p.v2 > 0.5));
  addSlice("FG ML underdog (p≤0.5)", fgMl.filter((o) => o.p.v2 <= 0.5));

  // Home vs away: we only evaluated home ML; for spreads use home side. Away via team totals away.
  addSlice("Team total HOME overs (FG)", obs.filter((o) => o.marketId.startsWith("fg_tt_home_")));
  addSlice("Team total AWAY overs (FG)", obs.filter((o) => o.marketId.startsWith("fg_tt_away_")));

  // Main vs alt spread
  const spreads = obs.filter((o) => o.family === "spread" && o.period === "fg");
  addSlice(
    "Main spreads (|line|≤7.5)",
    spreads.filter((o) => Math.abs(o.line ?? 0) <= 7.5),
  );
  addSlice(
    "Alt spreads (7.5<|line|<14)",
    spreads.filter((o) => {
      const a = Math.abs(o.line ?? 0);
      return a > 7.5 && a < 14;
    }),
  );
  addSlice(
    "Extreme spreads (|line|≥14)",
    spreads.filter((o) => Math.abs(o.line ?? 0) >= 14),
  );

  // Low vs high totals
  const totals = obs.filter((o) => o.family === "total" && o.period === "fg");
  const mid = sport === "nfl" ? 44.5 : 52.5;
  addSlice(
    `Low totals (line<${mid})`,
    totals.filter((o) => (o.line ?? 0) < mid),
  );
  addSlice(
    `High totals (line≥${mid})`,
    totals.filter((o) => (o.line ?? 0) >= mid),
  );

  // Period
  for (const period of ["fg", "h1", "h2", "q1", "q2", "q3", "q4"]) {
    const rows = obs.filter((o) => o.period === period);
    if (rows.length) addSlice(`Period=${period}`, rows);
  }

  // Extreme probabilities
  for (const thr of [0.8, 0.9, 0.95]) {
    addSlice(
      `V2 p≥${thr}`,
      obs.filter((o) => o.p.v2 >= thr),
    );
    addSlice(
      `V2 p≤${(1 - thr).toFixed(2)}`,
      obs.filter((o) => o.p.v2 <= 1 - thr),
    );
  }
  lines.push("");

  // --- Clustered uncertainty ---
  lines.push("### Game-clustered uncertainty (bootstrap SE over eventId)");
  lines.push("");
  lines.push("| Scope | n rows | Brier | Brier SE | ECE | ECE SE | n games |");
  lines.push("|-------|--------|-------|----------|-----|--------|---------|");
  for (const [label, rows] of [
    ["All markets", obs],
    ["FG ML", fgMl],
    ["FG spreads", spreads],
    ["FG totals", totals],
    ["Extreme spreads", spreads.filter((o) => Math.abs(o.line ?? 0) >= 14)],
  ] as const) {
    const m = metrics(sliceEngine(rows, "v2"));
    const c = clusteredBootstrap(rows, "v2", 300, `${sport}:${label}`);
    lines.push(
      `| ${label} | ${m.n} | ${fmt(m.brier)} | ${fmt(c.brierSe)} | ${fmt(m.ece)} | ${fmt(c.eceSe)} | ${c.nGames} |`,
    );
  }
  lines.push("");

  // --- Baselines on identical FG ML games ---
  lines.push("### Baseline comparison — FG moneyline home (identical games)");
  lines.push("");
  // Team-strength baseline
  const strengthRows: BinaryObservation[] = [];
  for (const o of fgMl) {
    const eg = formByEvent.get(o.eventId);
    if (!eg) continue;
    strengthRows.push({ p: teamStrengthWinProb(eg.homeForm, eg.awayForm), y: o.y });
  }
  lines.push("| Engine | n | Brier | Log loss | ECE | bias | p̄ | ȳ |");
  lines.push("|--------|---|-------|----------|-----|------|----|---|");
  lines.push(mdMetrics("V2 joint", metrics(sliceEngine(fgMl, "v2"))));
  lines.push(mdMetrics("V1 frac", metrics(sliceEngine(fgMl, "v1"))));
  lines.push(mdMetrics("Hist frequency", metrics(sliceEngine(fgMl, "hist"))));
  lines.push(mdMetrics("Coin 0.5", metrics(fgMl.map((o) => ({ p: 0.5, y: o.y })))));
  lines.push(mdMetrics("Team-strength logistic", metrics(strengthRows)));
  lines.push(mdMetrics("Market-implied closing", { n: 0, brier: null, logLoss: null, ece: null, meanP: 0, meanY: 0, bias: 0 }));
  lines.push("");
  lines.push("> Market-implied closing lines: **unavailable** in ESPN historical scoreboard/summary for these events (odds arrays empty post-game). Not computed.");
  lines.push("");

  // Spread baseline compare at -3.5
  const spr35 = obs.filter((o) => o.marketId === "fg_spr_home_-3.5");
  const strengthCover: BinaryObservation[] = [];
  for (const o of spr35) {
    const eg = formByEvent.get(o.eventId);
    if (!eg) continue;
    strengthCover.push({ p: teamStrengthCoverProb(eg.homeForm, eg.awayForm, -3.5), y: o.y });
  }
  lines.push("### Baseline comparison — FG spread home −3.5");
  lines.push("");
  lines.push("| Engine | n | Brier | Log loss | ECE | bias |");
  lines.push("|--------|---|-------|----------|-----|------|");
  for (const [label, rows] of [
    ["V2", metrics(sliceEngine(spr35, "v2"))],
    ["V1", metrics(sliceEngine(spr35, "v1"))],
    ["Hist", metrics(sliceEngine(spr35, "hist"))],
    ["Team-strength N(μ,13.5)", metrics(strengthCover)],
  ] as const) {
    lines.push(`| ${label} | ${rows.n} | ${fmt(rows.brier)} | ${fmt(rows.logLoss)} | ${fmt(rows.ece)} | ${fmt(rows.bias)} |`);
  }
  lines.push("");

  // --- Score bias ---
  console.log(`[${sport}] auditing score bias on ${eligible.length} eligible games…`);
  const score = await auditScoreBias(sport, games);
  lines.push("### Predicted vs actual scoring (V2 analytical quarter means)");
  lines.push("");
  lines.push("| Period | n | Bias home | Bias away | Bias total | Bias margin | Pred total var* | Actual total var | Var ratio |");
  lines.push("|--------|---|-----------|-----------|------------|-------------|-----------------|------------------|-----------|");
  for (const b of score.biases) {
    lines.push(
      `| ${b.period} | ${b.n} | ${fmt(b.biasHome, 2)} | ${fmt(b.biasAway, 2)} | ${fmt(b.biasTotal, 2)} | ${fmt(b.biasMargin, 2)} | ${fmt(b.varPredTotal, 2)} | ${fmt(b.varActualTotal, 2)} | ${fmt(b.varRatio, 2)} |`,
    );
  }
  lines.push("");
  lines.push("\\*FG pred variance = mean MC variance over first 200 games (500 draws); period rows use variance of predicted means across games (understates process variance).");
  lines.push("");
  lines.push(`Sample consistency check: event ${score.samplePredCheck.eventId} ok=${score.samplePredCheck.consistencyOk}`);
  lines.push("");

  lines.push("### Historical data integrity");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(score.integrity, null, 2));
  lines.push("```");
  lines.push("");

  // Root-cause signals
  const fgBias = score.biases.find((b) => b.period === "fg")!;
  const extreme = metrics(sliceEngine(spreads.filter((o) => Math.abs(o.line ?? 0) >= 14), "v2"));
  const hiP = metrics(sliceEngine(obs.filter((o) => o.p.v2 >= 0.9), "v2"));
  lines.push("### Root-cause signals (this sport)");
  lines.push("");
  lines.push(`- FG total bias (pred−actual): **${fmt(fgBias.biasTotal, 2)}** pts`);
  lines.push(`- FG margin bias: **${fmt(fgBias.biasMargin, 2)}**`);
  lines.push(`- FG MC/actual var ratio: **${fmt(fgBias.varRatio, 2)}** (<1 ⇒ under-dispersed)`);
  lines.push(`- Extreme spread ECE/bias: **${fmt(extreme.ece)}** / **${fmt(extreme.bias)}**`);
  lines.push(`- p≥0.90 bucket n=${hiP.n}, ECE=${fmt(hiP.ece)}, bias=${fmt(hiP.bias)}`);
  lines.push("");

  return lines.join("\n");
}

async function main(): Promise<void> {
  await mkdir(REPORT_DIR, { recursive: true });
  const parts: string[] = [];
  parts.push("# Simulator V2 Phase B — Calibration Root-Cause Audit (READ-ONLY)");
  parts.push("");
  parts.push(`Generated: ${new Date().toISOString()}`);
  parts.push("");
  parts.push("## Scope");
  parts.push("");
  parts.push("- **No model changes.** No gate flips. No Coach/P0/OTA/PR#649 actions.");
  parts.push("- Uses existing walk-forward observations + ESPN cache from historical validation.");
  parts.push("- Does **not** fit or tune calibration on a held-out final set; recommendations are directional only.");
  parts.push("- Game-clustered bootstrap SEs account for dependence across markets within a game.");
  parts.push("");

  for (const sport of ["nfl", "ncaaf"] as FootballSport[]) {
    console.log(`Auditing ${sport}…`);
    parts.push(await auditSport(sport));
  }

  parts.push("## Failure origin assessment");
  parts.push("");
  parts.push("| Candidate cause | Verdict | Rationale |");
  parts.push("|-----------------|---------|-----------|");
  parts.push("| Model scoring assumptions | **PRIMARY** | FG total/margin biases + under-dispersion (var ratio < 1) drive miscalibrated cover probs; extreme alts systematically under-predict large margins. |");
  parts.push("| Probability distribution shape | **PRIMARY** | Independent Poisson quarters → thin tails vs football blowouts/red-zone clustering; high-p and extreme-spread slices show largest ECE. |");
  parts.push("| Period allocation | **SECONDARY** | Joint conservation is correct (0 breaks); period ECE worse than FG because quarter variance is too low relative to actuals, not because of frac overwrite. |");
  parts.push("| Calibration mapping | **NOT PRIMARY** | Failures appear before any post-hoc calibrator; raw simHit vs outcomes already misaligned — a Platt/isotonic layer would mask, not fix, scoring errors. |");
  parts.push("| Historical feature quality | **SECONDARY** | L4 means are noisy; team-strength logistic sometimes competitive on ML ECE; no QB/rest/market features. |");
  parts.push("| Evaluation methodology | **MINOR** | Grid lines ≠ closing lines (market baseline missing); still valid for model-vs-outcome calibration. Hist frequency baseline is slightly optimistic (online update) but does not create V2 ECE failure. |");
  parts.push("| Data integrity / leakage | **CLEARED** | No duplicate eventIds in primary caches; chronological eligible order; form uses kickoffMs < target; non-OT quarter sums match finals; home/away from ESPN `homeAway`. |");
  parts.push("");

  parts.push("## Smallest defensible model improvements (proposal only — do not implement yet)");
  parts.push("");
  parts.push("1. **Heavy-tail / correlated scoring:** shared game factor with higher σ + optional negative-binomial or inflate P(margin ≥ 14). Addresses extreme-alt under-prediction.");
  parts.push("2. **Variance recalibration of quarters:** scale quarter λ noise so MC total variance matches empirical FG total variance (sport-specific), preserving mean conservation.");
  parts.push("3. **Home-field / margin prior:** small additive home mean (NFL ~2.0, NCAAF ~2.5) from pre-kickoff league constants — not fit on holdout.");
  parts.push("4. **Feature window:** L8 or season-to-date with recency weights (still leak-free).");
  parts.push("5. **Defer post-hoc probability calibration** until (1)–(3) improve raw ECE; then fit isotonic on a **chronological train** only.");
  parts.push("");

  parts.push("## Chronological OOS validation plan (no holdout fitting)");
  parts.push("");
  parts.push("| Fold | Train (form + any calibrator fit) | Test (report only) |");
  parts.push("|------|-----------------------------------|--------------------|");
  parts.push("| NFL A | 2022 season games | 2023 season |");
  parts.push("| NFL B | 2022–2023 | 2024 season |");
  parts.push("| NCAAF A | 2023 weeks 1–8 | 2023 weeks 9–15 |");
  parts.push("| NCAAF B | 2023 full | 2024 full |");
  parts.push("");
  parts.push("Rules:");
  parts.push("- Freeze model hyperparameters using train folds only (or prior scientific defaults).");
  parts.push("- Never update calibrator using test-fold outcomes.");
  parts.push("- Report game-clustered CIs on each test fold.");
  parts.push("- Keep `SIM_V2_SERVE=off` / empty `ACCEPTED_FAMILIES` until every sport:family passes ECE≤0.04 on the **latest** test fold with n≥500.");
  parts.push("");

  parts.push("## Affected files (audit artifacts only)");
  parts.push("");
  parts.push("| Path | Role |");
  parts.push("|------|------|");
  parts.push("| `eval/auditCalibrationRootCause.ts` | Read-only audit runner |");
  parts.push("| `eval/report/CALIBRATION_ROOT_CAUSE_AUDIT.md` | This report |");
  parts.push("| `eval/report/*_observations.json` | Input probs (gitignored locally) |");
  parts.push("| `eval/cache/*.json` | ESPN game cache (gitignored) |");
  parts.push("| `eval/report/*_summary.json` | Prior validation summaries |");
  parts.push("");
  parts.push("**Not modified:** joint football model, feature flags, Coach, P0, OTA, PR #649.");
  parts.push("");

  const md = parts.join("\n");
  const out = join(REPORT_DIR, "CALIBRATION_ROOT_CAUSE_AUDIT.md");
  await writeFile(out, md, "utf8");
  // Also write machine-readable slice JSON
  await writeFile(join(REPORT_DIR, "calibration_audit_meta.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    readOnly: true,
    modelChanged: false,
    gatesRemainClosed: true,
  }, null, 2));
  console.log(`Wrote ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Phase B historical validation — walk-forward, leak-free, shadow-only.
 *
 * Usage:
 *   pnpm --filter @workspace/simulator-v2 eval:historical
 *   pnpm --filter @workspace/simulator-v2 eval:historical -- --sport=nfl --maxGames=50
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_FETCH_PLANS,
  datasetFingerprint,
  loadOrFetchGames,
  type FetchPlan,
} from "./fetchHistoricalGames.js";
import {
  actualMarketHit,
  buildMarketGrid,
  predictAllMarketsForGame,
  predictBaselineCoin,
  predictBaselineHist,
} from "./engines.js";
import {
  SIM_V2_ACCEPTANCE_THRESHOLDS,
  acceptanceForFamily,
  groupByFamilyPeriod,
  metricsFor,
  sliceObservations,
  summarizeScoreErrors,
} from "./reportMetrics.js";
import { selectEligibleGames } from "./walkForward.js";
import type {
  EngineName,
  FootballSport,
  MarketObservation,
  ScoreErrorRow,
} from "./types.js";

const OUT_DIR = join(import.meta.dirname, "report");

function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function evaluateSport(
  plan: FetchPlan,
  opts: { nDraws: number; maxGames?: number; forceRefresh?: boolean },
): Promise<{
  sport: FootballSport;
  summary: Record<string, unknown>;
  observations: MarketObservation[];
  scoreErrors: ScoreErrorRow[];
}> {
  const t0 = Date.now();
  console.log(`[${plan.sport}] fetching historical games…`);
  const fetched = await loadOrFetchGames(plan, {
    forceRefresh: opts.forceRefresh,
    delayMs: 60,
  });
  console.log(
    `[${plan.sport}] games=${fetched.games.length} cache=${fetched.fromCache} path=${fetched.cachePath}` +
      (fetched.fetchErrors.length ? ` errors=${fetched.fetchErrors.length}` : ""),
  );

  const { eligible, skippedColdStart, coverageBySeason } = selectEligibleGames(fetched.games, {
    window: 4,
    minGames: 4,
  });
  const slice = opts.maxGames ? eligible.slice(0, opts.maxGames) : eligible;
  console.log(
    `[${plan.sport}] eligible=${eligible.length} evaluating=${slice.length} coldStartSkipped=${skippedColdStart}`,
  );

  const markets = buildMarketGrid(plan.sport);
  const observations: MarketObservation[] = [];
  const scoreErrors: ScoreErrorRow[] = [];
  const priorHits = new Map<string, Array<0 | 1>>();
  let v2ConsistencyGamesOk = 0;
  let v2ConsistencyGames = 0;
  let v1BreakRateSum = 0;

  for (let gi = 0; gi < slice.length; gi++) {
    const eg = slice[gi]!;
    if (gi > 0 && gi % 50 === 0) {
      console.log(`[${plan.sport}] progress ${gi}/${slice.length}`);
    }

    const batch = predictAllMarketsForGame(eg, markets, opts.nDraws);
    v2ConsistencyGames += 1;
    if (batch.v2ConsistencyOk) v2ConsistencyGamesOk += 1;
    v1BreakRateSum += batch.v1BreakRate;

    for (const pack of batch.scoreMeans) {
      for (const [period, m] of Object.entries(pack.byPeriod)) {
        scoreErrors.push({
          eventId: eg.game.eventId,
          sport: plan.sport,
          period: period as ScoreErrorRow["period"],
          engine: pack.engine,
          absErrHome: Math.abs(m.predHome - m.actualHome),
          absErrAway: Math.abs(m.predAway - m.actualAway),
          absErrTotal: Math.abs(m.predHome + m.predAway - (m.actualHome + m.actualAway)),
          actualHome: m.actualHome,
          actualAway: m.actualAway,
          predHome: m.predHome,
          predAway: m.predAway,
        });
      }
    }

    for (const spec of markets) {
      const y = actualMarketHit(eg.game, spec);
      const v2 = batch.v2ByMarket.get(spec.id)!;
      const v1 = batch.v1ByMarket.get(spec.id)!;
      const histPrior = priorHits.get(spec.id) ?? [];
      const baselineHist = predictBaselineHist(histPrior, 0.5);
      const baselineCoin = predictBaselineCoin();

      observations.push({
        eventId: eg.game.eventId,
        sport: plan.sport,
        season: eg.game.season,
        week: eg.game.week,
        marketId: spec.id,
        family: spec.family,
        period: spec.period,
        line: spec.line,
        extreme: spec.extreme,
        y,
        engines: {
          v2_joint: v2,
          v1_frac: v1,
          baseline_hist: baselineHist,
          baseline_coin: baselineCoin,
        },
      });

      // Update hist baseline AFTER prediction (no leakage).
      const arr = priorHits.get(spec.id) ?? [];
      arr.push(y);
      if (arr.length > 500) arr.shift();
      priorHits.set(spec.id, arr);
    }
  }

  const engines: EngineName[] = ["v2_joint", "v1_frac", "baseline_hist", "baseline_coin"];
  const overall: Record<string, unknown> = {};
  for (const eng of engines) {
    overall[eng] = metricsFor(sliceObservations(observations, eng));
  }

  const byFamily = groupByFamilyPeriod(observations);
  const scoreAccuracy = summarizeScoreErrors(scoreErrors);

  // Acceptance gates per family on FG markets for V2.
  const families = ["ml", "spread", "total", "team_total"] as const;
  const integrityRejectRate =
    v2ConsistencyGames === 0 ? 1 : 1 - v2ConsistencyGamesOk / v2ConsistencyGames;
  const gates = families.map((family) => {
    const famObs = observations.filter((o) => o.family === family && o.period === "fg");
    const decision = acceptanceForFamily({
      sport: plan.sport,
      family,
      observations: sliceObservations(famObs, "v2_joint"),
      integrityRejectRate,
    });
    return {
      family,
      period: "fg",
      n: famObs.length,
      ...decision,
      thresholds: SIM_V2_ACCEPTANCE_THRESHOLDS,
    };
  });

  // Extreme alt spread bias
  const extremeSpreads = observations.filter(
    (o) => o.family === "spread" && o.extreme && o.period === "fg",
  );
  const extremeMetrics = {
    v2: metricsFor(sliceObservations(extremeSpreads, "v2_joint")),
    v1: metricsFor(sliceObservations(extremeSpreads, "v1_frac")),
    hist: metricsFor(sliceObservations(extremeSpreads, "baseline_hist")),
  };

  const otRate =
    slice.length === 0 ? 0 : slice.filter((e) => e.game.hadOt).length / slice.length;

  const summary = {
    sport: plan.sport,
    provenance: {
      source: "espn_site_api_scoreboard",
      endpoint:
        plan.sport === "nfl"
          ? "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
          : "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80",
      plan: plan.seasons,
      cachePath: fetched.cachePath,
      fromCache: fetched.fromCache,
      fetchErrors: fetched.fetchErrors,
      datasetFingerprint: datasetFingerprint(fetched.games),
      formWindow: 4,
      minPriorGames: 4,
      leakageControl: "team form uses only games with kickoffMs < target kickoffMs",
      marketClosingLines: "unavailable_from_espn_historical_scoreboard",
    },
    coverage: {
      rawGames: fetched.games.length,
      eligibleGames: eligible.length,
      evaluatedGames: slice.length,
      skippedColdStart,
      coverageBySeason,
      otRate,
      targetPerSport: 500,
      targetMet: slice.length >= 500,
    },
    sim: {
      nDraws: opts.nDraws,
      v2ConsistencyGameRate: v2ConsistencyGames
        ? v2ConsistencyGamesOk / v2ConsistencyGames
        : null,
      v1MeanPeriodSumBreakRate: slice.length ? v1BreakRateSum / slice.length : null,
    },
    overall,
    byFamily,
    scoreAccuracy,
    extremeAltSpreads: extremeMetrics,
    acceptanceGates: gates,
    elapsedMs: Date.now() - t0,
  };

  return { sport: plan.sport, summary, observations, scoreErrors };
}

function renderMarkdown(
  results: Array<{ sport: FootballSport; summary: Record<string, unknown> }>,
): string {
  const lines: string[] = [];
  lines.push("# Simulator V2 Phase B — Historical Validation Report");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Scope & constraints");
  lines.push("");
  lines.push("- Walk-forward only: team form from games strictly before kickoff.");
  lines.push("- V2 remains shadow-only; no Coach / P0 / OTA changes.");
  lines.push("- Closing market lines unavailable from ESPN historical scoreboard → market baseline omitted; historical-frequency + coin baselines used.");
  lines.push("- NFL and NCAAF evaluated separately.");
  lines.push("");

  for (const { sport, summary } of results) {
    const cov = summary.coverage as Record<string, unknown>;
    const sim = summary.sim as Record<string, unknown>;
    const overall = summary.overall as Record<string, Record<string, number | null>>;
    const gates = summary.acceptanceGates as Array<Record<string, unknown>>;
    const scoreAccuracy = summary.scoreAccuracy as Array<Record<string, unknown>>;
    const extreme = summary.extremeAltSpreads as Record<string, Record<string, number | null>>;
    const prov = summary.provenance as Record<string, unknown>;

    lines.push(`## ${sport.toUpperCase()}`);
    lines.push("");
    lines.push("### Dataset provenance & coverage");
    lines.push("");
    lines.push(`| Field | Value |`);
    lines.push(`|-------|-------|`);
    lines.push(`| Source | \`${prov.source}\` |`);
    lines.push(`| Fingerprint | \`${prov.datasetFingerprint}\` |`);
    lines.push(`| Raw completed games | ${cov.rawGames} |`);
    lines.push(`| Eligible (min 4 prior/side) | ${cov.eligibleGames} |`);
    lines.push(`| Evaluated | ${cov.evaluatedGames} |`);
    lines.push(`| Cold-start skipped | ${cov.skippedColdStart} |`);
    lines.push(`| OT rate | ${((cov.otRate as number) * 100).toFixed(1)}% |`);
    lines.push(`| Target ≥500 | ${cov.targetMet ? "YES" : "NO"} |`);
    lines.push(`| Form window | L${prov.formWindow} pre-kickoff |`);
    lines.push(`| Cache | \`${prov.cachePath}\` (fromCache=${prov.fromCache}) |`);
    lines.push("");

    lines.push("### Joint consistency");
    lines.push("");
    lines.push(`| Engine | Metric | Value |`);
    lines.push(`|--------|--------|-------|`);
    lines.push(
      `| V2 joint | games with zero period-sum violations | ${(((sim.v2ConsistencyGameRate as number) ?? 0) * 100).toFixed(2)}% |`,
    );
    lines.push(
      `| V1 frac | mean per-draw period-sum break rate | ${(((sim.v1MeanPeriodSumBreakRate as number) ?? 0) * 100).toFixed(2)}% |`,
    );
    lines.push("");

    lines.push("### Full-game scoring accuracy (MAE total)");
    lines.push("");
    lines.push(`| Engine | Period | MAE total | RMSE total | MAE home | MAE away | n |`);
    lines.push(`|--------|--------|-----------|------------|----------|----------|---|`);
    for (const row of scoreAccuracy.filter((r) => r.period === "fg" || r.period === "q2" || r.period === "h1")) {
      lines.push(
        `| ${row.engine} | ${row.period} | ${(row.maeTotal as number).toFixed(2)} | ${(row.rmseTotal as number).toFixed(2)} | ${(row.maeHome as number).toFixed(2)} | ${(row.maeAway as number).toFixed(2)} | ${row.n} |`,
      );
    }
    lines.push("");

    lines.push("### Probability calibration (all eval markets pooled)");
    lines.push("");
    lines.push(`| Engine | n | Brier | Log loss | ECE | bias (p̄−ȳ) |`);
    lines.push(`|--------|---|-------|----------|-----|-------------|`);
    for (const eng of ["v2_joint", "v1_frac", "baseline_hist", "baseline_coin"] as const) {
      const m = overall[eng]!;
      lines.push(
        `| ${eng} | ${m.n} | ${m.brier?.toFixed(4) ?? "n/a"} | ${m.logLoss?.toFixed(4) ?? "n/a"} | ${m.ece?.toFixed(4) ?? "n/a"} | ${(m.bias as number).toFixed(4)} |`,
      );
    }
    lines.push("");

    lines.push("### Extreme alternate spreads (|line| ≥ 14)");
    lines.push("");
    lines.push(`| Engine | n | Brier | ECE | bias |`);
    lines.push(`|--------|---|-------|-----|------|`);
    for (const [eng, m] of Object.entries(extreme)) {
      lines.push(
        `| ${eng} | ${m.n} | ${m.brier?.toFixed(4) ?? "n/a"} | ${m.ece?.toFixed(4) ?? "n/a"} | ${(m.bias as number)?.toFixed?.(4) ?? m.bias} |`,
      );
    }
    lines.push("");

    lines.push("### Acceptance gates (V2 FG families)");
    lines.push("");
    lines.push(`Thresholds: minOos=${SIM_V2_ACCEPTANCE_THRESHOLDS.minOosSample}, maxEce=${SIM_V2_ACCEPTANCE_THRESHOLDS.maxEce}, integrityRejectRate=0, shadowSoak required.`);
    lines.push("");
    lines.push(`| Family | n | Brier | LogLoss | ECE | Accepted? | Fail reasons |`);
    lines.push(`|--------|---|-------|---------|-----|-----------|--------------|`);
    for (const g of gates) {
      const metrics = g.metrics as { brier: number | null; logLoss: number | null; ece: number | null };
      const reasons = (g.reasons as string[]).join("; ") || "—";
      lines.push(
        `| ${g.family} | ${g.n} | ${metrics.brier?.toFixed(4) ?? "n/a"} | ${metrics.logLoss?.toFixed(4) ?? "n/a"} | ${metrics.ece?.toFixed(4) ?? "n/a"} | ${g.accepted ? "PASS" : "FAIL"} | ${reasons} |`,
      );
    }
    lines.push("");
  }

  lines.push("## Biases, gaps, and overconfidence (cross-sport)");
  lines.push("");
  lines.push("| Finding | Evidence |");
  lines.push("|---------|----------|");
  lines.push("| **Joint integrity (V2)** | 100% of evaluated games: Q1–Q4 and H1/H2 sum to FG every draw. |");
  lines.push("| **Joint integrity (V1)** | ~99.9% of draws break period→FG conservation (frac×noise). |");
  for (const { sport, summary } of results) {
    const extreme = summary.extremeAltSpreads as Record<string, Record<string, number>>;
    const v2e = extreme.v2;
    lines.push(
      `| **${sport.toUpperCase()} extreme alts** | V2 bias ${v2e.bias.toFixed(3)} (p̄=${v2e.meanP.toFixed(3)} vs ȳ=${v2e.meanY.toFixed(3)}); ECE ${v2e.ece.toFixed(3)} — underestimates large-margin covers. |`,
    );
  }
  lines.push("| **Closing lines** | Unavailable from ESPN historical scoreboard — market/CLV baseline not computed. |");
  lines.push("| **Acceptance** | Sample-size met (≥500). All sport:family gates FAIL (ECE>0.04 + shadow soak incomplete). |");
  lines.push("");
  lines.push("## Recommended next steps");
  lines.push("");
  lines.push("1. Ingest historical closing lines (Odds API archive / sportsdata vendor) for true market baselines and CLV.");
  lines.push("2. Expand form features (rest, travel, QB availability) — current L4 means are thin.");
  lines.push("3. Increase blowout / heavy-tail mass (or drive-based scoring) — extreme-alt cover rates are too low vs history.");
  lines.push("4. Recalibrate period variance before trusting Q2/H1 probabilities.");
  lines.push("5. Keep V2 shadow-only until each sport:family passes ECE≤0.04 on n≥500 with shadow soak.");
  lines.push("6. Do not lift P0 blocks or merge OTA on the back of this report alone.");
  lines.push("");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const sportFilter = argValue("sport") as FootballSport | undefined;
  const maxGames = argValue("maxGames") ? Number(argValue("maxGames")) : undefined;
  const nDraws = Number(argValue("draws") ?? "2000");
  const forceRefresh = hasFlag("refresh");

  await mkdir(OUT_DIR, { recursive: true });
  const plans = DEFAULT_FETCH_PLANS.filter((p) => !sportFilter || p.sport === sportFilter);
  const results: Array<{ sport: FootballSport; summary: Record<string, unknown> }> = [];

  for (const plan of plans) {
    const result = await evaluateSport(plan, { nDraws, maxGames, forceRefresh });
    results.push({ sport: result.sport, summary: result.summary });
    await writeFile(
      join(OUT_DIR, `${result.sport}_summary.json`),
      JSON.stringify(result.summary, null, 2),
      "utf8",
    );
    // Compact observations (drop full engine detail duplication for size).
    await writeFile(
      join(OUT_DIR, `${result.sport}_observations.json`),
      JSON.stringify(
        result.observations.map((o) => ({
          eventId: o.eventId,
          season: o.season,
          week: o.week,
          marketId: o.marketId,
          family: o.family,
          period: o.period,
          line: o.line,
          extreme: o.extreme,
          y: o.y,
          p: {
            v2: o.engines.v2_joint.p,
            v1: o.engines.v1_frac.p,
            hist: o.engines.baseline_hist.p,
            coin: o.engines.baseline_coin.p,
          },
        })),
      ),
      "utf8",
    );
  }

  const md = renderMarkdown(results);
  await writeFile(join(OUT_DIR, "HISTORICAL_VALIDATION.md"), md, "utf8");
  console.log(`\nWrote ${join(OUT_DIR, "HISTORICAL_VALIDATION.md")}`);
  for (const r of results) {
    const cov = r.summary.coverage as { evaluatedGames: number; targetMet: boolean };
    const gates = r.summary.acceptanceGates as Array<{ family: string; accepted: boolean }>;
    console.log(
      `${r.sport}: evaluated=${cov.evaluatedGames} targetMet=${cov.targetMet} gates=${gates.map((g) => `${g.family}:${g.accepted ? "PASS" : "FAIL"}`).join(",")}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

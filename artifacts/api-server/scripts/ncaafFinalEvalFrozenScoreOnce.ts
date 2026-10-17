/**
 * Frozen FINAL_EVAL score — authorized once.
 *
 * - Clean E1 α=1.15 (frozen) · M1–M4 + Coach C1–C6
 * - Spreads BLOCKED · no retune · no paid HTTP · no deploy/OTA/unlock
 * - Requires NCAAF_FINAL_EVAL_SCORE=1 and alias-rematch integrity pass
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CLEAN_E1_ALPHA,
  CLEAN_E1_CANDIDATE_ID,
  NCAAF_CLEAN_ENGINE_STAMP,
  pHomeMlFromMargin,
  predictE1Frozen,
  runMlOnlyHarness,
  type CleanFixtureGameRow,
  type ClvMetricInputs,
  CleanOppAdjStrength,
  buildPregameFromFixtureRow,
} from "../src/lib/sportSim/ncaafClean/index.ts";

import { evaluateCloseArchiveSoftGates } from "../src/lib/sportSim/footballCalibration.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "../test/fixtures");
const ART = "/opt/cursor/artifacts";
const DOCS = join(HERE, "../../../docs/coach");

const MAX_EDGE_PCT = 12;

function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIX, name), "utf8")) as T;
}

function americanToImplied(american: number): number {
  if (!Number.isFinite(american) || american === 0) return 0.5;
  if (american < 0) return (-american) / (-american + 100);
  return 100 / (american + 100);
}

function mlClv(selectionOdds: number, closeOdds: number): number {
  return americanToImplied(closeOdds) - americanToImplied(selectionOdds);
}

function bootstrapSe(values: number[], B = 400): number {
  if (values.length < 2) return NaN;
  const n = values.length;
  const means: number[] = [];
  for (let b = 0; b < B; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) {
      s += values[Math.floor(Math.random() * n)]!;
    }
    means.push(s / n);
  }
  const m = means.reduce((a, b) => a + b, 0) / means.length;
  const v =
    means.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, means.length - 1);
  return Math.sqrt(v);
}

function main(): void {
  if (process.env.NCAAF_FINAL_EVAL_SCORE?.trim() !== "1") {
    console.error("Set NCAAF_FINAL_EVAL_SCORE=1 to authorize frozen FINAL_EVAL scoring");
    process.exit(2);
  }

  const rematch = loadJson<{
    integrityPass: boolean;
    paired: number;
    membershipN: number;
  }>("ncaaf-final-eval-alias-rematch-report.json");
  if (!rematch.integrityPass || rematch.paired !== 403) {
    console.error("Alias rematch integrity must PASS with paired=403 before scoring");
    process.exit(2);
  }

  const membership = loadJson<{ games: CleanFixtureGameRow[] }>(
    "ncaaf-final-eval-membership-games.json",
  );
  if (membership.games.length !== 408) {
    throw new Error("membership mutated — abort");
  }

  const closeArch = loadJson<{
    games: Array<{
      gameId: string;
      mlHome: number;
      mlAway: number;
      snapshotTimestamp?: string;
    }>;
    missing: Array<{ eventId: string; reason: string }>;
  }>("ncaaf-final-eval-close-h2h-archive.json");
  const earlyArch = loadJson<{
    games: Array<{
      gameId: string;
      mlHome: number;
      mlAway: number;
      snapshotTimestamp?: string;
    }>;
    missing: Array<{ eventId: string; reason: string }>;
  }>("ncaaf-final-eval-early-t24h-h2h-archive.json");

  const closes = new Map(
    closeArch.games.map((g) => [
      g.gameId,
      {
        gameId: g.gameId,
        closeMlHome: g.mlHome,
        closeMlAway: g.mlAway,
      },
    ]),
  );
  const earlyById = new Map(earlyArch.games.map((g) => [g.gameId, g]));
  const scoreIds = new Set(closeArch.games.map((g) => g.gameId));

  const phaseEDoc = loadJson<{ games?: CleanFixtureGameRow[] } | CleanFixtureGameRow[]>(
    "ncaaf-phase-e-games.json",
  );
  const phaseE = Array.isArray(phaseEDoc) ? phaseEDoc : phaseEDoc.games!;
  const tuning = loadJson<{ games: CleanFixtureGameRow[] }>(
    "ncaaf-tuning-2025-w1-7-games.json",
  );

  // Chronological walk: TUNING then FINAL_EVAL (seed = 2024)
  const walkGames: Array<CleanFixtureGameRow & { outcomeSealed?: boolean }> = [
    ...tuning.games.map((g) => ({ ...g, outcomeSealed: false })),
    ...membership.games.map((g) => ({ ...g, outcomeSealed: true })),
  ];

  // --- Coach ML CLV under R1–R4 (ML-only; spreads blocked) ---
  const strength = new CleanOppAdjStrength({ season: 2025 });
  strength.seedFromPriorSeason(
    phaseE
      .filter((g) => g.season === 2024 && g.homeFg != null && g.awayFg != null)
      .map((g) => ({
        homeTeamId: g.homeTeamId,
        awayTeamId: g.awayTeamId,
        homeFg: g.homeFg!,
        awayFg: g.awayFg!,
        season: g.season,
        kickoffIso: g.kickoffIso,
      })),
  );

  type Pick = {
    eventId: string;
    side: "home" | "away";
    selectionOdds: number;
    closeOdds: number;
    clv: number;
    edgePct: number;
    priceSource: "odds-early-cache";
    pHome: number;
  };
  const picks: Pick[] = [];
  const clvSkip: Record<string, number> = {};
  const softJoins: Array<{ pHome: number; yHome: 0 | 1; closeMlHome: number }> = [];
  const perGameSqErr: number[] = [];
  const perGameDelta: number[] = [];

  const walk = [...walkGames].sort((a, b) =>
    String(a.kickoffIso).localeCompare(String(b.kickoffIso)),
  );

  for (const g of walk) {
    // FINAL_EVAL membership carries explicit venueKind; TUNING venue sidecar
    // does not cover w8+ — do not let a sidecar miss rewrite venue to unknown.
    const pre = buildPregameFromFixtureRow(g, { useVenueSidecar: false });
    const pred = predictE1Frozen({ pregame: pre, strength });

    const eid = String(g.eventId);
    const isFe = scoreIds.has(eid);

    if (isFe && pred.ok && pred.evaluableSupported) {
      const close = closes.get(eid);
      const early = earlyById.get(eid);
      if (close?.closeMlHome != null && g.homeFg != null && g.awayFg != null && g.homeFg !== g.awayFg) {
        const pHome = pHomeMlFromMargin(pred.marginMean, pred.marginSd);
        const y = g.homeFg > g.awayFg ? 1 : 0;
        softJoins.push({ pHome, yHome: y as 0 | 1, closeMlHome: close.closeMlHome });
        const mkt = americanToImplied(close.closeMlHome);
        perGameSqErr.push((pHome - y) ** 2);
        perGameDelta.push((pHome - y) ** 2 - (mkt - y) ** 2);

        if (early && early.mlHome != null && early.mlAway != null) {
          const impH = americanToImplied(early.mlHome);
          const impA = americanToImplied(early.mlAway);
          const edgeH = (pHome - impH) * 100;
          const edgeA = (1 - pHome - impA) * 100;
          const lean: "home" | "away" | null =
            Math.abs(pHome - 0.5) >= 0.03 ? (pHome >= 0.5 ? "home" : "away") : null;

          type Cand = { side: "home" | "away"; odds: number; edgePct: number };
          const cands: Cand[] = [];
          if (edgeH > 0 && edgeH <= MAX_EDGE_PCT) {
            cands.push({ side: "home", odds: early.mlHome, edgePct: edgeH });
          }
          // R2: away only from early two-sided cache
          if (edgeA > 0 && edgeA <= MAX_EDGE_PCT) {
            cands.push({ side: "away", odds: early.mlAway, edgePct: edgeA });
          }
          if (!cands.length) {
            clvSkip.no_qualify_edge = (clvSkip.no_qualify_edge ?? 0) + 1;
          } else {
            const pool = lean ? cands.filter((c) => c.side === lean) : cands;
            const rank = (pool.length ? pool : cands).sort(
              (a, b) => b.edgePct - a.edgePct,
            );
            const best = rank[0]!;
            const closeOdds =
              best.side === "home"
                ? close.closeMlHome
                : close.closeMlAway != null
                  ? close.closeMlAway
                  : null;
            if (closeOdds == null) {
              clvSkip.missing_close_side = (clvSkip.missing_close_side ?? 0) + 1;
            } else {
              picks.push({
                eventId: eid,
                side: best.side,
                selectionOdds: best.odds,
                closeOdds,
                clv: mlClv(best.odds, closeOdds),
                edgePct: best.edgePct,
                priceSource: "odds-early-cache",
                pHome,
              });
            }
          }
        } else {
          clvSkip.missing_early = (clvSkip.missing_early ?? 0) + 1;
        }
      } else {
        clvSkip.missing_close_or_final = (clvSkip.missing_close_or_final ?? 0) + 1;
      }
    } else if (isFe && !pred.ok) {
      clvSkip[`pred_${pred.reason}`] = (clvSkip[`pred_${pred.reason}`] ?? 0) + 1;
    } else if (isFe && pred.ok && !pred.evaluableSupported) {
      clvSkip.not_evaluable = (clvSkip.not_evaluable ?? 0) + 1;
    }

    if (g.homeFg != null && g.awayFg != null) {
      strength.update({
        homeTeamId: g.homeTeamId,
        awayTeamId: g.awayTeamId,
        homeFg: g.homeFg,
        awayFg: g.awayFg,
        season: g.season,
        kickoffIso: g.kickoffIso,
      });
    }
  }

  const homeSelections = picks.filter((p) => p.side === "home").length;
  const awaySelections = picks.filter((p) => p.side === "away").length;
  const meanClv =
    picks.length > 0
      ? picks.reduce((s, p) => s + p.clv, 0) / picks.length
      : null;
  const pctBeat =
    picks.length > 0
      ? picks.filter((p) => p.clv > 0).length / picks.length
      : null;

  const soft = evaluateCloseArchiveSoftGates(
    softJoins.map((j, i) => ({
      eventId: `fe-soft-${i}`,
      pHome: j.pHome,
      yHome: j.yHome,
      closeMlHome: j.closeMlHome,
      // Spreads blocked — soft-gate ML path does not use ATS fields
      closeSpreadHome: 0,
      pHomeCoverClose: null,
      homeCoveredClose: null,
    })),
  );

  const clvInput: ClvMetricInputs = {
    available: true,
    nMlWithClv: picks.length,
    meanClvProbPoints: meanClv,
    pctSelectionsBeatClose: pctBeat,
    homeSelections,
    awaySelections,
    softGatesOk: soft.verdict === "PASS_SOFT_GATES_ONLY",
    earlyCachePicks: picks.length,
    note: "Clean E1 ML-only Coach CLV on rematched FINAL_EVAL early/close archives; R1–R4; spreads blocked",
  };

  const report = runMlOnlyHarness({
    split: "FINAL_EVAL",
    allowFinalEvalScoring: true,
    season: 2025,
    seedGames: phaseE.filter((g) => g.season === 2024),
    walkGames,
    scoreEventIds: scoreIds,
    closes,
    useVenueSidecar: false,
    e4InjuryValidated: false,
    clv: clvInput,
  });

  const uncertainty = {
    method: "bootstrap_resample_games_B400",
    n: perGameSqErr.length,
    mlBrierSE: bootstrapSe(perGameSqErr),
    deltaVsMarketSE: bootstrapSe(perGameDelta),
    meanClvSE:
      picks.length > 1 ? bootstrapSe(picks.map((p) => p.clv)) : null,
  };

  const exclusions = {
    membershipN: 408,
    scoredCloseMlN: scoreIds.size,
    emptyBookmakersMissing: closeArch.missing.filter(
      (m) => m.reason === "empty_bookmakers",
    ),
    closeMissing: closeArch.missing,
    earlyMissing: earlyArch.missing,
    harnessWithhold: report.withhold,
    clvSkip,
  };

  const out = {
    generatedAt: new Date().toISOString(),
    authorized: true,
    paidHttp: 0,
    retuned: false,
    deployOta: false,
    ncaafUnlock: false,
    spreads: "BLOCKED_SEPARATE_GATE",
    stamp: NCAAF_CLEAN_ENGINE_STAMP,
    candidateId: CLEAN_E1_CANDIDATE_ID,
    alpha: CLEAN_E1_ALPHA,
    membershipN: 408,
    membershipPreserved: true,
    pairedCoverage: `${rematch.paired}/408`,
    emptyBookmakersKeptMissing: 5,
    ...report,
    softGates: soft,
    coachClvDetail: {
      nPicks: picks.length,
      homeSelections,
      awaySelections,
      meanClv,
      pctBeatClose: pctBeat,
      earlyCachePicks: picks.length,
      selectionRules: ["R1_home_ok", "R2_away_early_cache", "R3_edge_le_12", "R4_price_source"],
      markets: ["h2h_ml_only"],
      spreadsBlocked: true,
    },
    uncertainty,
    exclusions,
    finalEvalScored: true,
    humanE6Required: true,
    note: "Single frozen FINAL_EVAL run — do not retune against these numbers",
  };

  // Strip circular / huge pick dump — keep summary only
  const md = `# FINAL_EVAL frozen score (once)

**Authorized:** yes · **Paid HTTP:** 0 · **Retuned:** false · **Deploy/OTA/unlock:** false  
**Stamp:** \`${NCAAF_CLEAN_ENGINE_STAMP}\` · **Candidate:** ${CLEAN_E1_CANDIDATE_ID} α=${CLEAN_E1_ALPHA}  
**Membership:** 408 preserved · **Paired coverage:** ${rematch.paired}/408 · **Empty shells missing:** 5  
**Spreads:** BLOCKED

## Exclusions / sample

| Item | n |
|------|--:|
| Membership | 408 |
| Paired early+close two-sided | ${rematch.paired} |
| Empty bookmakers (explicit missing) | 5 |
| M1 scored (decided + close ML + evaluable) | ${report.metrics.nMl} |
| Coach ML CLV picks | ${picks.length} |
| Harness withholds | ${JSON.stringify(report.withhold)} |
| CLV skips | ${JSON.stringify(clvSkip)} |

Empty bookmaker IDs: ${exclusions.emptyBookmakersMissing.map((m) => m.eventId).join(", ")}

## M1–M4 (engine moneyline)

| # | Criterion | Measured | Pass |
|---|-----------|----------|:----:|
${report.mlCriteria.map((c) => `| ${c.id} | ${c.threshold} | ${c.measured} (${c.detail}) | ${c.pass} |`).join("\n")}

| Metric | Value | Bootstrap SE |
|--------|------:|-------------:|
| ML Brier | ${report.metrics.mlBrier} | ${uncertainty.mlBrierSE?.toFixed?.(5) ?? uncertainty.mlBrierSE} |
| Market Brier | ${report.metrics.mktBrier} | — |
| Δ vs market | ${report.metrics.deltaVsMarket} | ${uncertainty.deltaVsMarketSE?.toFixed?.(5) ?? uncertainty.deltaVsMarketSE} |
| meanP / meanY / bias | ${report.metrics.meanP} / ${report.metrics.meanY} / ${report.metrics.bias} | — |

## Coach C1–C6 (ML CLV, R1–R4)

| # | Result | Detail |
|---|--------|--------|
${report.clvCriteria.map((c) => `| ${c.id} | pass=${c.pass} · ${c.evidenceClass} | ${c.detail} |`).join("\n")}

Soft gates (same stamp): **${soft.verdict}** (n=${soft.n}, engineBrier=${soft.engineBrier}, mktBrier=${soft.marketBrier}, meanGap=${soft.meanEngineMinusMarket})  
meanClv SE≈${uncertainty.meanClvSE?.toFixed?.(5) ?? "n/a"}

## Acceptance

\`finalPass=${report.acceptance.finalPass}\` — ${report.acceptance.reason}  
mlAllPass=${report.acceptance.mlAllPass} · clvAllPass=${report.acceptance.clvAllPass} · E4 injury validated=false

## Notes

${report.notes.map((n) => `- ${n}`).join("\n")}
- No retuning against FINAL_EVAL
- Human E6 still required before any gate flip
`;

  mkdirSync(ART, { recursive: true });
  writeFileSync(
    join(FIX, "ncaaf-final-eval-frozen-score.json"),
    JSON.stringify(out, null, 2) + "\n",
  );
  writeFileSync(join(ART, "ncaaf-final-eval-frozen-score.json"), JSON.stringify(out, null, 2) + "\n");
  writeFileSync(join(FIX, "ncaaf-final-eval-frozen-score.md"), md);
  writeFileSync(join(ART, "ncaaf-final-eval-frozen-score.md"), md);
  writeFileSync(join(DOCS, "ncaaf-final-eval-frozen-score.md"), md);

  // Mark archives scored=true for provenance (membership unchanged)
  for (const name of [
    "ncaaf-final-eval-close-h2h-archive.json",
    "ncaaf-final-eval-early-t24h-h2h-archive.json",
  ]) {
    const arch = loadJson<Record<string, unknown>>(name);
    arch.scored = true;
    arch.scoredAt = out.generatedAt;
    arch.scoreStamp = NCAAF_CLEAN_ENGINE_STAMP;
    writeFileSync(join(FIX, name), JSON.stringify(arch, null, 2) + "\n");
    writeFileSync(join(ART, name), JSON.stringify(arch, null, 2) + "\n");
  }

  console.log(
    JSON.stringify(
      {
        nMl: report.metrics.nMl,
        ml: report.mlCriteria,
        clv: report.clvCriteria,
        soft: soft.verdict,
        finalPass: report.acceptance.finalPass,
        mlAllPass: report.acceptance.mlAllPass,
        clvAllPass: report.acceptance.clvAllPass,
        uncertainty,
      },
      null,
      2,
    ),
  );
}

main();

// Full-board scan manifest — proves every market family was discovered, simulated, and gated.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { BoardMarketCategory } from "./balancedTicketMix.ts";
import { boardMarketCategory } from "./boardMarketPools.ts";
import {
  type BoardLegGateCode,
  explainBoardLegQualification,
  pickLabelForManifest,
} from "./boardLegQualification.ts";
import type { FinalAiScore } from "./finalAiScore.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";
import { isRealisticBoardPropCandidate } from "./boardPropSimExpansion.ts";
import { isAltPropPick } from "./altLinePool.ts";
import { impliedProb } from "./format.ts";

export type ManifestMarketFamily =
  | "playerProps"
  | "altPlayerProps"
  | "comboProps"
  | "moneyline"
  | "spread"
  | "total"
  | "altSpread"
  | "altTotal"
  | "teamTotal"
  | "periodHalfQuarterInning"
  | "raceTo"
  | "otherGameLine";

export type CoachBoardScanManifest = {
  scanComplete: boolean;
  boardExhausted: boolean;
  requestedLegs: number;
  deliveredLegs: number;
  gameSimDraws: number;
  propSimDraws: number;
  propSimTier: "deep" | "quick";

  marketsFound: number;
  marketsFoundByFamily: Record<ManifestMarketFamily, number>;
  propsFound: number;
  propsEligibleForSim: number;
  propsSkippedUnsupported: number;
  alternateGameLinesFound: number;
  alternatePropsFound: number;

  marketsSimulated: number;
  gameLinesSimulated: number;
  propsSimulated: number;
  propsSimBatches: number;
  propsSimTimeouts: number;

  /** Sim finished but pick never entered scored[] (null MC hit, timeout, etc.). */
  preScoreEvaluated: number;
  totalEvaluated: number;
  totalQualified: number;
  qualifiedMain: number;
  qualifiedAlt: number;
  qualifiedByCategory: Record<BoardMarketCategory, number>;

  gateFailureCounts: Partial<Record<BoardLegGateCode, number>>;
  rejectedSamples: Array<{
    game: string;
    sport: string;
    market: string;
    line: number | null;
    odds: number | null;
    simulationProbability: number | null;
    modelProbability: number | null;
    impliedProbability: number | null;
    confidence: number | null;
    edge: number | null;
    ev: number | null;
    dataQualityTier: "full" | "partial" | "market_only" | "unknown";
    correlationStatus: "not_evaluated";
    pick: string;
    category: BoardMarketCategory;
    family: ManifestMarketFamily;
    gate: BoardLegGateCode;
    reason: string;
  }>;
};

export function emptyCoachBoardScanManifest(requestedLegs = 0): CoachBoardScanManifest {
  const zeroFamilies = (): Record<ManifestMarketFamily, number> => ({
    playerProps: 0,
    altPlayerProps: 0,
    comboProps: 0,
    moneyline: 0,
    spread: 0,
    total: 0,
    altSpread: 0,
    altTotal: 0,
    teamTotal: 0,
    periodHalfQuarterInning: 0,
    raceTo: 0,
    otherGameLine: 0,
  });
  return {
    scanComplete: false,
    boardExhausted: false,
    requestedLegs,
    deliveredLegs: 0,
    gameSimDraws: 10_000,
    propSimDraws: 10_000,
    propSimTier: "deep",
    marketsFound: 0,
    marketsFoundByFamily: zeroFamilies(),
    propsFound: 0,
    propsEligibleForSim: 0,
    propsSkippedUnsupported: 0,
    alternateGameLinesFound: 0,
    alternatePropsFound: 0,
    marketsSimulated: 0,
    gameLinesSimulated: 0,
    propsSimulated: 0,
    propsSimBatches: 0,
    propsSimTimeouts: 0,
    preScoreEvaluated: 0,
    totalEvaluated: 0,
    totalQualified: 0,
    qualifiedMain: 0,
    qualifiedAlt: 0,
    qualifiedByCategory: { props: 0, gameLines: 0, teamTotals: 0, alternateLines: 0 },
    gateFailureCounts: {},
    rejectedSamples: [],
  };
}

export function classifyManifestMarketFamily(pick: ParsedPick): ManifestMarketFamily {
  const market = String(pick.market ?? "").trim();
  const lower = market.toLowerCase();
  if (pick.isProp) {
    if (isAltPropPick(pick) || pick.propIsAlt) return "altPlayerProps";
    if (/\+|&|combo|double|triple/i.test(lower) || /pts.*reb|reb.*ast|pra/i.test(lower)) {
      return "comboProps";
    }
    return "playerProps";
  }
  if (/team total/i.test(lower)) return "teamTotal";
  if (/alt spread/i.test(lower)) return "altSpread";
  if (/alt total/i.test(lower)) return "altTotal";
  if (/moneyline|\bml\b/i.test(lower)) return "moneyline";
  if (/spread/i.test(lower)) return "spread";
  if (/total/i.test(lower)) return "total";
  if (/race to/i.test(lower)) return "raceTo";
  if (
    /q[1-4]|quarter|half|period|inning|f5|1st/i.test(lower) ||
    /\b(h1|h2|p[1-3])\b/i.test(lower)
  ) {
    return "periodHalfQuarterInning";
  }
  return "otherGameLine";
}

export type CoachBoardScanManifestRecorder = CoachBoardScanManifest & {
  recordMarketFound(pick: ParsedPick): void;
  recordPropPoolRow(pick: ParsedPick): void;
  recordGameLineSimulated(): void;
  recordPropSimBatch(size: number, timedOut: boolean): void;
  /** Sim ran but the pick could not be graded (null MC hit, batch timeout, etc.). */
  recordPreScoreGateFailure(pick: ParsedPick, score?: Partial<FinalAiScore> | null): void;
  recordEvaluatedLeg(leg: BoardScoredLeg): void;
  recordEvaluatedPick(pick: ParsedPick, score: ParsedPick["finalAiScore"]): void;
  recomputeQualificationFromScored(scored: BoardScoredLeg[]): void;
  finalize(opts: { scanComplete: boolean; boardExhausted: boolean; deliveredLegs: number }): CoachBoardScanManifest;
};

const MAX_REJECTED_SAMPLES = 80;

function isBoardLegGateCode(value: string): value is BoardLegGateCode {
  return [
    "qualified_main",
    "qualified_alt",
    "no_score",
    "high_risk_value_play",
    "unsupported_market",
    "missing_odds",
    "missing_prop_line",
    "no_sim_grade",
    "negative_edge",
    "negative_ev",
    "sim_below_implied",
    "grade_below_minimum",
    "confidence_below_minimum",
    "not_sim_aligned",
    "holistic_not_recommended",
    "not_ai_recommended",
    "not_staged",
  ].includes(value);
}

function isCompleteFinalAiScore(
  score: Partial<FinalAiScore> | null | undefined,
): score is FinalAiScore {
  return (
    score != null &&
    score.composite !== undefined &&
    score.grade !== undefined &&
    score.confidencePct !== undefined &&
    score.edgePct !== undefined &&
    score.simHit !== undefined &&
    score.simAligned !== undefined &&
    score.highRiskValuePlay !== undefined &&
    score.recommends !== undefined &&
    score.factors !== undefined &&
    score.rubric !== undefined
  );
}

function mergeGateFailureCounts(
  a: Partial<Record<BoardLegGateCode, number>>,
  b: Partial<Record<BoardLegGateCode, number>>,
): Partial<Record<BoardLegGateCode, number>> {
  const out: Partial<Record<BoardLegGateCode, number>> = { ...a };
  for (const [gate, count] of Object.entries(b)) {
    if (!count || !isBoardLegGateCode(gate)) continue;
    out[gate] = (out[gate] ?? 0) + count;
  }
  return out;
}

export function createCoachBoardScanManifestRecorder(requestedLegs: number): CoachBoardScanManifestRecorder {
  const manifest = emptyCoachBoardScanManifest(requestedLegs);
  const seenRejectFp = new Set<string>();
  const seenPreScoreFp = new Set<string>();
  let preScoreGateFailures: Partial<Record<BoardLegGateCode, number>> = {};
  let preScoreRejectedSamples: CoachBoardScanManifest["rejectedSamples"] = [];
  let recorder: CoachBoardScanManifestRecorder;

  const syncRecorder = () => {
    Object.assign(recorder, manifest);
  };

  const bumpGate = (gate: BoardLegGateCode, target: Partial<Record<BoardLegGateCode, number>>) => {
    target[gate] = (target[gate] ?? 0) + 1;
  };

  const pushRejectedSample = (
    pick: ParsedPick,
    gate: BoardLegGateCode,
    reason: string,
    score: Partial<FinalAiScore> | null | undefined,
    bucket: CoachBoardScanManifest["rejectedSamples"],
    seen: Set<string>,
  ) => {
    const fp = `${pick.game}|${pick.market}|${pick.pick}|${pick.odds}|${gate}`;
    if (seen.has(fp) || bucket.length >= MAX_REJECTED_SAMPLES) return;
    seen.add(fp);
    const line =
      pick.propLine ??
      (() => {
        const match = String(pick.pick ?? "").match(/([+-]?\d+(?:\.\d+)?)\s*$/);
        return match ? Number(match[1]) : null;
      })();
    const simHit = score?.simHit ?? null;
    const odds = pick.odds ?? null;
    bucket.push({
      game: pick.game,
      sport: pick.sport ?? "unknown",
      market: String(pick.market ?? ""),
      line: Number.isFinite(line) ? line : null,
      odds,
      simulationProbability: simHit,
      modelProbability: simHit,
      impliedProbability: odds != null && Number.isFinite(odds) ? impliedProb(odds) : null,
      confidence: score?.confidencePct ?? null,
      edge: score?.edgePct ?? null,
      ev:
        simHit != null && odds != null && Number.isFinite(odds)
          ? simHit * (odds > 0 ? odds / 100 : 100 / -odds) - (1 - simHit)
          : null,
      dataQualityTier: "unknown",
      correlationStatus: "not_evaluated",
      pick: pickLabelForManifest(pick),
      category: boardMarketCategory(pick),
      family: classifyManifestMarketFamily(pick),
      gate,
      reason,
    });
  };

  recorder = {
    ...manifest,
    recordMarketFound(pick) {
      manifest.marketsFound += 1;
      const family = classifyManifestMarketFamily(pick);
      manifest.marketsFoundByFamily[family] += 1;
      if (!pick.isProp) {
        const cat = boardMarketCategory(pick);
        if (cat === "alternateLines") manifest.alternateGameLinesFound += 1;
      }
      syncRecorder();
    },
    recordPropPoolRow(pick) {
      manifest.propsFound += 1;
      recorder.recordMarketFound(pick);
      if (isAltPropPick(pick) || pick.propIsAlt) manifest.alternatePropsFound += 1;
      if (isRealisticBoardPropCandidate(pick)) {
        manifest.propsEligibleForSim += 1;
      } else {
        manifest.propsSkippedUnsupported += 1;
      }
      syncRecorder();
    },
    recordGameLineSimulated() {
      manifest.gameLinesSimulated += 1;
      manifest.marketsSimulated += 1;
      syncRecorder();
    },
    recordPropSimBatch(size, timedOut) {
      manifest.propsSimBatches += 1;
      manifest.propsSimulated += size;
      manifest.marketsSimulated += size;
      if (timedOut) manifest.propsSimTimeouts += 1;
      syncRecorder();
    },
    recordPreScoreGateFailure(pick, score) {
      const fp = `${pick.game}|${pick.market}|${pick.pick}|${pick.odds}|pre_score`;
      if (seenPreScoreFp.has(fp)) return;
      seenPreScoreFp.add(fp);
      manifest.preScoreEvaluated += 1;
      const q =
        score?.simHit == null
          ? {
              gate: "no_sim_grade" as const,
              reason: "No simulation result (10k MC not complete)",
            }
          : explainBoardLegQualification(
              pick,
              isCompleteFinalAiScore(score) ? score : null,
            );
      bumpGate(q.gate, preScoreGateFailures);
      pushRejectedSample(pick, q.gate, q.reason, score, preScoreRejectedSamples, seenRejectFp);
      syncRecorder();
    },
    recordEvaluatedLeg(leg) {
      recorder.recordEvaluatedPick(leg.pick, leg.pick.finalAiScore);
    },
    recordEvaluatedPick(pick, score) {
      const q = explainBoardLegQualification(pick, score);
      if (q.qualifies) {
        manifest.totalQualified += 1;
        if (q.role === "main") manifest.qualifiedMain += 1;
        if (q.role === "alt") manifest.qualifiedAlt += 1;
        const cat = boardMarketCategory(pick);
        manifest.qualifiedByCategory[cat] += 1;
        syncRecorder();
        return;
      }
      bumpGate(q.gate, manifest.gateFailureCounts);
      pushRejectedSample(pick, q.gate, q.reason, score, manifest.rejectedSamples, seenRejectFp);
      syncRecorder();
    },
    recomputeQualificationFromScored(scored) {
      manifest.totalQualified = 0;
      manifest.qualifiedMain = 0;
      manifest.qualifiedAlt = 0;
      manifest.qualifiedByCategory = { props: 0, gameLines: 0, teamTotals: 0, alternateLines: 0 };
      manifest.gateFailureCounts = {};
      manifest.rejectedSamples = [];
      seenRejectFp.clear();

      for (const leg of scored) {
        recorder.recordEvaluatedPick(leg.pick, leg.pick.finalAiScore);
      }

      manifest.totalEvaluated = manifest.preScoreEvaluated + scored.length;
      syncRecorder();
    },
    finalize(opts) {
      manifest.scanComplete = opts.scanComplete;
      manifest.boardExhausted = opts.boardExhausted;
      manifest.deliveredLegs = opts.deliveredLegs;
      if (!manifest.totalEvaluated) {
        manifest.totalEvaluated = manifest.preScoreEvaluated;
      }
      if (
        opts.scanComplete &&
        manifest.marketsSimulated > manifest.totalEvaluated
      ) {
        const gap = manifest.marketsSimulated - manifest.totalEvaluated;
        preScoreGateFailures.no_sim_grade = (preScoreGateFailures.no_sim_grade ?? 0) + gap;
        manifest.preScoreEvaluated += gap;
        manifest.totalEvaluated = manifest.marketsSimulated;
      }
      syncRecorder();
      return {
        ...manifest,
        gateFailureCounts: mergeGateFailureCounts(preScoreGateFailures, manifest.gateFailureCounts),
        rejectedSamples: [...preScoreRejectedSamples, ...manifest.rejectedSamples].slice(
          0,
          MAX_REJECTED_SAMPLES,
        ),
      };
    },
  };

  return recorder;
}

function gateLabel(gate: BoardLegGateCode): string {
  const labels: Record<BoardLegGateCode, string> = {
    qualified_main: "Qualified (main)",
    qualified_alt: "Qualified (alt)",
    no_score: "No score",
    high_risk_value_play: "High-risk value",
    unsupported_market: "Unsupported market",
    missing_odds: "Missing odds",
    missing_prop_line: "Missing prop line",
    no_sim_grade: "No sim grade",
    negative_edge: "Edge ≤ 0",
    negative_ev: "EV ≤ 0",
    sim_below_implied: "Sim ≤ implied",
    grade_below_minimum: "Grade below C+",
    confidence_below_minimum: "Confidence below 52%",
    not_sim_aligned: "Sim not aligned",
    holistic_not_recommended: "Holistic failed",
    not_ai_recommended: "Not AI recommended",
    not_staged: "Not staged",
  };
  return labels[gate] ?? gate;
}

/** User-facing scan manifest block (markdown). */
export function formatCoachBoardScanManifest(manifest: CoachBoardScanManifest): string {
  const lines: string[] = [];
  lines.push("### Scan manifest");
  lines.push(
    manifest.scanComplete && manifest.boardExhausted
      ? "**Status:** Full board evaluated — every posted market family scanned."
      : manifest.scanComplete
        ? "**Status:** Scan finished."
        : "**Status:** Scan in progress…",
  );
  lines.push("");
  lines.push("**Coverage**");
  lines.push(`- Markets found: **${manifest.marketsFound.toLocaleString()}**`);
  lines.push(`- Markets simulated (10k MC): **${manifest.marketsSimulated.toLocaleString()}**`);
  lines.push(`- Game lines simulated: **${manifest.gameLinesSimulated.toLocaleString()}**`);
  lines.push(
    `- Player props simulated: **${manifest.propsSimulated.toLocaleString()}** of **${manifest.propsEligibleForSim.toLocaleString()}** eligible (${manifest.propsFound.toLocaleString()} in pool)`,
  );
  lines.push(`- Alternate game lines found: **${manifest.alternateGameLinesFound.toLocaleString()}**`);
  lines.push(`- Alternate player props found: **${manifest.alternatePropsFound.toLocaleString()}**`);
  if (manifest.propsSkippedUnsupported > 0) {
    lines.push(`- Props skipped (no sim model / missing line): **${manifest.propsSkippedUnsupported.toLocaleString()}**`);
  }
  if (manifest.propsSimTimeouts > 0) {
    lines.push(`- Prop sim batch timeouts: **${manifest.propsSimTimeouts}**`);
  }

  lines.push("");
  lines.push("**Market families discovered**");
  const families: Array<[ManifestMarketFamily, string]> = [
    ["playerProps", "Player props"],
    ["altPlayerProps", "Alternate player props"],
    ["comboProps", "Combo props"],
    ["moneyline", "Moneylines"],
    ["spread", "Spreads"],
    ["total", "Totals"],
    ["altSpread", "Alternate spreads"],
    ["altTotal", "Alternate totals"],
    ["teamTotal", "Team totals"],
    ["periodHalfQuarterInning", "Quarter / half / period / inning"],
    ["raceTo", "Race-to markets"],
    ["otherGameLine", "Other posted game lines"],
  ];
  for (const [key, label] of families) {
    const n = manifest.marketsFoundByFamily[key];
    if (n > 0) lines.push(`- ${label}: **${n.toLocaleString()}**`);
  }

  lines.push("");
  lines.push("**Qualification**");
  lines.push(`- Candidates evaluated (with sim): **${manifest.totalEvaluated.toLocaleString()}**`);
  if (manifest.preScoreEvaluated > 0) {
    lines.push(
      `- Sim completed but not gradable: **${manifest.preScoreEvaluated.toLocaleString()}** (null MC hit, timeout, or missing score)`,
    );
  }
  lines.push(`- Qualified (main): **${manifest.qualifiedMain}**`);
  lines.push(`- Qualified (alt): **${manifest.qualifiedAlt}**`);
  lines.push(
    `- On ticket categories — props: **${manifest.qualifiedByCategory.props}**, game lines: **${manifest.qualifiedByCategory.gameLines}**, team totals: **${manifest.qualifiedByCategory.teamTotals}**, alts: **${manifest.qualifiedByCategory.alternateLines}**`,
  );

  const failureEntries = Object.entries(manifest.gateFailureCounts).filter(
    ([gate]) => gate !== "qualified_main" && gate !== "qualified_alt",
  );
  if (failureEntries.length > 0) {
    lines.push("");
    lines.push("**Gate failures**");
    for (const [gate, count] of failureEntries.sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))) {
      if (isBoardLegGateCode(gate)) {
        lines.push(`- ${gateLabel(gate)}: **${count?.toLocaleString()}**`);
      }
    }
  }

  if (manifest.rejectedSamples.length > 0) {
    lines.push("");
    lines.push(`**Sample rejections** (top ${manifest.rejectedSamples.length} by scan order)`);
    for (const r of manifest.rejectedSamples.slice(0, 25)) {
      lines.push(`- ${r.game} · ${r.pick} — _${r.reason}_`);
    }
    if (manifest.rejectedSamples.length > 25) {
      lines.push(`- _…and ${manifest.rejectedSamples.length - 25} more logged rejections_`);
    }
  }

  lines.push("");
  lines.push("**Delivery**");
  if (manifest.scanComplete && manifest.boardExhausted) {
    if (manifest.deliveredLegs > 0) {
      lines.push(
        `- Delivered **${manifest.deliveredLegs}** of **${manifest.requestedLegs || manifest.deliveredLegs}** requested legs after horizon + dedupe gates.`,
      );
    } else if (manifest.qualifiedMain + manifest.qualifiedAlt > 0) {
      lines.push(
        `- **0 legs delivered** — **${manifest.qualifiedMain + manifest.qualifiedAlt}** passed sim/AI gates but none survived final delivery (horizon, dedupe, or in-flight rescoring).`,
      );
    } else if (manifest.marketsSimulated > 0 && manifest.totalEvaluated > 0) {
      lines.push(
        `- **0 legs delivered** — **${manifest.marketsSimulated.toLocaleString()}** markets got 10k MC sims; **${manifest.totalEvaluated.toLocaleString()}** were graded but none passed edge, EV, and confidence gates. See gate failures above.`,
      );
    } else if (manifest.marketsSimulated > 0) {
      lines.push(
        `- **0 legs delivered** — **${manifest.marketsSimulated.toLocaleString()}** markets were simulated but none produced a gradable sim result on this slate.`,
      );
    } else {
      lines.push(
        `- **0 legs delivered** — no candidates passed sim, edge, EV, and confidence thresholds on this slate.`,
      );
    }
  } else if (manifest.deliveredLegs > 0) {
    lines.push(`- In progress: **${manifest.deliveredLegs}** leg(s) ready so far.`);
  }

  lines.push("");
  lines.push(
    `_Simulation: ${manifest.gameSimDraws.toLocaleString()} draws per game line; prop tier **${manifest.propSimTier}** (${manifest.propSimDraws.toLocaleString()} draws per prop)._`,
  );
  lines.push("_Pipeline: **board scan → staging gates → single delivery** (no preview/filler fallback)._");

  return lines.join("\n");
}

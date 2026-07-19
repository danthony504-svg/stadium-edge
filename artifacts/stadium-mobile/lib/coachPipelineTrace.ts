// Coach post-score pipeline tracing — stage counts + per-market rejection reasons.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { BoardLegGateCode } from "./boardLegQualification.ts";
import { explainBoardLegQualification, pickLabelForManifest } from "./boardLegQualification.ts";
import type { FinalAiScore } from "./finalAiScore.ts";
import { simEvPct } from "./gameSimQualityGates.ts";
import { pickHasSimGrade } from "./simMarketSupport.ts";
import { pickLegFingerprint } from "./parlayReachCore.ts";
import { positiveEdgeScoredLegs } from "./coachDeliverySalvage.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";

export const COACH_PIPELINE_LOG_PREFIX = "[coach-pipeline]";

export type CoachPipelineStageKey =
  | "downloaded"
  | "afterValidation"
  | "afterPricing"
  | "afterEv"
  | "afterSimulation"
  | "afterConfidence"
  | "afterCorrelation"
  | "afterDuplicates"
  | "beforeFinalSelection"
  | "finalDelivery";

export const COACH_PIPELINE_STAGE_LABELS: Record<CoachPipelineStageKey, string> = {
  downloaded: "Markets downloaded",
  afterValidation: "Markets after validation",
  afterPricing: "Markets after pricing filter",
  afterEv: "Markets after EV calculation",
  afterSimulation: "Markets after simulation",
  afterConfidence: "Markets after confidence filter",
  afterCorrelation: "Markets after correlation filter",
  afterDuplicates: "Markets after duplicate removal",
  beforeFinalSelection: "Markets remaining before final selection",
  finalDelivery: "Picks delivered to ticket",
};

export type CoachPipelineRejectedMarket = {
  entity: string;
  market: string;
  edge: number | null;
  confidence: number | null;
  ev: number | null;
  simulation: number | null;
  reason: string;
  stage: CoachPipelineStageKey | "delivery";
};

export type CoachPipelineSnapshot = {
  stages: Partial<Record<CoachPipelineStageKey, number>>;
  rejections: CoachPipelineRejectedMarket[];
  relaxationsApplied: string[];
};

export function emptyCoachPipelineSnapshot(): CoachPipelineSnapshot {
  return { stages: {}, rejections: [], relaxationsApplied: [] };
}

function entityLabel(pick: ParsedPick): string {
  if (pick.player) return pick.player;
  if (pick.teamAbbr) return pick.teamAbbr;
  const game = String(pick.game ?? "");
  const parts = game.split("@").map((s) => s.trim()).filter(Boolean);
  return parts[0] ?? (game || "—");
}

export function metricsFromPick(
  pick: ParsedPick,
  score: FinalAiScore | null | undefined,
): Pick<CoachPipelineRejectedMarket, "edge" | "confidence" | "ev" | "simulation"> {
  const simHit = score?.simHit ?? null;
  const edge = score?.edgePct ?? null;
  const confidence = score?.confidencePct ?? null;
  const ev =
    simHit != null && pick.odds != null ? simEvPct(simHit, pick.odds) : null;
  return {
    edge,
    confidence,
    ev,
    simulation: simHit != null ? Math.round(simHit * 1000) / 10 : null,
  };
}

export function gateToRejectionReason(gate: BoardLegGateCode, detail: string): string {
  switch (gate) {
    case "confidence_below_minimum":
      return `Rejected because confidence < threshold (${detail})`;
    case "negative_edge":
      return `Rejected because edge too small (${detail})`;
    case "negative_ev":
    case "sim_below_implied":
      return `Rejected because edge too small (${detail})`;
    case "grade_below_minimum":
      return `Rejected because grade below minimum (${detail})`;
    case "not_sim_aligned":
      return `Rejected because simulation disagrees with posted odds (${detail})`;
    case "holistic_not_recommended":
      return `Rejected because missing optional data (${detail})`;
    case "missing_odds":
      return "Rejected because market unavailable (missing odds)";
    case "missing_prop_line":
    case "no_score":
    case "no_sim_grade":
    case "unsupported_market":
      return `Rejected because market unavailable (${detail})`;
    case "high_risk_value_play":
      return "Rejected because high-risk value play flag";
    case "not_ai_recommended":
    case "not_staged":
      return `Rejected because below AI quality bar (${detail})`;
    default:
      return detail;
  }
}

export function rejectionFromQualification(
  pick: ParsedPick,
  score: FinalAiScore | null | undefined,
  stage: CoachPipelineStageKey,
): CoachPipelineRejectedMarket | null {
  const q = explainBoardLegQualification(pick, score);
  if (q.qualifies) return null;
  const metrics = metricsFromPick(pick, score);
  return {
    entity: entityLabel(pick),
    market: String(pick.market ?? ""),
    ...metrics,
    reason: gateToRejectionReason(q.gate, q.reason),
    stage,
  };
}

export function rejectionFromDelivery(
  pick: ParsedPick,
  score: FinalAiScore | null | undefined,
  reason: string,
): CoachPipelineRejectedMarket {
  return {
    entity: entityLabel(pick),
    market: String(pick.market ?? ""),
    ...metricsFromPick(pick, score),
    reason,
    stage: "delivery",
  };
}

export function explainDeliveryFilterRejection(
  pick: ParsedPick,
  score: FinalAiScore | null | undefined,
): string | null {
  if (!score) return "Rejected because market unavailable (no AI score)";
  if (score.highRiskValuePlay) return "Rejected because high-risk value play flag";
  if (!pickHasSimGrade(pick, score.simHit)) {
    return "Rejected because market unavailable (no simulation grade)";
  }
  if ((score.edgePct ?? 0) <= 0) {
    return `Rejected because edge too small (edge ${(score.edgePct ?? 0).toFixed(1)}%)`;
  }
  if (score.simHit != null && pick.odds != null) {
    const ev = simEvPct(score.simHit, pick.odds);
    if (ev != null && ev <= 0) {
      return `Rejected because edge too small (EV ${ev.toFixed(2)}%)`;
    }
  }
  const q = explainBoardLegQualification(pick, score);
  if (!q.qualifies) {
    return gateToRejectionReason(q.gate, q.reason);
  }
  return null;
}

export function pushPipelineRejection(
  snapshot: CoachPipelineSnapshot,
  rejection: CoachPipelineRejectedMarket,
  max = 200,
): void {
  if (snapshot.rejections.length >= max) return;
  snapshot.rejections.push(rejection);
}

export function setPipelineStage(
  snapshot: CoachPipelineSnapshot,
  stage: CoachPipelineStageKey,
  count: number,
): void {
  snapshot.stages[stage] = count;
}

export function logCoachPipelineSnapshot(snapshot: CoachPipelineSnapshot): void {
  console.log(`${COACH_PIPELINE_LOG_PREFIX} ── filter pipeline ──`);
  for (const key of Object.keys(COACH_PIPELINE_STAGE_LABELS) as CoachPipelineStageKey[]) {
    const count = snapshot.stages[key];
    if (count == null) continue;
    console.log(`${COACH_PIPELINE_LOG_PREFIX} ${COACH_PIPELINE_STAGE_LABELS[key]}: ${count}`);
  }
  if (snapshot.relaxationsApplied.length) {
    console.log(
      `${COACH_PIPELINE_LOG_PREFIX} Relaxations applied: ${snapshot.relaxationsApplied.join(" → ")}`,
    );
  }
  for (const r of snapshot.rejections.slice(0, 50)) {
    console.log(
      `${COACH_PIPELINE_LOG_PREFIX} REJECT ${r.entity} | ${r.market} | edge=${fmt(r.edge)} conf=${fmt(r.confidence)} ev=${fmt(r.ev)} sim=${fmt(r.simulation)}% | ${r.reason}`,
    );
  }
  if (snapshot.rejections.length > 50) {
    console.log(
      `${COACH_PIPELINE_LOG_PREFIX} …and ${snapshot.rejections.length - 50} more rejections (see manifest)`,
    );
  }
}

function fmt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return String(v);
}

export function logDeliveryFilterStages(
  stages: Partial<Record<CoachPipelineStageKey, number>>,
  removed: Partial<Record<CoachPipelineStageKey, number>>,
): void {
  console.log(`${COACH_PIPELINE_LOG_PREFIX} ── delivery filter stages ──`);
  for (const key of Object.keys(COACH_PIPELINE_STAGE_LABELS) as CoachPipelineStageKey[]) {
    const remaining = stages[key];
    const dropped = removed[key];
    if (remaining == null && dropped == null) continue;
    const dropNote = dropped != null && dropped > 0 ? ` (removed ${dropped})` : "";
    console.log(
      `${COACH_PIPELINE_LOG_PREFIX} ${COACH_PIPELINE_STAGE_LABELS[key]}: ${remaining ?? "—"}${dropNote}`,
    );
  }
}

export function traceScoredPoolPipeline(
  scored: BoardScoredLeg[],
  snapshot: CoachPipelineSnapshot,
): void {
  const total = scored.length;
  setPipelineStage(snapshot, "downloaded", total);

  const afterValidation = scored.filter((leg) => {
    const p = leg.pick;
    return (
      p.odds != null &&
      Number.isFinite(p.odds) &&
      p.odds !== 0 &&
      String(p.game ?? "").trim() &&
      String(p.market ?? "").trim() &&
      String(p.pick ?? "").trim()
    );
  });
  setPipelineStage(snapshot, "afterValidation", afterValidation.length);

  const afterEv = afterValidation.filter((leg) => (leg.pick.finalAiScore?.edgePct ?? leg.edgePct ?? 0) > 0);
  setPipelineStage(snapshot, "afterEv", afterEv.length);

  const afterSim = afterEv.filter((leg) => pickHasSimGrade(leg.pick, leg.pick.finalAiScore?.simHit ?? leg.simHit));
  setPipelineStage(snapshot, "afterSimulation", afterSim.length);

  const afterConf = afterSim.filter((leg) => (leg.pick.finalAiScore?.confidencePct ?? leg.confidencePct ?? 0) > 0);
  setPipelineStage(snapshot, "afterConfidence", afterConf.length);

  setPipelineStage(snapshot, "afterCorrelation", afterConf.length);
  setPipelineStage(snapshot, "afterDuplicates", afterConf.length);
  setPipelineStage(snapshot, "beforeFinalSelection", afterConf.length);

  const removed = {
    afterValidation: total - afterValidation.length,
    afterEv: afterValidation.length - afterEv.length,
    afterSimulation: afterEv.length - afterSim.length,
    afterConfidence: afterSim.length - afterConf.length,
  };
  logDeliveryFilterStages(snapshot.stages, removed);
}

export function buildPipelineStagesFromManifest(manifest: {
  marketsFound: number;
  propsFound: number;
  propsEligibleForSim: number;
  candidatesBeforeGrading: number;
  marketsSimulated: number;
  totalEvaluated: number;
  totalQualified: number;
  rejectedCorrelation: number;
  rejectedDuplicates: number;
  rejectedLowConfidence: number;
  finalSelectedCount: number;
  deliveredLegs: number;
}): Partial<Record<CoachPipelineStageKey, number>> {
  const downloaded = manifest.marketsFound + Math.max(0, manifest.propsFound - manifest.marketsFound);
  return {
    downloaded: downloaded || manifest.marketsFound,
    afterValidation: manifest.propsEligibleForSim + Math.max(0, manifest.candidatesBeforeGrading - manifest.propsFound),
    afterPricing: manifest.candidatesBeforeGrading,
    afterEv: manifest.totalEvaluated,
    afterSimulation: manifest.marketsSimulated || manifest.totalEvaluated,
    afterConfidence: manifest.totalQualified,
    afterCorrelation: Math.max(0, manifest.totalQualified - manifest.rejectedCorrelation),
    afterDuplicates: Math.max(0, manifest.totalQualified - manifest.rejectedDuplicates),
    beforeFinalSelection: manifest.finalSelectedCount || manifest.deliveredLegs || manifest.totalQualified,
  };
}

export function rejectionFromScoredLeg(
  leg: BoardScoredLeg,
  stage: CoachPipelineStageKey,
  reason: string,
): CoachPipelineRejectedMarket {
  const pick = leg.pick;
  const score = pick.finalAiScore;
  return {
    entity: entityLabel(pick),
    market: String(pick.market ?? ""),
    ...metricsFromPick(pick, score),
    reason,
    stage,
  };
}

export function formatPipelineRejectionLine(r: CoachPipelineRejectedMarket): string {
  return `${r.entity} · ${r.market} · edge ${fmt(r.edge)}% · conf ${fmt(r.confidence)}% · EV ${fmt(r.ev)}% · sim ${fmt(r.simulation)}% — _${r.reason}_`;
}

export function pickSummaryForLog(pick: ParsedPick): string {
  return `${pickLabelForManifest(pick)} (${pick.market})`;
}

function explainUnselectedPoolReason(
  pick: ParsedPick,
  score: FinalAiScore | null | undefined,
): string {
  const delivery = explainDeliveryFilterRejection(pick, score);
  if (delivery) return delivery;
  const q = explainBoardLegQualification(pick, score);
  if (!q.qualifies) return gateToRejectionReason(q.gate, q.reason);
  return "Not selected — lower rank than delivered legs on this ticket";
}

/** Log why each positive-edge market in the scored pool was not delivered. */
export function logUnselectedScoredPoolMarkets(
  scored: BoardScoredLeg[],
  selected: ParsedPick[],
  snapshot: CoachPipelineSnapshot,
  max = 200,
): void {
  const kept = new Set(selected.map((p) => pickLegFingerprint(p)));
  const positive = positiveEdgeScoredLegs(scored);
  for (const leg of positive) {
    const fp = pickLegFingerprint(leg.pick);
    if (kept.has(fp)) continue;
    const reason = explainUnselectedPoolReason(leg.pick, leg.pick.finalAiScore);
    pushPipelineRejection(
      snapshot,
      rejectionFromScoredLeg(leg, "beforeFinalSelection", reason),
      max,
    );
  }
  const dropped = positive.length - selected.length;
  if (dropped > 0) {
    console.log(
      `${COACH_PIPELINE_LOG_PREFIX} Unselected positive-edge markets: ${dropped} (see manifest rejections)`,
    );
  }
}

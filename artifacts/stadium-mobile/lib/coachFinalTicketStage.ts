// Final ticket stage — instrumented delivery from correlated candidates to rendered slip.
// Only this stage is timed; each step logs timestamps and duration. Steps > 500ms log fn name.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { FullBoardScanResult } from "./boardMarketScanner.ts";
import { applyCoachTicketInvariants, coerceCoachDisplayPicks } from "./coachTicketKernel.ts";
import { pickLegFingerprint } from "./parlayReachCore.ts";
import type { CoachFlashEnrich } from "./pickScoreContext.ts";
import {
  boardScanStagedLegQualifies,
  coachFlashTicketPicks,
  filterCoachDeliveredPicks,
  topUpBoardBuiltTicket,
} from "./pickRecommendation.ts";
import { summarizeCoachTicket } from "./coachTicketSummary.ts";
import { tagTicketRoles } from "./ticketStaging.ts";
import { finalizeCoachDeliveryPicks } from "./ticketDiversity.ts";
import { isFillerBackfillPick } from "./coachScanPolicy.ts";

export const FINAL_TICKET_STAGE_SLOW_MS = 500;

export const FINAL_TICKET_STAGE_STEPS = [
  "final-candidate-list-received",
  "duplicate-removal",
  "quality-filtering",
  "alternate-replacement",
  "slip-assembly",
  "bet-slip-context-update",
  "ai-summary-creation",
  "render-complete",
] as const;

export type FinalTicketStageStep = (typeof FINAL_TICKET_STAGE_STEPS)[number];

export type FinalTicketStageTiming = {
  step: FinalTicketStageStep;
  fnName: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  slow: boolean;
};

export type CoachFinalTicketStageInput = {
  candidates: readonly ParsedPick[];
  enrich: CoachFlashEnrich;
  legTarget: number;
  scan?: FullBoardScanResult | null;
};

export type CoachFinalTicketStageResult = {
  picks: ParsedPick[];
  timings: FinalTicketStageTiming[];
  candidateCount: number;
  deliveredCount: number;
  salvageUsed: boolean;
  skippedLegs: number;
  replacedLegs: number;
};

export type CoachFinalTicketStageCallbacks = {
  captureFromCoach: (picks: ParsedPick[]) => void;
  onSlipReady?: (picks: ParsedPick[]) => void;
  onBetSlipContextUpdated?: () => void;
  onAiSummaryReady?: () => void;
  onRenderComplete?: () => void;
};

function pickRank(p: ParsedPick): number {
  return p.finalAiScore?.composite ?? p.scores?.composite ?? 0;
}

function rankFinalCandidates(candidates: readonly ParsedPick[]): ParsedPick[] {
  const mains: ParsedPick[] = [];
  const alts: ParsedPick[] = [];
  for (const p of candidates) {
    if (isFillerBackfillPick(p)) continue;
    if (p.ticketRole === "alt") alts.push(p);
    else mains.push(p);
  }
  mains.sort((a, b) => pickRank(b) - pickRank(a));
  alts.sort((a, b) => pickRank(b) - pickRank(a));
  return [...mains, ...alts];
}

function logStageTiming(timing: FinalTicketStageTiming): void {
  if (timing.slow) {
    console.log(
      `[coach-final-ticket-stage] SLOW ${timing.durationMs}ms fn=${timing.fnName} step=${timing.step}`,
    );
  }
  console.log("[coach-final-ticket-stage]", JSON.stringify(timing));
}

function runStep<T>(step: FinalTicketStageStep, fnName: string, fn: () => T): { value: T; timing: FinalTicketStageTiming } {
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  const value = fn();
  const durationMs = Math.round(performance.now() - t0);
  const timing: FinalTicketStageTiming = {
    step,
    fnName,
    startedAt,
    endedAt: new Date().toISOString(),
    durationMs,
    slow: durationMs > FINAL_TICKET_STAGE_SLOW_MS,
  };
  logStageTiming(timing);
  return { value, timing };
}

async function runStepAsync<T>(
  step: FinalTicketStageStep,
  fnName: string,
  fn: () => Promise<T>,
  fallback: T,
): Promise<{ value: T; timing: FinalTicketStageTiming }> {
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  let value = fallback;
  try {
    value = await fn();
  } catch (err) {
    console.warn(`[coach-final-ticket-stage] ${step} failed in ${fnName}`, err);
  }
  const durationMs = Math.round(performance.now() - t0);
  const timing: FinalTicketStageTiming = {
    step,
    fnName,
    startedAt,
    endedAt: new Date().toISOString(),
    durationMs,
    slow: durationMs > FINAL_TICKET_STAGE_SLOW_MS,
  };
  logStageTiming(timing);
  return { value, timing };
}

function tryProcessSingleLeg(pick: ParsedPick, enrich: CoachFlashEnrich): ParsedPick | null {
  try {
    const tagged = tagTicketRoles([pick]);
    const invariant = applyCoachTicketInvariants(tagged, enrich);
    if (!invariant.length) return null;
    const delivered = filterCoachDeliveredPicks(invariant, enrich);
    if (delivered.length) return delivered[0]!;
    return invariant[0] ?? null;
  } catch {
    return null;
  }
}

function removeDuplicateCandidates(candidates: ParsedPick[], enrich: CoachFlashEnrich): ParsedPick[] {
  try {
    const deduped = finalizeCoachDeliveryPicks(candidates, {
      simByGame: enrich.gameSimulations,
      matchupHistory: enrich.matchupHistory,
    });
    const seen = new Set<string>();
    const out: ParsedPick[] = [];
    for (const p of deduped) {
      const fp = pickLegFingerprint(p);
      if (seen.has(fp)) continue;
      seen.add(fp);
      out.push(p);
    }
    return out.length ? out : candidates;
  } catch {
    return candidates;
  }
}

function filterQualityCandidates(candidates: ParsedPick[], enrich: CoachFlashEnrich): ParsedPick[] {
  const qualified: ParsedPick[] = [];
  for (const p of candidates) {
    try {
      if (boardScanStagedLegQualifies(p, p.finalAiScore)) {
        qualified.push(p);
      }
    } catch {
      // skip leg
    }
  }
  if (qualified.length) return qualified;
  try {
    const delivered = filterCoachDeliveredPicks(candidates, enrich);
    if (delivered.length) return delivered;
  } catch {
    // fall through
  }
  return candidates;
}

function assembleResilientSlip(
  ranked: ParsedPick[],
  enrich: CoachFlashEnrich,
  legTarget: number,
): { picks: ParsedPick[]; skippedLegs: number; replacedLegs: number } {
  const used = new Set<string>();
  const slip: ParsedPick[] = [];
  let skippedLegs = 0;
  let replacedLegs = 0;

  for (const candidate of ranked) {
    if (legTarget > 0 && slip.length >= legTarget) break;
    const fp = pickLegFingerprint(candidate);
    if (used.has(fp)) continue;

    const leg = tryProcessSingleLeg(candidate, enrich);
    if (!leg) {
      skippedLegs += 1;
      continue;
    }

    const legFp = pickLegFingerprint(leg);
    if (used.has(legFp)) {
      skippedLegs += 1;
      continue;
    }

    const conflicts = slip.some(
      (existing) => pickLegFingerprint(existing) === legFp || existing.game === leg.game && existing.player === leg.player && leg.isProp && existing.isProp,
    );
    if (conflicts) {
      skippedLegs += 1;
      replacedLegs += 1;
      continue;
    }

    slip.push(leg);
    used.add(legFp);
  }

  if (legTarget > 0 && slip.length < legTarget) {
    try {
      const topped = topUpBoardBuiltTicket(slip, legTarget, ranked, enrich);
      if (topped.length > slip.length) {
        replacedLegs += topped.length - slip.length;
        return { picks: topped.slice(0, legTarget), skippedLegs, replacedLegs };
      }
    } catch {
      // keep partial slip
    }
  }

  return {
    picks: legTarget > 0 ? slip.slice(0, legTarget) : slip,
    skippedLegs,
    replacedLegs,
  };
}

function salvageFinalPicks(candidates: ParsedPick[], enrich: CoachFlashEnrich, legTarget: number): ParsedPick[] {
  const tagged = tagTicketRoles([...candidates]);
  const flash = coachFlashTicketPicks(tagged, enrich);
  if (flash.length) return legTarget > 0 ? flash.slice(0, legTarget) : flash;
  const coerced = coerceCoachDisplayPicks(tagged, enrich);
  if (coerced.length) return legTarget > 0 ? coerced.slice(0, legTarget) : coerced;
  return legTarget > 0 ? tagged.slice(0, legTarget) : tagged;
}

/**
 * Synchronous final-stage pipeline (steps 1–5). Returns picks ready for immediate UI render.
 * Never returns empty when candidates exist — salvages staged legs before giving up.
 */
export function runCoachFinalTicketStage(input: CoachFinalTicketStageInput): CoachFinalTicketStageResult {
  const timings: FinalTicketStageTiming[] = [];
  const { candidates, enrich, legTarget } = input;

  const step1 = runStep("final-candidate-list-received", "receiveFinalCandidates", () => {
    const list = candidates.filter((p) => !isFillerBackfillPick(p));
    return rankFinalCandidates(list);
  });
  timings.push(step1.timing);
  let ranked = step1.value;
  let salvageUsed = false;

  const step2 = runStep("duplicate-removal", "removeDuplicateCandidates", () =>
    removeDuplicateCandidates(ranked, enrich),
  );
  timings.push(step2.timing);
  ranked = step2.value;

  const step3 = runStep("quality-filtering", "filterQualityCandidates", () =>
    filterQualityCandidates(ranked, enrich),
  );
  timings.push(step3.timing);
  const qualityPool = step3.value.length ? step3.value : ranked;

  const step4 = runStep("alternate-replacement", "replaceWithAlternateCandidates", () => {
    const mains = qualityPool.filter((p) => p.ticketRole !== "alt");
    const alts = qualityPool.filter((p) => p.ticketRole === "alt");
    return [...rankFinalCandidates(mains), ...rankFinalCandidates(alts)];
  });
  timings.push(step4.timing);
  const replacementPool = step4.value;

  const step5 = runStep("slip-assembly", "assembleResilientSlip", () =>
    assembleResilientSlip(replacementPool, enrich, legTarget),
  );
  timings.push(step5.timing);
  let picks = step5.value.picks;

  if (!picks.length && candidates.length) {
    salvageUsed = true;
    picks = salvageFinalPicks([...candidates], enrich, legTarget);
  }

  return {
    picks,
    timings,
    candidateCount: candidates.length,
    deliveredCount: picks.length,
    salvageUsed,
    skippedLegs: step5.value.skippedLegs,
    replacedLegs: step5.value.replacedLegs,
  };
}

/**
 * Async completion (steps 6–8). Run after picks are on screen so the UI never waits at 93%.
 */
export async function completeCoachFinalTicketStage(
  picks: readonly ParsedPick[],
  callbacks: CoachFinalTicketStageCallbacks,
): Promise<FinalTicketStageTiming[]> {
  const timings: FinalTicketStageTiming[] = [];
  if (!picks.length) return timings;

  callbacks.onSlipReady?.([...picks]);

  const step6 = await runStepAsync(
    "bet-slip-context-update",
    "updateBetSlipContext",
    async () => {
      try {
        callbacks.captureFromCoach([...picks]);
      } catch (err) {
        console.warn("[coach-final-ticket-stage] captureFromCoach failed", err);
      }
      callbacks.onBetSlipContextUpdated?.();
      return true;
    },
    false,
  );
  timings.push(step6.timing);

  const step7 = await runStepAsync(
    "ai-summary-creation",
    "createAiSummary",
    async () => {
      try {
        summarizeCoachTicket(picks);
      } catch (err) {
        console.warn("[coach-final-ticket-stage] summarizeCoachTicket failed", err);
      }
      callbacks.onAiSummaryReady?.();
      return true;
    },
    false,
  );
  timings.push(step7.timing);

  const step8 = await runStepAsync(
    "render-complete",
    "markRenderComplete",
    async () => {
      callbacks.onRenderComplete?.();
      return true;
    },
    false,
  );
  timings.push(step8.timing);

  return timings;
}

/** Fire background analytics without blocking the caller. */
export function scheduleCoachFinalTicketStageBackground(
  picks: readonly ParsedPick[],
  callbacks: CoachFinalTicketStageCallbacks,
): void {
  void completeCoachFinalTicketStage(picks, callbacks).catch((err) => {
    console.warn("[coach-final-ticket-stage] background completion failed", err);
  });
}

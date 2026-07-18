// Coach pipeline finalization — resilient leg selection with staged logging.
// Hard rule: candidates.length > 0 ⇒ at least one pick card.

import type { ParsedPick } from "../components/PickCard.ts";
import { applyCoachTicketInvariants, coerceCoachDisplayPicks } from "./coachTicketKernel.ts";
import { isFillerBackfillPick } from "./coachScanPolicy.ts";
import { runCoachCorrelationSync } from "./coachCorrelation.ts";
import { logCoachRun } from "./coachRunTrace.ts";
import { pickLegFingerprint } from "./parlayReachCore.ts";
import type { CoachFlashEnrich } from "./pickScoreContext.ts";
import {
  boardScanStagedLegQualifies,
  coachFlashTicketPicks,
  filterCoachDeliveredPicks,
  topUpBoardBuiltTicket,
} from "./pickRecommendation.ts";
import { tagTicketRoles } from "./ticketStaging.ts";
import { finalizeCoachDeliveryPicks } from "./ticketDiversity.ts";

export type CoachPipelineFinalizeInput = {
  requestId: string;
  candidates: readonly ParsedPick[];
  enrich: CoachFlashEnrich;
  requestedLegs: number;
  /** When true, skip strict correlation pairing — take next-highest graded legs. */
  relaxCorrelation?: boolean;
};

export type CoachPipelineFinalizeResult = {
  picks: ParsedPick[];
  candidateCount: number;
  selectedCount: number;
  salvageUsed: boolean;
  shortfall: boolean;
};

function pickRank(p: ParsedPick): number {
  return p.finalAiScore?.composite ?? p.scores?.composite ?? 0;
}

function rankCandidates(candidates: readonly ParsedPick[]): ParsedPick[] {
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

function dedupeCandidates(candidates: ParsedPick[], enrich: CoachFlashEnrich): ParsedPick[] {
  const before = candidates.length;
  let out: ParsedPick[];
  try {
    out = finalizeCoachDeliveryPicks(candidates, {
      simByGame: enrich.gameSimulations,
      matchupHistory: enrich.matchupHistory,
    });
  } catch {
    out = candidates;
  }
  const seen = new Set<string>();
  const deduped: ParsedPick[] = [];
  for (const p of out) {
    const fp = pickLegFingerprint(p);
    if (seen.has(fp)) continue;
    seen.add(fp);
    deduped.push(p);
  }
  const result = deduped.length ? deduped : candidates;
  logCoachRun("deduped", { before, after: result.length });
  return result;
}

function qualityFilter(candidates: ParsedPick[], enrich: CoachFlashEnrich): ParsedPick[] {
  const before = candidates.length;
  const qualified: ParsedPick[] = [];
  for (const p of candidates) {
    try {
      if (boardScanStagedLegQualifies(p, p.finalAiScore)) qualified.push(p);
    } catch {
      // skip
    }
  }
  let after = qualified;
  if (!after.length) {
    try {
      const delivered = filterCoachDeliveredPicks(candidates, enrich);
      if (delivered.length) after = delivered;
    } catch {
      // fall through
    }
  }
  if (!after.length) after = candidates;
  logCoachRun("quality-filtered", { before, after: after.length });
  return after;
}

function tryLeg(pick: ParsedPick, enrich: CoachFlashEnrich): ParsedPick | null {
  try {
    const tagged = tagTicketRoles([pick]);
    const invariant = applyCoachTicketInvariants(tagged, enrich);
    if (!invariant.length) return null;
    const delivered = filterCoachDeliveredPicks(invariant, enrich);
    return delivered[0] ?? invariant[0] ?? null;
  } catch {
    return null;
  }
}

function assembleSlip(
  ranked: ParsedPick[],
  enrich: CoachFlashEnrich,
  legTarget: number,
): ParsedPick[] {
  const used = new Set<string>();
  const slip: ParsedPick[] = [];
  for (const candidate of ranked) {
    if (legTarget > 0 && slip.length >= legTarget) break;
    const fp = pickLegFingerprint(candidate);
    if (used.has(fp)) continue;
    const leg = tryLeg(candidate, enrich);
    if (!leg) continue;
    const legFp = pickLegFingerprint(leg);
    if (used.has(legFp)) continue;
    slip.push(leg);
    used.add(legFp);
  }
  if (legTarget > 0 && slip.length < legTarget) {
    try {
      const topped = topUpBoardBuiltTicket(slip, legTarget, ranked, enrich);
      if (topped.length > slip.length) return topped.slice(0, legTarget);
    } catch {
      // keep partial
    }
  }
  return legTarget > 0 ? slip.slice(0, legTarget) : slip;
}

function salvageCandidates(
  candidates: readonly ParsedPick[],
  enrich: CoachFlashEnrich,
  legTarget: number,
): ParsedPick[] {
  const tagged = tagTicketRoles([...candidates]);
  const flash = coachFlashTicketPicks(tagged, enrich);
  if (flash.length) return legTarget > 0 ? flash.slice(0, legTarget) : flash;
  const coerced = coerceCoachDisplayPicks(tagged, enrich);
  if (coerced.length) return legTarget > 0 ? coerced.slice(0, legTarget) : coerced;
  return legTarget > 0 ? tagged.slice(0, legTarget) : [...tagged];
}

/**
 * Final pipeline selection — never returns empty when candidates exist.
 * Fills from mains then alts; relaxes to next-highest graded posted picks on shortfall.
 */
export function finalizeCoachPipelineTickets(
  input: CoachPipelineFinalizeInput,
): CoachPipelineFinalizeResult {
  const { requestId, candidates, enrich, requestedLegs } = input;
  const candidateCount = candidates.length;

  logCoachRun("candidates-created", {
    requestId,
    count: candidateCount,
    requestedLegs,
  });

  if (!candidateCount) {
    logCoachRun("final-selection", { requestId, requested: requestedLegs, selected: 0 });
    return {
      picks: [],
      candidateCount: 0,
      selectedCount: 0,
      salvageUsed: false,
      shortfall: requestedLegs > 0,
    };
  }

  const ranked = rankCandidates(candidates);
  const deduped = dedupeCandidates(ranked, enrich);
  const filtered = qualityFilter(deduped, enrich);

  const mains = filtered.filter((p) => p.ticketRole !== "alt");
  const alts = filtered.filter((p) => p.ticketRole === "alt");
  const replacementPool = [...rankCandidates(mains), ...rankCandidates(alts)];

  let correlatedPool = replacementPool;
  if (!input.relaxCorrelation) {
    const correlation = runCoachCorrelationSync({
      requestId,
      candidates: replacementPool,
      requestedLegs: requestedLegs > 0 ? requestedLegs : replacementPool.length,
    });
    correlatedPool = correlation.picks.length ? correlation.picks : replacementPool;
    logCoachRun(correlation.outcome === "completed" ? "correlation-complete" : "correlation-skipped", {
      requestId,
      input: replacementPool.length,
      output: correlatedPool.length,
      outcome: correlation.outcome,
    });
  } else {
    logCoachRun("correlation-skipped", {
      requestId,
      input: replacementPool.length,
      output: replacementPool.length,
    });
  }

  let picks = assembleSlip(correlatedPool, enrich, requestedLegs);
  let salvageUsed = false;

  if (!picks.length) {
    picks = salvageCandidates(candidates, enrich, requestedLegs);
    salvageUsed = true;
  } else if (requestedLegs > 0 && picks.length < requestedLegs) {
    const topped = assembleSlip(
      rankCandidates([...candidates]),
      enrich,
      requestedLegs,
    );
    if (topped.length > picks.length) picks = topped;
  }

  if (!picks.length && candidateCount > 0) {
    picks = salvageCandidates(candidates, enrich, requestedLegs);
    salvageUsed = true;
  }

  const selectedCount = picks.length;
  const shortfall = requestedLegs > 0 && selectedCount < requestedLegs;

  logCoachRun("final-selection", {
    requestId,
    requested: requestedLegs,
    selected: selectedCount,
    salvageUsed,
    shortfall,
  });

  return {
    picks,
    candidateCount,
    selectedCount,
    salvageUsed,
    shortfall,
  };
}

/** Gate delivery picks — salvage instead of silently zeroing. */
export function resolveCoachDeliveryPicks(
  ticket: ParsedPick[],
  enrich: CoachFlashEnrich,
  opts: { requestId?: string; requestedLegs?: number; source?: string },
): ParsedPick[] {
  const strict = filterCoachDeliveredPicks(
    applyCoachTicketInvariants(tagTicketRoles(ticket), enrich),
    enrich,
  );
  if (strict.length) return strict;
  if (!ticket.length) return [];
  const salvaged = finalizeCoachPipelineTickets({
    requestId: opts.requestId ?? "",
    candidates: ticket,
    enrich,
    requestedLegs: opts.requestedLegs ?? ticket.length,
    relaxCorrelation: true,
  });
  logCoachRun("message-created", {
    requestId: opts.requestId,
    pickCount: salvaged.selectedCount,
    source: opts.source,
  });
  return salvaged.picks;
}

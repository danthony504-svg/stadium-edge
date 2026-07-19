// Per-request Coach result state — one final outcome per requestId.

import type { ParsedPick } from "../components/PickCard.ts";
import { COACH_EMPTY_BOARD_SCAN_LEAD } from "./coachBoardScanDelivery.ts";
import type { FinalAiScore } from "./finalAiScore.ts";

export type CoachResultOutcome =
  | "pending"
  | "success"
  | "partial-success"
  | "no-qualifying-picks"
  | "failed";

export type CoachResultRecord = {
  requestId: string;
  legTarget: number;
  outcome: CoachResultOutcome;
  selectedCount: number;
  pipelineComplete: boolean;
};

export type CoachAssistantMessageFields = {
  role: "assistant";
  content: string;
  picks?: ParsedPick[];
  legNote?: string;
  coachDetailNote?: string;
  ticketLegTarget?: number;
  parlayBuild?: boolean;
  retry?: string;
  coachRequestId?: string;
  coachResultPreliminary?: boolean;
  coachResultOutcome?: CoachResultOutcome;
};

const NO_PICKS_RE =
  /no legs cleared delivery gates|cleared the AI quality bar/i;

const byRequestId = new Map<string, CoachResultRecord>();

export function resetCoachResultStateForTests(): void {
  byRequestId.clear();
}

export function bindCoachResultRequest(requestId: string, legTarget: number): void {
  if (!requestId) return;
  byRequestId.set(requestId, {
    requestId,
    legTarget,
    outcome: "pending",
    selectedCount: 0,
    pipelineComplete: false,
  });
}

export function getCoachResultRecord(requestId: string | null | undefined): CoachResultRecord | null {
  if (!requestId) return null;
  return byRequestId.get(requestId) ?? null;
}

export function isCoachResultRequestStale(
  requestId: string,
  activeRequestId: string | null | undefined,
): boolean {
  return !!activeRequestId && requestId !== activeRequestId;
}

export function recordCoachPipelineComplete(
  requestId: string,
  selectedCount: number,
  legTarget?: number,
): CoachResultRecord | null {
  const record = byRequestId.get(requestId);
  if (!record || record.requestId !== requestId) return null;
  record.pipelineComplete = true;
  record.selectedCount = selectedCount;
  if (legTarget != null && legTarget > 0) record.legTarget = legTarget;
  if (selectedCount <= 0) {
    record.outcome = "no-qualifying-picks";
  } else if (record.legTarget > 0 && selectedCount < record.legTarget) {
    record.outcome = "partial-success";
  } else {
    record.outcome = "success";
  }
  return record;
}

/** True only after the full pipeline confirms zero deliverable picks. */
export function canPublishCoachNoPicksResult(requestId: string | null | undefined): boolean {
  const record = getCoachResultRecord(requestId);
  if (!record) return false;
  return record.pipelineComplete && record.selectedCount === 0;
}

export function isCoachNoPicksLead(text: string): boolean {
  return NO_PICKS_RE.test(text);
}

export function stripCoachNoPicksLead(text: string): string {
  if (!text.trim()) return "";
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !NO_PICKS_RE.test(line));
  return lines.join("\n\n");
}

export function coachNoPicksMessage(): string {
  return COACH_EMPTY_BOARD_SCAN_LEAD;
}

export function buildCoachSuccessLegNote(
  pickCount: number,
  legTarget: number,
  preliminary: boolean,
): string {
  if (pickCount <= 0) return "";
  const countLead =
    legTarget > 0 && pickCount < legTarget
      ? `**${pickCount}** of **${legTarget}** picks found`
      : `**${pickCount}** pick${pickCount === 1 ? "" : "s"} found`;
  if (!preliminary) return countLead;
  return `${countLead} — preliminary; some matchup/form signals are still loading.`;
}

const HOLISTIC_CONTEXT_KEYS = new Set([
  "matchup",
  "opponentTendency",
  "recentForm",
  "playingTime",
  "injury",
]);

export function missingHolisticSignalLabels(
  holistic: { factors: Array<{ key: string; label: string; applicable: boolean; present: boolean }> },
): string[] {
  return holistic.factors
    .filter((f) => f.applicable && !f.present && HOLISTIC_CONTEXT_KEYS.has(f.key))
    .map((f) => f.label);
}

export function pickHasThinHolisticContext(pick: ParsedPick): boolean {
  const holistic = pick.finalAiScore?.propHolistic;
  if (!holistic) return true;
  return holistic.missingCount >= 4;
}

export function ticketContextPreliminary(picks: readonly ParsedPick[]): {
  preliminary: boolean;
  missingSignalLabels: string[];
} {
  const labels = new Set<string>();
  let thinCount = 0;
  for (const pick of picks) {
    if (!pick.isProp) continue;
    const holistic = pick.finalAiScore?.propHolistic;
    if (!holistic || pickHasThinHolisticContext(pick)) {
      thinCount += 1;
      for (const label of missingHolisticSignalLabels(holistic ?? { factors: [] })) {
        labels.add(label);
      }
      continue;
    }
    for (const label of missingHolisticSignalLabels(holistic)) {
      labels.add(label);
    }
  }
  const propCount = picks.filter((p) => p.isProp).length;
  const preliminary = propCount > 0 && thinCount >= Math.ceil(propCount / 2);
  return {
    preliminary,
    missingSignalLabels: [...labels],
  };
}

export function preliminaryHolisticCoverageCaption(
  holistic: { coveragePct: number; missingCount: number },
  missingLabels: string[],
): string {
  if (holistic.missingCount <= 0) {
    return `${holistic.coveragePct}% context grounded`;
  }
  const unavailable =
    missingLabels.length > 0
      ? missingLabels.slice(0, 4).join(", ")
      : `${holistic.missingCount} signal${holistic.missingCount === 1 ? "" : "s"}`;
  return `Preliminary — ${holistic.coveragePct}% context grounded · unavailable: ${unavailable}`;
}

export function preliminaryGradeCaption(grade: string | null | undefined): string {
  const g = grade?.trim() || "B+";
  return `Preliminary ${g} based on simulation, market value, and available data.`;
}

export function pickShowsPreliminaryGrade(
  pick: ParsedPick,
  score: FinalAiScore | null | undefined,
): boolean {
  if (!pick.isProp) return false;
  const holistic = score?.propHolistic;
  if (!holistic) return true;
  return holistic.missingCount >= 4;
}

export function applyCoachResultToAssistantMessage(opts: {
  prev: CoachAssistantMessageFields;
  requestId: string;
  picks: ParsedPick[];
  legTarget: number;
  legNote?: string;
  coachDetailNote?: string;
  pipelineComplete: boolean;
}): CoachAssistantMessageFields | null {
  const { prev, requestId, picks, legTarget, pipelineComplete } = opts;
  const pickCount = picks.length;
  const context = ticketContextPreliminary(picks);

  if (!pipelineComplete && pickCount === 0) {
    return null;
  }

  const record = recordCoachPipelineComplete(requestId, pickCount, legTarget);
  const outcome = record?.outcome ?? (pickCount > 0 ? "success" : "no-qualifying-picks");

  if (pickCount === 0) {
    if (!canPublishCoachNoPicksResult(requestId)) return null;
    const detail = stripCoachNoPicksLead(opts.coachDetailNote ?? prev.coachDetailNote ?? "");
    return {
      role: "assistant",
      content: coachNoPicksMessage(),
      picks: [],
      legNote: stripCoachNoPicksLead(opts.legNote ?? prev.legNote ?? "") || undefined,
      coachDetailNote: detail || undefined,
      ticketLegTarget: legTarget > 0 ? legTarget : prev.ticketLegTarget,
      parlayBuild: prev.parlayBuild,
      retry: prev.retry,
      coachRequestId: requestId,
      coachResultPreliminary: false,
      coachResultOutcome: outcome,
    };
  }

  const successNote =
    buildCoachSuccessLegNote(pickCount, legTarget, context.preliminary) ||
    stripCoachNoPicksLead(opts.legNote ?? "");
  const detail = stripCoachNoPicksLead(opts.coachDetailNote ?? prev.coachDetailNote ?? "");

  return {
    role: "assistant",
    content: "",
    picks,
    legNote: successNote || undefined,
    coachDetailNote: detail || undefined,
    ticketLegTarget: legTarget > 0 ? legTarget : prev.ticketLegTarget,
    parlayBuild: prev.parlayBuild,
    retry: prev.retry,
    coachRequestId: requestId,
    coachResultPreliminary: context.preliminary,
    coachResultOutcome: outcome,
  };
}

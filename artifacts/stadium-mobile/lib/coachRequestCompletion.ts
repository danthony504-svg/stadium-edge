// Authoritative Coach request terminal state — one idempotent commit per requestId.

import type { ParsedPick } from "../components/PickCard.tsx";

export type CoachBuildPhase =
  | "idle"
  | "loading_board"
  | "scoring"
  | "correlation"
  | "finalizing"
  | "completed"
  | "empty"
  | "failed";

export type CoachTerminalKind = "completed" | "empty" | "failed";

export type CoachCompleteResult = {
  requestId: string;
  sendGeneration: number;
  terminal: CoachTerminalKind;
  picks: ParsedPick[];
  legNote?: string;
  coachDetailNote?: string;
  legTarget?: number;
};

let activeRequestId = "";
let activeSendGeneration = 0;
let currentPhase: CoachBuildPhase = "idle";
const completedKeys = new Set<string>();
const latestResults = new Map<string, CoachCompleteResult>();

export function coachCompletionKey(sendGeneration: number, requestId: string): string {
  return `${sendGeneration}:${requestId}`;
}

export function resetCoachRequestCompletion(): void {
  activeRequestId = "";
  activeSendGeneration = 0;
  currentPhase = "idle";
  completedKeys.clear();
  latestResults.clear();
}

export function registerActiveCoachRequest(requestId: string, sendGeneration: number): void {
  activeRequestId = requestId;
  activeSendGeneration = sendGeneration;
  currentPhase = "loading_board";
}

export function setCoachRequestPhase(phase: CoachBuildPhase, requestId?: string): void {
  if (requestId) activeRequestId = requestId;
  currentPhase = phase;
}

export function getCoachRequestPhase(): CoachBuildPhase {
  return currentPhase;
}

export function getLatestCoachCompleteResult(requestId: string): CoachCompleteResult | null {
  return latestResults.get(requestId) ?? null;
}

export function coachRequestWasCompleted(sendGeneration: number, requestId?: string | null): boolean {
  if (!requestId) return false;
  return completedKeys.has(coachCompletionKey(sendGeneration, requestId));
}

export function isStaleCoachRequest(requestId: string, sendGeneration: number): boolean {
  if (!requestId || !activeRequestId) return false;
  if (requestId !== activeRequestId) return true;
  return sendGeneration !== activeSendGeneration;
}

/**
 * Single terminal commit — idempotent per requestId + sendGeneration.
 * Rejects stale requestIds. Stores final result for diagnostics.
 */
export function completeCoachRequest(
  result: CoachCompleteResult,
  commit: () => void,
): boolean {
  if (!result.requestId) return false;

  latestResults.set(result.requestId, result);

  if (isStaleCoachRequest(result.requestId, result.sendGeneration)) {
    console.log("[coach-complete] rejected stale requestId", {
      requestId: result.requestId,
      activeRequestId,
      sendGeneration: result.sendGeneration,
      activeSendGeneration,
    });
    return false;
  }

  const key = coachCompletionKey(result.sendGeneration, result.requestId);
  if (completedKeys.has(key)) {
    console.log("[coach-complete] already committed", { requestId: result.requestId });
    return true;
  }

  currentPhase = "finalizing";
  commit();
  completedKeys.add(key);
  currentPhase =
    result.terminal === "failed"
      ? "failed"
      : result.picks.length > 0
        ? "completed"
        : "empty";

  console.log("[coach-complete] terminal committed", {
    requestId: result.requestId,
    terminal: currentPhase,
    pickCount: result.picks.length,
    progress: 100,
    finalTicketReady: result.picks.length > 0,
    isScanning: false,
  });
  return true;
}

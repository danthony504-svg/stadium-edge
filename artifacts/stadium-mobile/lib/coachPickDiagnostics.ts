/** Structured Coach pick-path diagnostics (Metro / device logs). */

export const COACH_PICK_DIAG = true;

import type { TieredFillSummary } from "./coachTicketTieredFill.ts";

export type CoachPickDiagStage =
  | "stream-request"
  | "stream-response"
  | "stream-error"
  | "board-scan-start"
  | "board-scan-partial"
  | "board-scan-complete"
  | "board-scan-stage"
  | "board-scan-timeout"
  | "board-scan-error"
  | "delivery-attempt"
  | "delivery-result"
  | "render-picks"
  | "dead-end";

export function logCoachPickDiag(
  stage: CoachPickDiagStage,
  detail: Record<string, unknown>,
): void {
  if (!COACH_PICK_DIAG) return;
  console.log(`[coach-pick-diag] ${stage}`, JSON.stringify({ at: new Date().toISOString(), ...detail }));
}

/** Human-readable tiered-fill lines matching device terminal [COACH] style. */
export function logCoachTieredFillDiag(
  target: number,
  delivered: number,
  summary: TieredFillSummary,
): void {
  if (!COACH_PICK_DIAG) return;
  console.log("[COACH] Scan board");
  console.log(`[COACH] Qualified picks: ${summary.strictQualifiedCount} found`);
  console.log(
    `[COACH] Elite picks (A+, Confidence >= 9): ${summary.eliteCount} found`,
  );
  if (summary.eliteCount < target) {
    console.log("[COACH] Expanding search... A or better, Confidence >= 8.5");
    console.log(`[COACH] Now found ${summary.expandedCount} qualified picks`);
  }
  if (summary.safetyFillCount > 0 || summary.expandedFillCount > 0) {
    console.log(
      `[COACH] Tiered fill (${summary.selectedPool}): safety=${summary.safetyFillCount} expandedFill=${summary.expandedFillCount}`,
    );
  }
  console.log(`[COACH] Return best ${delivered}.`);
  logCoachPickDiag("board-scan-complete", {
    stage: "tiered-fill",
    target,
    delivered,
    tieredFill: summary,
  });
}

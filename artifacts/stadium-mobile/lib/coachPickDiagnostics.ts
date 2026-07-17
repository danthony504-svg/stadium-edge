/** Structured Coach pick-path diagnostics (Metro / device logs). */

export const COACH_PICK_DIAG = true;

export type CoachPickDiagStage =
  | "stream-request"
  | "stream-response"
  | "stream-error"
  | "board-scan-start"
  | "board-scan-partial"
  | "board-scan-complete"
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

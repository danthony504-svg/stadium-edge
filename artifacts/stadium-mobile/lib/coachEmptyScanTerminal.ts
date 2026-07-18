// Terminal state when a final board scan exhausts with zero combinator output.

import type { FullBoardScanResult } from "./boardMarketScanner.ts";
import { boardScanIsComplete } from "./coachScanPolicy.ts";
import { logCoachPickDiag } from "./coachPickDiagnostics.ts";
import { summarizeBoardScanEmptyFromResult } from "./boardScanStageDiagnostics.ts";

export type BoardScanCombinatorMeta = {
  source: "preview" | "final" | "unknown";
  candidateCount: number;
  pickCount: number;
};

/** True only for a finished scan whose FINAL combinator produced zero candidates and zero picks. */
export function shouldFireEmptyScanTerminal(
  scan: FullBoardScanResult | null | undefined,
): boolean {
  if (!scan || !boardScanIsComplete(scan)) return false;
  const meta = scan.combinatorMeta;
  if (meta?.source === "preview") return false;
  const pickCount = meta?.pickCount ?? scan.picks?.length ?? 0;
  const candidateCount = meta?.candidateCount;
  if (meta?.source === "final") {
    return candidateCount === 0 && pickCount === 0;
  }
  return pickCount === 0;
}

export function logEmptyScanTerminalFired(
  scan: FullBoardScanResult,
  emptyReason: string,
): void {
  const meta = scan.combinatorMeta;
  logCoachPickDiag("empty-scan-terminal-fired", {
    scanComplete: scan.scanComplete === true,
    combinatorSource: meta?.source ?? "unknown",
    candidateCount: meta?.candidateCount ?? 0,
    pickCount: meta?.pickCount ?? scan.picks?.length ?? 0,
    emptyReason,
  });
}

export function emptyReasonForScan(scan: FullBoardScanResult): string {
  return summarizeBoardScanEmptyFromResult(scan);
}

/** Never let a preview partial replace a finished final scan snapshot. */
export function mergeBoardScanSnapshot(
  existing: FullBoardScanResult | null | undefined,
  incoming: FullBoardScanResult,
): FullBoardScanResult {
  if (!existing) return incoming;
  if (boardScanIsComplete(existing) && !boardScanIsComplete(incoming)) {
    return existing;
  }
  if (boardScanIsComplete(incoming)) return incoming;
  if ((incoming.picks?.length ?? 0) > (existing.picks?.length ?? 0)) return incoming;
  return existing;
}

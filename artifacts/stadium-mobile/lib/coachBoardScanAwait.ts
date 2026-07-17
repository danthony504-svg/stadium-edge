// Await an in-flight board scan until it settles — never time out mid-scan.

import type { FullBoardScanResult } from "./boardMarketScanner.ts";
import { logCoachPickDiag } from "./coachPickDiagnostics.ts";

/** Wait for the scan promise to finish. Respects abort; never returns early on a timer. */
export async function awaitBoardScanUntilComplete(
  inflight: Promise<FullBoardScanResult | null> | null | undefined,
  signal?: AbortSignal,
): Promise<FullBoardScanResult | null> {
  if (!inflight) return null;
  if (signal?.aborted) return null;

  logCoachPickDiag("delivery-attempt", { stage: "await-inflight-scan-until-complete" });

  return new Promise<FullBoardScanResult | null>((resolve) => {
    const onAbort = () => {
      signal?.removeEventListener("abort", onAbort);
      resolve(null);
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });

    inflight
      .then((result) => {
        signal?.removeEventListener("abort", onAbort);
        resolve(result);
      })
      .catch(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve(null);
      });
  });
}

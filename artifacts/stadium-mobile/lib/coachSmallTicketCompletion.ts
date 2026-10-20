import { marketFamily } from "./altLinePool.ts";
import type { ParsedPick } from "../components/PickCard.tsx";
import { qualifyCoachCandidate } from "./coach/qualifyCoachCandidate.ts";
import { AUTO_FREE_COACH_ASK, freeCoachAskForStyle } from "./coachAutoFreePreview.ts";

const autoAsks = new Set([AUTO_FREE_COACH_ASK, ...(["hot","easy","value","longshot"] as const).map(freeCoachAskForStyle)]);
export function isAutomaticFreeCoachAsk(ask: string | null | undefined): boolean {
  return autoAsks.has(String(ask ?? "").trim());
}
/** Only an already staged, diverse, fully qualified two-leg automatic ticket may finish early. */
export function canCompleteAutomaticSmallTicket(opts: { enabled?: boolean; target: number; picks: readonly ParsedPick[]; awaitingPropSlots?: boolean; propPhaseIncomplete?: boolean }): boolean {
  if (!opts.enabled || opts.target !== 2 || opts.picks.length !== 2 || opts.awaitingPropSlots || opts.propPhaseIncomplete) return false;
  if (!opts.picks.every(p => {
    const input = p as ParsedPick & { qualificationStatus?: "qualified" | "rejected" };
    return input.qualificationStatus !== "rejected" && qualifyCoachCandidate({ ...input, qualificationStatus: undefined }, { requestStyle: "normal" }).status === "qualified";
  })) return false;
  const families = opts.picks.map(p => p.isProp ? String(p.propMarketKey ?? "").toLowerCase().replace(/_alternate$/, "").trim() : marketFamily(p.market ?? ""));
  return families.every(Boolean) && new Set(families).size === 2;
}

/** Owned work is aborted on early completion; the caller's deadline/cancellation signal stays untouched. */
export async function runScanUntilTargetSatisfied<T>(parent: AbortSignal | undefined, enabled: boolean, work: (signal: AbortSignal | undefined, complete: (value: T) => void) => Promise<T>): Promise<T> {
  if (!enabled) return work(parent, () => {});
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parent?.aborted) abort(); else parent?.addEventListener("abort", abort, { once: true });
  let settled = false;
  let resolve!: (value: T) => void;
  const satisfied = new Promise<T>(r => { resolve = r; });
  const complete = (value: T) => {
    if (settled || controller.signal.aborted) return;
    settled = true;
    resolve(value);
    controller.abort();
  };
  try { const pending = work(controller.signal, complete).then(value => settled ? satisfied : value); return await Promise.race([pending, satisfied]); }
  finally { settled = true; parent?.removeEventListener("abort", abort); controller.abort(); }
}

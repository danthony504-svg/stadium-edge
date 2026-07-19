// Coach board-scan → ticket finalization lifecycle (requestId-scoped, idempotent).

export type CoachFinalizePhase =
  | "idle"
  | "correlating"
  | "finalizing"
  | "complete"
  | "empty"
  | "interrupted";

export type CoachFinalizeRecord = {
  requestId: string;
  requestedLegs: number;
  phase: CoachFinalizePhase;
  selectedCount: number;
  cardsSaved: boolean;
  correlationCompleteAt?: number;
  finalizedAt?: number;
  error?: string;
};

const STORAGE_KEY = "coach_finalize_v1";

const records = new Map<string, CoachFinalizeRecord>();
const finalizeLocks = new Map<string, "finalizing" | "done">();
let activeRequestId: string | null = null;

function log(event: string, requestId: string, extra?: Record<string, unknown>): void {
  const tail = extra ? ` ${JSON.stringify(extra)}` : "";
  console.log(`[coach-finalize] ${event} requestId=${requestId}${tail}`);
}

export function resetCoachFinalizeForTests(): void {
  records.clear();
  finalizeLocks.clear();
  activeRequestId = null;
}

export function beginCoachFinalizeRequest(requestId: string, requestedLegs: number): CoachFinalizeRecord {
  activeRequestId = requestId;
  const record: CoachFinalizeRecord = {
    requestId,
    requestedLegs,
    phase: "correlating",
    selectedCount: 0,
    cardsSaved: false,
  };
  records.set(requestId, record);
  return record;
}

export function getCoachFinalizeRecord(requestId: string | null | undefined): CoachFinalizeRecord | null {
  if (!requestId) return null;
  return records.get(requestId) ?? null;
}

export function getActiveCoachFinalizeRecord(): CoachFinalizeRecord | null {
  return activeRequestId ? records.get(activeRequestId) ?? null : null;
}

/** Board scan correlation finished — may trigger finalization once. */
export function markCoachCorrelationComplete(requestId: string): CoachFinalizeRecord | null {
  const record = records.get(requestId);
  if (!record) return null;
  if (record.phase === "complete" || record.phase === "empty" || record.phase === "interrupted") {
    return record;
  }
  record.phase = "correlating";
  record.correlationCompleteAt = Date.now();
  records.set(requestId, record);
  log("correlation-complete", requestId, { requestedLegs: record.requestedLegs });
  return record;
}

/**
 * Idempotent lock — first caller wins; blocks duplicate finalization for the same requestId.
 * Does not mark done until releaseCoachFinalizeLock(cardsSaved: true).
 */
export function tryAcquireCoachFinalizeLock(requestId: string): boolean {
  const state = finalizeLocks.get(requestId);
  if (state === "done" || state === "finalizing") return false;
  finalizeLocks.set(requestId, "finalizing");
  const record = records.get(requestId);
  if (record && record.phase !== "complete" && record.phase !== "empty") {
    record.phase = "finalizing";
    records.set(requestId, record);
  }
  log("start", requestId);
  return true;
}

export function releaseCoachFinalizeLock(requestId: string, cardsSaved: boolean): void {
  finalizeLocks.set(requestId, "done");
  const record = records.get(requestId);
  if (record) {
    record.cardsSaved = cardsSaved;
    records.set(requestId, record);
  }
}

export function isCoachFinalizeLocked(requestId: string): boolean {
  const state = finalizeLocks.get(requestId);
  return state === "finalizing" || state === "done";
}

export function markCoachFinalizeSelected(requestId: string, selectedCount: number): void {
  const record = records.get(requestId);
  if (!record) return;
  record.selectedCount = selectedCount;
  records.set(requestId, record);
  log("selected-count", requestId, { selectedCount });
}

export function markCoachFinalizeCardsSaved(requestId: string, selectedCount: number): void {
  const record = records.get(requestId);
  if (!record) return;
  record.selectedCount = selectedCount;
  record.cardsSaved = true;
  record.phase = selectedCount > 0 ? "complete" : "empty";
  record.finalizedAt = Date.now();
  records.set(requestId, record);
  releaseCoachFinalizeLock(requestId, true);
  log("cards-saved", requestId, { selectedCount });
  log("complete", requestId, { selectedCount, phase: record.phase });
}

export function markCoachFinalizeEmpty(requestId: string): void {
  const record = records.get(requestId);
  if (!record) return;
  record.selectedCount = 0;
  record.cardsSaved = true;
  record.phase = "empty";
  record.finalizedAt = Date.now();
  records.set(requestId, record);
  releaseCoachFinalizeLock(requestId, true);
  log("cards-saved", requestId, { selectedCount: 0 });
  log("complete", requestId, { selectedCount: 0, phase: "empty" });
}

export function markCoachFinalizeInterrupted(requestId: string, error?: string): void {
  const record = records.get(requestId);
  if (!record) return;
  record.phase = "interrupted";
  record.error = error ?? "Build interrupted";
  record.finalizedAt = Date.now();
  records.set(requestId, record);
  releaseCoachFinalizeLock(requestId, false);
  log("error", requestId, { error: record.error });
}

export function markCoachFinalizeError(requestId: string, error: string): void {
  markCoachFinalizeInterrupted(requestId, error);
}

/** Progress checklist index (0–9) derived from finalize phase — not a cosmetic timer. */
export function coachFinalizeWorkflowIndex(
  record: CoachFinalizeRecord | null,
  opts?: { scanComplete?: boolean; hasCards?: boolean },
): number {
  if (!record) return opts?.scanComplete ? 7 : 3;
  if (record.phase === "complete" || (record.phase === "empty" && record.cardsSaved)) return 9;
  if (record.phase === "interrupted") return 9;
  if (record.phase === "finalizing") return 8;
  if (record.correlationCompleteAt || opts?.scanComplete) return 7;
  if (record.phase === "correlating") return 6;
  return 3;
}

/** Percent complete from workflow index (matches AnalysisProgress TARGETS). */
const WORKFLOW_PERCENTS = [6, 16, 28, 40, 52, 64, 74, 84, 93, 100] as const;

export function coachFinalizeProgressPercent(workflowIndex: number): number {
  const idx = Math.max(0, Math.min(WORKFLOW_PERCENTS.length - 1, workflowIndex));
  return WORKFLOW_PERCENTS[idx];
}

export function coachFinalizeIsTerminal(record: CoachFinalizeRecord | null): boolean {
  if (!record) return false;
  return (
    record.phase === "complete" ||
    record.phase === "empty" ||
    record.phase === "interrupted"
  );
}

export function coachFinalizeShouldTimeout(record: CoachFinalizeRecord | null, now = Date.now()): boolean {
  if (!record || coachFinalizeIsTerminal(record)) return false;
  if (record.phase !== "correlating" && record.phase !== "finalizing") return false;
  const started = record.correlationCompleteAt ?? 0;
  if (!started) return false;
  return now - started > 15_000;
}

export async function persistCoachFinalize(record: CoachFinalizeRecord): Promise<void> {
  try {
    const { default: AsyncStorage } = await import("@react-native-async-storage/async-storage");
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    /* storage unavailable */
  }
}

export async function loadPersistedCoachFinalize(): Promise<CoachFinalizeRecord | null> {
  try {
    const { default: AsyncStorage } = await import("@react-native-async-storage/async-storage");
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CoachFinalizeRecord;
    if (!parsed?.requestId) return null;
    records.set(parsed.requestId, parsed);
    if (parsed.cardsSaved) finalizeLocks.set(parsed.requestId, "done");
    activeRequestId = parsed.requestId;
    return parsed;
  } catch {
    return null;
  }
}

export async function clearPersistedCoachFinalize(): Promise<void> {
  try {
    const { default: AsyncStorage } = await import("@react-native-async-storage/async-storage");
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export const COACH_NO_QUALIFYING_PICKS_LEAD =
  "_No qualifying picks found after correlation scoring — every posted market was scanned but none cleared delivery gates. Tap **Try again** to rerun the board scan._";

export const COACH_BUILD_INTERRUPTED_LEAD =
  "_Build interrupted — the ticket did not finish finalizing. Tap **Try again** to rerun the scan._";

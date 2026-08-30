import AsyncStorage from "@react-native-async-storage/async-storage";

const COACH_REQUEST_TRACE_KEY = "stadium-edge:coach-request-trace:v1";
const MAX_TRACE_EVENTS = 80;

export type CoachTraceStage =
  | "scan_start"
  | "game_sim_start"
  | "game_sim_complete"
  | "prop_expansion_start"
  | "prop_expansion_complete"
  | "prop_sim_start"
  | "prop_sim_complete"
  | "partial_candidates_emitted"
  | "qualification_complete"
  | "correlation_finished"
  | "final_selection_start"
  | "final_selection_complete"
  | "ticket_creation_start"
  | "ticket_creation_complete"
  | "state_update_start"
  | "state_update_complete"
  | "watchdog_fired"
  | "request_terminal";

export type CoachTraceEvent = {
  stage: CoachTraceStage;
  timestamp: string;
  elapsedMs: number;
  requestId: string;
  candidateCount: number;
  qualifiedCount: number;
  returnedPickCount: number;
  /** Prop-sim: how many candidates actually received deep MC. */
  simulatedCount?: number;
  /** Prop-sim: pre-rank/dedupe skips before deep MC. */
  skippedCount?: number;
  /** Stage wall duration when recorded by the scanner. */
  durationMs?: number;
  error?: string;
};

export type CoachRequestTrace = {
  requestId: string;
  startedAt: number;
  events: CoachTraceEvent[];
};

let currentTrace: CoachRequestTrace | null = null;

export function startCoachRequestTrace(requestId: string): void {
  currentTrace = { requestId, startedAt: Date.now(), events: [] };
  void persistCoachRequestTrace();
}

export function recordCoachRequestTrace(
  stage: CoachTraceStage,
  details: Partial<Omit<CoachTraceEvent, "stage" | "timestamp" | "elapsedMs" | "requestId">> & {
    requestId?: string;
  } = {},
): void {
  const requestId = details.requestId ?? currentTrace?.requestId ?? "";
  if (!currentTrace || (requestId && currentTrace.requestId !== requestId)) {
    currentTrace = { requestId, startedAt: Date.now(), events: [] };
  }
  const event: CoachTraceEvent = {
    stage,
    timestamp: new Date().toISOString(),
    elapsedMs: Date.now() - currentTrace.startedAt,
    requestId: currentTrace.requestId,
    candidateCount: details.candidateCount ?? 0,
    qualifiedCount: details.qualifiedCount ?? 0,
    returnedPickCount: details.returnedPickCount ?? 0,
    ...(details.simulatedCount != null ? { simulatedCount: details.simulatedCount } : {}),
    ...(details.skippedCount != null ? { skippedCount: details.skippedCount } : {}),
    ...(details.durationMs != null ? { durationMs: details.durationMs } : {}),
    ...(details.error ? { error: details.error } : {}),
  };
  currentTrace.events.push(event);
  while (currentTrace.events.length > MAX_TRACE_EVENTS) currentTrace.events.shift();
  void persistCoachRequestTrace();
}

async function persistCoachRequestTrace(): Promise<void> {
  try {
    await AsyncStorage.setItem(COACH_REQUEST_TRACE_KEY, JSON.stringify(currentTrace));
  } catch {
    // Diagnostics must never block or fail a Coach request.
  }
}

export async function loadCoachRequestTrace(): Promise<CoachRequestTrace | null> {
  if (currentTrace) return currentTrace;
  try {
    const raw = await AsyncStorage.getItem(COACH_REQUEST_TRACE_KEY);
    const parsed = raw ? (JSON.parse(raw) as CoachRequestTrace) : null;
    return parsed?.events && Array.isArray(parsed.events) ? parsed : null;
  } catch {
    return null;
  }
}

export function formatCoachRequestTrace(trace: CoachRequestTrace | null): string {
  if (!trace) return "No Coach request trace recorded yet.";
  return [
    `=== Coach request trace (${trace.requestId || "unknown"}) ===`,
    ...trace.events.map((event) =>
      [
        event.timestamp,
        `+${event.elapsedMs}ms`,
        event.stage,
        `request=${event.requestId || "unknown"}`,
        `candidates=${event.candidateCount}`,
        `qualified=${event.qualifiedCount}`,
        `returned=${event.returnedPickCount}`,
        event.simulatedCount != null ? `simulated=${event.simulatedCount}` : "",
        event.skippedCount != null ? `skipped=${event.skippedCount}` : "",
        event.durationMs != null ? `durationMs=${event.durationMs}` : "",
        event.error ? `error=${event.error}` : "",
      ]
        .filter(Boolean)
        .join(" "),
    ),
  ].join("\n");
}

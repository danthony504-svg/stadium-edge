import AsyncStorage from "@react-native-async-storage/async-storage";

const COACH_REQUEST_TRACE_KEY = "stadium-edge:coach-request-trace:v1";
const COACH_MARKET_AUDIT_KEY = "stadium-edge:coach-market-pipeline-audit:v2";
const LEGACY_COACH_MARKET_AUDIT_KEY = "stadium-edge:coach-market-pipeline-audit:v1";
const MAX_TRACE_EVENTS = 80;
// Diagnostics are retained only to investigate the current/recent requests.
// Keeping every full board audit indefinitely can exhaust AsyncStorage and
// render memory on production devices.
const MAX_RETAINED_MARKET_AUDITS = 3;

export type CoachTraceStage =
  | "UI_REQUEST_STARTED"
  | "UI_PARTIAL_RESULTS_RENDERED"
  | "UI_INTERACTION_ENABLED"
  | "UI_FINAL_RESULTS_RENDERED"
  | "UI_REQUEST_COMPLETE"
  | "UI_LONG_TASK"
  | "requested_leg_count_reached"
  | "final_ticket_committed"
  | "ui_loading_flags_cleared"
  | "background_scan_continuing"
  | "late_partial_ignored_after_terminal"
  | "coach_bulk_add_pressed"
  | "coach_bulk_add_source_count"
  | "coach_bulk_add_existing_count"
  | "coach_bulk_add_added_count"
  | "coach_bulk_add_final_slip_count"
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
let tracePersistTimer: ReturnType<typeof setTimeout> | null = null;
type MarketAudit = { requestId?: string; [key: string]: unknown };
export type CoachTicketFinalizationAudit = {
  requestedLegs: number;
  qualifiedPoolSize: number;
  preCorrelationCount: number;
  postCorrelationCount: number;
  postDedupeCount: number;
  postVarietyCount: number;
  preFinalizationCount: number;
  finalTicketCount: number;
  removals: Array<{ selection: string; removalStage: string; removalReason: string }>;
};
let marketAuditsByRequestId = new Map<string, MarketAudit>();
let completedMarketAuditRequestId = "";
const frozenMarketAuditRequestIds = new Set<string>();

function frozenAuditCopy(audit: MarketAudit): MarketAudit {
  return JSON.parse(JSON.stringify(audit)) as MarketAudit;
}

export function startCoachRequestTrace(requestId: string): void {
  currentTrace = { requestId, startedAt: Date.now(), events: [] };
  scheduleCoachRequestTracePersist(true);
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
  scheduleCoachRequestTracePersist(
    stage === "request_terminal" || stage === "UI_REQUEST_COMPLETE",
  );
}

function scheduleCoachRequestTracePersist(immediate = false): void {
  if (immediate) {
    if (tracePersistTimer) clearTimeout(tracePersistTimer);
    tracePersistTimer = null;
    void persistCoachRequestTrace();
    return;
  }
  if (tracePersistTimer) return;
  tracePersistTimer = setTimeout(() => {
    tracePersistTimer = null;
    void persistCoachRequestTrace();
  }, 500);
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

function persistMarketAuditStore(): void {
  void AsyncStorage.setItem(
    COACH_MARKET_AUDIT_KEY,
    JSON.stringify({
      completedRequestId: completedMarketAuditRequestId,
      audits: Object.fromEntries(marketAuditsByRequestId),
    }),
  ).catch(() => {});
}

function trimMarketAudits(): void {
  while (marketAuditsByRequestId.size > MAX_RETAINED_MARKET_AUDITS) {
    const removableId = [...marketAuditsByRequestId.keys()].find(
      (id) => id !== completedMarketAuditRequestId,
    );
    if (!removableId) break;
    marketAuditsByRequestId.delete(removableId);
  }
}

export function persistCoachMarketPipelineAudit(audit: MarketAudit): void {
  const requestId = audit.requestId?.trim();
  if (!requestId || requestId === "unknown") return;
  // A request reaches its terminal state exactly once. Late callbacks from a
  // cancelled scan can carry the same request ID, so protect the completed
  // snapshot as well as protecting it from "unknown" background scans.
  if (frozenMarketAuditRequestIds.has(requestId)) return;
  marketAuditsByRequestId.set(requestId, audit);
  trimMarketAudits();
  persistMarketAuditStore();
}

export function freezeCoachMarketPipelineAudit(requestId: string | null | undefined): void {
  const id = requestId?.trim();
  if (!id || id === "unknown") return;
  const audit = marketAuditsByRequestId.get(id);
  if (audit) marketAuditsByRequestId.set(id, frozenAuditCopy(audit));
  frozenMarketAuditRequestIds.add(id);
  completedMarketAuditRequestId = id;
  trimMarketAudits();
  persistMarketAuditStore();
}

/** Attach delivery-only counts after final ticket invariants run. */
export function recordCoachTicketFinalizationAudit(
  requestId: string | null | undefined,
  finalization: CoachTicketFinalizationAudit,
): void {
  const id = requestId?.trim();
  if (!id || id === "unknown" || frozenMarketAuditRequestIds.has(id)) return;
  const audit = marketAuditsByRequestId.get(id);
  if (!audit) return;
  marketAuditsByRequestId.set(id, { ...audit, finalization });
  persistMarketAuditStore();
}

export async function loadCoachMarketPipelineAudit<T>(): Promise<T | null> {
  if (completedMarketAuditRequestId) {
    return (marketAuditsByRequestId.get(completedMarketAuditRequestId) as T | undefined) ?? null;
  }
  try {
    const raw = await AsyncStorage.getItem(COACH_MARKET_AUDIT_KEY);
    const parsed = raw
      ? (JSON.parse(raw) as { completedRequestId?: string; audits?: Record<string, MarketAudit> })
      : null;
    if (parsed?.completedRequestId && parsed.audits?.[parsed.completedRequestId]) {
      completedMarketAuditRequestId = parsed.completedRequestId;
      marketAuditsByRequestId = new Map(Object.entries(parsed.audits));
      trimMarketAudits();
      return marketAuditsByRequestId.get(completedMarketAuditRequestId) as T;
    }

    // v1 kept only a global latest audit. Migrate a valid completed request once;
    // unknown scans were never safe diagnostics and remain intentionally ignored.
    const legacyRaw = await AsyncStorage.getItem(LEGACY_COACH_MARKET_AUDIT_KEY);
    const legacyAudit = legacyRaw ? (JSON.parse(legacyRaw) as MarketAudit) : null;
    if (!legacyAudit) return null;
    const legacyRequestId = legacyAudit.requestId?.trim();
    if (!legacyRequestId || legacyRequestId === "unknown") return null;
    marketAuditsByRequestId.set(legacyRequestId, legacyAudit);
    completedMarketAuditRequestId = legacyRequestId;
    persistMarketAuditStore();
    return legacyAudit as T;
  } catch {
    return null;
  }
}

export function resetCoachMarketAuditStorageForTests(): void {
  marketAuditsByRequestId = new Map();
  completedMarketAuditRequestId = "";
  frozenMarketAuditRequestIds.clear();
  if (tracePersistTimer) clearTimeout(tracePersistTimer);
  tracePersistTimer = null;
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

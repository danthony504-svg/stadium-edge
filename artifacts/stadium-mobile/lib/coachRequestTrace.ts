import AsyncStorage from "@react-native-async-storage/async-storage";

const COACH_REQUEST_TRACE_KEY = "stadium-edge:coach-request-trace:v1";
const COACH_MARKET_AUDIT_KEY = "stadium-edge:coach-market-pipeline-audit:v2";
const LEGACY_COACH_MARKET_AUDIT_KEY = "stadium-edge:coach-market-pipeline-audit:v1";
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
type MarketAudit = { requestId?: string; [key: string]: unknown };
let marketAuditsByRequestId = new Map<string, MarketAudit>();
let completedMarketAuditRequestId = "";
const frozenMarketAuditRequestIds = new Set<string>();

function frozenAuditCopy(audit: MarketAudit): MarketAudit {
  return JSON.parse(JSON.stringify(audit)) as MarketAudit;
}

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

function persistMarketAuditStore(): void {
  void AsyncStorage.setItem(
    COACH_MARKET_AUDIT_KEY,
    JSON.stringify({
      completedRequestId: completedMarketAuditRequestId,
      audits: Object.fromEntries(marketAuditsByRequestId),
    }),
  ).catch(() => {});
}

export function persistCoachMarketPipelineAudit(audit: MarketAudit): void {
  const requestId = audit.requestId?.trim();
  if (!requestId || requestId === "unknown") return;
  // A request reaches its terminal state exactly once. Late callbacks from a
  // cancelled scan can carry the same request ID, so protect the completed
  // snapshot as well as protecting it from "unknown" background scans.
  if (frozenMarketAuditRequestIds.has(requestId)) return;
  marketAuditsByRequestId.set(requestId, audit);
  persistMarketAuditStore();
}

export function freezeCoachMarketPipelineAudit(requestId: string | null | undefined): void {
  const id = requestId?.trim();
  if (!id || id === "unknown") return;
  const audit = marketAuditsByRequestId.get(id);
  if (audit) marketAuditsByRequestId.set(id, frozenAuditCopy(audit));
  frozenMarketAuditRequestIds.add(id);
  completedMarketAuditRequestId = id;
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

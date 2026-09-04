/** Client-side +500 Steals scan lifecycle tracing (console + optional UI hooks). */

export type StealScanLogKind =
  | "start"
  | "stage-update"
  | "stats-update"
  | "terminal"
  | "duplicate-update-blocked"
  | "cleanup";

export type StealScanLifecycleStage =
  | "request_start"
  | "response_received"
  | "parse_ok"
  | "feed_degraded"
  | "http_error"
  | "network_error"
  | "scan_complete"
  | "scan_incomplete"
  | "ui_state";

export type StealScanLifecycleEvent = {
  stage: StealScanLifecycleStage;
  at: string;
  endpoint: string;
  httpStatus?: number | null;
  responseTimeMs?: number;
  scanComplete?: boolean;
  booksScanned?: number;
  marketsChecked?: number;
  longshotsAnalyzed?: number;
  stealsFound?: number;
  feedDegraded?: boolean;
  isScanning?: boolean;
  isError?: boolean;
  error?: string | null;
  detail?: string;
};

export type StealScanStatsSnapshot = {
  sportsbookCount: number | null;
  gameCount: number | null;
  marketCount: number | null;
  lastScanAt: string | number | null;
  available: boolean;
};

let lastEvent: StealScanLifecycleEvent | null = null;
const listeners = new Set<(event: StealScanLifecycleEvent) => void>();

export function logStealsScan(
  kind: StealScanLogKind,
  detail: Record<string, string | number | boolean | null | undefined>,
): void {
  const parts = [
    "[steals-scan]",
    kind,
    ...Object.entries(detail)
      .filter(([, v]) => v != null && v !== "")
      .map(([k, v]) => `${k}=${typeof v === "string" ? v : String(v)}`),
  ];
  console.info(parts.join(" "));
}

export function logStealScanLifecycle(
  partial: Omit<StealScanLifecycleEvent, "at"> & { at?: string },
): StealScanLifecycleEvent {
  const event: StealScanLifecycleEvent = {
    at: partial.at ?? new Date().toISOString(),
    ...partial,
  };
  lastEvent = event;
  const parts = [
    "[steals-scan]",
    `stage=${event.stage}`,
    `endpoint=${event.endpoint}`,
    event.httpStatus != null ? `status=${event.httpStatus}` : null,
    event.responseTimeMs != null ? `ms=${event.responseTimeMs}` : null,
    event.scanComplete != null ? `complete=${event.scanComplete}` : null,
    event.isScanning != null ? `scanning=${event.isScanning}` : null,
    event.booksScanned != null ? `books=${event.booksScanned}` : null,
    event.marketsChecked != null ? `markets=${event.marketsChecked}` : null,
    event.longshotsAnalyzed != null ? `longshots=${event.longshotsAnalyzed}` : null,
    event.stealsFound != null ? `found=${event.stealsFound}` : null,
    event.feedDegraded != null ? `degraded=${event.feedDegraded}` : null,
    event.isError != null ? `error_state=${event.isError}` : null,
    event.error ? `reason=${event.error}` : null,
    event.detail ? `detail=${event.detail}` : null,
  ].filter(Boolean);
  console.info(parts.join(" "));
  for (const listener of listeners) listener(event);
  return event;
}

export function getLastStealScanLifecycleEvent(): StealScanLifecycleEvent | null {
  return lastEvent;
}

export function subscribeStealScanLifecycle(
  listener: (event: StealScanLifecycleEvent) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Authoritative Coach parlay build lifecycle — single completion gate + ordered logs.

export const COACH_LIFECYCLE_LOG = "[coach-lifecycle]";

export type CoachLifecycleEvent =
  | "request-start"
  | "board-scan-start"
  | "board-scan-complete"
  | "scoring-complete"
  | "correlation-complete"
  | "delivery-complete"
  | "cards-committed"
  | "build-complete";

const LIFECYCLE_ORDER: CoachLifecycleEvent[] = [
  "request-start",
  "board-scan-start",
  "board-scan-complete",
  "scoring-complete",
  "correlation-complete",
  "delivery-complete",
  "cards-committed",
  "build-complete",
];

let activeRequestId: string | undefined;
let lastEvent: CoachLifecycleEvent | undefined;
let buildCompleteLogged = false;
let deliveryCompleteLogged = false;
let cardsCommittedLogged = false;
let boardScanInFlightCount = 0;

function emit(event: CoachLifecycleEvent, requestId?: string): void {
  if (event === "build-complete") {
    if (buildCompleteLogged) return;
    buildCompleteLogged = true;
  }
  lastEvent = event;
  const rid = requestId ?? activeRequestId ?? "—";
  console.log(`${COACH_LIFECYCLE_LOG} ${event} requestId=${rid}`);
}

export function coachLifecycleRequestStart(requestId: string): void {
  activeRequestId = requestId;
  lastEvent = undefined;
  buildCompleteLogged = false;
  deliveryCompleteLogged = false;
  cardsCommittedLogged = false;
  boardScanInFlightCount = 0;
  emit("request-start", requestId);
}

export function coachLifecycleBoardScanStart(requestId?: string): void {
  boardScanInFlightCount += 1;
  emit("board-scan-start", requestId);
}

export function coachLifecycleBoardScanEnd(
  scan: { scanComplete?: boolean } | null | undefined,
  requestId?: string,
): void {
  boardScanInFlightCount = Math.max(0, boardScanInFlightCount - 1);
  if (!scan?.scanComplete) return;
  emit("board-scan-complete", requestId);
  emit("scoring-complete", requestId);
  emit("correlation-complete", requestId);
}

export function coachLifecycleDeliveryComplete(requestId?: string): void {
  if (deliveryCompleteLogged) return;
  deliveryCompleteLogged = true;
  emit("delivery-complete", requestId);
}

export function coachLifecycleCardsCommitted(requestId?: string): void {
  if (cardsCommittedLogged) return;
  cardsCommittedLogged = true;
  emit("cards-committed", requestId);
}

export function coachLifecycleBuildComplete(requestId?: string): void {
  emit("build-complete", requestId);
  activeRequestId = undefined;
  lastEvent = undefined;
  boardScanInFlightCount = 0;
}

export function coachLifecycleIsBuildComplete(): boolean {
  return buildCompleteLogged;
}

export function coachLifecycleHasActiveBoardScan(): boolean {
  return boardScanInFlightCount > 0;
}

export function coachLifecycleLastEvent(): CoachLifecycleEvent | undefined {
  return lastEvent;
}

export function coachLifecycleExpectedOrder(): readonly CoachLifecycleEvent[] {
  return LIFECYCLE_ORDER;
}

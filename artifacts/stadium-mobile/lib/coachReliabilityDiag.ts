/**
 * Temporary observe-only diagnostics for /reliability/coach-events.
 * Logs only — does not change classification, selection, grading, sim, UI, or Telegram rules.
 * Remove after the grounding / underfill production trace is confirmed.
 */

export type CoachRelDiagPick = {
  player?: string | null;
  teamAbbr?: string | null;
  game?: string | null;
  market?: string | null;
};

const DIAG_PREFIX = "[coach-rel-diag]";

/** Public athlete / market labels only — never tokens, emails, or auth material. */
function safeLabel(value: unknown, max = 80): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, max);
}

export function newCoachRelCorrelationId(): string {
  const rand =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `crdiag-${Date.now()}-${rand}`;
}

export function coachRelDiagPickSnapshots(
  picks: readonly CoachRelDiagPick[] | null | undefined,
  limit = 12,
): Array<{
  player: string | null;
  teamAbbr: string | null;
  game: string | null;
  market: string | null;
}> {
  if (!picks?.length) return [];
  return picks.slice(0, limit).map((p) => ({
    player: safeLabel(p.player, 60),
    teamAbbr: safeLabel(p.teamAbbr, 8),
    game: safeLabel(p.game, 120),
    market: safeLabel(p.market, 60),
  }));
}

export function logCoachRelDiagCall(opts: {
  correlationId: string;
  requestId: string | null;
  eventTypeCandidate: string | null;
  returnedPickCount: number;
  picks?: readonly CoachRelDiagPick[] | null;
}): void {
  try {
    console.info(DIAG_PREFIX, "call", {
      correlationId: opts.correlationId,
      requestId: opts.requestId,
      eventTypeCandidate: opts.eventTypeCandidate,
      returnedPickCount: opts.returnedPickCount,
      picks: coachRelDiagPickSnapshots(opts.picks),
    });
  } catch {
    // Fail soft — diagnostics must never break Coach.
  }
}

export function logCoachRelDiagPostResult(opts: {
  correlationId: string;
  requestId: string | null;
  httpStatus: number | null;
  success: boolean;
  error?: string | null;
}): void {
  try {
    console.info(DIAG_PREFIX, "post", {
      correlationId: opts.correlationId,
      requestId: opts.requestId,
      httpStatus: opts.httpStatus,
      success: opts.success,
      ...(opts.error ? { error: safeLabel(opts.error, 80) } : {}),
    });
  } catch {
    // Fail soft.
  }
}

// Pure decision logic for the background-finished AI Coach build path, factored
// out of routes/chat.ts (which keeps the model alive after the client socket
// drops) and coachBuild.ts (which persists the outcome + fires the push). Like
// coachBuildSweep.ts this is deliberately side-effect-free and import-free so it
// can be unit-tested without a model stream, a socket, or a database. The
// db/SSE-coupled callers map these decisions onto real I/O.
//
// Invariant carried by construction: a partial / aborted / stalled build
// delivers NO picks. The only outcome that stashes a deliverable ticket is
// `stashReady`; every failure outcome stashes a TERMINAL STATUS with no
// full/props (honesty — a half-finished parlay is never delivered).

// The terminal outcome of a background-eligible Coach build, independent of how
// it was reached (clean completion vs. thrown error / watchdog abort).
export type BackgroundOutcome =
  // The client never left — the ticket streamed live in-app. Nothing to stash;
  // the caller only retires the in-flight marker.
  | { kind: "deliveredLive" }
  // The client walked away but the model finished with usable text — stash the
  // completed reply + prop pool as status:"ready".
  | { kind: "stashReady" }
  // The client walked away and the build ended without a usable ticket — stash a
  // TERMINAL STATUS only (no full/props). `timedOut` = the background watchdog
  // aborted a stalled upstream; `failed` = an error or an empty completion.
  | { kind: "stashFailure"; status: "failed" | "timedOut" }
  // A live client hit an error — show the inline error and retire the marker.
  | { kind: "liveError" }
  // Socket already gone / response already ended — do nothing.
  | { kind: "silent" };

// COMPLETION PATH: the upstream stream finished WITHOUT throwing. Called only
// for a background-eligible build (the caller wraps this in `if (bgUserId)`).
// - client still present  -> delivered live, just clear the marker
// - client gone + usable  -> ready (the one outcome that carries a ticket)
// - client gone + nothing -> failed (empty completion is not a deliverable)
export function decideCompletionOutcome(opts: {
  clientGone: boolean;
  hasUsableText: boolean;
}): BackgroundOutcome {
  if (!opts.clientGone) return { kind: "deliveredLive" };
  if (opts.hasUsableText) return { kind: "stashReady" };
  return { kind: "stashFailure", status: "failed" };
}

// ERROR / ABORT PATH: the upstream stream threw — the background watchdog
// aborted a stall (watchdogAborted), the upstream errored, or the client abort
// fired. `bgEligible` is whether this was a background-finish build at all
// (notifyOnBackground + signed in); only those persist a terminal failure.
// Mirrors the leading conditionals of the chat.ts catch block exactly.
export function decideErrorOutcome(opts: {
  clientGone: boolean;
  bgEligible: boolean;
  writableEnded: boolean;
  destroyed: boolean;
  watchdogAborted: boolean;
}): BackgroundOutcome {
  // Background build the user walked away from: persist a terminal status (never
  // a partial ticket) so the client shows a deterministic "couldn't finish".
  if (opts.clientGone && opts.bgEligible && !opts.writableEnded) {
    return { kind: "stashFailure", status: opts.watchdogAborted ? "timedOut" : "failed" };
  }
  // Client disconnected (non-bg, so we aborted ourselves) or the response is
  // already finished — any accumulated reply is incomplete, so stay silent.
  if (opts.clientGone || opts.writableEnded || opts.destroyed) {
    return { kind: "silent" };
  }
  // Live client is still watching — surface the inline error.
  return { kind: "liveError" };
}

// BACKGROUND-MODE WATCHDOG. Once the client is gone we keep the model alive, so
// a hung upstream would run forever. Two ceilings end it: an IDLE cutoff (no
// token for a while) and an absolute MAX wall-clock. CRITICAL: `lastUpstream
// Chunk` must be the timestamp of the last UPSTREAM token, NOT the socket-gated
// `lastActivity` (which freezes once the client leaves and would falsely abort a
// still-streaming build). A breach drives a `timedOut` terminal status.
export function shouldWatchdogAbort(opts: {
  now: number;
  lastUpstreamChunk: number;
  bgStart: number;
  idleMs: number;
  maxMs: number;
}): boolean {
  return (
    opts.now - opts.lastUpstreamChunk >= opts.idleMs ||
    opts.now - opts.bgStart >= opts.maxMs
  );
}

// At-most-once push idempotency keys, shared by the live handler AND the cron
// sweeper so two observers of the same dead build can't double-send. The keys
// are STABLE per (user, build) — the db unique constraint collapses retries into
// one push — and the ready/failed namespaces are DISTINCT so a success push and
// a failure push for the same build can never collide.
export function coachReadyDedupeKey(userId: string, buildId: string): string {
  return `coachReady:${userId}:${buildId}`;
}

export function coachFailedDedupeKey(userId: string, buildId: string): string {
  return `coachFailed:${userId}:${buildId}`;
}

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideCompletionOutcome,
  decideErrorOutcome,
  shouldWatchdogAbort,
  coachReadyDedupeKey,
  coachFailedDedupeKey,
  type BackgroundOutcome,
} from "../src/lib/coachBuildFinish.ts";

// ---- completion path (the stream finished WITHOUT throwing) -----------------

test("completed build after disconnect with usable text => stash status:ready (the only outcome that carries a ticket)", () => {
  const outcome = decideCompletionOutcome({ clientGone: true, hasUsableText: true });
  assert.deepEqual(outcome, { kind: "stashReady" });
});

test("completed build after disconnect with NO usable text => stash status:failed (empty completion is not deliverable)", () => {
  const outcome = decideCompletionOutcome({ clientGone: true, hasUsableText: false });
  assert.deepEqual(outcome, { kind: "stashFailure", status: "failed" });
});

test("completed build while the client is still present => delivered live, nothing stashed", () => {
  // With or without text: a live client already received it; we only retire the
  // in-flight marker, never stash.
  assert.deepEqual(
    decideCompletionOutcome({ clientGone: false, hasUsableText: true }),
    { kind: "deliveredLive" },
  );
  assert.deepEqual(
    decideCompletionOutcome({ clientGone: false, hasUsableText: false }),
    { kind: "deliveredLive" },
  );
});

// Honesty rule, asserted at the type/shape level: no completion outcome ever
// carries a ticket payload except `stashReady`; every failure is status-only.
test("completion honesty: only stashReady is a deliverable; failures carry status only", () => {
  const outcomes: BackgroundOutcome[] = [
    decideCompletionOutcome({ clientGone: true, hasUsableText: true }),
    decideCompletionOutcome({ clientGone: true, hasUsableText: false }),
    decideCompletionOutcome({ clientGone: false, hasUsableText: true }),
  ];
  for (const o of outcomes) {
    if (o.kind === "stashFailure") {
      // No full/props field exists on a failure outcome — it is status-only.
      assert.ok(!("full" in o) && !("props" in o));
      assert.ok(o.status === "failed" || o.status === "timedOut");
    }
  }
});

// ---- error / abort path (the stream THREW) ---------------------------------

test("watchdog abort after disconnect => stash status:timedOut with NO ticket", () => {
  const outcome = decideErrorOutcome({
    clientGone: true,
    bgEligible: true,
    writableEnded: false,
    destroyed: false,
    watchdogAborted: true,
  });
  assert.deepEqual(outcome, { kind: "stashFailure", status: "timedOut" });
  // honesty: a failure outcome never carries full/props
  assert.ok(!("full" in outcome) && !("props" in outcome));
});

test("upstream error after disconnect (NOT a watchdog abort) => stash status:failed", () => {
  const outcome = decideErrorOutcome({
    clientGone: true,
    bgEligible: true,
    writableEnded: false,
    destroyed: false,
    watchdogAborted: false,
  });
  assert.deepEqual(outcome, { kind: "stashFailure", status: "failed" });
});

test("error on a non-background build (anonymous / not opted in) after disconnect => silent, never stashes", () => {
  const outcome = decideErrorOutcome({
    clientGone: true,
    bgEligible: false,
    writableEnded: false,
    destroyed: false,
    watchdogAborted: true,
  });
  assert.deepEqual(outcome, { kind: "silent" });
});

test("error after the response already finished => silent (no double-stash on a delivered build)", () => {
  assert.deepEqual(
    decideErrorOutcome({
      clientGone: true,
      bgEligible: true,
      writableEnded: true,
      destroyed: false,
      watchdogAborted: true,
    }),
    { kind: "silent" },
  );
  assert.deepEqual(
    decideErrorOutcome({
      clientGone: false,
      bgEligible: true,
      writableEnded: false,
      destroyed: true,
      watchdogAborted: false,
    }),
    { kind: "silent" },
  );
});

test("live-client error (client still watching) => liveError (inline message, no stash)", () => {
  const outcome = decideErrorOutcome({
    clientGone: false,
    bgEligible: true,
    writableEnded: false,
    destroyed: false,
    watchdogAborted: false,
  });
  assert.deepEqual(outcome, { kind: "liveError" });
});

// ---- background watchdog trigger -------------------------------------------

const NOW = Date.parse("2026-06-13T12:00:00.000Z");
const IDLE = 60_000; // mirrors BG_IDLE_MS
const MAX = 240_000; // mirrors BG_MAX_MS

test("watchdog does NOT abort a build that is still streaming (recent token, well within max)", () => {
  assert.equal(
    shouldWatchdogAbort({
      now: NOW,
      lastUpstreamChunk: NOW - (IDLE - 1000),
      bgStart: NOW - (MAX - 1000),
      idleMs: IDLE,
      maxMs: MAX,
    }),
    false,
  );
});

test("watchdog aborts on the IDLE cutoff (no upstream token for too long)", () => {
  assert.equal(
    shouldWatchdogAbort({
      now: NOW,
      lastUpstreamChunk: NOW - IDLE,
      bgStart: NOW - (MAX - 1000), // still under the wall-clock max
      idleMs: IDLE,
      maxMs: MAX,
    }),
    true,
  );
});

test("watchdog aborts on the absolute MAX wall-clock even if tokens are still arriving", () => {
  assert.equal(
    shouldWatchdogAbort({
      now: NOW,
      lastUpstreamChunk: NOW - 1000, // a token arrived 1s ago (not idle)
      bgStart: NOW - MAX,
      idleMs: IDLE,
      maxMs: MAX,
    }),
    true,
  );
});

// The idle-source trap that cost a review rejection: the watchdog measures the
// last UPSTREAM token, not the socket-gated lastActivity. A long build that is
// still producing tokens (recent lastUpstreamChunk) must NOT be aborted just
// because the client socket — and thus lastActivity — froze long ago.
test("watchdog ignores a frozen socket clock: still-progressing upstream is never falsely aborted", () => {
  const socketFrozenLongAgo = NOW - 10 * IDLE; // lastActivity-style value (stale)
  // The build is genuinely progressing: a token arrived just now, started recently.
  assert.equal(
    shouldWatchdogAbort({
      now: NOW,
      lastUpstreamChunk: NOW - 500,
      bgStart: NOW - 30_000,
      idleMs: IDLE,
      maxMs: MAX,
    }),
    false,
  );
  // Sanity: had we (wrongly) fed the frozen socket clock as the idle source, it
  // WOULD have aborted — proving the distinction matters.
  assert.equal(
    shouldWatchdogAbort({
      now: NOW,
      lastUpstreamChunk: socketFrozenLongAgo,
      bgStart: NOW - 30_000,
      idleMs: IDLE,
      maxMs: MAX,
    }),
    true,
  );
});

// ---- push dedupe keys (at-most-once per build) -----------------------------

test("dedupe keys are STABLE per (user, build) so a retry / second disconnect can't double-send", () => {
  // Same inputs -> identical key. The db unique constraint then collapses two
  // push attempts for the same build into a single delivery (at most once).
  assert.equal(
    coachReadyDedupeKey("user_1", "build_abc"),
    coachReadyDedupeKey("user_1", "build_abc"),
  );
  assert.equal(
    coachFailedDedupeKey("user_1", "build_abc"),
    coachFailedDedupeKey("user_1", "build_abc"),
  );
});

test("ready and failed dedupe keys are DISTINCT for the same build (success and failure pushes never collide)", () => {
  assert.notEqual(
    coachReadyDedupeKey("user_1", "build_abc"),
    coachFailedDedupeKey("user_1", "build_abc"),
  );
});

test("dedupe keys vary by user AND by build (no cross-build / cross-user collapse)", () => {
  const keys = new Set([
    coachReadyDedupeKey("user_1", "build_a"),
    coachReadyDedupeKey("user_1", "build_b"),
    coachReadyDedupeKey("user_2", "build_a"),
    coachFailedDedupeKey("user_1", "build_a"),
    coachFailedDedupeKey("user_1", "build_b"),
    coachFailedDedupeKey("user_2", "build_a"),
  ]);
  // All six are unique — different user or build or namespace each.
  assert.equal(keys.size, 6);
});

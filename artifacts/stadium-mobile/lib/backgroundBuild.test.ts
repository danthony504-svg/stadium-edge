import assert from "node:assert/strict";
import { test } from "node:test";

import {
  decideBackgroundRestore,
  deserializePendingBuild,
  makeBuildId,
  serializePendingBuild,
  shouldAbortForHandoff,
  shouldHandOffBuild,
  type CoachBuildStashShape,
  type PendingBuildShape,
} from "./backgroundBuild.ts";

// ---- makeBuildId -----------------------------------------------------------

test("makeBuildId returns a non-empty string and is unique across calls", () => {
  const ids = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    const id = makeBuildId();
    assert.equal(typeof id, "string");
    assert.ok(id.length > 0);
    ids.add(id);
  }
  assert.equal(ids.size, 1000);
});

// ---- pending-build serialize / deserialize ---------------------------------

type Ctx = { games: number };
type Prop = { player: string };
type Meta = { home: string };
type Pending = PendingBuildShape<Ctx, Prop, Meta> & { createdAt: number };

const samplePending: Pending = {
  buildId: "abc123",
  userText: "build me a 5 leg parlay",
  context: { games: 7 },
  propPool: [{ player: "Doncic" }],
  gameMeta: [{ home: "DAL" }],
  todayOnly: true,
  createdAt: 1718200000000,
};

test("serialize -> deserialize round-trips a pending build verbatim", () => {
  const raw = serializePendingBuild(samplePending);
  const back = deserializePendingBuild<Pending>(raw);
  assert.deepEqual(back, samplePending);
});

test("deserializePendingBuild returns null for missing/empty/corrupt data", () => {
  assert.equal(deserializePendingBuild<Pending>(null), null);
  assert.equal(deserializePendingBuild<Pending>(undefined), null);
  assert.equal(deserializePendingBuild<Pending>(""), null);
  assert.equal(deserializePendingBuild<Pending>("{not json"), null);
});

// ---- handoff eligibility (when a disconnect hands off vs. aborts) -----------

test("a signed-in parlay build is eligible to hand off", () => {
  assert.equal(shouldHandOffBuild({ isParlayBuild: true, isSignedIn: true }), true);
});

test("a non-parlay or anonymous build does NOT hand off", () => {
  // anonymous parlay build → no per-user stash, stream in-app only
  assert.equal(shouldHandOffBuild({ isParlayBuild: true, isSignedIn: false }), false);
  // signed-in non-parlay chat → nothing to finish server-side
  assert.equal(shouldHandOffBuild({ isParlayBuild: false, isSignedIn: true }), false);
  assert.equal(shouldHandOffBuild({ isParlayBuild: false, isSignedIn: false }), false);
});

test("background event only triggers a handoff abort when streaming AND eligible", () => {
  assert.equal(
    shouldAbortForHandoff({ streaming: true, hasPendingBackground: true }),
    true,
  );
  // streaming but it wasn't a background-eligible build → no handoff
  assert.equal(
    shouldAbortForHandoff({ streaming: true, hasPendingBackground: false }),
    false,
  );
  // eligible but nothing in flight → nothing to hand off
  assert.equal(
    shouldAbortForHandoff({ streaming: false, hasPendingBackground: true }),
    false,
  );
  assert.equal(
    shouldAbortForHandoff({ streaming: false, hasPendingBackground: false }),
    false,
  );
});

// ---- restore / replay decision ---------------------------------------------

type Stash = CoachBuildStashShape<{ player: string }>;

const readyStash: Stash = {
  buildId: "abc123",
  status: "ready",
  full: "PICK Lakers ML\nGreat ticket.",
  props: [{ player: "Doncic" }],
};

test("replay reuses the server stash VERBATIM without re-calling the model", () => {
  const decision = decideBackgroundRestore("abc123", samplePending, readyStash);
  assert.equal(decision.action, "replay");
  if (decision.action !== "replay") return;
  // The reply text + props come straight from the stash — same references.
  assert.equal(decision.payload.full, readyStash.full);
  assert.equal(decision.payload.props, readyStash.props);
  // The context halves come from the locally-saved pending build (no re-fetch).
  assert.equal(decision.payload.context, samplePending.context);
  assert.equal(decision.payload.propPool, samplePending.propPool);
  assert.equal(decision.payload.gameMeta, samplePending.gameMeta);
  assert.equal(decision.payload.todayOnly, samplePending.todayOnly);
});

test("replay tolerates a stash with no props (empty array, never fabricated)", () => {
  const decision = decideBackgroundRestore(
    "abc123",
    samplePending,
    { buildId: "abc123", status: "ready", full: "PICK X" },
  );
  assert.equal(decision.action, "replay");
  if (decision.action !== "replay") return;
  assert.deepEqual(decision.payload.props, []);
});

test("missing or mismatched local pending → wrong-device (rebuild only where started)", () => {
  assert.equal(
    decideBackgroundRestore("abc123", null, readyStash).action,
    "wrong-device",
  );
  const otherPending = { ...samplePending, buildId: "different" };
  assert.equal(
    decideBackgroundRestore("abc123", otherPending, readyStash).action,
    "wrong-device",
  );
});

test("missing / mismatched / empty stash → not-ready (retry later, no fabrication)", () => {
  assert.equal(
    decideBackgroundRestore("abc123", samplePending, null).action,
    "not-ready",
  );
  assert.equal(
    decideBackgroundRestore(
      "abc123",
      samplePending,
      { ...readyStash, buildId: "different" },
    ).action,
    "not-ready",
  );
  // empty/whitespace full means still finishing
  assert.equal(
    decideBackgroundRestore(
      "abc123",
      samplePending,
      { buildId: "abc123", status: "ready", full: "   " },
    ).action,
    "not-ready",
  );
});

test("terminal failure status surfaces a recovery decision carrying the prompt", () => {
  for (const status of ["timedOut", "failed"] as const) {
    const decision = decideBackgroundRestore(
      "abc123",
      samplePending,
      { buildId: "abc123", status, full: "" },
    );
    assert.equal(decision.action, "failed");
    if (decision.action !== "failed") continue;
    assert.equal(decision.status, status);
    // retry uses the ORIGINAL user prompt — never an invented one.
    assert.equal(decision.retryText, samplePending.userText);
  }
});

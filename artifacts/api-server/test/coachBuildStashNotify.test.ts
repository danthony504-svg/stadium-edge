import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  stashAndNotifyBackgroundBuild,
  stashBackgroundBuildFailure,
  COACH_BUILD_NS,
} from "../src/lib/coachBuild.ts";
import {
  coachReadyDedupeKey,
  coachFailedDedupeKey,
} from "../src/lib/coachBuildFinish.ts";
import { __control, resetDb } from "./fakes/db.ts";
import { __push, resetPush } from "./fakes/push.ts";

// Integration-style coverage of the DB side of background-build delivery: the
// stash row shape, the in-flight marker clear, the notif-prefs gating, and the
// at-most-once notif_log claim. The @workspace/db / push.js / drizzle-orm
// imports inside coachBuild.ts are redirected to in-memory fakes by
// ./register-hooks.mjs (loaded via `node --import`), so these run with no real
// Postgres and no live Expo push.

const log = { error() {}, warn() {} };

beforeEach(() => {
  resetDb();
  resetPush();
});

// ---- stashAndNotifyBackgroundBuild: success path ----------------------------

test("ready: writes the stash row with the right shape (status:ready + ticket payload)", async () => {
  await stashAndNotifyBackgroundBuild({
    userId: "user_1",
    buildId: "build_a",
    full: "Here is your 3-leg parlay…",
    props: [{ id: "p1" }, { id: "p2" }],
    log,
  });

  assert.equal(__control.writes.userSync.length, 1, "exactly one stash upsert");
  const row = __control.writes.userSync[0];
  assert.equal(row.userId, "user_1");
  assert.equal(row.namespace, COACH_BUILD_NS);
  assert.ok(row.updatedAt instanceof Date, "updatedAt is a Date");
  const data = row.data as Record<string, unknown>;
  assert.deepEqual(data, {
    buildId: "build_a",
    status: "ready",
    full: "Here is your 3-leg parlay…",
    props: [{ id: "p1" }, { id: "p2" }],
    createdAt: data.createdAt,
  });
  assert.equal(typeof data.createdAt, "string");
});

test("ready: clears the in-flight pending marker", async () => {
  await stashAndNotifyBackgroundBuild({
    userId: "user_1",
    buildId: "build_a",
    full: "ticket",
    props: [],
    log,
  });
  // clearBackgroundBuildPending deletes the userSync (pending-namespace) row.
  assert.equal(__control.deletes.userSync, 1, "pending marker cleared once");
});

test("ready: fires exactly one push with the correct title + deep-link data", async () => {
  await stashAndNotifyBackgroundBuild({
    userId: "user_1",
    buildId: "build_a",
    full: "ticket",
    props: [],
    log,
  });

  assert.equal(__push.calls.length, 1, "one push send");
  const messages = __push.calls[0];
  assert.equal(messages.length, 1, "one message per token");
  assert.equal(messages[0].to, "tok_1");
  assert.equal(messages[0].title, "Your parlay is ready");
  assert.deepEqual(messages[0].data, { type: "coachReady", buildId: "build_a" });
  // The dedupe claim was recorded under the ready key.
  assert.ok(__control.notifLogKeys.has(coachReadyDedupeKey("user_1", "build_a")));
});

// ---- notif-prefs gating -----------------------------------------------------

test("ready: master mute suppresses the push but STILL stashes", async () => {
  __control.notifPrefsRows = [{ data: { master: false } }];
  await stashAndNotifyBackgroundBuild({
    userId: "user_1",
    buildId: "build_a",
    full: "ticket",
    props: [],
    log,
  });

  assert.equal(__push.calls.length, 0, "no push when globally muted");
  assert.equal(__control.writes.userSync.length, 1, "stash still written");
  assert.equal(__control.deletes.userSync, 1, "marker still cleared");
  assert.equal(__control.notifLogKeys.size, 0, "no dedupe claim when suppressed");
});

test("ready: coachReady=false suppresses the push but STILL stashes", async () => {
  __control.notifPrefsRows = [{ data: { coachReady: false } }];
  await stashAndNotifyBackgroundBuild({
    userId: "user_1",
    buildId: "build_a",
    full: "ticket",
    props: [],
    log,
  });

  assert.equal(__push.calls.length, 0, "no push when coachReady toggled off");
  assert.equal(__control.writes.userSync.length, 1, "stash still written");
});

test("ready: no push tokens => stash + claim happen, no send", async () => {
  __control.tokenRows = [];
  await stashAndNotifyBackgroundBuild({
    userId: "user_1",
    buildId: "build_a",
    full: "ticket",
    props: [],
    log,
  });
  assert.equal(__push.calls.length, 0, "nothing to send to");
  assert.equal(__control.writes.userSync.length, 1, "stash still written");
});

// ---- at-most-once dedupe ----------------------------------------------------

test("ready: a second call for the same buildId does NOT send a second push", async () => {
  const args = {
    userId: "user_1",
    buildId: "build_a",
    full: "ticket",
    props: [] as unknown[],
    log,
  };
  await stashAndNotifyBackgroundBuild(args);
  await stashAndNotifyBackgroundBuild(args);

  assert.equal(__push.calls.length, 1, "push fired at most once for the build");
  // Both calls still wrote the (latest-wins) stash — only the push is deduped.
  assert.equal(__control.writes.userSync.length, 2, "stash is idempotent-upsert, not deduped");
});

test("ready: distinct buildIds each get their own push", async () => {
  await stashAndNotifyBackgroundBuild({ userId: "user_1", buildId: "build_a", full: "t", props: [], log });
  await stashAndNotifyBackgroundBuild({ userId: "user_1", buildId: "build_b", full: "t", props: [], log });
  assert.equal(__push.calls.length, 2, "a different build is a different push");
});

// ---- stashBackgroundBuildFailure --------------------------------------------

test("failure: stashes a status-only terminal row (NO full/props) and clears the marker", async () => {
  await stashBackgroundBuildFailure({
    userId: "user_1",
    buildId: "build_a",
    status: "timedOut",
    log,
  });

  assert.equal(__control.writes.userSync.length, 1);
  const row = __control.writes.userSync[0];
  assert.equal(row.namespace, COACH_BUILD_NS);
  const data = row.data as Record<string, unknown>;
  assert.equal(data.buildId, "build_a");
  assert.equal(data.status, "timedOut");
  assert.equal(typeof data.createdAt, "string");
  // Honesty: a failure is never a deliverable ticket.
  assert.ok(!("full" in data) && !("props" in data));
  assert.equal(__control.deletes.userSync, 1, "marker cleared");
});

test("failure: fires one push with the failure copy under the coachFailed key", async () => {
  await stashBackgroundBuildFailure({
    userId: "user_1",
    buildId: "build_a",
    status: "failed",
    log,
  });

  assert.equal(__push.calls.length, 1);
  const messages = __push.calls[0];
  assert.equal(messages[0].title, "Couldn't finish your parlay");
  assert.deepEqual(messages[0].data, { type: "coachReady", buildId: "build_a" });
  assert.ok(__control.notifLogKeys.has(coachFailedDedupeKey("user_1", "build_a")));
});

test("failure: master mute suppresses the push but STILL stashes the terminal status", async () => {
  __control.notifPrefsRows = [{ data: { master: false } }];
  await stashBackgroundBuildFailure({
    userId: "user_1",
    buildId: "build_a",
    status: "failed",
    log,
  });
  assert.equal(__push.calls.length, 0);
  assert.equal(__control.writes.userSync.length, 1, "terminal status still stashed");
});

test("failure: a second call for the same buildId does NOT send a second push", async () => {
  const args = {
    userId: "user_1",
    buildId: "build_a",
    status: "failed" as const,
    log,
  };
  await stashBackgroundBuildFailure(args);
  await stashBackgroundBuildFailure(args);
  assert.equal(__push.calls.length, 1, "failure push fired at most once");
});

test("failure and ready keys are independent: both can fire once for the same build", async () => {
  // Distinct dedupe namespaces mean a ready push and a failure push for the same
  // buildId never collapse into one another.
  await stashAndNotifyBackgroundBuild({ userId: "user_1", buildId: "build_a", full: "t", props: [], log });
  await stashBackgroundBuildFailure({ userId: "user_1", buildId: "build_a", status: "failed", log });
  assert.equal(__push.calls.length, 2, "ready + failure are separate at-most-once claims");
  assert.equal(__push.calls[0][0].title, "Your parlay is ready");
  assert.equal(__push.calls[1][0].title, "Couldn't finish your parlay");
});

// ---- dead-token prune (push returned invalid tokens) ------------------------

test("ready: invalid tokens returned by sendPush are pruned", async () => {
  __control.tokenRows = [{ token: "tok_dead" }];
  __push.invalidTokens = ["tok_dead"];
  await stashAndNotifyBackgroundBuild({
    userId: "user_1",
    buildId: "build_a",
    full: "ticket",
    props: [],
    log,
  });
  assert.equal(__control.deletes.pushTokens, 1, "dead token row deleted");
});

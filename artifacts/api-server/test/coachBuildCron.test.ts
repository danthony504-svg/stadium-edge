import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  sweepAbandonedCoachBuilds,
  pruneOldCoachBuilds,
  COACH_BUILD_NS,
  COACH_BUILD_STALE_MS,
  COACH_BUILD_RETENTION_MS,
} from "../src/lib/coachBuild.ts";
import { coachFailedDedupeKey } from "../src/lib/coachBuildFinish.ts";
import { __control, resetDb } from "./fakes/db.ts";
import { __push, resetPush } from "./fakes/push.ts";

// Integration-style coverage of the DB side of the abandoned-build CRON jobs:
// the sweeper that finalizes builds the live handler died on
// (sweepAbandonedCoachBuilds) and the pruner that deletes aged terminal records
// (pruneOldCoachBuilds). The pure decision logic is unit-tested in
// coachBuildSweep.test.ts / coachBuildPrune.test.ts; here we exercise the actual
// db wiring (which rows are selected, finalized, cleared, deleted) against the
// in-memory fake harness — so it runs in CI with no Postgres, unlike the
// DATABASE_URL-gated real-DB test in coachBuildSweepIntegration.test.ts.
//
// coachBuild.ts's @workspace/db / push.js / drizzle-orm imports are redirected
// to the fakes under ./fakes by ./register-hooks.mjs (loaded via `node
// --import`); the drizzle fake captures structured predicate nodes so the fake
// db can route the three user_sync SELECTs and evaluate the pruner's DELETEs.

const log = { error() {}, warn() {} };
const staleIso = () => new Date(Date.now() - COACH_BUILD_STALE_MS - 60_000).toISOString();
const freshIso = () => new Date().toISOString();

beforeEach(() => {
  resetDb();
  resetPush();
});

// ---- sweepAbandonedCoachBuilds ----------------------------------------------

test("sweep: a stale marker with no terminal stash is finalized as a failure", async () => {
  __control.markerRows = [
    { userId: "uA", data: { buildId: "bA", createdAt: staleIso() }, updatedAt: new Date() },
  ];

  const swept = await sweepAbandonedCoachBuilds(log);

  assert.equal(swept, 1, "the abandoned build was swept into a failure");
  assert.equal(__control.writes.userSync.length, 1, "one terminal stash written");
  const w = __control.writes.userSync[0];
  assert.equal(w.namespace, COACH_BUILD_NS);
  const data = w.data as Record<string, unknown>;
  assert.equal(data.status, "failed", "terminal failure status");
  assert.equal(data.buildId, "bA", "stash carries the abandoned buildId");
  // Honesty: a swept build is NEVER a deliverable ticket.
  assert.ok(!("full" in data) && !("props" in data), "no full/props on a failure");
  // The in-flight marker is retired and exactly one coachFailed push is claimed.
  assert.ok(__control.deletes.userSync >= 1, "marker cleared");
  assert.ok(
    __control.notifLogKeys.has(coachFailedDedupeKey("uA", "bA")),
    "exactly one coachFailed claim",
  );
  assert.equal(__push.calls.length, 1, "one failure push fired");
  assert.equal(__push.calls[0][0].title, "Couldn't finish your parlay");
});

test("sweep: a stale marker whose build already has a 'ready' stash only retires the marker", async () => {
  __control.markerRows = [
    { userId: "uB", data: { buildId: "bB", createdAt: staleIso() }, updatedAt: new Date() },
  ];
  // The live handler beat the sweeper: a real ready ticket already exists.
  __control.stashByUser = {
    uB: { buildId: "bB", status: "ready", full: "your 3-leg ticket", props: [{ id: "p1" }] },
  };

  const swept = await sweepAbandonedCoachBuilds(log);

  assert.equal(swept, 0, "nothing finalized — the ready ticket stands");
  // Critically: the sweeper must NOT clobber the ready outcome with a failure.
  assert.equal(__control.writes.userSync.length, 0, "no failure stash written");
  assert.equal(__control.notifLogKeys.size, 0, "no push claimed for a ready build");
  assert.equal(__push.calls.length, 0, "no push fired");
  // But the stale marker is still retired so it isn't re-examined forever.
  assert.equal(__control.deletes.userSync, 1, "stale marker retired");
});

test("sweep: a malformed marker (no buildId) is cleaned up, not finalized", async () => {
  __control.markerRows = [
    { userId: "uM", data: { createdAt: staleIso() }, updatedAt: new Date() },
  ];

  const swept = await sweepAbandonedCoachBuilds(log);

  assert.equal(swept, 0, "a malformed marker is never finalized as a build");
  assert.equal(__control.writes.userSync.length, 0, "no stash written");
  assert.equal(__control.deletes.userSync, 1, "malformed marker cleaned up");
});

test("sweep: an in-deadline marker is skipped (handler may still be running)", async () => {
  __control.markerRows = [
    { userId: "uF", data: { buildId: "bF", createdAt: freshIso() }, updatedAt: new Date() },
  ];

  const swept = await sweepAbandonedCoachBuilds(log);

  assert.equal(swept, 0, "fresh build not swept");
  assert.equal(__control.writes.userSync.length, 0, "no stash written");
  assert.equal(__control.deletes.userSync, 0, "marker left completely untouched");
});

test("sweep: handles a mixed batch — only the truly abandoned build is finalized", async () => {
  __control.markerRows = [
    { userId: "uA", data: { buildId: "bA", createdAt: staleIso() }, updatedAt: new Date() },
    { userId: "uB", data: { buildId: "bB", createdAt: staleIso() }, updatedAt: new Date() },
    { userId: "uM", data: { createdAt: staleIso() }, updatedAt: new Date() },
    { userId: "uF", data: { buildId: "bF", createdAt: freshIso() }, updatedAt: new Date() },
  ];
  __control.stashByUser = {
    uB: { buildId: "bB", status: "ready", full: "ticket", props: [] },
  };

  const swept = await sweepAbandonedCoachBuilds(log);

  assert.equal(swept, 1, "only uA (stale, no stash) is finalized");
  assert.equal(__control.writes.userSync.length, 1, "one failure stash (uA)");
  assert.equal((__control.writes.userSync[0].data as Record<string, unknown>).buildId, "bA");
  // uA finalize-clear + uB marker-retire + uM malformed-clear = 3 marker deletes;
  // uF (fresh) is untouched.
  assert.equal(__control.deletes.userSync, 3, "three markers retired, fresh one kept");
});

// ---- pruneOldCoachBuilds ----------------------------------------------------

test("prune: only stash rows older than the retention cutoff are deleted", async () => {
  const aged = new Date(Date.now() - COACH_BUILD_RETENTION_MS - 60_000);
  const recent = new Date(Date.now() - 60_000);
  __control.coachStashDeleteRows = [
    { userId: "u1", namespace: COACH_BUILD_NS, updatedAt: aged },
    { userId: "u2", namespace: COACH_BUILD_NS, updatedAt: aged },
    { userId: "u3", namespace: COACH_BUILD_NS, updatedAt: recent },
  ];

  const res = await pruneOldCoachBuilds(log);

  assert.equal(res.stashes, 2, "exactly the two aged stashes deleted");
  assert.deepEqual(
    __control.deleted.coachStash.map((r) => r.userId).sort(),
    ["u1", "u2"],
    "the recent stash (u3) is preserved",
  );
});

test("prune: notif_log delete is scoped to coachReady/coachFailed keys and the cutoff", async () => {
  const aged = new Date(Date.now() - COACH_BUILD_RETENTION_MS - 60_000);
  const recent = new Date(Date.now() - 60_000);
  __control.notifLogDeleteRows = [
    { userId: "u1", dedupeKey: "coachReady:u1:b1", sentAt: aged },
    { userId: "u1", dedupeKey: "coachFailed:u1:b2", sentAt: aged },
    { userId: "u1", dedupeKey: "coachReady:u1:b3", sentAt: recent }, // too new
    { userId: "u2", dedupeKey: "reminder:u2:2026-06-10", sentAt: aged }, // other ns
    { userId: "u2", dedupeKey: "dailyDog:u2:2026-06-10", sentAt: aged }, // other ns
  ];

  const res = await pruneOldCoachBuilds(log);

  assert.equal(res.notifLogs, 2, "only the two aged coach dedupe rows deleted");
  assert.deepEqual(
    __control.deleted.notifLog.map((r) => r.dedupeKey).sort(),
    ["coachFailed:u1:b2", "coachReady:u1:b1"],
    "other-namespace dedupe rows and fresh coach rows are untouched",
  );
});

test("prune: an explicit (tiny) retention deletes everything past it", async () => {
  const t0 = new Date(Date.now() - 10_000);
  __control.coachStashDeleteRows = [{ userId: "u1", namespace: COACH_BUILD_NS, updatedAt: t0 }];
  __control.notifLogDeleteRows = [{ userId: "u1", dedupeKey: "coachReady:u1:b1", sentAt: t0 }];

  // retentionMs of 0 => cutoff == now, so a 10s-old row is past it.
  const res = await pruneOldCoachBuilds(log, 0);

  assert.equal(res.stashes, 1, "aged stash pruned under a 0ms retention");
  assert.equal(res.notifLogs, 1, "aged dedupe row pruned under a 0ms retention");
});

import { and, eq, inArray, sql, lt, like, or } from "drizzle-orm";
import { db, userSyncTable, notifLogTable, pushTokensTable } from "@workspace/db";
import { sendPush } from "./push.js";
import { decideSweepAction, pruneCutoffMs } from "./coachBuildSweep.js";
import { coachReadyDedupeKey, coachFailedDedupeKey } from "./coachBuildFinish.js";

// -------------------------------------------------------------------------
// Background-finished AI Coach parlay builds (mobile). When a build is in
// flight and the user backgrounds / leaves the app, the phone socket dies but
// the server keeps generating; on completion we stash the finished reply under
// the user's account and fire a push, and the client replays it on return.
//
// This module owns the DURABLE persistence side of that feature so it can be
// shared between the live /chat request handler (which observes its own
// success / stall / error finish-paths) and the cron SWEEPER (which closes the
// gap the handler can't: on autoscale a TCP drop can kill the in-flight handler
// before EITHER finish-path runs, leaving no stash at all). The sweeper marks
// such abandoned builds as a terminal failure after a deadline so a returning
// user always gets a definite outcome — never silent limbo.
//
// Invariant: this only governs WHERE/WHEN the result is delivered and the
// terminal STATUS — never the pick-building logic, prompts, or the HONESTY
// rule. A partial / aborted / abandoned build delivers NO picks.
// -------------------------------------------------------------------------

// Namespace holding the latest background build OUTCOME per user (status
// "ready" carries full/props; "failed"/"timedOut" carry status only). Read by
// the client on return; server-authored (NOT in the sync write whitelist).
export const COACH_BUILD_NS = "coachBuild";
// Namespace holding an IN-FLIGHT background build MARKER (`{ buildId,
// createdAt }`) written when the model starts streaming and cleared on any
// terminal outcome. A row that lingers past the deadline means the handler died
// before any finish-path ran — the sweeper turns it into a terminal failure.
// Purely internal server state: neither readable nor writable by clients.
export const COACH_BUILD_PENDING_NS = "coachBuildPending";

// How long after a build was marked in-flight we consider it abandoned (the
// handler must be dead — it can no longer reach any finish-path). Comfortably
// larger than the in-handler watchdog max wall-clock (BG_MAX_MS = 240s in
// chat.ts) so a still-running build is never falsely swept.
export const COACH_BUILD_STALE_MS = 8 * 60 * 1000;

// How long terminal background-build bookkeeping is retained before the cron
// pruner deletes it: the per-user `coachBuild` outcome stash (latest-wins, one
// row/user) and — the unbounded one — a `notif_log` dedupe row per build
// (coachReady / coachFailed). A week is comfortably longer than both the
// few-minute build lifecycle and the time a user might take to reopen the app
// after walking away, so deleting older rows can neither strand a returning
// user nor weaken the at-most-once push guarantee (nothing live re-touches a
// build this old).
export const COACH_BUILD_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

// Minimal structural logger so this lib works with both the per-request pino
// logger (req.log) and the module logger used by the cron jobs.
type CoachBuildLogger = {
  error: (obj: unknown, msg?: string) => void;
  warn?: (obj: unknown, msg?: string) => void;
};

type PendingMarker = { buildId: string; createdAt: string };

// Mark a background build as in-flight (durably) the moment the model starts
// streaming, so even a handler killed mid-stream leaves a trail the sweeper can
// finalize. Best-effort: a write hiccup just means this one build won't be
// sweeper-recoverable (the handler's own finish-paths still cover the common
// case). Latest-wins: one in-flight marker per user.
export async function recordBackgroundBuildPending(
  userId: string,
  buildId: string,
  log: CoachBuildLogger,
): Promise<void> {
  try {
    const now = new Date();
    const payload: PendingMarker = { buildId, createdAt: now.toISOString() };
    await db
      .insert(userSyncTable)
      .values({ userId, namespace: COACH_BUILD_PENDING_NS, data: payload, updatedAt: now })
      .onConflictDoUpdate({
        target: [userSyncTable.userId, userSyncTable.namespace],
        set: { data: payload, updatedAt: now },
      });
  } catch (err) {
    log.error({ err }, "background coach build pending-marker write failed");
  }
}

// Clear the in-flight marker once a terminal outcome has been persisted. A
// SINGLE atomic delete that matches the stored buildId inside the jsonb payload,
// so a newer build's marker (latest-wins overwrote the row with a different
// buildId) is never clobbered by an older build finishing. Doing the match in
// one statement — rather than select-then-delete — closes the read/overwrite
// race where a concurrent newer build could slip in between the two.
export async function clearBackgroundBuildPending(
  userId: string,
  buildId: string,
  log: CoachBuildLogger,
): Promise<void> {
  try {
    await db
      .delete(userSyncTable)
      .where(
        and(
          eq(userSyncTable.userId, userId),
          eq(userSyncTable.namespace, COACH_BUILD_PENDING_NS),
          sql`${userSyncTable.data} ->> 'buildId' = ${buildId}`,
        ),
      );
  } catch (err) {
    log.error({ err }, "background coach build pending-marker clear failed");
  }
}

// The user left / backgrounded the app mid-build but asked us to FINISH it in
// the background (notifyOnBackground). The model finished generating after the
// client socket dropped, so we (a) stash the completed reply + the exact prop
// pool the model used under the user's account (so the app can reconstruct the
// pick cards on return — identical to the in-app path, no fabrication), and
// (b) fire a single "your ticket is ready" push. Best-effort: any failure is
// logged and swallowed so a delivery hiccup never crashes the request.
export async function stashAndNotifyBackgroundBuild(opts: {
  userId: string;
  buildId: string;
  full: string;
  props: unknown[];
  log: CoachBuildLogger;
}): Promise<void> {
  const { userId, buildId, full, props, log } = opts;
  try {
    const now = new Date();
    const payload = { buildId, status: "ready" as const, full, props, createdAt: now.toISOString() };
    // Latest-wins: one stashed background build per user (they only ever need
    // the most recent one back). Mirrors the sync route's upsert shape.
    await db
      .insert(userSyncTable)
      .values({ userId, namespace: COACH_BUILD_NS, data: payload, updatedAt: now })
      .onConflictDoUpdate({
        target: [userSyncTable.userId, userSyncTable.namespace],
        set: { data: payload, updatedAt: now },
      });
    // Terminal outcome reached — retire the in-flight marker so the sweeper
    // won't later mistake this build for an abandoned one.
    await clearBackgroundBuildPending(userId, buildId, log);

    // Respect the user's notification prefs: the global mute (master) and the
    // dedicated coachReady toggle both suppress the push. The stash above still
    // happens so returning to the app can load the result silently.
    const prefRows = await db
      .select()
      .from(userSyncTable)
      .where(
        and(eq(userSyncTable.userId, userId), eq(userSyncTable.namespace, "notifPrefs")),
      )
      .limit(1);
    const prefs = (prefRows[0]?.data ?? {}) as Record<string, unknown>;
    if (prefs["master"] === false || prefs["coachReady"] === false) return;

    // At-most-once per build (the same composite-PK idempotency log the cron
    // jobs use). A client retry / second disconnect can't double-send.
    const dedupeKey = coachReadyDedupeKey(userId, buildId);
    const claimed = await db
      .insert(notifLogTable)
      .values({ userId, dedupeKey })
      .onConflictDoNothing()
      .returning({ k: notifLogTable.dedupeKey });
    if (claimed.length === 0) return;

    const tokens = await db
      .select()
      .from(pushTokensTable)
      .where(eq(pushTokensTable.userId, userId));
    if (tokens.length === 0) return;
    const messages = tokens.map((t) => ({
      to: t.token,
      title: "Your parlay is ready",
      body: "Your AI Coach finished the ticket you started. Tap to see it.",
      data: { type: "coachReady" as const, buildId },
    }));
    const { invalidTokens } = await sendPush(messages);
    if (invalidTokens.length > 0) {
      await db
        .delete(pushTokensTable)
        .where(inArray(pushTokensTable.token, invalidTokens))
        .catch(() => {});
    }
  } catch (err) {
    log.error({ err }, "background coach build stash/notify failed");
  }
}

// Companion to the success path above. A background build can stall (the
// watchdog aborts the upstream model), error out with no usable reply, OR — the
// gap the sweeper closes — die with the whole handler (autoscale TCP drop)
// before any finish-path ran. We deliberately stash NO picks — a half-finished
// parlay is never delivered (honesty) — but we DO persist a terminal status so
// the client can show a deterministic "couldn't finish that build, tap to
// retry" instead of leaving the user who walked away in silent limbo. An
// optional push (respecting the same prefs + at-most-once dedupe as the ready
// push) tells them to come back.
export async function stashBackgroundBuildFailure(opts: {
  userId: string;
  buildId: string;
  status: "failed" | "timedOut";
  log: CoachBuildLogger;
}): Promise<void> {
  const { userId, buildId, status, log } = opts;
  try {
    const now = new Date();
    // Terminal status only — no `full`/`props`, so the client can never mistake
    // this for a deliverable ticket. Latest-wins, same upsert shape as the
    // success stash (one stashed background build per user).
    const payload = { buildId, status, createdAt: now.toISOString() };
    await db
      .insert(userSyncTable)
      .values({ userId, namespace: COACH_BUILD_NS, data: payload, updatedAt: now })
      .onConflictDoUpdate({
        target: [userSyncTable.userId, userSyncTable.namespace],
        set: { data: payload, updatedAt: now },
      });
    // Terminal outcome reached — retire the in-flight marker.
    await clearBackgroundBuildPending(userId, buildId, log);

    // Same pref gating as the ready push: the global mute (master) and the
    // dedicated coachReady toggle both suppress the push. The stash above still
    // happens so returning to the app surfaces the failure silently.
    const prefRows = await db
      .select()
      .from(userSyncTable)
      .where(
        and(eq(userSyncTable.userId, userId), eq(userSyncTable.namespace, "notifPrefs")),
      )
      .limit(1);
    const prefs = (prefRows[0]?.data ?? {}) as Record<string, unknown>;
    if (prefs["master"] === false || prefs["coachReady"] === false) return;

    // At-most-once per build, on a distinct key from the success push so the two
    // can never collide for the same buildId. Sharing this key across the
    // handler AND the sweeper guarantees a single failure push even if both
    // observe the same dead build.
    const dedupeKey = coachFailedDedupeKey(userId, buildId);
    const claimed = await db
      .insert(notifLogTable)
      .values({ userId, dedupeKey })
      .onConflictDoNothing()
      .returning({ k: notifLogTable.dedupeKey });
    if (claimed.length === 0) return;

    const tokens = await db
      .select()
      .from(pushTokensTable)
      .where(eq(pushTokensTable.userId, userId));
    if (tokens.length === 0) return;
    const messages = tokens.map((t) => ({
      to: t.token,
      title: "Couldn't finish your parlay",
      body: "Your AI Coach couldn't complete that ticket. Tap to try again.",
      // Reuse the coachReady deep-link: tapping opens Coach with this buildId,
      // where the client reads the stashed terminal status and shows the retry.
      data: { type: "coachReady" as const, buildId },
    }));
    const { invalidTokens } = await sendPush(messages);
    if (invalidTokens.length > 0) {
      await db
        .delete(pushTokensTable)
        .where(inArray(pushTokensTable.token, invalidTokens))
        .catch(() => {});
    }
  } catch (err) {
    log.error({ err }, "background coach build failure stash/notify failed");
  }
}

// SWEEPER (cron). Closes the autoscale gap: a TCP drop can kill the in-flight
// /chat handler before either finish-path runs, so neither a "ready" stash nor
// a terminal-failure stash is ever written and the in-flight marker just
// lingers. For every marker older than the deadline we finalize the build as a
// terminal failure (no picks — honesty) UNLESS the handler already managed to
// write a terminal outcome for that exact build (in which case we just retire
// the stale marker). Returns how many builds were swept into a failure.
export async function sweepAbandonedCoachBuilds(
  log: CoachBuildLogger,
): Promise<number> {
  let swept = 0;
  let markers: Array<{ userId: string; data: unknown; updatedAt: Date }> = [];
  try {
    markers = await db
      .select({
        userId: userSyncTable.userId,
        data: userSyncTable.data,
        updatedAt: userSyncTable.updatedAt,
      })
      .from(userSyncTable)
      .where(eq(userSyncTable.namespace, COACH_BUILD_PENDING_NS));
  } catch (err) {
    log.error({ err }, "coach build sweep: marker query failed");
    return 0;
  }

  const now = Date.now();
  for (const row of markers) {
    const marker = row.data as Partial<PendingMarker> | null;
    // Cheap pre-decision WITHOUT a stash lookup: skips in-deadline markers and
    // cleans up malformed ones without an extra query. Only a "finalizeFailed"
    // verdict here warrants fetching the stash to confirm.
    const pre = decideSweepAction(marker, null, now, COACH_BUILD_STALE_MS);
    if (pre.kind === "skip") continue;
    if (pre.kind === "clearMarker") {
      // Malformed marker (no usable buildId). Compare-and-delete on the exact
      // row version we read so a concurrent newer build that overwrote the row
      // between our read and this delete is never clobbered.
      await clearMarkerRow(row.userId, row.updatedAt, log);
      continue;
    }

    try {
      // Re-decide with the terminal stash in hand: if the handler already
      // persisted an outcome for THIS build before dying, downgrade to a marker
      // cleanup so we never clobber a real "ready" ticket.
      const stashRows = await db
        .select({ data: userSyncTable.data })
        .from(userSyncTable)
        .where(
          and(
            eq(userSyncTable.userId, row.userId),
            eq(userSyncTable.namespace, COACH_BUILD_NS),
          ),
        )
        .limit(1);
      const stash = stashRows[0]?.data as
        | { buildId?: string; status?: string }
        | undefined;
      const action = decideSweepAction(marker, stash, now, COACH_BUILD_STALE_MS);
      if (action.kind !== "finalizeFailed") {
        // Terminal outcome already exists for THIS valid buildId — retire the
        // marker by buildId match (atomic), so a newer build's marker is never
        // clobbered.
        await clearBackgroundBuildPending(row.userId, marker!.buildId!, log);
        continue;
      }

      // Handler died before any finish-path ran — finalize as a failure (this
      // also retires the marker by buildId match via clearBackgroundBuildPending).
      await stashBackgroundBuildFailure({
        userId: row.userId,
        buildId: action.buildId,
        status: "failed",
        log,
      });
      swept++;
    } catch (err) {
      log.error({ err, userId: row.userId }, "coach build sweep: finalize failed");
    }
  }
  return swept;
}

// RETENTION (cron). The sweeper above retires in-flight markers, but the
// TERMINAL records are otherwise kept forever: the per-user `coachBuild` outcome
// stash (latest-wins, one row/user — bounded but stale once the games are long
// over) and the per-build `notif_log` dedupe rows (coachReady / coachFailed —
// one new row PER build, so unbounded growth). This deletes both once they age
// past COACH_BUILD_RETENTION_MS so the tables don't accumulate stale rows.
//
// Safe for the at-most-once push guarantee: the retention window dwarfs the
// few-minute build lifecycle (handler watchdog + 8-min sweep deadline), so no
// live handler or sweeper ever re-touches a build old enough to be pruned —
// the dedupe rows are only needed WITHIN that window. Each delete is wrapped
// independently and fail-safe (never throws) so it can't break the cron run.
// Returns the per-table delete counts for the cron summary.
export async function pruneOldCoachBuilds(
  log: CoachBuildLogger,
  retentionMs: number = COACH_BUILD_RETENTION_MS,
): Promise<{ stashes: number; notifLogs: number }> {
  const cutoff = new Date(pruneCutoffMs(Date.now(), retentionMs));
  let stashes = 0;
  let notifLogs = 0;

  // Terminal outcome stashes (ready/failed/timedOut) the client has had ample
  // time to consume. Latest-wins keeps one per user, but a user who never
  // returns leaves a permanently stale row — prune it by age.
  try {
    const deleted = await db
      .delete(userSyncTable)
      .where(
        and(
          eq(userSyncTable.namespace, COACH_BUILD_NS),
          lt(userSyncTable.updatedAt, cutoff),
        ),
      )
      .returning({ userId: userSyncTable.userId });
    stashes = deleted.length;
  } catch (err) {
    log.error({ err }, "coach build prune: stash delete failed");
  }

  // Per-build push dedupe rows — the unbounded one. Scope STRICTLY to the
  // background-build dedupe namespaces so other notification dedupe rows
  // (reminder/result/daily/etc., which the cron jobs own) are never touched.
  try {
    const deleted = await db
      .delete(notifLogTable)
      .where(
        and(
          lt(notifLogTable.sentAt, cutoff),
          or(
            like(notifLogTable.dedupeKey, "coachReady:%"),
            like(notifLogTable.dedupeKey, "coachFailed:%"),
          ),
        ),
      )
      .returning({ k: notifLogTable.dedupeKey });
    notifLogs = deleted.length;
  } catch (err) {
    log.error({ err }, "coach build prune: notif_log delete failed");
  }

  return { stashes, notifLogs };
}

// Compare-and-delete a marker by the exact row version (updatedAt) we read.
// Used only for malformed markers that carry no usable buildId; the updatedAt
// guard ensures a concurrent newer build that overwrote the row is not clobbered.
export async function clearMarkerRow(
  userId: string,
  updatedAt: Date,
  log: CoachBuildLogger,
): Promise<void> {
  try {
    await db
      .delete(userSyncTable)
      .where(
        and(
          eq(userSyncTable.userId, userId),
          eq(userSyncTable.namespace, COACH_BUILD_PENDING_NS),
          eq(userSyncTable.updatedAt, updatedAt),
        ),
      );
  } catch (err) {
    log.error({ err, userId }, "coach build sweep: marker cleanup failed");
  }
}

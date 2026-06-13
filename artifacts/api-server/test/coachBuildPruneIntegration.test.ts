import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// Real-Postgres integration coverage for the terminal-record PRUNER
// (pruneOldCoachBuilds). The pure retention math is unit-tested in
// coachBuildPrune.test.ts and the prune call is fake-tested in
// coachBuildCron.test.ts, but the pruner's actual safety lives in SQL DELETE
// PREDICATES that an in-memory fake (which dispatches on table identity and
// ignores WHERE conditions) cannot exercise:
//  - the coachBuild stash delete is scoped to namespace = 'coachBuild' AND an
//    updated_at cutoff — a wrong column or comparison could delete live rows or
//    nothing at all,
//  - the notif_log delete is scoped to a sent_at cutoff AND a
//    `coachReady:% / coachFailed:%` LIKE pattern — a broken pattern would either
//    wipe OTHER notification dedupe rows (reminder/result/daily) or leave the
//    coach dedupe rows to grow unbounded.
// Only a real Postgres run validates those, so this test bundles the real
// coachBuild.ts (with its real @workspace/db) via esbuild and runs it against
// the dev database (DATABASE_URL). See
// .agents/memory/api-server-db-module-testing.md for why the native `node --test`
// runner can't load @workspace/db directly (the esbuild-bundle technique here),
// and coachBuildSweepIntegration.test.ts for the harness pattern this copies.

// Unique per-run prefix so setup rows never collide with other runs and teardown
// can sweep up any leftovers from a previous aborted run. The literal underscores
// double as LIKE wildcards, which is harmless here (still matches our own rows).
const PREFIX = `test_prune_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_`;
const userA = `${PREFIX}A`;
const userB = `${PREFIX}B`;
const userC = `${PREFIX}C`;

const log = { error() {}, warn() {} };

async function bundleHarness(): Promise<string> {
  const esbuild = await import("esbuild");
  const libDir = path.resolve(import.meta.dirname, "../src/lib");
  const outfile = path.join(
    os.tmpdir(),
    `coachBuildPruneHarness.${process.pid}.${Date.now()}.mjs`,
  );
  await esbuild.build({
    stdin: {
      // Re-export the pruner + the constants the test needs, plus the real db
      // pool so the test can drive setup/assert SQL and close the only open
      // handle (otherwise `node --test` would hang on the live pg pool).
      contents: `export {
  pruneOldCoachBuilds,
  COACH_BUILD_NS,
  COACH_BUILD_RETENTION_MS,
} from "./coachBuild.ts";
export { pool } from "@workspace/db";
`,
      resolveDir: libDir,
      sourcefile: "harness.ts",
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    sourcemap: false,
    logLevel: "silent",
    // pg loads its optional native binding lazily; never bundle it (or any
    // native addon). @workspace/db (and its directory-import of ./schema) MUST be
    // bundled — externalizing it reproduces the ERR_UNSUPPORTED_DIR_IMPORT crash.
    external: ["pg-native", "*.node", "@napi-rs/*"],
    banner: {
      js: `import { createRequire as __cr } from 'node:module';
import __p from 'node:path';
import __u from 'node:url';
globalThis.require = __cr(import.meta.url);
globalThis.__filename = __u.fileURLToPath(import.meta.url);
globalThis.__dirname = __p.dirname(globalThis.__filename);`,
    },
    plugins: [
      {
        // Replace ./logger with a no-op so the bundle never spins pino-pretty's
        // worker thread (a lingering handle would keep `node --test` from
        // exiting). push.ts's real send path is otherwise left intact.
        name: "stub-logger",
        setup(b) {
          b.onResolve({ filter: /\/logger$/ }, () => ({
            path: "stub-logger",
            namespace: "stub-logger",
          }));
          b.onLoad({ filter: /.*/, namespace: "stub-logger" }, () => ({
            contents:
              "export const logger = { info(){}, warn(){}, error(){}, debug(){}, fatal(){}, trace(){}, child(){ return this; } };",
            loader: "js",
          }));
        },
      },
    ],
  });
  return outfile;
}

test("pruneOldCoachBuilds deletes only aged coach rows against a real DB", async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL not set — skipping real-DB pruner integration test");
    return;
  }

  let outfile: string | undefined;
  let pool:
    | { query: (q: string, p?: unknown[]) => Promise<{ rows: any[] }>; end: () => Promise<void> }
    | undefined;

  try {
    outfile = await bundleHarness();
    const mod: any = await import(pathToFileURL(outfile).href);
    pool = mod.pool;
    const { pruneOldCoachBuilds, COACH_BUILD_NS, COACH_BUILD_RETENTION_MS } = mod;
    const q = (text: string, params?: unknown[]) => pool!.query(text, params);

    // Clean up any leftovers from a previously aborted run of THIS suite.
    const cleanup = async () => {
      await q(`DELETE FROM user_sync WHERE user_id LIKE 'test_prune_%'`);
      await q(`DELETE FROM notif_log WHERE user_id LIKE 'test_prune_%'`);
    };
    await cleanup();

    const cutoff = new Date(Date.now() - COACH_BUILD_RETENTION_MS);

    // SAFETY: the pruner runs UNSCOPED global DELETEs (the whole `coachBuild`
    // namespace past the cutoff, and every aged `coachReady:%`/`coachFailed:%`
    // notif_log row). If any FOREIGN (non-test) row matches those exact delete
    // predicates we must NOT run — pruning a real user's terminal stash or a
    // real at-most-once dedupe row would be unacceptable. The dev DB normally
    // has none; real traffic hits the separate prod DB.
    const foreignStash = await q(
      `SELECT 1 FROM user_sync
        WHERE namespace = $1 AND updated_at < $2 AND user_id NOT LIKE 'test_prune_%'
        LIMIT 1`,
      [COACH_BUILD_NS, cutoff.toISOString()],
    );
    const foreignNotif = await q(
      `SELECT 1 FROM notif_log
        WHERE sent_at < $1
          AND (dedupe_key LIKE 'coachReady:%' OR dedupe_key LIKE 'coachFailed:%')
          AND user_id NOT LIKE 'test_prune_%'
        LIMIT 1`,
      [cutoff.toISOString()],
    );
    if (foreignStash.rows.length > 0 || foreignNotif.rows.length > 0) {
      t.skip(
        "foreign aged coach rows present — refusing to prune a shared DB with real terminal records",
      );
      return;
    }

    // ---- seed aged + fresh rows --------------------------------------------
    // Comfortably past / before the retention cutoff so the boundary is never
    // in doubt regardless of the few-ms it takes the pruner to compute `now`.
    const aged = new Date(
      Date.now() - COACH_BUILD_RETENTION_MS - 24 * 60 * 60 * 1000,
    ).toISOString();
    const fresh = new Date().toISOString();

    const putSync = (
      userId: string,
      namespace: string,
      data: Record<string, unknown>,
      updatedAt: string,
    ) =>
      q(
        `INSERT INTO user_sync (user_id, namespace, data, updated_at)
         VALUES ($1, $2, $3::jsonb, $4)
         ON CONFLICT (user_id, namespace)
         DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
        [userId, namespace, JSON.stringify(data), updatedAt],
      );
    const putNotif = (userId: string, dedupeKey: string, sentAt: string) =>
      q(
        `INSERT INTO notif_log (user_id, dedupe_key, sent_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, dedupe_key)
         DO UPDATE SET sent_at = EXCLUDED.sent_at`,
        [userId, dedupeKey, sentAt],
      );

    // user_sync rows:
    //  A: aged terminal coachBuild stash         -> pruned (age + namespace).
    await putSync(userA, COACH_BUILD_NS, { buildId: "bA", status: "failed" }, aged);
    //  B: fresh terminal coachBuild stash        -> survives (newer than cutoff).
    await putSync(userB, COACH_BUILD_NS, { buildId: "bB", status: "ready", full: "x" }, fresh);
    //  C: aged but DIFFERENT namespace (savedSlips) -> survives (namespace scope).
    await putSync(userC, "savedSlips", { slips: [] }, aged);

    // notif_log rows:
    //  aged coachReady / coachFailed             -> pruned (age + LIKE pattern).
    await putNotif(userA, `coachReady:${userA}:bA`, aged);
    await putNotif(userA, `coachFailed:${userA}:bA2`, aged);
    //  fresh coachReady                          -> survives (newer than cutoff).
    await putNotif(userB, `coachReady:${userB}:bB`, fresh);
    //  aged OTHER-namespace dedupe rows          -> survive (LIKE pattern scope).
    await putNotif(userC, `reminder:${userC}:g1`, aged);
    await putNotif(userC, `result:${userC}:s1`, aged);

    // ---- run the pruner once ------------------------------------------------
    const { stashes, notifLogs } = await pruneOldCoachBuilds(log);

    // The foreign-row guard above ensures no other aged coach rows exist, so the
    // returned counts are exactly the aged coach rows WE seeded.
    assert.equal(stashes, 1, "exactly one aged coachBuild stash deleted (A)");
    assert.equal(notifLogs, 2, "exactly two aged coach dedupe rows deleted (A)");

    // ---- aged coach rows are gone -------------------------------------------
    await t.test("aged coachBuild stash and dedupe rows are pruned", async () => {
      const stash = await q(
        `SELECT 1 FROM user_sync WHERE user_id = $1 AND namespace = $2`,
        [userA, COACH_BUILD_NS],
      );
      assert.equal(stash.rows.length, 0, "aged coachBuild stash deleted");

      const notif = await q(
        `SELECT dedupe_key FROM notif_log WHERE user_id = $1`,
        [userA],
      );
      assert.equal(notif.rows.length, 0, "aged coachReady/coachFailed rows deleted");
    });

    // ---- fresh coach rows survive -------------------------------------------
    await t.test("fresh coach rows newer than the cutoff survive", async () => {
      const stash = await q(
        `SELECT data FROM user_sync WHERE user_id = $1 AND namespace = $2`,
        [userB, COACH_BUILD_NS],
      );
      assert.equal(stash.rows.length, 1, "fresh coachBuild stash preserved");
      assert.equal(
        (stash.rows[0].data as Record<string, unknown>).buildId,
        "bB",
        "fresh stash untouched",
      );

      const notif = await q(
        `SELECT 1 FROM notif_log WHERE user_id = $1 AND dedupe_key = $2`,
        [userB, `coachReady:${userB}:bB`],
      );
      assert.equal(notif.rows.length, 1, "fresh coachReady dedupe row preserved");
    });

    // ---- other-namespace rows survive even when aged ------------------------
    await t.test("aged rows OUTSIDE the coach scope are never touched", async () => {
      const sync = await q(
        `SELECT 1 FROM user_sync WHERE user_id = $1 AND namespace = $2`,
        [userC, "savedSlips"],
      );
      assert.equal(sync.rows.length, 1, "aged non-coach user_sync row preserved");

      const others = await q(
        `SELECT dedupe_key FROM notif_log WHERE user_id = $1 ORDER BY dedupe_key`,
        [userC],
      );
      assert.deepEqual(
        others.rows.map((r) => r.dedupe_key),
        [`reminder:${userC}:g1`, `result:${userC}:s1`],
        "aged reminder/result dedupe rows preserved (not coach-scoped)",
      );
    });

    await cleanup();
  } finally {
    if (pool) await pool.end().catch(() => {});
    if (outfile) await rm(outfile, { force: true }).catch(() => {});
  }
});

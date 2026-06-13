import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// Real-Postgres integration coverage for the abandoned background-Coach-build
// SWEEPER. The pure decision logic is unit-tested in coachBuildSweep.test.ts and
// the stash/notify DB shape is fake-tested in coachBuildStashNotify.test.ts, but
// the sweeper's safety lives in SQL PREDICATES that an in-memory fake (which
// dispatches on table identity and ignores WHERE conditions) cannot exercise:
//  - it writes a terminal "failed" outcome for a truly abandoned build,
//  - it clears the in-flight marker BY buildId (never clobbering a newer build),
//  - and it claims the at-most-once `coachFailed` notif_log row exactly once.
// Only a real Postgres run validates those, so this test bundles the real
// coachBuild.ts (with its real @workspace/db) via esbuild and runs it against
// the dev database (DATABASE_URL). See
// .agents/memory/api-server-db-module-testing.md for why the native `node --test`
// runner can't load @workspace/db directly (the esbuild-bundle technique here).
//
// The register-hooks resolve shim redirects coachBuild.ts's @workspace/db import
// to a fake ONLY when imported under `node --test`; bundling sidesteps that
// entirely — the bundle is self-contained (db inlined), so it hits real SQL.

// Unique per-run prefix so setup rows never collide with other runs and teardown
// can sweep up any leftovers from a previous aborted run. The literal underscores
// double as LIKE wildcards, which is harmless here (still matches our own rows).
const PREFIX = `test_sweep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_`;
const userA = `${PREFIX}A`;
const userB = `${PREFIX}B`;
const userC = `${PREFIX}C`;
const buildA = "bA";
const buildB = "bB";
const buildC = "bC";

const log = { error() {}, warn() {} };

async function bundleHarness(): Promise<string> {
  const esbuild = await import("esbuild");
  const libDir = path.resolve(import.meta.dirname, "../src/lib");
  const outfile = path.join(
    os.tmpdir(),
    `coachBuildSweepHarness.${process.pid}.${Date.now()}.mjs`,
  );
  await esbuild.build({
    stdin: {
      // Re-export the sweeper + the constants the test needs, plus the real db
      // pool so the test can drive setup/assert SQL and close the only open
      // handle (otherwise `node --test` would hang on the live pg pool).
      contents: `export {
  sweepAbandonedCoachBuilds,
  COACH_BUILD_NS,
  COACH_BUILD_PENDING_NS,
  COACH_BUILD_STALE_MS,
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

test("sweepAbandonedCoachBuilds finalizes abandoned builds against a real DB", async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL not set — skipping real-DB sweeper integration test");
    return;
  }

  let outfile: string | undefined;
  let pool: { query: (q: string, p?: unknown[]) => Promise<{ rows: any[] }>; end: () => Promise<void> } | undefined;

  try {
    outfile = await bundleHarness();
    const mod: any = await import(pathToFileURL(outfile).href);
    pool = mod.pool;
    const {
      sweepAbandonedCoachBuilds,
      COACH_BUILD_NS,
      COACH_BUILD_PENDING_NS,
      COACH_BUILD_STALE_MS,
    } = mod;
    const q = (text: string, params?: unknown[]) => pool!.query(text, params);

    // Clean up any leftovers from a previously aborted run of THIS suite.
    const cleanup = async () => {
      await q(`DELETE FROM user_sync WHERE user_id LIKE 'test_sweep_%'`);
      await q(`DELETE FROM notif_log WHERE user_id LIKE 'test_sweep_%'`);
      await q(`DELETE FROM push_tokens WHERE user_id LIKE 'test_sweep_%'`);
    };
    await cleanup();

    // SAFETY: the sweeper scans the ENTIRE pending namespace. If any FOREIGN
    // (non-test) marker is present we must not run — finalizing a real user's
    // in-flight build (and possibly firing a real push) would be unacceptable.
    // The dev DB normally has none; real traffic hits the separate prod DB.
    const foreign = await q(
      `SELECT user_id FROM user_sync WHERE namespace = $1 AND user_id NOT LIKE 'test_sweep_%' LIMIT 1`,
      [COACH_BUILD_PENDING_NS],
    );
    if (foreign.rows.length > 0) {
      t.skip(
        "foreign coachBuildPending marker present — refusing to sweep a shared DB with real in-flight builds",
      );
      return;
    }

    // ---- setup the three scenarios -----------------------------------------
    const staleCreatedAt = new Date(
      Date.now() - COACH_BUILD_STALE_MS - 60_000,
    ).toISOString();
    const freshCreatedAt = new Date().toISOString();

    const putMarker = (userId: string, buildId: string, createdAt: string) =>
      q(
        `INSERT INTO user_sync (user_id, namespace, data, updated_at)
         VALUES ($1, $2, $3::jsonb, now())
         ON CONFLICT (user_id, namespace)
         DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [userId, COACH_BUILD_PENDING_NS, JSON.stringify({ buildId, createdAt })],
      );
    const putStash = (userId: string, data: Record<string, unknown>) =>
      q(
        `INSERT INTO user_sync (user_id, namespace, data, updated_at)
         VALUES ($1, $2, $3::jsonb, now())
         ON CONFLICT (user_id, namespace)
         DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [userId, COACH_BUILD_NS, JSON.stringify(data)],
      );

    // A: stale marker, NO terminal stash -> should be finalized as "failed".
    await putMarker(userA, buildA, staleCreatedAt);
    // B: stale marker BUT a "ready" stash already exists -> must be preserved.
    await putMarker(userB, buildB, staleCreatedAt);
    await putStash(userB, {
      buildId: buildB,
      status: "ready",
      full: "Here is your ready 3-leg ticket",
      props: [{ id: "p1" }, { id: "p2" }],
      createdAt: freshCreatedAt,
    });
    // C: fresh marker -> still within deadline, left untouched.
    await putMarker(userC, buildC, freshCreatedAt);

    // ---- run the sweeper once ----------------------------------------------
    const swept = await sweepAbandonedCoachBuilds(log);

    // Only A is an abandoned build; B has a real outcome, C is still in flight.
    assert.equal(swept, 1, "exactly one build swept into a failure (A only)");

    // ---- scenario A: stale + no stash -> one "failed" stash, marker cleared,
    //      exactly one coachFailed claim ---------------------------------------
    await t.test("A: abandoned build finalized as a terminal failure", async () => {
      const stash = await q(
        `SELECT data FROM user_sync WHERE user_id = $1 AND namespace = $2`,
        [userA, COACH_BUILD_NS],
      );
      assert.equal(stash.rows.length, 1, "a terminal stash was written for A");
      const d = stash.rows[0].data as Record<string, unknown>;
      assert.equal(d.status, "failed", "status is the terminal failure");
      assert.equal(d.buildId, buildA, "stash carries the abandoned buildId");
      // Honesty: a swept failure is NEVER a deliverable ticket.
      assert.ok(!("full" in d) && !("props" in d), "no full/props on a failure");

      const marker = await q(
        `SELECT 1 FROM user_sync WHERE user_id = $1 AND namespace = $2`,
        [userA, COACH_BUILD_PENDING_NS],
      );
      assert.equal(marker.rows.length, 0, "in-flight marker cleared for A");

      const claim = await q(
        `SELECT dedupe_key FROM notif_log WHERE user_id = $1 AND dedupe_key LIKE 'coachFailed:%'`,
        [userA],
      );
      assert.equal(claim.rows.length, 1, "exactly one coachFailed claim for A");
      assert.equal(
        claim.rows[0].dedupe_key,
        `coachFailed:${userA}:${buildA}`,
        "claim is keyed to (user, build)",
      );
    });

    // ---- scenario B: stale marker + existing "ready" stash -> nothing
    //      finalized, ready ticket preserved, marker cleared -------------------
    await t.test("B: existing ready ticket is preserved, marker retired", async () => {
      const stash = await q(
        `SELECT data FROM user_sync WHERE user_id = $1 AND namespace = $2`,
        [userB, COACH_BUILD_NS],
      );
      assert.equal(stash.rows.length, 1, "B's stash still present");
      const d = stash.rows[0].data as Record<string, unknown>;
      assert.equal(d.status, "ready", "ready ticket NOT overwritten with failed");
      assert.equal(d.full, "Here is your ready 3-leg ticket", "full preserved");
      assert.deepEqual(d.props, [{ id: "p1" }, { id: "p2" }], "props preserved");

      const marker = await q(
        `SELECT 1 FROM user_sync WHERE user_id = $1 AND namespace = $2`,
        [userB, COACH_BUILD_PENDING_NS],
      );
      assert.equal(marker.rows.length, 0, "stale marker retired for B");

      const claim = await q(
        `SELECT 1 FROM notif_log WHERE user_id = $1 AND dedupe_key LIKE 'coachFailed:%'`,
        [userB],
      );
      assert.equal(claim.rows.length, 0, "no failure claimed for a ready build");
    });

    // ---- scenario C: fresh marker -> left completely alone -------------------
    await t.test("C: fresh in-flight marker is left untouched", async () => {
      const marker = await q(
        `SELECT data FROM user_sync WHERE user_id = $1 AND namespace = $2`,
        [userC, COACH_BUILD_PENDING_NS],
      );
      assert.equal(marker.rows.length, 1, "fresh marker still present");
      const d = marker.rows[0].data as Record<string, unknown>;
      assert.equal(d.buildId, buildC, "marker unchanged");

      const stash = await q(
        `SELECT 1 FROM user_sync WHERE user_id = $1 AND namespace = $2`,
        [userC, COACH_BUILD_NS],
      );
      assert.equal(stash.rows.length, 0, "no terminal stash for a live build");

      const claim = await q(
        `SELECT 1 FROM notif_log WHERE user_id = $1`,
        [userC],
      );
      assert.equal(claim.rows.length, 0, "no push claim for a live build");
    });

    await cleanup();
  } finally {
    if (pool) await pool.end().catch(() => {});
    if (outfile) await rm(outfile, { force: true }).catch(() => {});
  }
});

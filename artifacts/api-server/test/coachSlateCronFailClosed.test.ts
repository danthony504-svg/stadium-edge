/**
 * Cron HTTP must not report success when the slate job fails,
 * and must not run heavy work on the web dyno by default.
 */
import assert from "node:assert/strict";
import test from "node:test";

type JobResult = {
  ok: boolean;
  summary: { skipped?: boolean; reason?: string; sports?: number };
};

/** Mirror routes/coachSlate.ts POST /coach/slate/cron status selection. */
function cronHttpStatus(
  result: JobResult | null | undefined,
  opts?: { runOnWeb?: boolean },
): number {
  if (opts?.runOnWeb !== true) return 410;
  if (!result?.ok || result.summary?.reason === "error") return 500;
  return 200;
}

test("cron web path disabled by default → 410", () => {
  assert.equal(
    cronHttpStatus({ ok: true, summary: { skipped: false, sports: 3 } }),
    410,
  );
});

test("cron fail-closed: ok:false → 500 when web override enabled", () => {
  assert.equal(
    cronHttpStatus(
      { ok: false, summary: { skipped: true, reason: "error" } },
      { runOnWeb: true },
    ),
    500,
  );
});

test("cron fail-closed: ok:true reason error → 500 when web override enabled", () => {
  assert.equal(
    cronHttpStatus(
      { ok: true, summary: { skipped: true, reason: "error" } },
      { runOnWeb: true },
    ),
    500,
  );
});

test("cron success: ok:true fresh compute → 200 when web override enabled", () => {
  assert.equal(
    cronHttpStatus(
      { ok: true, summary: { skipped: false, sports: 3 } },
      { runOnWeb: true },
    ),
    200,
  );
});

test("cron success: already-running skip → 200 when web override enabled", () => {
  assert.equal(
    cronHttpStatus(
      {
        ok: true,
        summary: { skipped: true, reason: "already-running" },
      },
      { runOnWeb: true },
    ),
    200,
  );
});

/**
 * Cron HTTP must not report success when the slate job fails.
 */
import assert from "node:assert/strict";
import test from "node:test";

type JobResult = {
  ok: boolean;
  summary: { skipped?: boolean; reason?: string; sports?: number };
};

/** Mirror routes/coachSlate.ts POST /coach/slate/cron status selection. */
function cronHttpStatus(result: JobResult | null | undefined): number {
  if (!result?.ok || result.summary?.reason === "error") return 500;
  return 200;
}

test("cron fail-closed: ok:false → 500", () => {
  assert.equal(
    cronHttpStatus({ ok: false, summary: { skipped: true, reason: "error" } }),
    500,
  );
});

test("cron fail-closed: ok:true reason error → 500", () => {
  assert.equal(
    cronHttpStatus({ ok: true, summary: { skipped: true, reason: "error" } }),
    500,
  );
});

test("cron success: ok:true fresh compute → 200", () => {
  assert.equal(
    cronHttpStatus({ ok: true, summary: { skipped: false, sports: 3 } }),
    200,
  );
});

test("cron success: already-running skip → 200", () => {
  assert.equal(
    cronHttpStatus({
      ok: true,
      summary: { skipped: true, reason: "already-running" },
    }),
    200,
  );
});

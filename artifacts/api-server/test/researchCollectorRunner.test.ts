import test from "node:test";
import assert from "node:assert/strict";
import {
  collectorExitFailure,
  collectorFailureCode,
  sanitizeCollectorDetail,
} from "../src/lib/researchCollectorRunner.js";

test("sanitizeCollectorDetail prefers allowlisted trailing codes", () => {
  assert.equal(
    sanitizeCollectorDetail(
      "NCAAF context assembly failed; forecasts and release unchanged.\n",
    ),
    null,
  );
  assert.equal(
    sanitizeCollectorDetail("boom\ncontext_overlap\n"),
    "context_overlap",
  );
  assert.equal(
    sanitizeCollectorDetail("conference_all_captures_failed"),
    "conference_all_captures_failed",
  );
});

test("collectorFailureCode names the script and failure class", () => {
  assert.equal(
    collectorFailureCode("ncaaf-context-dataset.mjs", {}),
    "pipeline_collector_ncaaf_context_dataset_failed",
  );
  assert.equal(
    collectorFailureCode("ncaaf-context-dataset.mjs", { oomOrKilled: true }),
    "pipeline_collector_ncaaf_context_dataset_oom_or_killed",
  );
  assert.equal(
    collectorFailureCode("ncaaf-context-dataset.mjs", {
      detail: "context_overlap",
    }),
    "pipeline_collector_ncaaf_context_dataset_context_overlap",
  );
  assert.equal(
    collectorFailureCode("ncaab-capture-live-inputs.mjs", {
      codePrefix: "ncaab_pipeline_collector",
      timedOut: true,
    }),
    "ncaab_pipeline_collector_ncaab_capture_live_inputs_timeout",
  );
});

test("collectorExitFailure maps SIGKILL to oom_or_killed", () => {
  assert.equal(
    collectorExitFailure("ncaaf-context-dataset.mjs", null, "SIGKILL", ""),
    "pipeline_collector_ncaaf_context_dataset_oom_or_killed",
  );
  assert.equal(
    collectorExitFailure(
      "ncaaf-conference-availability.mjs",
      1,
      null,
      "conference_all_captures_failed\n",
    ),
    "pipeline_collector_ncaaf_conference_availability_conference_all_captures_failed",
  );
});

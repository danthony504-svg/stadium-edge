import test from "node:test";
import assert from "node:assert/strict";
import { catchUpNcaafDevelopment } from "../src/lib/ncaafDevelopmentCatchup.js";

function fixture(
  pointer: unknown = null,
  receivedAt = "2026-10-24T14:01:00Z",
  now = "2026-10-24T14:15:00Z",
) {
  const calls: { name: string; args: string[] }[] = [];
  const writes: { key: string; value: unknown }[] = [];
  const db = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes("current_database"))
        return { rows: [{ name: "stadium_edge_production" }] };
      if (sql.includes("clock_timestamp")) return { rows: [{ now }] };
      if (sql.includes("WHERE key=$1") && !sql.includes("INSERT"))
        return { rows: pointer ? [{ value: pointer }] : [] };
      if (sql.includes("WHERE key LIKE"))
        return {
          rows: [
            {
              key: `research:ncaaf:live-inputs:${receivedAt}`,
              value: {
                version: 1,
                researchOnly: true,
                odds: { receivedAt },
                matched: [
                  {
                    target: {
                      eventId: "101",
                      season: 2026,
                      kickoff: "2026-10-24T23:00:00Z",
                    },
                  },
                ],
              },
            },
          ],
        };
      if (sql.includes("INSERT INTO public.app_kv")) {
        writes.push({
          key: String(params?.[0]),
          value: JSON.parse(String(params?.[1])),
        });
        return { rows: [], rowCount: 1 };
      }
      throw Error("unexpected query");
    },
  };
  return {
    db,
    calls,
    writes,
    loadFrozen: async () =>
      pointer
        ? ({ artifact: { excludedGameIds: ["2026:99"] }, pointer: {} } as never)
        : null,
    runCollector: async (name: string, args: string[]) => {
      calls.push({ name, args });
    },
  };
}

test("new development targets get a free same-slot catch-up without another odds request", async () => {
  const f = fixture();
  const r = await catchUpNcaafDevelopment(f);
  assert.equal(r.state, "processed");
  assert.deepEqual(f.calls, [
    { name: "ncaaf-capture-injuries.mjs", args: [] },
    {
      name: "ncaaf-conference-availability.mjs",
      args: [
        "--capture-slot",
        "2026-10-24T14:00:00.000Z",
        "--development-catchup",
      ],
    },
    {
      name: "ncaaf-repair-team-history.mjs",
      args: [
        "--season",
        "2026",
        "--capture-slot",
        "2026-10-24T14:00:00.000Z",
      ],
    },
    {
      name: "ncaaf-capture-usage.mjs",
      args: ["--capture-slot", "2026-10-24T14:00:00.000Z"],
    },
    { name: "ncaaf-context-dataset.mjs", args: [] },
  ]);
  assert.equal(r.releaseEligible, false);
  assert.equal(f.writes[0]?.key, "research:ncaaf:development-catchup:latest");
});

test("a frozen candidate permits prospective catch-up but does not fit or request odds", async () => {
  const f = fixture({ state: "frozen_research_candidate" });
  const r = await catchUpNcaafDevelopment(f);
  assert.equal(r.state, "processed");
  assert.equal(r.contextRole, "holdout_context");
  assert.equal(f.calls.length, 5);
  assert.ok(
    f.calls.every(
      (c) => !c.name.includes("live-inputs") && !c.name.includes("adjusted"),
    ),
  );
  assert.equal(f.calls[0].name, "ncaaf-capture-injuries.mjs");
  assert.equal(r.injuryRefreshFailed, false);
});

test("injury refresh failure does not abort conference or context catch-up", async () => {
  const f = fixture({ state: "frozen_research_candidate" });
  f.runCollector = async (name: string, args: string[]) => {
    f.calls.push({ name, args });
    if (name === "ncaaf-capture-injuries.mjs")
      throw Error("pipeline_collector_ncaaf_capture_injuries_failed");
  };
  const r = await catchUpNcaafDevelopment(f);
  assert.equal(r.state, "partial_failure");
  assert.equal(r.injuryRefreshFailed, true);
  assert.equal(r.contextAssemblyFailed, false);
  assert.ok(f.calls.some((c) => c.name === "ncaaf-conference-availability.mjs"));
  assert.ok(f.calls.some((c) => c.name === "ncaaf-context-dataset.mjs"));
  assert.equal(
    r.failedReasons["ncaaf-capture-injuries.mjs"],
    "pipeline_collector_ncaaf_capture_injuries_failed",
  );
});

test("context assembly failure surfaces the exact collector reason", async () => {
  const f = fixture({ state: "frozen_research_candidate" });
  f.runCollector = async (name: string, args: string[]) => {
    f.calls.push({ name, args });
    if (name === "ncaaf-context-dataset.mjs")
      throw Error("pipeline_collector_ncaaf_context_dataset_oom_or_killed");
  };
  await assert.rejects(
    () => catchUpNcaafDevelopment(f),
    /pipeline_collector_ncaaf_context_dataset_oom_or_killed/,
  );
  const latest = f.writes.find(
    (w) => w.key === "research:ncaaf:development-catchup:latest",
  );
  assert.equal((latest?.value as any).state, "context_assembly_failed");
  assert.equal(
    (latest?.value as any).primaryFailureReason,
    "pipeline_collector_ncaaf_context_dataset_oom_or_killed",
  );
  assert.ok(f.calls.some((c) => c.name === "ncaaf-capture-usage.mjs"));
});

test("conference failure soft-continues into usage and context", async () => {
  const f = fixture();
  f.runCollector = async (name: string, args: string[]) => {
    f.calls.push({ name, args });
    if (name === "ncaaf-conference-availability.mjs")
      throw Error("pipeline_collector_ncaaf_conference_availability_conference_all_captures_failed");
  };
  const r = await catchUpNcaafDevelopment(f);
  assert.equal(r.state, "partial_failure");
  assert.ok(f.calls.some((c) => c.name === "ncaaf-capture-usage.mjs"));
  assert.ok(f.calls.some((c) => c.name === "ncaaf-context-dataset.mjs"));
});

test("overnight receipt reuses its active slot without borrowing the next budget", async () => {
  const same = fixture(null, "2026-10-24T02:01:00Z", "2026-10-24T12:00:00Z");
  assert.equal((await catchUpNcaafDevelopment(same)).state, "processed");
  const conference = same.calls.find(
    (c) => c.name === "ncaaf-conference-availability.mjs",
  );
  assert.equal(conference?.args[1], "2026-10-24T02:00:00.000Z");
  const crossed = fixture(
    null,
    "2026-10-24T13:59:00Z",
    "2026-10-24T14:15:00Z",
  );
  assert.equal(
    (await catchUpNcaafDevelopment(crossed)).state,
    "waiting_for_active_slot_inputs",
  );
  assert.equal(crossed.calls.length, 0);
});

test("stale or future live slates cannot start catch-up", async () => {
  for (const receivedAt of [
    "2026-10-24T01:00:00Z",
    "2026-10-24T15:00:00Z",
    "invalid",
  ]) {
    const f = fixture(null, receivedAt);
    assert.equal(
      (await catchUpNcaafDevelopment(f)).state,
      "waiting_for_current_inputs",
    );
    assert.deepEqual(f.calls, []);
  }
});

test("protocol-excluded games never start holdout catch-up", async () => {
  const f = fixture({ state: "frozen_research_candidate" });
  f.loadFrozen = async () =>
    ({ artifact: { excludedGameIds: ["2026:101"] }, pointer: {} } as never);
  assert.equal(
    (await catchUpNcaafDevelopment(f)).state,
    "waiting_for_upcoming_targets",
  );
  assert.equal(f.calls.length, 0);
});

test("invalid frozen registry fails before collector writes", async () => {
  const f = fixture({ state: "invalid" });
  f.loadFrozen = async () => {
    throw Error("adjusted_invalid_registry_pointer");
  };
  await assert.rejects(() => catchUpNcaafDevelopment(f), /invalid_registry/);
  assert.equal(f.calls.length, 0);
});

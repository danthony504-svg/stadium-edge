import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  freezeCoachMarketPipelineAudit,
  formatCoachRequestTrace,
  loadCoachMarketPipelineAudit,
  loadCoachRequestTrace,
  persistCoachMarketPipelineAudit,
  recordCoachRequestTrace,
  resetCoachMarketAuditStorageForTests,
  startCoachRequestTrace,
} from "./coachRequestTrace.ts";

describe("Coach request trace", () => {
  it("records complete diagnostic fields and formats them for copying", async () => {
    startCoachRequestTrace("request-123");
    recordCoachRequestTrace("scan_start", {
      candidateCount: 24,
      qualifiedCount: 0,
      returnedPickCount: 0,
    });
    recordCoachRequestTrace("prop_sim_complete", {
      candidateCount: 5585,
      qualifiedCount: 12,
      returnedPickCount: 12,
      simulatedCount: 500,
      skippedCount: 5085,
      durationMs: 42000,
      error: "aborted",
    });
    recordCoachRequestTrace("watchdog_fired", {
      candidateCount: 24,
      qualifiedCount: 2,
      returnedPickCount: 0,
      error: "stall_timeout_120000ms",
    });

    const trace = await loadCoachRequestTrace();
    expect(trace?.requestId).toBe("request-123");
    expect(trace?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "scan_start",
          requestId: "request-123",
          candidateCount: 24,
          qualifiedCount: 0,
          returnedPickCount: 0,
        }),
        expect.objectContaining({
          stage: "prop_sim_complete",
          simulatedCount: 500,
          skippedCount: 5085,
          durationMs: 42000,
          error: "aborted",
        }),
        expect.objectContaining({
          stage: "watchdog_fired",
          error: "stall_timeout_120000ms",
        }),
      ]),
    );
    const formatted = formatCoachRequestTrace(trace);
    expect(formatted).toContain("watchdog_fired");
    expect(formatted).toContain("simulated=500");
    expect(formatted).toContain("skipped=5085");
    expect(formatted).toContain("durationMs=42000");
  });

  it("keeps the frozen user-request audit when unknown scans persist later", async () => {
    resetCoachMarketAuditStorageForTests();
    await AsyncStorage.clear();
    const completedAudit = {
      requestId: "user-request-123",
      stages: { final_selected: { mlb: { playerProps: 5 } } },
      qualifiedCandidates: [{ selection: "Qualified game line", selected: false }],
    };

    persistCoachMarketPipelineAudit(completedAudit);
    freezeCoachMarketPipelineAudit("user-request-123");
    persistCoachMarketPipelineAudit({
      requestId: "unknown",
      stages: { final_selected: { nfl: { moneyline: 1 } } },
    });
    persistCoachMarketPipelineAudit({
      requestId: "background-request",
      stages: { final_selected: { nfl: { moneyline: 1 } } },
    });

    await expect(loadCoachMarketPipelineAudit<typeof completedAudit>()).resolves.toEqual(completedAudit);
  });

  it("keeps the terminal snapshot when a late scan uses the same request ID", async () => {
    resetCoachMarketAuditStorageForTests();
    await AsyncStorage.clear();
    const completedAudit = {
      requestId: "user-request-456",
      stages: { final_selected: { mlb: { moneyline: 1, playerProps: 5 } } },
    };

    persistCoachMarketPipelineAudit(completedAudit);
    freezeCoachMarketPipelineAudit(completedAudit.requestId);
    persistCoachMarketPipelineAudit({
      requestId: completedAudit.requestId,
      stages: { final_selected: { nfl: { playerProps: 99 } } },
    });

    await expect(loadCoachMarketPipelineAudit<typeof completedAudit>()).resolves.toEqual(completedAudit);
  });

  it("migrates a valid v1 completed audit and ignores unknown legacy data", async () => {
    resetCoachMarketAuditStorageForTests();
    await AsyncStorage.clear();
    const legacyAudit = { requestId: "old-user-request", stages: { ranked: {} } };
    await AsyncStorage.setItem(
      "stadium-edge:coach-market-pipeline-audit:v1",
      JSON.stringify(legacyAudit),
    );

    await expect(loadCoachMarketPipelineAudit<typeof legacyAudit>()).resolves.toEqual(legacyAudit);
    await expect(AsyncStorage.getItem("stadium-edge:coach-market-pipeline-audit:v2")).resolves.toContain(
      '"completedRequestId":"old-user-request"',
    );

    resetCoachMarketAuditStorageForTests();
    await AsyncStorage.clear();
    await AsyncStorage.setItem(
      "stadium-edge:coach-market-pipeline-audit:v1",
      JSON.stringify({ requestId: "unknown", stages: { ranked: {} } }),
    );
    await expect(loadCoachMarketPipelineAudit()).resolves.toBeNull();
  });
});

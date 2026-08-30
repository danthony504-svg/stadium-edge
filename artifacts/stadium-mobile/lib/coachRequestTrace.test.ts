import {
  formatCoachRequestTrace,
  loadCoachRequestTrace,
  recordCoachRequestTrace,
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
          stage: "watchdog_fired",
          error: "stall_timeout_120000ms",
        }),
      ]),
    );
    expect(formatCoachRequestTrace(trace)).toContain("watchdog_fired");
  });
});

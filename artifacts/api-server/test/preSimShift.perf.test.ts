import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildPreSimShiftFactors } from "../src/lib/preSimShift/index.js";

function series(n: number, value: number): number[] {
  return Array.from({ length: n }, () => value);
}

describe("preSimShift latency", () => {
  it("10k buildPreSimShiftFactors calls stay well under 200ms total", () => {
    const opts = {
      sport: "nfl",
      market: "player_pass_yds",
      isHome: true as const,
      seasonValues: series(20, 240),
      homeValues: series(10, 260),
      awayValues: series(10, 220),
      vsOpponentValues: series(6, 270),
      opportunityShift: 1.12,
    };
    // Warm
    buildPreSimShiftFactors(opts);
    const t0 = performance.now();
    for (let i = 0; i < 10_000; i++) buildPreSimShiftFactors(opts);
    const elapsed = performance.now() - t0;
    console.log(
      `[preSimShift.perf] 10k builds: ${elapsed.toFixed(2)}ms (p-call=${(elapsed / 10).toFixed(3)}µs)`,
    );
    // Pure sync math — ~µs/call. Bound allows cold CI VMs; still ≪ one Coach turn.
    assert.ok(elapsed < 200, `expected <200ms for 10k builds, got ${elapsed.toFixed(2)}ms`);
  });
});

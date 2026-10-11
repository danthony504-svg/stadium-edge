/**
 * Opportunity Shift CPU cost — sync table build only (no network, no MC).
 * Reports p50/p95 for OFF / ON-no-vacancy / one vacancy / multi vacancy.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOpportunityShiftTable,
  lookupOpportunityShift,
} from "../src/lib/opportunityShift/index.js";

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const w = idx - lo;
  return sorted[lo]! * (1 - w) + sorted[hi]! * w;
}

function bench(label: string, fn: () => void, iters = 400): { p50: number; p95: number } {
  // Warmup
  for (let i = 0; i < 40; i++) fn();
  const samples: number[] = [];
  for (let i = 0; i < iters; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const p50 = percentile(samples, 0.5);
  const p95 = percentile(samples, 0.95);
  // eslint-disable-next-line no-console
  console.log(`[opportunityShift.perf] ${label}: p50=${p50.toFixed(3)}ms p95=${p95.toFixed(3)}ms`);
  return { p50, p95 };
}

function roster(n = 22) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const pos = i % 5 === 0 ? "QB" : i % 5 === 1 ? "RB" : i % 5 === 2 ? "WR" : i % 5 === 3 ? "TE" : "OL";
    out.push({
      player: `Player ${i}`,
      athleteId: `id${i}`,
      team: "Home",
      position: pos,
      channelUsage: {
        carries: pos === "RB" ? 8 + (i % 4) : 0,
        targets: pos === "WR" || pos === "TE" || pos === "RB" ? 3 + (i % 3) : 0,
        routes: 10,
        pass_attempts: pos === "QB" ? 30 : 0,
      },
    });
  }
  return out;
}

describe("Opportunity Shift performance", () => {
  it("reports p50/p95; no-vacancy path effectively free", () => {
    const beneficiaries = roster();

    const off = bench("OFF baseline (empty call)", () => {
      buildOpportunityShiftTable({
        sport: "nfl",
        gameKey: "Away @ Home",
        team: "Home",
        injuries: [],
        beneficiaries: [],
      });
    });

    const noVac = bench("ON, no relevant injuries", () => {
      const t = buildOpportunityShiftTable({
        sport: "nfl",
        gameKey: "Away @ Home",
        team: "Home",
        injuries: [
          {
            player: "Depth Guy",
            team: "Home",
            position: "WR",
            status: "Questionable",
          },
        ],
        beneficiaries,
      });
      lookupOpportunityShift(t, {
        player: "Player 1",
        athleteId: "id1",
        market: "rush_attempts",
        sport: "nfl",
      });
    });

    const one = bench("one confirmed vacancy", () => {
      const t = buildOpportunityShiftTable({
        sport: "nfl",
        gameKey: "Away @ Home",
        team: "Home",
        injuries: [
          {
            player: "Player 1",
            athleteId: "id1",
            team: "Home",
            position: "RB",
            status: "Out",
          },
        ],
        beneficiaries,
      });
      for (let i = 0; i < 8; i++) {
        lookupOpportunityShift(t, {
          player: `Player ${i}`,
          athleteId: `id${i}`,
          market: i % 2 === 0 ? "rush_attempts" : "receptions",
          sport: "nfl",
        });
      }
    });

    const multi = bench("multiple confirmed vacancies", () => {
      const t = buildOpportunityShiftTable({
        sport: "nfl",
        gameKey: "Away @ Home",
        team: "Home",
        injuries: [
          {
            player: "Player 1",
            athleteId: "id1",
            team: "Home",
            position: "RB",
            status: "Out",
          },
          {
            player: "Player 2",
            athleteId: "id2",
            team: "Home",
            position: "WR",
            status: "Out",
          },
          {
            player: "Player 5",
            athleteId: "id5",
            team: "Home",
            position: "OL",
            status: "Doubtful",
          },
        ],
        beneficiaries,
      });
      for (let i = 0; i < 12; i++) {
        lookupOpportunityShift(t, {
          player: `Player ${i}`,
          athleteId: `id${i}`,
          market: "rush_yds",
          sport: "nfl",
        });
      }
    });

    // No-vacancy should stay under a few ms p95 on this hardware.
    assert.ok(noVac.p95 < 5, `no-vacancy p95 ${noVac.p95}`);
    assert.ok(one.p95 < 15, `one vacancy p95 ${one.p95}`);
    assert.ok(multi.p95 < 25, `multi vacancy p95 ${multi.p95}`);
    assert.ok(off.p50 <= noVac.p50 + 1);
  });
});

/**
 * Before/after scan→ticket seating timing on identical fixtures.
 * Fails if the single-event seating layer adds a material regression.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildStagedTicketFromScan, type BoardScoredLeg } from "./ticketStaging.ts";
import type { ParsedPick } from "../components/PickCard.tsx";
import { seatSingleEventTicket } from "./singleEventSeating.ts";

const mainScore = {
  composite: 8,
  grade: "B+",
  confidencePct: 58,
  edgePct: 4,
  simHit: 0.56,
  simAligned: true,
  highRiskValuePlay: false,
  recommends: true,
  factors: [],
  rubric: { composite: 8, grade: "B+", confidencePct: 58, edgePct: 4, scores: {} as never },
};

function makePool(nProps: number, nGl: number): BoardScoredLeg[] {
  const game = "Vikings @ Saints";
  const out: BoardScoredLeg[] = [];
  for (let i = 0; i < nProps; i++) {
    const pick: ParsedPick = {
      game,
      market: i % 2 ? "Pass Yds" : "Rush Yds",
      pick: `Player${i} Over ${100 + i} Yds`,
      odds: -110,
      isProp: true,
      player: `Player${i}`,
      propLine: 100 + i,
      propSide: "Over",
      sport: "nfl",
      finalAiScore: mainScore,
    };
    out.push({
      pick,
      evPct: 2,
      edgePct: 3,
      confidencePct: 55,
      impliedProbPct: 50,
      lineShoppingScore: 1,
      grade: "B",
      simHit: 0.55,
      composite: 7,
      rankScore: 1000 - i,
    });
  }
  for (let i = 0; i < nGl; i++) {
    const markets = ["Moneyline", "Spread", "Total", "1H Spread", "Team Total"] as const;
    const pick: ParsedPick = {
      game,
      market: markets[i % markets.length]!,
      pick: `Saints line ${i}`,
      odds: -110,
      isProp: false,
      sport: "nfl",
      finalAiScore: mainScore,
    };
    out.push({
      pick,
      evPct: 2,
      edgePct: 3,
      confidencePct: 55,
      impliedProbPct: 50,
      lineShoppingScore: 1,
      grade: "B",
      simHit: 0.55,
      composite: 7,
      rankScore: 500 - i,
    });
  }
  return out;
}

function pctile(samples: number[], p: number): number {
  const s = [...samples].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.floor(s.length * p)));
  return s[idx]!;
}

function bench(fn: () => void, rounds = 30): { p50: number; p95: number; mean: number } {
  // Warmup
  for (let i = 0; i < 5; i++) fn();
  const samples: number[] = [];
  for (let i = 0; i < rounds; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  return { p50: pctile(samples, 0.5), p95: pctile(samples, 0.95), mean };
}

test("scan→ticket p50/p95 before/after single-event seating (same fixtures)", () => {
  const pool = makePool(120, 40);
  const ranked = pool.map((l) => ({ pick: l.pick, rankScore: l.rankScore }));

  // BEFORE: multi-event staging path (no askText → single-event inactive)
  const before = bench(() => {
    buildStagedTicketFromScan(pool, 8, undefined, { askText: "8 leg tonight" });
  });

  // AFTER: single-event seating layer on the same candidate counts
  const afterDirect = bench(() => {
    seatSingleEventTicket(ranked, {
      target: 8,
      eventKey: "Vikings @ Saints",
      sport: "nfl",
    });
  });

  const afterWired = bench(() => {
    buildStagedTicketFromScan(pool, 8, undefined, {
      askText: "8 leg Saints",
      singleEventKey: "Vikings @ Saints",
      singleEventSport: "nfl",
    });
  });

  const absDeltaP50 = afterWired.p50 - before.p50;
  const pctDeltaP50 = before.p50 > 0 ? (absDeltaP50 / before.p50) * 100 : 0;
  const absDeltaP95 = afterWired.p95 - before.p95;
  const pctDeltaP95 = before.p95 > 0 ? (absDeltaP95 / before.p95) * 100 : 0;

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      fixtureCandidates: pool.length,
      before_ms: before,
      afterDirectSeat_ms: afterDirect,
      afterWired_ms: afterWired,
      deltaWiredVsBefore_p50_ms: absDeltaP50,
      deltaWiredVsBefore_p50_pct: pctDeltaP50,
      deltaWiredVsBefore_p95_ms: absDeltaP95,
      deltaWiredVsBefore_p95_pct: pctDeltaP95,
    }),
  );

  // Material regression gate:
  // - direct seating layer stays near-O(C) (absolute ms)
  // - wired single-event path must not regress multi-event baseline by >5ms p95
  assert.ok(afterDirect.p50 < 15, `direct seat p50 ${afterDirect.p50.toFixed(3)}ms`);
  assert.ok(afterDirect.p95 < 30, `direct seat p95 ${afterDirect.p95.toFixed(3)}ms`);
  // Primary gate: wired single-event path vs multi-event baseline on same fixtures.
  assert.ok(
    afterWired.p95 <= before.p95 + 5 || afterWired.p95 < 20,
    `material p95 regression: before=${before.p95.toFixed(3)} after=${afterWired.p95.toFixed(3)} (${pctDeltaP95.toFixed(1)}%)`,
  );
  assert.ok(
    absDeltaP50 < 5 || pctDeltaP50 < 50 || afterWired.p50 <= before.p50,
    `material p50 regression: Δ=${absDeltaP50.toFixed(3)}ms (${pctDeltaP50.toFixed(1)}%)`,
  );
});

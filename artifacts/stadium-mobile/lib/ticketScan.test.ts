import { test } from "node:test";
import assert from "node:assert/strict";
import { computeTicketScan } from "./ticketScan.ts";

test("empty slip yields a zero/null scan", () => {
  const s = computeTicketScan([]);
  assert.equal(s.count, 0);
  assert.equal(s.hitRate, null);
  assert.equal(s.highest, null);
  assert.equal(s.weakest, null);
  assert.equal(s.avgEdge, null);
  assert.equal(s.edgeLegs, 0);
});

test("counts every leg even ones with no usable odds", () => {
  const s = computeTicketScan([
    { pick: "Lakers ML", odds: -200, edgePct: null, confidence: null },
    { pick: "Bad leg", odds: 0, edgePct: null, confidence: null },
  ]);
  assert.equal(s.count, 2);
});

test("estimated hit rate is the combined implied probability of the real odds", () => {
  // Two -110 legs: each implies 110/210 ≈ 0.5238; product ≈ 0.2744.
  const s = computeTicketScan([
    { pick: "Over 220.5", odds: -110, edgePct: null, confidence: null },
    { pick: "Under 7.5", odds: -110, edgePct: null, confidence: null },
  ]);
  assert.ok(s.hitRate !== null);
  assert.ok(Math.abs(s.hitRate! - 0.2744) < 0.001);
});

test("with no graded legs, ranks by market likelihood: highest = best, weakest = longshot", () => {
  const s = computeTicketScan([
    { pick: "Heavy fav -300", odds: -300, edgePct: null, confidence: null },
    { pick: "Coin flip -110", odds: -110, edgePct: null, confidence: null },
    { pick: "Longshot +250", odds: 250, edgePct: null, confidence: null },
  ]);
  assert.equal(s.highest?.pick, "Heavy fav -300");
  assert.equal(s.highest?.mode, "prob");
  assert.equal(s.weakest?.pick, "Longshot +250");
  assert.equal(s.weakest?.mode, "prob");
  assert.ok(s.highest!.metric > s.weakest!.metric);
});

test("with 2+ graded legs, ranks by the app's edge-derived confidence (not odds)", () => {
  // The most-likely-by-price leg (-300) is graded weakest by confidence, so the
  // ranking must follow confidence, not implied probability.
  const s = computeTicketScan([
    { pick: "Heavy fav -300", odds: -300, edgePct: null, confidence: 3.1 },
    { pick: "Edge play +120", odds: 120, edgePct: 7, confidence: 8.4 },
    { pick: "Mid play -110", odds: -110, edgePct: 2, confidence: 6.0 },
  ]);
  assert.equal(s.highest?.pick, "Edge play +120");
  assert.equal(s.highest?.mode, "conf");
  assert.equal(s.highest?.metric, 8.4);
  assert.equal(s.weakest?.pick, "Heavy fav -300");
  assert.equal(s.weakest?.mode, "conf");
});

test("a single graded leg is not enough — falls back to market likelihood", () => {
  const s = computeTicketScan([
    { pick: "Only graded -110", odds: -110, edgePct: 5, confidence: 7.5 },
    { pick: "Longshot +400", odds: 400, edgePct: null, confidence: null },
  ]);
  assert.equal(s.highest?.mode, "prob");
  assert.equal(s.highest?.pick, "Only graded -110");
  assert.equal(s.weakest?.pick, "Longshot +400");
});

test("all-invalid odds leave hit rate and rankings null but still count the legs", () => {
  const s = computeTicketScan([
    { pick: "A", odds: 0, edgePct: null, confidence: null },
    { pick: "B", odds: Number.NaN, edgePct: null, confidence: null },
  ]);
  assert.equal(s.count, 2);
  assert.equal(s.hitRate, null);
  assert.equal(s.highest, null);
  assert.equal(s.weakest, null);
});

test("average edge is the mean of legs that state an edge; edgeless legs are skipped", () => {
  const s = computeTicketScan([
    { pick: "A", odds: -110, edgePct: 4, confidence: null },
    { pick: "B", odds: -120, edgePct: 6, confidence: null },
    { pick: "C", odds: 100, edgePct: null, confidence: null },
  ]);
  assert.equal(s.avgEdge, 5);
  assert.equal(s.edgeLegs, 2);
});

test("average edge is null when no leg states an edge", () => {
  const s = computeTicketScan([
    { pick: "A", odds: -110, edgePct: null, confidence: null },
    { pick: "B", odds: -120, edgePct: null, confidence: null },
  ]);
  assert.equal(s.avgEdge, null);
  assert.equal(s.edgeLegs, 0);
});

test("negative stated edges average honestly (no flipping to positive)", () => {
  const s = computeTicketScan([
    { pick: "A", odds: -110, edgePct: -2, confidence: null },
    { pick: "B", odds: -120, edgePct: 4, confidence: null },
  ]);
  assert.equal(s.avgEdge, 1);
});

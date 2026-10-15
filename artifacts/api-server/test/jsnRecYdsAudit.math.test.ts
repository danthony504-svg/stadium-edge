/**
 * Freeze the JSN Over 93.5 @ -111 audit arithmetic against live history units.
 * Does not call ESPN — uses the receivingYards series recorded in
 * docs/coach/jsn-recyds-93.5-audit.md (2026-10-15 snapshot).
 */
import assert from "node:assert/strict";
import test from "node:test";

/** ESPN machine field receivingYards — NOT ambiguous display YDS. */
const RECEIVING_YARDS = [102, 76, 128, 155, 122];

function avg(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function sampleStd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = avg(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalSample(mean: number, std: number, rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function simOverHit(mean: number, std: number, line: number, n: number, seed: number): number {
  const rng = mulberry32(seed);
  let hits = 0;
  for (let i = 0; i < n; i++) {
    const s = Math.max(0, normalSample(mean, std, rng));
    if (s > line) hits += 1;
  }
  return hits / n;
}

test("JSN receivingYards base mean is 116.6 yards (not ambiguous YDS ~3)", () => {
  const mean = 0.4 * avg(RECEIVING_YARDS.slice(0, 5)) +
    0.3 * avg(RECEIVING_YARDS.slice(0, 10)) +
    0.3 * avg(RECEIVING_YARDS);
  assert.equal(Math.round(mean * 10) / 10, 116.6);
  // Ambiguous YDS column on the same tape averages ~3.2 — must not be used.
  const ambiguousYds = [16, 0, 0, 0, 0];
  assert.ok(avg(ambiguousYds) < 10);
});

test("Over 93.5 @ -111: base ~77% hit; ~92% hit needs ~1.16x mean lift inside cap", () => {
  const mean = 116.6;
  const std = Math.max(sampleStd(RECEIVING_YARDS), mean * 0.12, 0.35);
  const line = 93.5;
  const implied = 111 / (111 + 100);
  const baseHit = simOverHit(mean, std, line, 10_000, 0x4a534e31);
  assert.ok(baseHit > 0.7 && baseHit < 0.85, `baseHit=${baseHit}`);

  const liftedMean = mean * 1.16; // inside combinedPreSimMult cap 1.35
  const liftedHit = simOverHit(liftedMean, std, line, 10_000, 0x4a534e31);
  assert.ok(liftedHit > 0.88 && liftedHit < 0.96, `liftedHit=${liftedHit}`);

  const edgeIf92 = Math.round((0.92 - implied) * 1000) / 10;
  assert.equal(edgeIf92, 39.4);
});

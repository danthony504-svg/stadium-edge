/**
 * Device-confirmed crash regression (OTA 01a126f2-bf1b-77ce-8d64-96347ebd0661).
 *
 * Stack: ScoreBreakdown → PickCard → VirtualizedList → ErrorBoundary
 * Error: TypeError: Cannot convert undefined value to object
 * Site:  ScoreBreakdown.tsx FACTORS.filter((f) => data.scores[f.key] != null)
 *        when `data.scores` is undefined.
 *
 * PickCard mounted ScoreBreakdown when grade/confidence existed even if the
 * spread source was a partial CombinedPickScore or bare rubric without a nested
 * `scores` map — producing `{ composite, grade, … }` with `scores === undefined`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  combinePickScore,
  emptyPickSubScores,
  normalizeCombinedPickScore,
  type CombinedPickScore,
  type PickSubScores,
} from "./pickScore.ts";

const FACTORS: Array<{ key: keyof PickSubScores }> = [
  { key: "matchup" },
  { key: "trend" },
  { key: "lineValue" },
  { key: "injury" },
  { key: "lineShopping" },
  { key: "simulation" },
];

/** Pre-fix ScoreBreakdown present-count (exact throw expression). */
function legacyPresentCount(data: CombinedPickScore): number {
  return FACTORS.filter((f) => data.scores[f.key] != null).length;
}

/** Post-fix ScoreBreakdown path: normalize then filter. */
function safePresentCount(raw: unknown): number | "unavailable" {
  const safe = normalizeCombinedPickScore(raw);
  if (!safe) return "unavailable";
  return FACTORS.filter((f) => safe.scores[f.key] != null).length;
}

/**
 * Mirrors PickCard's pre-fix `data={{ ...(rubric ?? scores ?? fallback), … }}`
 * assembly that produced undefined `scores` on the device.
 */
function assemblePickCardData(pick: {
  scores?: unknown;
  finalAiScore?: {
    rubric?: unknown;
    composite?: number | null;
    grade?: string | null;
    confidencePct?: number | null;
    edgePct?: number | null;
  } | null;
}): unknown {
  const fallback = {
    scores: emptyPickSubScores(),
    composite: pick.finalAiScore?.composite ?? null,
    grade: pick.finalAiScore?.grade ?? null,
    confidencePct: pick.finalAiScore?.confidencePct ?? null,
    edgePct: pick.finalAiScore?.edgePct ?? null,
  };
  return {
    ...((pick.finalAiScore?.rubric ?? pick.scores ?? fallback) as object),
    composite: pick.finalAiScore?.composite ?? (pick.scores as { composite?: number } | null)?.composite ?? null,
    grade: pick.finalAiScore?.grade ?? (pick.scores as { grade?: string } | null)?.grade ?? null,
    confidencePct:
      pick.finalAiScore?.confidencePct ??
      (pick.scores as { confidencePct?: number } | null)?.confidencePct ??
      null,
    edgePct:
      pick.finalAiScore?.edgePct ?? (pick.scores as { edgePct?: number } | null)?.edgePct ?? null,
  };
}

test("reproduces device crash: grade-only scores object → undefined data.scores", () => {
  // Partial / cached pick: truthy pick.scores with top-level grade, no nested map.
  const assembled = assemblePickCardData({
    scores: { composite: 7.2, grade: "B", confidencePct: 61, edgePct: 3.4 },
  }) as CombinedPickScore;
  assert.equal(assembled.scores, undefined);
  assert.throws(() => legacyPresentCount(assembled), (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    return /undefined/i.test(msg);
  });
});

test("reproduces device crash: bare PickSubScores assigned to pick.scores", () => {
  const assembled = assemblePickCardData({
    scores: {
      matchup: 7,
      trend: 6,
      lineValue: 8,
      injury: null,
      lineShopping: 5,
      simulation: null,
    },
  }) as CombinedPickScore;
  assert.equal(assembled.scores, undefined);
  assert.throws(() => legacyPresentCount(assembled), /undefined/i);
});

test("fix: PickCard normalize path — malformed pick does not throw", () => {
  const assembled = assemblePickCardData({
    scores: { composite: 7.2, grade: "B", confidencePct: 61, edgePct: 3.4 },
  });
  assert.equal(safePresentCount(assembled), 0);
  const safe = normalizeCombinedPickScore(assembled)!;
  assert.deepEqual(safe.scores, emptyPickSubScores());
  assert.equal(safe.grade, "B");
  assert.equal(safe.composite, 7.2);
});

test("fix: bare legacy scores still expose real factor values, no invented grade", () => {
  const assembled = assemblePickCardData({
    scores: {
      matchup: 7,
      trend: 6,
      lineValue: 8,
      injury: null,
      lineShopping: 5,
      simulation: null,
    },
  });
  assert.equal(safePresentCount(assembled), 4);
  const safe = normalizeCombinedPickScore(assembled)!;
  assert.equal(safe.scores.matchup, 7);
  assert.equal(safe.composite, null);
  assert.equal(safe.grade, null);
});

test("fix: valid CombinedPickScore still counts all present factors", () => {
  const valid = combinePickScore(
    {
      matchup: 8,
      trend: 7,
      lineValue: 7.5,
      injury: 6,
      lineShopping: 5,
      simulation: 6.5,
    },
    5.2,
  );
  const assembled = assemblePickCardData({ scores: valid });
  assert.equal(safePresentCount(assembled), 6);
  assert.deepEqual(normalizeCombinedPickScore(assembled), valid);
});

test("mixed VirtualizedList payloads: one bad pick cannot crash the batch", () => {
  const picks = [
    { scores: combinePickScore(
      { matchup: 8, trend: 7, lineValue: 7, injury: 6, lineShopping: 5, simulation: 6 },
      4.1,
    ) },
    { scores: { composite: 7, grade: "B", confidencePct: 50 } },
    {
      finalAiScore: { grade: "A-", composite: 8.1, confidencePct: 70, edgePct: 6.2 },
      scores: null,
    },
    { scores: { scores: undefined, grade: "C", composite: 5.5 } },
  ];
  const results = picks.map((p) => safePresentCount(assemblePickCardData(p)));
  assert.equal(results[0], 6);
  assert.equal(results[1], 0);
  // grade-only via finalAiScore + null scores → fallback empty scores map
  assert.equal(results[2], 0);
  assert.equal(results[3], 0);
  assert.ok(results.every((r) => r === "unavailable" || typeof r === "number"));
});

// Market-weighting layer for the pick rubric. This is an EXPLICIT, user-configured
// ranking preference on TOP of the honest 5-signal rubric in lib/pickScore — it
// nudges a pick's Confidence based on (a) a fixed market-priority prior the user
// asked for and (b) the user's REAL historical Stadium Edge hit-rate by market.
//
// HONESTY CONTRACT:
//   * It only ADJUSTS a Confidence that the rubric already grounded from real
//     signals. A leg with no groundable signal has confidencePct === null and we
//     return it untouched — we NEVER manufacture a Confidence out of a market
//     preference.
//   * The performance bias is driven ONLY by real settled results (the grader's
//     win/loss ledger). It fires only when a market has a real, sufficient sample
//     (>= MIN_PERF_SAMPLE decided picks); otherwise it contributes nothing. No
//     fabricated hit rates, no assuming a market is hot/cold without the data.
//   * The static prior is a stated preference (boost rebounds / WNBA props /
//     defensive props / spreads; reduce points / assists / game totals / MLB
//     props), not a claim about data. It is bounded so it tilts ranking without
//     inventing certainty. Grade (the pure value composite) is left UNTOUCHED —
//     only Confidence, the metric the user referenced and the one Coach ranks /
//     filters on, is adjusted.

import type { CombinedPickScore } from "./pickScore.ts";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// The minimal pick shape this module needs. ParsedPick satisfies it structurally,
// so we avoid importing PickCard (and a circular dependency).
export type WeightablePick = {
  isProp?: boolean;
  sport?: string;
  market?: string;
  propMarketKey?: string;
};

// Real settled performance for one market family, on the grader's family
// taxonomy (lowercase: "rebounds", "points", "spread", "total", ...).
export type MarketPerf = { decided: number; hitRatePct: number | null };

// Gate + thresholds for the data-driven bias (exactly as requested):
//   below 40% over 20+ graded picks  -> downgrade
//   above 60% over 20+ graded picks  -> upgrade
export const MIN_PERF_SAMPLE = 20;
export const PERF_COLD_PCT = 40;
export const PERF_HOT_PCT = 60;
// Confidence points (0-100 scale) a cold/hot market moves a leg.
export const PERF_MAGNITUDE = 8;

export type WeightBucket =
  | "rebounds"
  | "wnba_props"
  | "defensive"
  | "spreads"
  | "points"
  | "assists"
  | "totals"
  | "mlb_props";

// Static market-priority prior, in Confidence points. Boosts are positive,
// reductions negative; ordering mirrors the user's stated priority within each
// list. A pick can match several buckets (e.g. a WNBA rebounds prop is both
// "rebounds" and "wnba_props") and the biases sum, then clamp.
export const STATIC_BIAS: Record<WeightBucket, number> = {
  // Prioritize (highest historical hit rate first)
  rebounds: 6,
  wnba_props: 5,
  defensive: 4, // blocks, steals
  spreads: 3,
  // Reduce confidence on
  points: -6,
  assists: -5,
  totals: -4,
  mlb_props: -3,
};

const STATIC_CLAMP = 10; // cap on the summed static prior
const TOTAL_CLAMP = 15; // cap on static + performance combined

// Map a pick to the grader's market-family key (lowercase), or null when we
// can't resolve one. Game lines come off `market`; props come off the raw Odds
// API `propMarketKey` (strip the player_/batter_/pitcher_ prefix, underscores ->
// spaces) so it lines up with the grader's `statText`-derived family
// ("total bases", "home runs", ...). Falls back to `market` for props with no key.
export function familyKeyForPick(pick: WeightablePick): string | null {
  if (!pick.isProp) {
    const m = (pick.market ?? "").toLowerCase();
    if (!m) return null;
    if (/\bspread|run line|puck line|handicap\b/.test(m)) return "spread";
    if (/\btotal|over|under\b/.test(m)) return "total";
    if (/moneyline|\bml\b|h2h/.test(m)) return "moneyline";
    return m;
  }
  const key = (pick.propMarketKey ?? "").toLowerCase();
  if (key) {
    const stat = key.replace(/^(player|batter|pitcher)_/, "").replace(/_/g, " ").trim();
    return stat || null;
  }
  const m = (pick.market ?? "").toLowerCase().trim();
  return m || null;
}

// Which weighting buckets a pick falls into. A pick can be in several.
export function classifyBuckets(pick: WeightablePick): WeightBucket[] {
  const buckets: WeightBucket[] = [];
  const fam = familyKeyForPick(pick);
  const sport = (pick.sport ?? "").toLowerCase();
  const isProp = !!pick.isProp;
  const mk = (pick.propMarketKey ?? "").toLowerCase();

  // Boosts
  if (fam === "rebounds") buckets.push("rebounds");
  if (isProp && sport === "wnba") buckets.push("wnba_props");
  if (isProp && (mk.includes("block") || mk.includes("steal") || fam === "blocks" || fam === "steals"))
    buckets.push("defensive");
  if (fam === "spread") buckets.push("spreads");

  // Reductions
  if (fam === "points") buckets.push("points");
  if (fam === "assists") buckets.push("assists");
  if (fam === "total") buckets.push("totals");
  if (isProp && sport === "mlb") buckets.push("mlb_props");

  return buckets;
}

// The fixed market-priority prior for a pick, in Confidence points (clamped).
export function staticBiasPoints(pick: WeightablePick): number {
  const sum = classifyBuckets(pick).reduce((a, b) => a + STATIC_BIAS[b], 0);
  return clamp(sum, -STATIC_CLAMP, STATIC_CLAMP);
}

// The data-driven bias from REAL settled results. Fires only on a sufficient,
// real sample for the pick's market family; otherwise 0 (no data -> no nudge).
export function performanceBiasPoints(
  pick: WeightablePick,
  perfByFamily: Map<string, MarketPerf> | undefined,
): number {
  if (!perfByFamily) return 0;
  const fam = familyKeyForPick(pick);
  if (!fam) return 0;
  const perf = perfByFamily.get(fam);
  if (!perf || perf.hitRatePct == null || perf.decided < MIN_PERF_SAMPLE) return 0;
  if (perf.hitRatePct < PERF_COLD_PCT) return -PERF_MAGNITUDE;
  if (perf.hitRatePct > PERF_HOT_PCT) return PERF_MAGNITUDE;
  return 0;
}

// Total Confidence delta for a pick (static prior + real-performance bias),
// clamped so the layer tilts ranking without manufacturing certainty.
export function marketConfidenceDelta(
  pick: WeightablePick,
  perfByFamily?: Map<string, MarketPerf>,
): number {
  const total = staticBiasPoints(pick) + performanceBiasPoints(pick, perfByFamily);
  return clamp(total, -TOTAL_CLAMP, TOTAL_CLAMP);
}

// Apply the market-weighting layer to a combined pick score. Returns a NEW score
// with confidencePct nudged and clamped to the rubric's 5-95 band. A null score
// or a null confidence (ungroundable leg) is returned untouched — we never invent
// a Confidence from a market preference. Grade/edge are never altered.
export function applyMarketWeighting(
  combined: CombinedPickScore | null,
  pick: WeightablePick,
  perfByFamily?: Map<string, MarketPerf>,
): CombinedPickScore | null {
  if (!combined || combined.confidencePct == null) return combined;
  const delta = marketConfidenceDelta(pick, perfByFamily);
  if (delta === 0) return combined;
  const adjusted = clamp(Math.round(combined.confidencePct + delta), 5, 95);
  if (adjusted === combined.confidencePct) return combined;
  return { ...combined, confidencePct: adjusted };
}

// Build the family -> real-performance map the layer reads, from the Model
// Report's byFamily breakdown (computeAnalytics(results).byFamily). Decided =
// wins + losses (pushes are no-action). Kept structural so this module stays
// db-free and unit-testable under `node --test`.
export function perfMapFromByFamily(
  byFamily: Array<{ key: string; tally: { wins: number; losses: number; pushes: number } }>,
): Map<string, MarketPerf> {
  const map = new Map<string, MarketPerf>();
  for (const b of byFamily) {
    const decided = b.tally.wins + b.tally.losses;
    const hitRatePct = decided > 0 ? (b.tally.wins / decided) * 100 : null;
    map.set(b.key.toLowerCase(), { decided, hitRatePct });
  }
  return map;
}

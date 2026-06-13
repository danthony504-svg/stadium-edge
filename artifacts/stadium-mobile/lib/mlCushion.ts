// Moneyline "cushion" tier selection for the PickCard line-ladder.
//
// A moneyline only cashes on an outright win; a spread that gives the SAME team
// points also cashes if they merely lose by fewer than the line. So for an ML
// pick we offer the book's REAL posted alt-spread rungs on that team inside a
// +1..+20 point band as the card's Safe/Value tiers — every such rung is
// strictly safer than the ML. This module owns ONLY the tier selection (which
// eligible rung is Safe vs Value); the caller does the real-pool filtering
// (same game / same team / spread family / band / juice floor) so this stays a
// pure, unit-testable function with no React Native coupling.

// +1..+20 points TO the team only (a positive handicap = a cushion).
export const ML_CUSHION_MIN_PTS = 1;
export const ML_CUSHION_MAX_PTS = 20;

// Only PLUS-MONEY cushion rungs (American odds >= +100) qualify. The point of an
// ML cushion is to ADD AN EDGE — a better-than-even payout while still derisking
// the bet by giving the team points — not to lay heavy juice for safety. A
// same-team alt spread priced at minus money is dropped, so the card falls back
// to BEST only rather than showing an expensive "safe" rung.
export const ML_CUSHION_MIN_ODDS = 100;

export type CushionRung = { line: number; odds: number };

// Pick the Safe and Value tiers from the eligible cushion rungs:
//   Safe  = the most PROTECTIVE rung = the book's safest price = LOWEST odds
//           (most juice). Tie-break: the deeper cushion (more points), then the
//           earlier entry — fully deterministic.
//   Value = the highest PAYOUT rung = HIGHEST odds. Same tie-breaks.
// Returns indices into `rungs`. `value` is null when there is only one rung or
// when Safe and Value resolve to the same rung (so the card shows Safe + Best
// only, never a duplicate chip). Returns null entirely for an empty input.
//
// Odds drive the choice (not line alone) because a real book can misprice/stale
// an alt line so that the shallowest line is NOT the highest payout — Value must
// be the genuinely better price, never just the nearest line.
export function chooseMlCushionTiers(
  rungs: CushionRung[],
): { safe: number; value: number | null } | null {
  if (rungs.length === 0) return null;
  let safe = 0;
  let value = 0;
  for (let i = 1; i < rungs.length; i++) {
    const r = rungs[i]!;
    const s = rungs[safe]!;
    const v = rungs[value]!;
    // Safe: lowest odds; tie -> more points (deeper cushion).
    if (r.odds < s.odds || (r.odds === s.odds && r.line > s.line)) safe = i;
    // Value: highest odds; tie -> more points (safer at the same price).
    if (r.odds > v.odds || (r.odds === v.odds && r.line > v.line)) value = i;
  }
  return { safe, value: value === safe ? null : value };
}

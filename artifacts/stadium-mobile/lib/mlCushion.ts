// Moneyline "cushion" tier selection for the PickCard line-ladder.
//
// A moneyline only cashes on an outright win; a spread that gives the SAME team
// points also cashes if they merely lose by fewer than the line. So for an ML
// pick we offer the book's REAL posted alt-spread rungs on that team inside a
// +1..+20 point band as the card's Safe/Value tiers — every such rung is
// strictly safer than the ML. This module owns ONLY the tier selection (which
// eligible rung is Safe vs Value); the caller does the real-pool filtering
// (same game / same team / spread family / band) so this stays a pure,
// unit-testable function with no React Native coupling.

// +1..+20 points TO the team only (a positive handicap = a cushion).
export const ML_CUSHION_MIN_PTS = 1;
export const ML_CUSHION_MAX_PTS = 20;

// The boundary between the two cushion bands, in American odds. A rung priced at
// >= +100 (plus money) is a VALUE rung; anything below is a SAFE rung.
export const ML_CUSHION_MIN_ODDS = 100;

export type CushionRung = { line: number; odds: number };

export type TwoBandTiers = { safe: number | null; value: number | null };

// Pick the Safe and Value tiers from the eligible cushion rungs, drawing each
// from its OWN price band so a card can show one, both, or neither:
//
//   Value = the highest-PAYOUT real PLUS-money rung (odds >= ML_CUSHION_MIN_ODDS).
//           Adds points to the team AND still pays better than even — the
//           genuine edge play. Tie -> the deeper cushion (more points).
//   Safe  = the most protective real MINUS-money rung: the DEEPEST line (most
//           points, e.g. a +2/+3 run line) priced from just under +100 down to
//           `floorOdds`. You lay juice for safety and a lower payout, but it
//           rarely loses. Buried no-payout juice past `floorOdds` is excluded.
//           Tie -> the better (less negative) odds.
//
// The two bands are disjoint by price, so Safe and Value never resolve to the
// same rung. Returns null for a band with no eligible rung. Odds (not line)
// drive the Value choice because a real book can misprice/stale an alt rung so
// the shallowest line is not the best payout — Value must be the genuinely
// better price.
export function chooseMlCushionTwoBand(
  rungs: CushionRung[],
  floorOdds: number,
): TwoBandTiers {
  let safe: number | null = null;
  let value: number | null = null;
  for (let i = 0; i < rungs.length; i++) {
    const r = rungs[i]!;
    if (r.odds >= ML_CUSHION_MIN_ODDS) {
      // Value band: highest payout; tie -> deeper cushion (more points).
      if (value === null) {
        value = i;
      } else {
        const v = rungs[value]!;
        if (r.odds > v.odds || (r.odds === v.odds && r.line > v.line)) value = i;
      }
    } else if (r.odds >= floorOdds) {
      // Safe band: deepest cushion (most points); tie -> less-negative odds.
      if (safe === null) {
        safe = i;
      } else {
        const s = rungs[safe]!;
        if (r.line > s.line || (r.line === s.line && r.odds > s.odds)) safe = i;
      }
    }
  }
  return { safe, value };
}

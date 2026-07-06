// Universal AI Coach rules — every sport, every ticket surface.

/** Never recommend AI Grade below C+ on Coach surfaces. */
export const UNIVERSAL_MIN_GRADE = "C+";

/** Require Confidence ≥ 52 on every Coach recommendation. */
export const UNIVERSAL_MIN_CONFIDENCE = 52;

/** Cross-book / line-shopping score (1–10) that validates market agreement. */
export const LINE_SIGNAL_MIN_SHOPPING_SCORE = 5.5;

/** Book spread advantage (pct pts) toward the picked side. */
export const LINE_SIGNAL_MIN_BOOK_SPREAD = 1;

/** Strong edge overrides missing line-history feeds. */
export const LINE_SIGNAL_STRONG_EDGE_PCT = 2.5;

export const UNIVERSAL_AI_RULES = [
  "Only recommend positive EV bets",
  "Never recommend negative-edge bets",
  `Never recommend AI Grade below ${UNIVERSAL_MIN_GRADE}`,
  `Require Confidence ≥ ${UNIVERSAL_MIN_CONFIDENCE}`,
  "Check line movement / cross-book price before recommending",
  "Avoid correlated picks unless building an intentional same-game parlay",
  "Never recommend opposite sides of the same game",
  "Remove duplicate picks across tickets",
  "Diversify markets — do not overload one stat type without clear edge",
  "Learn from historical performance by sport, market, player, and sportsbook",
] as const;

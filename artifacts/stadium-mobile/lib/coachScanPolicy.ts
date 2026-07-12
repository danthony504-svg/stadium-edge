// Coach full-board parlay scan policy — enforced in boardMarketScanner, ticket
// staging, and delivery gates. Never pad tickets with ungraded posted lines.

export const COACH_FULL_BOARD_SCAN_POLICY =
  "Scan every available market. Return all AI Recommended picks first. If fewer than the requested number qualify, continue scanning alternate lines, props, periods, innings, quarters, halves, and team totals until enough AI Recommended picks are found. Only if every posted market has been evaluated and there still aren't enough qualifying picks should the app return fewer legs. Never add filler picks just to reach the requested number.";

export const COACH_NO_FILLER_SHORTFALL =
  "Every posted market was scanned — these are every AI Recommended and qualifying alt pick on the board. No filler was added to reach your requested leg count.";

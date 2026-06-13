// Pure, dependency-free helpers for the "+500 Steals" screen. The server
// (api-server lib/liveSteals.ts) does ALL the finding/grading honestly — every
// surfaced steal carries a REAL cross-book no-vig edge and the W/L record is
// graded against real results only. These helpers are display-side formatting +
// the small derived stats the header card shows; they never invent a steal.

// The longshot price band, in American odds. Mirrors the server constants so the
// client can label the section and (defensively) reject anything out of band.
export const STEAL_MIN_ODDS = 500;
export const STEAL_MAX_ODDS = 30000;

export function inStealBand(price: number | null | undefined): boolean {
  return price != null && price >= STEAL_MIN_ODDS && price <= STEAL_MAX_ODDS;
}

// "+650" / "-120". Plus sign is mandatory for positive American odds.
export function formatOdds(american: number): string {
  return american > 0 ? `+${american}` : `${american}`;
}

// "+12.4%" / "0%" / "" for null. EV/edge are real percentages from the feed.
export function formatPct(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "";
  const r = Math.round(pct * 10) / 10;
  return r > 0 ? `+${r}%` : `${r}%`;
}

export type StealRecord = {
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  ungraded: number;
  graded: number;
};

// Win rate over SETTLED win/loss picks only (pushes are no-action, pending and
// ungraded aren't decided). Returns null when nothing decisive has graded yet,
// so the UI shows "—" instead of a fake 0%/100%. Range 0..100, 1 decimal.
export function recordWinPct(rec: StealRecord): number | null {
  const decided = rec.wins + rec.losses;
  if (decided <= 0) return null;
  return Math.round((rec.wins / decided) * 1000) / 10;
}

// Compact W-L(-P) record string, e.g. "7-3" or "7-3-1" (push shown only if any).
export function recordLabel(rec: StealRecord): string {
  const base = `${rec.wins}-${rec.losses}`;
  return rec.pushes > 0 ? `${base}-${rec.pushes}` : base;
}

// American decimal payout of a price (for "to win $X" math). 1 unit stake.
export function americanToDecimal(american: number): number {
  return american > 0 ? american / 100 + 1 : 100 / -american + 1;
}

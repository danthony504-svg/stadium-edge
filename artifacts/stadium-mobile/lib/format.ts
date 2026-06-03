// Odds / parlay math — American odds throughout, matching the web app.

export function formatAmerican(odds: number | null | undefined): string {
  if (odds == null || !Number.isFinite(odds)) return "—";
  const n = Math.round(odds);
  return n > 0 ? `+${n}` : `${n}`;
}

// American odds -> decimal multiplier (e.g. -110 -> 1.909, +150 -> 2.5).
export function americanToDecimal(odds: number): number {
  if (!Number.isFinite(odds) || odds === 0) return 1;
  return odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds);
}

// Decimal multiplier -> American odds.
export function decimalToAmerican(dec: number): number {
  if (!Number.isFinite(dec) || dec <= 1) return 0;
  return dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1));
}

// Implied probability (0..1) for a single American price.
export function impliedProb(odds: number): number {
  if (!Number.isFinite(odds) || odds === 0) return 0;
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}

// Combined American odds of a parlay (multiply the decimal legs).
export function parlayAmerican(legOdds: number[]): number | null {
  const valid = legOdds.filter((o) => Number.isFinite(o) && o !== 0);
  if (valid.length === 0) return null;
  const dec = valid.reduce((acc, o) => acc * americanToDecimal(o), 1);
  return decimalToAmerican(dec);
}

// Combined implied probability of the whole parlay (0..1).
export function parlayImplied(legOdds: number[]): number {
  const valid = legOdds.filter((o) => Number.isFinite(o) && o !== 0);
  if (valid.length === 0) return 0;
  return valid.reduce((acc, o) => acc * impliedProb(o), 1);
}

// Total return (stake + winnings) for a stake on combined American odds.
export function payout(stake: number, combinedAmerican: number | null): number {
  if (combinedAmerican == null || !Number.isFinite(stake) || stake <= 0) return 0;
  return stake * americanToDecimal(combinedAmerican);
}

// Parse an American odds token out of an AI PICK line field (e.g. "+120", "-140").
export function parseOdds(token: string): number | null {
  if (!token) return null;
  const m = token.replace(/[−–—]/g, "-").match(/[+-]?\d+/);
  if (!m) return null;
  const n = parseInt(m[0], 10);
  return Number.isFinite(n) ? n : null;
}

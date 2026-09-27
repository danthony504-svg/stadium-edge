/** American odds ↔ implied probability helpers for coach-data normalization. */

export function americanToDecimal(american: number): number {
  if (american === 0) return 1;
  return american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
}

export function impliedProbabilityFromAmerican(american: number): number {
  if (american === 0) return 0;
  if (american < 0) return Math.abs(american) / (Math.abs(american) + 100);
  return 100 / (american + 100);
}

export function normalizeSportId(sport: string): string {
  return sport.toLowerCase().trim();
}

export function normalizeGameId(gameLabel: string): string {
  return gameLabel.trim();
}

export function formatPropPick(side: "Over" | "Under", line: number | null): string {
  if (line == null) return side;
  return `${side} ${line}`;
}

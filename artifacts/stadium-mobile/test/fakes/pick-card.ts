// Test stub — avoids loading the full React Native PickCard module in node --test.

export type ParsedPick = {
  game: string;
  market: string;
  pick: string;
  odds: number;
  sport?: string;
  isProp?: boolean;
  player?: string;
  ticketRole?: "main" | "alt";
  edge?: string | null;
  finalAiScore?: Record<string, unknown> | null;
  scores?: { composite?: number | null } | null;
  [key: string]: unknown;
};

export function backfillPicks<T>(picks: T[]): T[] {
  return picks;
}

export function backfillProps<T>(picks: T[]): T[] {
  return picks;
}

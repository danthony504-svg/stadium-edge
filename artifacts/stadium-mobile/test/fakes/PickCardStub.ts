/** Test stub — avoids loading React Native PickCard.tsx under node --test. */

export type ParsedPick = Record<string, unknown> & {
  game?: string;
  market?: string;
  pick?: string;
  odds?: number | null;
  isProp?: boolean;
  player?: string;
  sport?: string;
  startsAt?: string | null;
  ticketRole?: "main" | "alt";
  finalAiScore?: unknown;
};

export type AltRungOption = Record<string, unknown>;
export type SimAltTierLabel = "Safest" | "Best" | "Best Value" | "High Risk";
export type SimAltLine = AltRungOption & { tierLabel: SimAltTierLabel };
export type AltRungBias = "value" | "cushion" | null;

export function backfillPicks<T>(existing: T[]): T[] {
  return existing;
}
export function backfillProps<T>(existing: T[]): T[] {
  return existing;
}
export function enrichPickMeta<T>(pick: T): T {
  return pick;
}
export function marketFamily(s: string): string {
  return String(s ?? "");
}
export function parsePicks(): ParsedPick[] {
  return [];
}
export function sameGame(): boolean {
  return false;
}
export function gameAltOptions(): AltRungOption[] {
  return [];
}
export function gameSideFromPick(): null {
  return null;
}
export function gameTotalFromPick(): null {
  return null;
}
export function parseEdgeStats(): Record<string, unknown> {
  return {};
}
export function EdgeReadout(): null {
  return null;
}
export function PickCard(): null {
  return null;
}
export const norm = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const ALT_BACKFILL_ORDER: RegExp[] = [];
export const GENERIC_BACKFILL_ORDER: RegExp[] = [];
export const FULL_REACH_GAME_ORDER: RegExp[] = [];
export const PERIOD_BACKFILL_ORDER: RegExp[] = [];

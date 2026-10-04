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
  const m = norm(String(s ?? ""));
  if (/spread|run ?line|puck ?line/.test(m)) return "spread";
  if (/total|over|under|o\/u/.test(m)) return "total";
  if (/money|h2h|\bml\b/.test(m)) return "moneyline";
  return m;
}
export function parsePicks(): ParsedPick[] {
  return [];
}
export function sameGame(a?: string, b?: string): boolean {
  if (a == null || b == null) return false;
  if (a === b) return true;
  const na = norm(a);
  const nb = norm(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}
export function gameAltOptions(): AltRungOption[] {
  return [];
}
export function gameSideFromPick(
  pick?: ParsedPick,
): { name: string; opp: string; isHome: boolean; line: number | null } | null {
  if (!pick || pick.isProp) return null;
  const text = norm(String(pick.pick ?? ""));
  if (/\b(over|under)\b/.test(text)) return null;
  const parts = String(pick.game ?? "").split(/\s+@\s+/);
  if (parts.length !== 2) return null;
  const [away, home] = parts.map((s) => s.trim());
  const nick = (team: string) => {
    const t = norm(team).split(" ").filter(Boolean);
    return t[t.length - 1] || "";
  };
  const homeNick = nick(home);
  const awayNick = nick(away);
  const matchHome =
    text.includes(norm(home)) || (homeNick.length > 2 && text.split(" ").includes(homeNick));
  const matchAway =
    text.includes(norm(away)) || (awayNick.length > 2 && text.split(" ").includes(awayNick));
  if (matchHome === matchAway) return null;
  if (matchHome) return { name: home, opp: away, isHome: true, line: null };
  return { name: away, opp: home, isHome: false, line: null };
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

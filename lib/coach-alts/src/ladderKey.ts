import type { CoachQualifiedLeg } from "@workspace/coach-types";

const norm = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function pickSideKey(leg: CoachQualifiedLeg): string {
  if (leg.propSide) return leg.propSide.toLowerCase();
  const p = norm(leg.pick);
  if (/\bover\b/.test(p)) return "over";
  if (/\bunder\b/.test(p)) return "under";
  const team = leg.pick
    .replace(/\s*(ml|moneyline)\s*$/i, "")
    .replace(/\s*[+-]?\d+(?:\.\d+)?\s*$/, "")
    .trim();
  return norm(team);
}

function marketFamilyKey(marketKey: string, marketLabel: string): string {
  const m = norm(`${marketKey} ${marketLabel}`);
  if (/\b(1h|2h|q1|q2|q3|q4|f5)\b/.test(m)) {
    const period = m.match(/\b(1h|2h|q1|q2|q3|q4|f5)\b/)?.[1] ?? "";
    if (/spread|run line|puck line/.test(m)) return `${period}:spread`;
    if (/total|over|under/.test(m)) return `${period}:total`;
    if (/money|ml|h2h/.test(m)) return `${period}:moneyline`;
  }
  if (/spread|run line|puck line/.test(m)) return "spread";
  if (/total|team total/.test(m)) return "total";
  if (/money|h2h|ml/.test(m)) return "moneyline";
  return marketKey;
}

/** Stable key grouping main + alt rungs on the same market ladder. */
export function marketLadderKey(leg: CoachQualifiedLeg): string {
  if (leg.kind === "player_prop") {
    const player = norm(leg.playerName ?? leg.playerId ?? "player");
    const side = pickSideKey(leg);
    return `${norm(leg.gameLabel)}|prop|${player}|${norm(leg.marketKey)}|${side}`;
  }
  return `${norm(leg.gameLabel)}|${marketFamilyKey(leg.marketKey, leg.marketLabel)}|${pickSideKey(leg)}`;
}

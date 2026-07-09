// Drop Coach prop picks that lack a real game-log sample for the posted stat.
// The model and backfill must not surface "analytics" on a player the feed
// cannot grade (e.g. James Jarvis SB with no ESPN log).

import type { ParsedPick } from "../components/PickCard.tsx";
import { PROP_MARKET_LABEL_MAP } from "./propMarketLabel.ts";
import type { PlayerHistorySlice } from "./pickScoreContext.ts";
import { gameValueForMarket } from "./propStats.ts";

/** Minimum recent games with a real value for this market before a prop is pickable. */
export const PROP_HISTORY_MIN_GAMES = 3;

/** Rare counting stats — the column can be present every game as 0 without real opportunity. */
export const RARE_LOW_VOLUME_MARKETS = new Set(["batter_stolen_bases"]);

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function playerHistoryFor(
  player: string | undefined,
  athleteId: string | null | undefined,
  map?: Record<string, PlayerHistorySlice>,
): PlayerHistorySlice | undefined {
  if (!map) return undefined;
  if (athleteId) {
    const hit =
      map[`${player}#${athleteId}`] ??
      Object.entries(map).find(([k]) => k.endsWith(`#${athleteId}`))?.[1];
    if (hit) return hit;
  }
  if (player) {
    const hit = Object.entries(map).find(([k]) => k.startsWith(`${player}#`))?.[1];
    if (hit) return hit;
  }
  return undefined;
}

export function marketKeyForPick(pick: ParsedPick): string | null {
  if (pick.propMarketKey) return pick.propMarketKey;
  const target = norm(pick.market);
  for (const [key, label] of Object.entries(PROP_MARKET_LABEL_MAP)) {
    const lab = norm(label);
    if (lab === target || target.startsWith(lab)) return key;
  }
  return null;
}

/** Count recent games where ESPN carried a real per-game value for this market. */
export function groundedPropStatGames(
  ph: PlayerHistorySlice | undefined,
  marketKey: string,
  minGames = PROP_HISTORY_MIN_GAMES,
): number {
  if (!ph?.recent?.length || !marketKey) return 0;
  let n = 0;
  for (const g of ph.recent) {
    const raw = g.stats ?? {};
    const stats: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v != null && v !== "") stats[k] = String(v);
    }
    const v = gameValueForMarket(marketKey, stats, new Set());
    if (v != null) n++;
    if (n >= minGames) break;
  }
  return n;
}

/** Rare-event markets need real activity in the log, not five straight zeros. */
export function rareEventHasRealActivity(
  ph: PlayerHistorySlice | undefined,
  marketKey: string,
): boolean {
  if (!RARE_LOW_VOLUME_MARKETS.has(marketKey)) return true;
  if (!ph?.recent?.length) return false;
  let nonZero = 0;
  for (const g of ph.recent) {
    const raw = g.stats ?? {};
    const stats: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v != null && v !== "") stats[k] = String(v);
    }
    const v = gameValueForMarket(marketKey, stats, new Set());
    if (v != null && v > 0) nonZero++;
  }
  return nonZero >= 1;
}

export function propHasGroundedGameLog(
  pick: ParsedPick,
  playerHistory?: Record<string, PlayerHistorySlice>,
  minGames = PROP_HISTORY_MIN_GAMES,
): boolean {
  if (!pick.isProp) return true;
  const ph = playerHistoryFor(pick.player, pick.athleteId, playerHistory);
  if (!ph?.recent?.length) return false;
  const mk = marketKeyForPick(pick);
  if (!mk) return false;
  if (groundedPropStatGames(ph, mk, minGames) < minGames) return false;
  return rareEventHasRealActivity(ph, mk);
}

export function dropUngroundedPropPicks(
  picks: ParsedPick[],
  playerHistory?: Record<string, PlayerHistorySlice>,
  minGames = PROP_HISTORY_MIN_GAMES,
): { picks: ParsedPick[]; dropped: ParsedPick[] } {
  const kept: ParsedPick[] = [];
  const dropped: ParsedPick[] = [];
  for (const p of picks) {
    if (propHasGroundedGameLog(p, playerHistory, minGames)) kept.push(p);
    else if (p.isProp) dropped.push(p);
    else kept.push(p);
  }
  return { picks: kept, dropped };
}

export function propPoolEntryHasGroundedHistory(
  entry: { player: string; athleteId?: string | null; marketKey?: string | null; marketLabel?: string },
  playerHistory?: Record<string, PlayerHistorySlice>,
  minGames = PROP_HISTORY_MIN_GAMES,
): boolean {
  const ph = playerHistoryFor(entry.player, entry.athleteId, playerHistory);
  const mk =
    entry.marketKey ??
    (entry.marketLabel
      ? marketKeyForPick({
          isProp: true,
          game: "",
          market: entry.marketLabel,
          pick: "",
          odds: 0,
          propMarketKey: null,
        } as ParsedPick)
      : null);
  if (!mk) return false;
  if (groundedPropStatGames(ph, mk, minGames) < minGames) return false;
  return rareEventHasRealActivity(ph, mk);
}

export function enforceGroundedPropHistory(
  picks: ParsedPick[],
  playerHistory?: Record<string, PlayerHistorySlice>,
): { picks: ParsedPick[]; dropped: ParsedPick[] } {
  return dropUngroundedPropPicks(picks, playerHistory);
}

export function groundedPropHistoryNote(dropped: ParsedPick[]): string {
  if (!dropped.length) return "";
  const names = [...new Set(dropped.map((p) => p.player).filter(Boolean))].slice(0, 4);
  const label = names.length ? ` (${names.join(", ")})` : "";
  return `_Dropped ${dropped.length} player prop${dropped.length === 1 ? "" : "s"} with no real game-log sample for that stat${label} — the Coach only recommends props it can grade from real ESPN logs (stolen-base props need at least one steal in the recent log)._`;
}

/**
 * Pure local grading for NFL/NCAAF props-only tickets.
 * Kept free of api.ts so node:test can prove history → sim hit.
 *
 * Rebuild after #541 phone empties ("8 leg NFL player props" → quality bar):
 * - Odds API anytime_td often posts Yes/No with line:null — treat as 0.5
 * - Grade both Over/Under when posted; keep the history-supported EV side
 * - Odds gate uses hit ≥ implied (float-safe) so fair -110 can stage
 */

import type { ParsedPick } from "../components/PickCard.tsx";
import { computeAmbiguous, gameValueForMarket } from "./propStats.ts";
import { clipPropSimHitForGrade, pickHasSimGrade } from "./simMarketSupport.ts";
import { impliedProb } from "./format.ts";
import { simEvPct } from "./gameSimQualityGates.ts";

export type PropsOnlyHit = { hitProbability: number | null; nullReason?: string | null };

export type PropsOnlyHistorySlice = {
  player?: string;
  labels?: string[];
  recent?: { stats?: Record<string, string> }[];
};

type PoolRow = {
  player: string;
  side: string;
  line: number | null;
  game?: string;
  marketKey?: string | null;
  bookSpread?: number | null;
  edge?: number | null;
  odds?: number;
};

/** Yes/No skill markets the Odds API often posts with point=null. */
const BINARY_NULL_LINE_MARKETS = new Set([
  "player_anytime_td",
  "player_first_td",
  "player_double_double",
]);

/** Map Odds API / feed sport keys to ESPN player-history sport ids. */
export function normalizeHistorySport(sport: string | null | undefined): string {
  const n = String(sport ?? "")
    .toLowerCase()
    .trim();
  if (!n) return "";
  if (n === "nfl" || n === "football" || n.includes("americanfootball_nfl")) return "nfl";
  if (n === "ncaaf" || n === "cfb" || n.includes("americanfootball_ncaaf")) return "ncaaf";
  if (n === "nba" || n.includes("basketball_nba")) return "nba";
  if (n === "wnba" || n.includes("basketball_wnba")) return "wnba";
  if (n === "mlb" || n.includes("baseball_mlb")) return "mlb";
  if (n === "nhl" || n.includes("icehockey_nhl")) return "nhl";
  if (n === "ncaab" || n.includes("basketball_ncaab")) return "ncaab";
  if (n.startsWith("soccer") || n.includes("soccer_")) return "soccer";
  return n;
}

export function isBinaryNullLineMarket(market: string | null | undefined): boolean {
  const m = String(market ?? "")
    .toLowerCase()
    .trim();
  if (BINARY_NULL_LINE_MARKETS.has(m)) return true;
  return /\banytime_td\b|\bfirst_td\b|\banytime\s*td\b|\btouchdown\b/.test(m);
}

/**
 * Effective grading line: Odds API anytime TD Yes/No arrives as line:null.
 * Books mean Over 0.5 — without this default, candidacy + history keys die.
 */
export function propsOnlyEffectiveLine(
  pick: {
    propLine?: number | null;
    propMarketKey?: string | null;
    market?: string | null;
    line?: number | null;
  },
): number | null {
  const raw = pick.propLine ?? pick.line ?? null;
  if (raw != null && Number.isFinite(raw)) return raw;
  if (isBinaryNullLineMarket(pick.propMarketKey ?? pick.market)) return 0.5;
  return null;
}

/** Stamp null-line binary TDs to Over 0.5 so lookup/grade/stage share one key. */
export function normalizePropsOnlyPick(pick: ParsedPick): ParsedPick {
  const line = propsOnlyEffectiveLine(pick);
  if (line == null || pick.propLine === line) {
    if (pick.propSide === "Yes") return { ...pick, propSide: "Over" };
    if (pick.propSide === "No") return { ...pick, propSide: "Under" };
    return pick;
  }
  const side =
    pick.propSide === "Under" || pick.propSide === "No"
      ? "Under"
      : pick.propSide === "Over" || pick.propSide === "Yes" || !pick.propSide
        ? "Over"
        : pick.propSide;
  const player = pick.player ?? "";
  const label = pick.market ?? pick.propMarketKey ?? "";
  return {
    ...pick,
    propLine: line,
    propSide: side,
    pick:
      player && line != null
        ? `${player} ${side} ${line} ${label}`.trim()
        : pick.pick,
  };
}

function propSimKey(
  player: string,
  market: string,
  line: number,
  side: string,
): string {
  return `${player}|${market}|${line}|${side}`;
}

export function propsOnlySimLookupKey(
  pick: {
    player?: string;
    propMarketKey?: string | null;
    market?: string;
    propLine?: number | null;
    propSide?: string | null;
  },
  poolRow?: { marketKey?: string | null; line?: number | null } | null,
): string | null {
  const line = propsOnlyEffectiveLine({
    propLine: pick.propLine,
    propMarketKey: pick.propMarketKey,
    market: pick.market,
    line: poolRow?.line,
  });
  if (!pick.player || line == null) return null;
  const side =
    pick.propSide === "Under" || pick.propSide === "No"
      ? "Under"
      : pick.propSide === "Over" || pick.propSide === "Yes"
        ? "Over"
        : null;
  if (!side) return null;
  const market = pick.propMarketKey ?? poolRow?.marketKey ?? pick.market ?? "";
  return propSimKey(pick.player, market, line, side);
}

export function lookupPropsOnlyHit(
  pick: Parameters<typeof propsOnlySimLookupKey>[0],
  poolRow: Parameters<typeof propsOnlySimLookupKey>[1],
  hits: Map<string, PropsOnlyHit>,
): number | null {
  const keys = new Set<string>();
  const primary = propsOnlySimLookupKey(pick, poolRow);
  if (primary) keys.add(primary);
  const altMarket = pick.propMarketKey ? pick.market : pick.propMarketKey;
  if (altMarket) {
    const alt = propsOnlySimLookupKey({ ...pick, propMarketKey: altMarket }, poolRow);
    if (alt) keys.add(alt);
  }
  for (const key of keys) {
    const hit = hits.get(key)?.hitProbability;
    if (hit != null && Number.isFinite(hit)) return hit;
  }
  return null;
}

function historyForPick(
  pick: ParsedPick,
  histories: Record<string, PropsOnlyHistorySlice | undefined>,
): PropsOnlyHistorySlice | null {
  if (!pick.player) return null;
  if (pick.athleteId) {
    const keyed = histories[`${pick.player}#${pick.athleteId}`];
    if (keyed?.recent?.length) return keyed;
  }
  const byName = Object.entries(histories).find(
    ([k, v]) => k.startsWith(`${pick.player}#`) && (v?.recent?.length ?? 0) > 0,
  )?.[1];
  return byName ?? null;
}

export function propsOnlyPoolRowForPick(pick: ParsedPick, pool: PoolRow[]): PoolRow | undefined {
  const norm = normalizePropsOnlyPick(pick);
  const side = norm.propSide === "Under" ? "Under" : norm.propSide === "Over" ? "Over" : null;
  const line = propsOnlyEffectiveLine(norm);
  if (!side || line == null) return undefined;
  return (
    pool.find(
      (e) =>
        e.player === norm.player &&
        e.side === side &&
        (e.line === line ||
          e.line === pick.propLine ||
          (e.line == null && isBinaryNullLineMarket(norm.propMarketKey ?? norm.market))) &&
        (norm.game ? e.game === norm.game : true),
    ) ??
    pool.find((e) => e.player === norm.player && e.side === side) ??
    pool.find(
      (e) =>
        e.player === norm.player &&
        (e.line === line || e.line == null) &&
        (norm.game ? e.game === norm.game : true),
    )
  );
}

function localHitFromHistory(
  history: PropsOnlyHistorySlice | null | undefined,
  args: { market: string; line: number; side: "Over" | "Under" },
): number | null {
  const recent = history?.recent ?? [];
  if (!recent.length) return null;
  const ambiguous = computeAmbiguous(history?.labels);
  const vals = recent
    .map((g) => gameValueForMarket(args.market, g.stats ?? {}, ambiguous))
    .filter((v): v is number => v != null)
    .slice(0, 10);
  if (vals.length < 3) return null;
  const hits = vals.filter((v) => (args.side === "Under" ? v < args.line : v >= args.line)).length;
  const hitProbRaw = hits / vals.length;
  return hitProbRaw <= 0 ? 0.02 : hitProbRaw >= 1 ? 0.98 : hitProbRaw;
}

export function gradeFootballPropFromHistory(
  pick: ParsedPick,
  hist: PropsOnlyHistorySlice | null | undefined,
  poolRow?: { marketKey?: string | null; line?: number | null } | null,
): PropsOnlyHit {
  const norm = normalizePropsOnlyPick(pick);
  const market = norm.propMarketKey ?? poolRow?.marketKey ?? null;
  const side = norm.propSide === "Under" ? "Under" : norm.propSide === "Over" ? "Over" : null;
  const line = propsOnlyEffectiveLine({
    propLine: norm.propLine,
    propMarketKey: norm.propMarketKey,
    market: norm.market,
    line: poolRow?.line,
  });
  if (!market || line == null || !side || !norm.player) {
    return { hitProbability: null, nullReason: "incomplete_prop" };
  }
  if (!hist?.recent?.length) {
    return { hitProbability: null, nullReason: "no_player_history" };
  }
  const hitProb = localHitFromHistory(hist, {
    market,
    line,
    side,
  });
  if (hitProb == null) {
    return {
      hitProbability: null,
      nullReason:
        (hist.recent?.length ?? 0) >= 3 ? "insufficient_mapped_stats" : "insufficient_game_log",
    };
  }
  const clipped = clipPropSimHitForGrade({ ...norm, propLine: line }, hitProb);
  return { hitProbability: clipped, nullReason: null };
}

export function gradeFootballPropsOnlyFromHistory(
  picks: ParsedPick[],
  histories: Record<string, PropsOnlyHistorySlice | undefined>,
  pool: PoolRow[] = [],
): Map<string, PropsOnlyHit> {
  const hits = new Map<string, PropsOnlyHit>();
  for (const pick of picks) {
    const norm = normalizePropsOnlyPick(pick);
    const row = propsOnlyPoolRowForPick(norm, pool);
    const key = propsOnlySimLookupKey(norm, row);
    if (!key) continue;
    const hist = historyForPick(norm, histories);
    hits.set(key, gradeFootballPropFromHistory(norm, hist, row));
  }
  return hits;
}

export function softClipPropsOnlyHits(
  picks: ParsedPick[],
  hits: Map<string, PropsOnlyHit>,
  pool: PoolRow[] = [],
): void {
  for (const pick of picks) {
    const norm = normalizePropsOnlyPick(pick);
    const row = propsOnlyPoolRowForPick(norm, pool);
    const key = propsOnlySimLookupKey(norm, row);
    if (!key) continue;
    const raw = hits.get(key)?.hitProbability;
    const clipped = clipPropSimHitForGrade(norm, raw);
    if (clipped != null && clipped !== raw) {
      hits.set(key, { hitProbability: clipped, nullReason: null });
    }
  }
}

export function propsOnlyPickHasGrade(
  pick: ParsedPick,
  hits: Map<string, PropsOnlyHit>,
  pool: PoolRow[] = [],
): boolean {
  const norm = normalizePropsOnlyPick(pick);
  const row = propsOnlyPoolRowForPick(norm, pool);
  const raw = lookupPropsOnlyHit(norm, row, hits);
  const clipped = clipPropSimHitForGrade(norm, raw);
  return pickHasSimGrade(norm, clipped);
}

/**
 * Props-only delivery gate: real history/MC hit rate vs posted odds.
 * Allows ~2.5pp slack so short game-log sample noise (4/8 = 50% TD at -110)
 * still stages — phone #541 emptied on exact hit>implied with n≈8.
 */
export function propsOnlyLegClearsOdds(pick: ParsedPick, simHit: number | null): boolean {
  if (pick.odds == null || !Number.isFinite(pick.odds)) return false;
  const norm = normalizePropsOnlyPick(pick);
  const clipped = clipPropSimHitForGrade(norm, simHit);
  if (!pickHasSimGrade(norm, clipped) || clipped == null) return false;
  const implied = impliedProb(pick.odds);
  // 2.5pp sampling slack — history windows are short (3–10 games); -110 implied
  // is ~52.4% so a clean 4/8 TD rate must still clear.
  return clipped + 0.025 + 1e-9 >= implied;
}

export function propsOnlyEvPct(pick: ParsedPick, simHit: number | null): number | null {
  if (pick.odds == null || !Number.isFinite(pick.odds) || simHit == null) return null;
  const clipped = clipPropSimHitForGrade(normalizePropsOnlyPick(pick), simHit);
  if (clipped == null) return null;
  return simEvPct(clipped, pick.odds);
}

/**
 * For a player+market ladder, keep the posted side with the best history EV.
 * Wrong-side yards (-110 Over when history is Under) were the #541 empty path.
 */
export function pickBestEvPropsOnlySide(
  sides: ParsedPick[],
  hits: Map<string, PropsOnlyHit>,
  pool: PoolRow[] = [],
): { pick: ParsedPick; hit: number; ev: number } | null {
  let best: { pick: ParsedPick; hit: number; ev: number } | null = null;
  for (const raw of sides) {
    const pick = normalizePropsOnlyPick(raw);
    const row = propsOnlyPoolRowForPick(pick, pool);
    const hit = lookupPropsOnlyHit(pick, row, hits);
    const clipped = clipPropSimHitForGrade(pick, hit);
    if (clipped == null || !pickHasSimGrade(pick, clipped)) continue;
    const ev = propsOnlyEvPct(pick, clipped);
    if (ev == null) continue;
    if (!best || ev > best.ev) {
      best = { pick, hit: clipped, ev };
    }
  }
  return best;
}

/** Collapse Over/Under duplicates to the history-backed EV side before staging. */
export function collapsePropsOnlyToBestEvSides(
  picks: ParsedPick[],
  hits: Map<string, PropsOnlyHit>,
  pool: PoolRow[] = [],
): ParsedPick[] {
  const groups = new Map<string, ParsedPick[]>();
  for (const p of picks) {
    const norm = normalizePropsOnlyPick(p);
    const mk = `${norm.game}|${norm.player}|${norm.propMarketKey ?? norm.market}|${propsOnlyEffectiveLine(norm)}`.toLowerCase();
    const arr = groups.get(mk) ?? [];
    arr.push(norm);
    groups.set(mk, arr);
  }
  const out: ParsedPick[] = [];
  for (const sides of groups.values()) {
    const best = pickBestEvPropsOnlySide(sides, hits, pool);
    if (best) {
      out.push(best.pick);
      continue;
    }
    // Keep a graded side even if EV is flat-negative — staging gate decides.
    for (const s of sides) {
      if (propsOnlyPickHasGrade(s, hits, pool)) {
        out.push(s);
        break;
      }
    }
  }
  return out;
}

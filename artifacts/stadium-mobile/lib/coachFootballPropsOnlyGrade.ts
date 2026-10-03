/**
 * Pure local grading for NFL/NCAAF props-only tickets.
 * Kept free of api.ts so node:test can prove history → sim hit.
 *
 * Phone #544 diag: PROPS_ONLY_NO_GRADE nulls=insufficient_game_log:54
 * Early 2026 NFL season only has ~2–3 ESPN games; the old min sample of 3
 * + current-season-only fetch zeroed every grade. Rebuild:
 * - Prior-season backfill when current log is thin
 * - Merge same-date category splits (pass/rush/rec rows) before grading
 * - Min sample 2 for props-only early-season windows
 */

import type { ParsedPick } from "../components/PickCard.tsx";
import { canonicalPropMarketKey } from "./coachAskMarketFilter.ts";
import { computeAmbiguous, gameValueForMarket } from "./propStats.ts";
import {
  isRareCountPropMarket,
  rareCountHitFromValues,
  rareCountHitReliability,
} from "./rareCountPropModel.ts";
import { clipPropSimHitForGrade, pickHasSimGrade } from "./simMarketSupport.ts";
import { impliedProb } from "./format.ts";
import { simEvPct } from "./gameSimQualityGates.ts";

export type PropsOnlyHit = {
  hitProbability: number | null;
  nullReason?: string | null;
  /** 0..1 sample/threshold confidence — rare counts with thin evidence stay low. */
  hitReliability?: number | null;
};

export type PropsOnlyHistoryGame = {
  date?: string | null;
  opp?: string | null;
  stats?: Record<string, string>;
};

export type PropsOnlyHistorySlice = {
  player?: string;
  labels?: string[];
  recent?: PropsOnlyHistoryGame[];
};

/** Early-season floor — 3 left every NFL prop ungraded in week 3–4 of 2026. */
export const PROPS_ONLY_MIN_SAMPLE = 2;
/** Prefetch prior season when current recent is below this. */
export const PROPS_ONLY_HISTORY_BACKFILL_BELOW = 8;
export const PROPS_ONLY_HISTORY_TARGET = 10;

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

/** Prior ESPN season year for thin current logs (NFL 2026 week 3 → 2025). */
export function propsOnlyPriorSeasonYear(
  availableSeasons?: string[] | null,
  now = new Date(),
): string {
  const years = (availableSeasons ?? [])
    .map((s) => String(s).trim())
    .filter((s) => /^\d{4}$/.test(s))
    .sort((a, b) => Number(b) - Number(a));
  if (years.length >= 2) return years[1]!;
  if (years.length === 1) {
    const y = Number(years[0]);
    return String(y - 1);
  }
  return String(now.getFullYear() - 1);
}

/**
 * ESPN football gamelogs emit one row per category (pass / rush / rec) for the
 * same game. Merge same-date rows so anytime TD / combo markets see all columns.
 */
export function mergePropsOnlyHistoryGames(
  games: PropsOnlyHistoryGame[] | null | undefined,
): PropsOnlyHistoryGame[] {
  if (!games?.length) return [];
  const byKey = new Map<string, PropsOnlyHistoryGame>();
  const order: string[] = [];
  for (const g of games) {
    const date = String(g.date ?? "").trim();
    const opp = String(g.opp ?? "").trim().toLowerCase();
    const key = date || opp ? `${date}|${opp}` : `anon:${order.length}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        date: g.date ?? null,
        opp: g.opp ?? null,
        stats: { ...(g.stats ?? {}) },
      });
      order.push(key);
      continue;
    }
    existing.stats = { ...(existing.stats ?? {}), ...(g.stats ?? {}) };
    if (!existing.date && g.date) existing.date = g.date;
    if (!existing.opp && g.opp) existing.opp = g.opp;
  }
  return order.map((k) => byKey.get(k)!);
}

/** Current-season games first, then prior-season fill up to target (deduped). */
export function mergePropsOnlySeasonLogs(
  current: PropsOnlyHistoryGame[] | null | undefined,
  prior: PropsOnlyHistoryGame[] | null | undefined,
  target = PROPS_ONLY_HISTORY_TARGET,
): PropsOnlyHistoryGame[] {
  const merged = mergePropsOnlyHistoryGames([...(current ?? []), ...(prior ?? [])]);
  // Prefer current dates: current was listed first so merge kept those stats;
  // re-order by date desc when dates exist.
  const dated = merged.filter((g) => g.date);
  const undated = merged.filter((g) => !g.date);
  dated.sort((a, b) => {
    const ad = a.date ? new Date(a.date).getTime() : 0;
    const bd = b.date ? new Date(b.date).getTime() : 0;
    return bd - ad;
  });
  return [...dated, ...undated].slice(0, target);
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

function historyValuesForMarket(
  history: PropsOnlyHistorySlice | null | undefined,
  market: string,
): number[] {
  const recent = mergePropsOnlyHistoryGames(history?.recent ?? []);
  if (!recent.length) return [];
  const ambiguous = computeAmbiguous(history?.labels);
  return recent
    .map((g) => gameValueForMarket(market, g.stats ?? {}, ambiguous))
    .filter((v): v is number => v != null)
    .slice(0, 10);
}

function localHitFromHistory(
  history: PropsOnlyHistorySlice | null | undefined,
  args: { market: string; line: number; side: "Over" | "Under" },
): { hit: number | null; reliability: number } {
  const vals = historyValuesForMarket(history, args.market);
  if (vals.length < PROPS_ONLY_MIN_SAMPLE) return { hit: null, reliability: 0 };

  // Rare count props (HR / multi-goal / SB): threshold-aware Poisson — never
  // invent a 2% floor, and never let Over 1.5 inherit Over 0.5's empirical rate.
  if (isRareCountPropMarket(args.market)) {
    return {
      hit: rareCountHitFromValues(vals, args.line, args.side),
      reliability: rareCountHitReliability(vals, args.line, args.side),
    };
  }

  const hits = vals.filter((v) => (args.side === "Under" ? v < args.line : v >= args.line)).length;
  const hitProbRaw = hits / vals.length;
  const hit = hitProbRaw <= 0 ? 0.02 : hitProbRaw >= 1 ? 0.98 : hitProbRaw;
  // High-volume yards/points: sample size alone drives reliability.
  const reliability = Math.min(1, vals.length / 10);
  return { hit, reliability };
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
  const mergedRecent = mergePropsOnlyHistoryGames(hist?.recent ?? []);
  if (!mergedRecent.length) {
    return { hitProbability: null, nullReason: "no_player_history", hitReliability: 0 };
  }
  const { hit: hitProb, reliability } = localHitFromHistory(
    { ...hist, recent: mergedRecent },
    { market, line, side },
  );
  if (hitProb == null) {
    return {
      hitProbability: null,
      nullReason:
        mergedRecent.length >= PROPS_ONLY_MIN_SAMPLE
          ? isRareCountPropMarket(market)
            ? "rare_count_insufficient_evidence"
            : "insufficient_mapped_stats"
          : "insufficient_game_log",
      hitReliability: reliability,
    };
  }
  const clipped = clipPropSimHitForGrade(
    { ...norm, propLine: line, propMarketKey: market, market },
    hitProb,
  );
  if (clipped == null) {
    return {
      hitProbability: null,
      nullReason: "rare_count_insufficient_evidence",
      hitReliability: reliability,
    };
  }
  return { hitProbability: clipped, nullReason: null, hitReliability: reliability };
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
    const existing = hits.get(key);
    const raw = existing?.hitProbability;
    const clipped = clipPropSimHitForGrade(norm, raw);
    if (clipped !== raw) {
      hits.set(key, {
        hitProbability: clipped,
        nullReason: clipped == null ? "rare_count_insufficient_evidence" : null,
        hitReliability: existing?.hitReliability ?? null,
      });
    }
  }
}

/** Reliability 0..1 stored at grade time (defaults to 1 for non-rare / unknown). */
export function lookupPropsOnlyHitReliability(
  pick: Parameters<typeof propsOnlySimLookupKey>[0],
  poolRow: Parameters<typeof propsOnlySimLookupKey>[1],
  hits: Map<string, PropsOnlyHit>,
): number {
  const keys = new Set<string>();
  const primary = propsOnlySimLookupKey(pick, poolRow);
  if (primary) keys.add(primary);
  for (const key of keys) {
    const r = hits.get(key)?.hitReliability;
    if (r != null && Number.isFinite(r)) return Math.max(0, Math.min(1, r));
  }
  return 1;
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
 *
 * Recovery fills (skill-board / emptied allowlist) may pass a wider slack so
 * yards/rec/sack alts can land when the strict gate wiped the ticket.
 */
export const PROPS_ONLY_ODDS_SLACK = 0.025;
/** Wider slack for skill-board recovery after a locked-market quality wipe. */
export const PROPS_ONLY_RECOVERY_ODDS_SLACK = 0.08;

export function propsOnlyLegClearsOdds(
  pick: ParsedPick,
  simHit: number | null,
  slack: number = PROPS_ONLY_ODDS_SLACK,
): boolean {
  if (pick.odds == null || !Number.isFinite(pick.odds)) return false;
  const norm = normalizePropsOnlyPick(pick);
  const clipped = clipPropSimHitForGrade(norm, simHit);
  if (!pickHasSimGrade(norm, clipped) || clipped == null) return false;
  const implied = impliedProb(pick.odds);
  const pad = Number.isFinite(slack) ? Math.max(0, slack) : PROPS_ONLY_ODDS_SLACK;
  return clipped + pad + 1e-9 >= implied;
}

export function propsOnlyEvPct(pick: ParsedPick, simHit: number | null): number | null {
  if (pick.odds == null || !Number.isFinite(pick.odds) || simHit == null) return null;
  const clipped = clipPropSimHitForGrade(normalizePropsOnlyPick(pick), simHit);
  if (clipped == null) return null;
  return simEvPct(clipped, pick.odds);
}

/**
 * Ladder key for props-only collapse: same player + canonical market
 * (main + `_alternate` rungs share one seat). Line is NOT in the key so
 * softer alt numbers can beat a main that fails the odds gate.
 */
export function propsOnlyCollapseLadderKey(pick: ParsedPick): string {
  const norm = normalizePropsOnlyPick(pick);
  const market = canonicalPropMarketKey(norm.propMarketKey ?? norm.market);
  return `${norm.game}|${norm.player}|${market || norm.market}`.toLowerCase();
}

/**
 * For a player+market ladder (main + alt rungs), prefer the posted side that
 * clears the odds gate with the best history EV. Only when no rung clears do
 * we fall back to raw best EV (staging still drops it).
 *
 * Phone: main Over failed clearsOdds while a softer `_alternate` Over cleared —
 * grouping by line kept them apart so the ticket emptied on "quality bar".
 */
export function pickBestEvPropsOnlySide(
  sides: ParsedPick[],
  hits: Map<string, PropsOnlyHit>,
  pool: PoolRow[] = [],
  oddsSlack: number = PROPS_ONLY_ODDS_SLACK,
): { pick: ParsedPick; hit: number; ev: number } | null {
  let bestClearing: { pick: ParsedPick; hit: number; ev: number } | null = null;
  let bestAny: { pick: ParsedPick; hit: number; ev: number } | null = null;
  for (const raw of sides) {
    const pick = normalizePropsOnlyPick(raw);
    const row = propsOnlyPoolRowForPick(pick, pool);
    const hit = lookupPropsOnlyHit(pick, row, hits);
    const clipped = clipPropSimHitForGrade(pick, hit);
    if (clipped == null || !pickHasSimGrade(pick, clipped)) continue;
    const ev = propsOnlyEvPct(pick, clipped);
    if (ev == null) continue;
    const scored = { pick, hit: clipped, ev };
    if (!bestAny || ev > bestAny.ev) bestAny = scored;
    if (propsOnlyLegClearsOdds(pick, clipped, oddsSlack)) {
      if (!bestClearing || ev > bestClearing.ev) bestClearing = scored;
    }
  }
  return bestClearing ?? bestAny;
}

/**
 * Collapse main + alt ladder rungs (and Over/Under) to the odds-clearing
 * history EV side before staging — same idea as board-scan ladder exhaustion.
 */
export function collapsePropsOnlyToBestEvSides(
  picks: ParsedPick[],
  hits: Map<string, PropsOnlyHit>,
  pool: PoolRow[] = [],
  oddsSlack: number = PROPS_ONLY_ODDS_SLACK,
): ParsedPick[] {
  const groups = new Map<string, ParsedPick[]>();
  for (const p of picks) {
    const norm = normalizePropsOnlyPick(p);
    const mk = propsOnlyCollapseLadderKey(norm);
    const arr = groups.get(mk) ?? [];
    arr.push(norm);
    groups.set(mk, arr);
  }
  const out: ParsedPick[] = [];
  for (const sides of groups.values()) {
    const best = pickBestEvPropsOnlySide(sides, hits, pool, oddsSlack);
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

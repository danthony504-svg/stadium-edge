// Analytics + adaptive signal weights for the AI Coach pick ledger. Every stat is
// derived from REAL settled picks — never fabricated hit rates.

import type { MarketPerf } from "./marketWeighting.ts";
import {
  familyKeyForPick,
  MIN_PERF_SAMPLE,
  PERF_COLD_PCT,
  PERF_HOT_PCT,
  PERF_MAGNITUDE,
} from "./marketWeighting.ts";
import {
  confidenceBucket,
  edgeBucket,
  familyForTracked,
  gradeBucket,
  isDecidedStatus,
  oddsBucket,
  oddsRole,
  type TrackedPick,
  type TrackedPickStatus,
} from "./pickTracker.ts";
import {
  buildRollingWinRateSeries,
  summarizeRecentPerformance,
  type SettledPick,
} from "./performanceChart.ts";
import { americanToDecimal } from "./format.ts";

const SPORT_LABELS: Record<string, string> = {
  mlb: "MLB",
  wnba: "WNBA",
  nba: "NBA",
  nhl: "NHL",
  soccer: "Soccer",
  nfl: "NFL",
  ncaaf: "NCAAF",
  ncaab: "NCAAB",
  tennis: "Tennis",
  golf: "Golf",
};

function sportLabel(id: string): string {
  return SPORT_LABELS[id.toLowerCase()] ?? id.toUpperCase();
}

const FAMILY_LABELS: Record<string, string> = {
  total: "Game Totals",
  spread: "Spreads",
  moneyline: "Moneyline",
  points: "Points",
  rebounds: "Rebounds",
  assists: "Assists",
  strikeouts: "Strikeouts",
  "total bases": "Total Bases",
  "home runs": "Home Runs",
};

function familyLabel(family: string): string {
  const key = family.toLowerCase();
  return (
    FAMILY_LABELS[key] ??
    family
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}

export type Tally = { wins: number; losses: number; pushes: number };

export function emptyTally(): Tally {
  return { wins: 0, losses: 0, pushes: 0 };
}

export function addToTally(t: Tally, r: TrackedPickStatus) {
  if (r === "win") t.wins += 1;
  else if (r === "loss") t.losses += 1;
  else if (r === "push") t.pushes += 1;
}

export function decided(t: Tally): number {
  return t.wins + t.losses;
}

export function winPct(t: Tally): number | null {
  const d = decided(t);
  return d > 0 ? (t.wins / d) * 100 : null;
}

export function recordText(t: Tally): string {
  return t.pushes > 0 ? `${t.wins}-${t.losses}-${t.pushes}` : `${t.wins}-${t.losses}`;
}

export type Breakdown = { key: string; label: string; tally: Tally };

function toSortedBreakdowns(
  map: Map<string, Tally>,
  labelFn: (key: string) => string,
): Breakdown[] {
  return Array.from(map.entries())
    .map(([key, tally]) => ({ key, label: labelFn(key), tally }))
    .sort((a, b) => decided(b.tally) - decided(a.tally) || b.tally.wins - a.tally.wins);
}

const ODDS_BUCKET_LABEL: Record<string, string> = {
  heavyFav: "Heavy favorites (< -200)",
  fav: "Favorites (-200 to -101)",
  plus: "Plus money (+100 to +150)",
  longshot: "Longshots (+151+)",
};

const ODDS_ROLE_LABEL: Record<string, string> = {
  favorite: "Favorites",
  underdog: "Underdogs",
  longshot: "Longshots (+200+)",
};

const GRADE_LABEL: Record<string, string> = {
  A: "Grade A",
  B: "Grade B",
  C: "Grade C",
  D: "Grade D",
  F: "Grade F",
};

const CONF_LABEL: Record<string, string> = {
  low: "Confidence < 45%",
  mid: "Confidence 45–59%",
  high: "Confidence 60%+",
};

const EDGE_LABEL: Record<string, string> = {
  negative: "Edge < 0%",
  neutral: "Edge 0–2%",
  positive: "Edge > 2%",
};

export type TrackedAnalytics = {
  total: number;
  pending: number;
  legTally: Tally;
  ungraded: number;
  roiPct: number | null;
  unitsWon: number;
  bySport: Breakdown[];
  byFamily: Breakdown[];
  byMarketType: Breakdown[];
  byOddsBucket: Breakdown[];
  byOddsRole: Breakdown[];
  byGrade: Breakdown[];
  byConfidence: Breakdown[];
  byEdge: Breakdown[];
  rollingWinRate: number[];
  recentWindow: ReturnType<typeof summarizeRecentPerformance>;
  hotTrend: string | null;
  coldTrend: string | null;
};

function tallyMap(): Map<string, Tally> {
  return new Map();
}

function bump(map: Map<string, Tally>, key: string, result: TrackedPickStatus) {
  if (!map.has(key)) map.set(key, emptyTally());
  addToTally(map.get(key)!, result);
}

/** Flat $1 unit ROI on decided picks (wins pay decimal-1, losses -1). */
export function computeRoiPct(picks: TrackedPick[]): { roiPct: number | null; units: number } {
  let units = 0;
  let count = 0;
  for (const p of picks) {
    if (!isDecidedStatus(p.status)) continue;
    count += 1;
    if (p.status === "win") units += americanToDecimal(p.odds) - 1;
    else units -= 1;
  }
  if (count === 0) return { roiPct: null, units: 0 };
  return { roiPct: Math.round((units / count) * 1000) / 10, units: Math.round(units * 100) / 100 };
}

export function computeTrackedAnalytics(picks: TrackedPick[]): TrackedAnalytics {
  const legTally = emptyTally();
  let pending = 0;
  let ungraded = 0;
  const sport = tallyMap();
  const family = tallyMap();
  const marketType = tallyMap();
  const oddsB = tallyMap();
  const oddsR = tallyMap();
  const grade = tallyMap();
  const conf = tallyMap();
  const edge = tallyMap();

  const settledHistory: SettledPick[] = [];

  for (const p of picks) {
    if (p.status === "pending") {
      pending += 1;
      continue;
    }
    if (p.status === "ungraded") {
      ungraded += 1;
      continue;
    }
    addToTally(legTally, p.status);
    if (p.settledAt) {
      settledHistory.push({
        status: p.status,
        gradedAt: new Date(p.settledAt).toISOString(),
      });
    }

    bump(sport, p.sport, p.status);
    const fam = familyForTracked(p);
    if (fam) bump(family, fam, p.status);
    bump(marketType, p.isProp ? "player_props" : "game_lines", p.status);
    bump(oddsB, oddsBucket(p.odds), p.status);
    bump(oddsR, oddsRole(p.odds), p.status);
    const gb = gradeBucket(p.aiGrade);
    if (gb) bump(grade, gb, p.status);
    const cb = confidenceBucket(p.confidence);
    if (cb) bump(conf, cb, p.status);
    const eb = edgeBucket(p.edge);
    if (eb) bump(edge, eb, p.status);
  }

  settledHistory.sort((a, b) => Date.parse(a.gradedAt) - Date.parse(b.gradedAt));
  const rollingWinRate = buildRollingWinRateSeries(settledHistory);
  const recentWindow = summarizeRecentPerformance(settledHistory);
  const { roiPct, units: unitsWon } = computeRoiPct(picks);

  const bestSport = toSortedBreakdowns(sport, (k) => sportLabel(k))
    .filter((b) => decided(b.tally) >= 8)
    .map((b) => ({ ...b, pct: winPct(b.tally)! }))
    .sort((a, b) => b.pct - a.pct)[0];
  const worstSport = toSortedBreakdowns(sport, (k) => sportLabel(k))
    .filter((b) => decided(b.tally) >= 8)
    .map((b) => ({ ...b, pct: winPct(b.tally)! }))
    .sort((a, b) => a.pct - b.pct)[0];

  const hotTrend =
    bestSport && bestSport.pct >= 58
      ? `${bestSport.label} hot at ${bestSport.pct.toFixed(0)}% (${recordText(bestSport.tally)})`
      : recentWindow.winPct != null && recentWindow.sampleSize >= 10 && recentWindow.winPct >= 58
        ? `Last ${recentWindow.sampleSize} picks: ${recentWindow.winPct}% win rate`
        : null;

  const coldTrend =
    worstSport && worstSport.pct <= 42
      ? `${worstSport.label} cold at ${worstSport.pct.toFixed(0)}% (${recordText(worstSport.tally)})`
      : recentWindow.winPct != null && recentWindow.sampleSize >= 10 && recentWindow.winPct <= 42
        ? `Last ${recentWindow.sampleSize} picks: ${recentWindow.winPct}% win rate`
        : null;

  return {
    total: picks.length,
    pending,
    legTally,
    ungraded,
    roiPct,
    unitsWon,
    bySport: toSortedBreakdowns(sport, (k) => sportLabel(k)),
    byFamily: toSortedBreakdowns(family, familyLabel),
    byMarketType: toSortedBreakdowns(marketType, (k) =>
      k === "player_props" ? "Player props" : "Game lines",
    ),
    byOddsBucket: toSortedBreakdowns(oddsB, (k) => ODDS_BUCKET_LABEL[k] ?? k),
    byOddsRole: toSortedBreakdowns(oddsR, (k) => ODDS_ROLE_LABEL[k] ?? k),
    byGrade: toSortedBreakdowns(grade, (k) => GRADE_LABEL[k] ?? k),
    byConfidence: toSortedBreakdowns(conf, (k) => CONF_LABEL[k] ?? k),
    byEdge: toSortedBreakdowns(edge, (k) => EDGE_LABEL[k] ?? k),
    rollingWinRate,
    recentWindow,
    hotTrend,
    coldTrend,
  };
}

export const MIN_SIGNAL_SAMPLE = 12;

export type SignalPerf = { decided: number; hitRatePct: number | null };

/** Build performance map for adaptive weighting (family keys + signal categories). */
export function computeSignalPerfMap(picks: TrackedPick[]): Map<string, SignalPerf> {
  const tallies = new Map<string, Tally>();
  const bumpKey = (key: string, status: TrackedPickStatus) => {
    if (!isDecidedStatus(status)) return;
    if (!tallies.has(key)) tallies.set(key, emptyTally());
    addToTally(tallies.get(key)!, status);
  };

  for (const p of picks) {
    if (!isDecidedStatus(p.status)) continue;
    bumpKey(`sport:${p.sport}`, p.status);
    const fam = familyForTracked(p);
    if (fam) bumpKey(`family:${fam}`, p.status);
    bumpKey(`market:${p.isProp ? "player_props" : "game_lines"}`, p.status);
    bumpKey(`odds:${oddsBucket(p.odds)}`, p.status);
    bumpKey(`role:${oddsRole(p.odds)}`, p.status);
    const gb = gradeBucket(p.aiGrade);
    if (gb) bumpKey(`grade:${gb}`, p.status);
    const cb = confidenceBucket(p.confidence);
    if (cb) bumpKey(`conf:${cb}`, p.status);
    const eb = edgeBucket(p.edge);
    if (eb) bumpKey(`edge:${eb}`, p.status);
  }

  const out = new Map<string, SignalPerf>();
  for (const [key, t] of tallies) {
    const d = decided(t);
    out.set(key, { decided: d, hitRatePct: d > 0 ? (t.wins / d) * 100 : null });
  }
  return out;
}

export function perfMapFromTrackedPicks(picks: TrackedPick[]): Map<string, MarketPerf> {
  const map = new Map<string, MarketPerf>();
  for (const [key, perf] of computeSignalPerfMap(picks)) {
    if (!key.startsWith("family:")) continue;
    map.set(key.slice("family:".length), perf);
  }
  return map;
}

function biasFromPerf(perf: SignalPerf | undefined, minSample = MIN_SIGNAL_SAMPLE): number {
  if (!perf || perf.hitRatePct == null || perf.decided < minSample) return 0;
  if (perf.hitRatePct < PERF_COLD_PCT) return -PERF_MAGNITUDE;
  if (perf.hitRatePct > PERF_HOT_PCT) return PERF_MAGNITUDE;
  return 0;
}

/** Confidence delta from tracked pick history for a new recommendation. */
export function trackedSignalBias(
  pick: {
    sport?: string;
    isProp?: boolean;
    market?: string;
    propMarketKey?: string;
    odds: number;
    scores?: { grade?: string | null; confidencePct?: number | null; edgePct?: number | null } | null;
    finalAiScore?: {
      grade?: string | null;
      confidencePct?: number | null;
      edgePct?: number | null;
    } | null;
  },
  perfMap: Map<string, SignalPerf>,
): number {
  const fam = familyKeyForPick(pick);
  const grade = gradeBucket(pick.finalAiScore?.grade ?? pick.scores?.grade);
  const conf = confidenceBucket(
    pick.finalAiScore?.confidencePct ?? pick.scores?.confidencePct,
  );
  const edge = edgeBucket(pick.finalAiScore?.edgePct ?? pick.scores?.edgePct);

  const keys = [
    pick.sport ? `sport:${pick.sport.toLowerCase()}` : null,
    fam ? `family:${fam}` : null,
    `market:${pick.isProp ? "player_props" : "game_lines"}`,
    `odds:${oddsBucket(pick.odds)}`,
    `role:${oddsRole(pick.odds)}`,
    grade ? `grade:${grade}` : null,
    conf ? `conf:${conf}` : null,
    edge ? `edge:${edge}` : null,
  ].filter(Boolean) as string[];

  let sum = 0;
  for (const k of keys) sum += biasFromPerf(perfMap.get(k));
  return Math.max(-15, Math.min(15, sum));
}

/** Coach context strings from tracked pick performance. */
export function computeTrackedModelStrengths(picks: TrackedPick[]): string[] {
  const a = computeTrackedAnalytics(picks);
  const out: string[] = [];

  const rate = (label: string, t: Tally) => {
    if (decided(t) < 8) return;
    const p = winPct(t)!;
    if (p >= 55) out.push(`Coach ${label}: strong (${p.toFixed(0)}%, ${recordText(t)})`);
    else if (p <= 42) out.push(`Coach ${label}: cold (${p.toFixed(0)}%, ${recordText(t)})`);
  };

  for (const b of a.byFamily.slice(0, 4)) rate(b.label, b.tally);
  for (const b of a.bySport.slice(0, 2)) rate(b.label, b.tally);
  for (const b of a.byMarketType) rate(b.label, b.tally);

  if (a.hotTrend) out.push(`Coach trend: ${a.hotTrend}`);
  if (a.coldTrend) out.push(`Coach trend: ${a.coldTrend}`);

  return out.slice(0, 8);
}

/** Merge slip-results family perf with tracked coach pick perf (union by max sample). */
export function mergePerfMaps(
  a: Map<string, MarketPerf>,
  b: Map<string, MarketPerf>,
): Map<string, MarketPerf> {
  const out = new Map(a);
  for (const [k, perf] of b) {
    const cur = out.get(k);
    if (!cur || perf.decided > cur.decided) out.set(k, perf);
  }
  return out;
}

export { MIN_PERF_SAMPLE };

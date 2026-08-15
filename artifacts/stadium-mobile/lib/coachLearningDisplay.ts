// Coach AI Learning display helpers — derived from REAL settled pick history only.

import { americanToDecimal } from "./format.ts";
import {
  decided,
  recordText,
  winPct,
  type Breakdown,
  type Tally,
  type TrackedAnalytics,
} from "./pickTrackerAnalytics.ts";
import { familyForTracked, isDecidedStatus, type TrackedPick } from "./pickTracker.ts";

type ColorTokens = {
  success: string;
  primary: string;
  warning: string;
  destructive: string;
  foreground: string;
};

/** A = green, B = blue, C = yellow, D/F = red. */
export function gradeTierColor(
  grade: string | null | undefined,
  colors: ColorTokens,
): string {
  if (!grade) return colors.foreground;
  const tier = grade.trim().charAt(0).toUpperCase();
  if (tier === "A") return colors.success;
  if (tier === "B") return colors.primary;
  if (tier === "C") return colors.warning;
  if (tier === "D" || tier === "F") return colors.destructive;
  return colors.foreground;
}

function tallyPicks(picks: TrackedPick[]): Tally {
  const t: Tally = { wins: 0, losses: 0, pushes: 0 };
  for (const p of picks) {
    if (p.status === "win") t.wins += 1;
    else if (p.status === "loss") t.losses += 1;
    else if (p.status === "push") t.pushes += 1;
  }
  return t;
}

export function unitsForPicks(picks: TrackedPick[]): number {
  let units = 0;
  for (const p of picks) {
    if (!isDecidedStatus(p.status)) continue;
    if (p.status === "win") units += americanToDecimal(p.odds) - 1;
    else if (p.status === "loss") units -= 1;
  }
  return Math.round(units * 100) / 100;
}

function startOfLocalDay(d = new Date()): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

function settledPicks(picks: TrackedPick[]): TrackedPick[] {
  return picks.filter((p) => isDecidedStatus(p.status) && p.settledAt != null);
}

function picksSettledOnDay(picks: TrackedPick[], dayOffset: number): TrackedPick[] {
  const target = new Date(startOfLocalDay());
  target.setDate(target.getDate() + dayOffset);
  const targetStart = target.getTime();
  target.setDate(target.getDate() + 1);
  const targetEnd = target.getTime();
  return picks.filter((p) => {
    const ts = p.settledAt;
    return ts != null && ts >= targetStart && ts < targetEnd;
  });
}

function picksSettledSince(picks: TrackedPick[], days: number): TrackedPick[] {
  const cutoff = Date.now() - days * 86_400_000;
  return picks.filter((p) => p.settledAt != null && p.settledAt >= cutoff);
}

function picksSettledThisMonth(picks: TrackedPick[]): TrackedPick[] {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  return picks.filter((p) => p.settledAt != null && p.settledAt >= monthStart);
}

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
};

const FAMILY_LABELS: Record<string, string> = {
  strikeouts: "Strikeouts",
  "total bases": "Total Bases",
  "home runs": "Home Runs",
  points: "Points",
  rebounds: "Rebounds",
  assists: "Assists",
  spread: "Spreads",
  total: "Totals",
  moneyline: "Moneyline",
};

function sportLabel(id: string): string {
  return SPORT_LABELS[id.toLowerCase()] ?? id.toUpperCase();
}

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

export type LearningCardStats = {
  picksTracked: number;
  winRatePct: number | null;
  roiPct: number | null;
  last30Record: string | null;
  bestSport: string | null;
  bestMarket: string | null;
  avgLineValuePct: number | null;
  pending: number;
};

export function computeLearningCardStats(
  picks: TrackedPick[],
  analytics: TrackedAnalytics,
): LearningCardStats {
  const decidedCount = decided(analytics.legTally);
  const recent = analytics.recentWindow;

  const bestSport =
    analytics.bySport.find((b) => decided(b.tally) >= 3 && winPct(b.tally) != null) ??
    null;
  const bestMarket =
    analytics.byFamily.find((b) => decided(b.tally) >= 3 && winPct(b.tally) != null) ??
    null;

  const settled = settledPicks(picks);
  const edges = settled
    .map((p) => p.edge)
    .filter((e): e is number => e != null && Number.isFinite(e));
  const avgLineValuePct =
    edges.length > 0
      ? Math.round((edges.reduce((a, b) => a + b, 0) / edges.length) * 10) / 10
      : null;

  return {
    picksTracked: analytics.total,
    winRatePct: decidedCount > 0 ? winPct(analytics.legTally) : null,
    roiPct: analytics.roiPct,
    last30Record:
      recent.sampleSize > 0 && decidedCount > 0
        ? `${recent.wins}-${recent.losses}${recent.pushes ? `-${recent.pushes}` : ""}`
        : null,
    bestSport: bestSport ? bestSport.label : null,
    bestMarket: bestMarket ? bestMarket.label : null,
    avgLineValuePct,
    pending: analytics.pending,
  };
}

export function buildPerformanceHeadlines(picks: TrackedPick[]): string[] {
  const settled = settledPicks(picks);
  if (settled.length === 0) return [];

  const lines: string[] = [];

  const yesterday = picksSettledOnDay(settled, -1);
  const yTally = tallyPicks(yesterday);
  if (decided(yTally) >= 1) {
    const units = unitsForPicks(yesterday);
    const sign = units > 0 ? "+" : "";
    lines.push(`Yesterday: ${recordText(yTally)} (${sign}${units.toFixed(1)} units)`);
  }

  const last7 = picksSettledSince(settled, 7);
  const w7 = tallyPicks(last7);
  if (decided(w7) >= 1) {
    const pct = winPct(w7);
    lines.push(`Last 7 Days: ${recordText(w7)} (${pct?.toFixed(0)}%)`);
  }

  const month = picksSettledThisMonth(settled);
  const combo = bestSportMarketCombo(month, 5);
  if (combo) {
    lines.push(`${combo.label}: ${combo.pct.toFixed(0)}% this month`);
  }

  return lines.slice(0, 3);
}

function bestSportMarketCombo(
  picks: TrackedPick[],
  minSample: number,
): { label: string; pct: number } | null {
  const map = new Map<string, Tally>();
  for (const p of picks) {
    if (!isDecidedStatus(p.status)) continue;
    const fam = familyForTracked(p);
    if (!fam) continue;
    const key = `${p.sport}|${fam}`;
    if (!map.has(key)) map.set(key, { wins: 0, losses: 0, pushes: 0 });
    const t = map.get(key)!;
    if (p.status === "win") t.wins += 1;
    else if (p.status === "loss") t.losses += 1;
    else if (p.status === "push") t.pushes += 1;
  }

  let best: { label: string; pct: number } | null = null;
  for (const [key, t] of map) {
    const d = decided(t);
    if (d < minSample) continue;
    const pct = winPct(t);
    if (pct == null) continue;
    const [sport, fam] = key.split("|");
    const label = `${sportLabel(sport)} ${familyLabel(fam)}`;
    if (!best || pct > best.pct) best = { label, pct };
  }
  return best;
}

export function worstBreakdown(
  rows: Breakdown[],
  minSample = 3,
): Breakdown | null {
  return (
    [...rows]
      .filter((b) => decided(b.tally) >= minSample)
      .sort((a, b) => (winPct(a.tally) ?? 100) - (winPct(b.tally) ?? 100))[0] ?? null
  );
}

export function formatPct(value: number | null, digits = 1): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `${value.toFixed(digits)}%`;
}

export function formatSignedPct(value: number | null, digits = 1): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

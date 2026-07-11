// Client-side period score decomposition — mirrors api-server gamePeriodMonteCarlo.ts.

import type { SimPeriodScope } from "./simMarketSupport.ts";

const round2 = (n: number) => Math.round(n * 100) / 100;

function periodIncrementFrac(sport: string, period: SimPeriodScope): number | null {
  const s = sport.toLowerCase();
  if (period === "fg") return 1;
  if (s === "mlb" || s.startsWith("baseball")) {
    if (period === "f5") return 0.55;
    if (period === "i1") return 0.11;
    return null;
  }
  if (s === "nhl" || s.includes("hockey")) {
    if (period === "p1" || period === "p2" || period === "p3") return 1 / 3;
    return null;
  }
  if (period === "q1" || period === "q3") return 0.26;
  if (period === "q2" || period === "q4") return 0.24;
  if (period === "h1") return 0.5;
  if (period === "h2") return 0.5;
  return null;
}

export function periodScoresForDraw(
  sport: string,
  period: SimPeriodScope,
  homeFull: number,
  awayFull: number,
): { home: number; away: number } {
  if (period === "fg") return { home: homeFull, away: awayFull };
  const frac = periodIncrementFrac(sport, period);
  if (frac == null) return { home: homeFull, away: awayFull };
  const noiseH = 1 + (Math.random() - 0.5) * 0.14;
  const noiseA = 1 + (Math.random() - 0.5) * 0.14;
  return {
    home: Math.max(0, round2(homeFull * frac * noiseH)),
    away: Math.max(0, round2(awayFull * frac * noiseA)),
  };
}

export function raceToHits(
  target: number,
  teamSide: "home" | "away",
  homeFull: number,
  awayFull: number,
): boolean {
  const t = Math.max(1, Math.round(target));
  const homeRate = Math.max(0.05, homeFull);
  const awayRate = Math.max(0.05, awayFull);
  let h = 0;
  let a = 0;
  let guard = 0;
  while (h < t && a < t && guard < 500) {
    guard += 1;
    const roll = Math.random() * (homeRate + awayRate);
    if (roll < homeRate) h += 1;
    else a += 1;
  }
  if (teamSide === "home") return h >= t && h > a;
  return a >= t && a > h;
}

export function sportSupportsPeriod(sport: string, period: SimPeriodScope): boolean {
  if (period === "fg") return true;
  return periodIncrementFrac(sport, period) != null;
}

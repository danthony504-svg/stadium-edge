// Client-side model calibration — adjusts confidence from settled pick accuracy
// by sport + market. Mirrors server /sports/model-calibration when available.

import type { MarketPerf } from "./marketWeighting.ts";
import { familyKeyForPick, MIN_PERF_SAMPLE, PERF_COLD_PCT, PERF_HOT_PCT, PERF_MAGNITUDE } from "./marketWeighting.ts";
import type { TrackedPick } from "./pickTracker.ts";
import { isDecidedStatus } from "./pickTracker.ts";

export type CalibrationBucket = {
  sport: string;
  marketFamily: string;
  sampleSize: number;
  hitRatePct: number | null;
  confidenceDelta: number;
  label: "cold" | "neutral" | "hot";
};

export const CALIBRATION_MIN_SAMPLE = 15;
const MAX_CALIBRATION_DELTA = 12;

function deltaFromHitRate(hitRatePct: number | null, sample: number): number {
  if (hitRatePct == null || sample < CALIBRATION_MIN_SAMPLE) return 0;
  if (hitRatePct < PERF_COLD_PCT) {
    return -Math.round(((PERF_COLD_PCT - hitRatePct) / PERF_COLD_PCT) * MAX_CALIBRATION_DELTA);
  }
  if (hitRatePct > PERF_HOT_PCT) {
    return Math.round(((hitRatePct - PERF_HOT_PCT) / (100 - PERF_HOT_PCT)) * MAX_CALIBRATION_DELTA);
  }
  return 0;
}

/** Build sport+market calibration from user's settled picks. */
export function calibrationFromTrackedPicks(picks: TrackedPick[]): Map<string, CalibrationBucket> {
  const buckets = new Map<string, { wins: number; losses: number }>();
  for (const p of picks) {
    if (!isDecidedStatus(p.status)) continue;
    const sport = (p.sport ?? "unknown").toLowerCase();
    const fam = familyKeyForPick(p) ?? "other";
    const key = `${sport}|${fam}`;
    const t = buckets.get(key) ?? { wins: 0, losses: 0 };
    if (p.status === "win") t.wins += 1;
    else if (p.status === "loss") t.losses += 1;
    buckets.set(key, t);
  }

  const out = new Map<string, CalibrationBucket>();
  for (const [key, tally] of buckets) {
    const [sport, marketFamily] = key.split("|");
    const sampleSize = tally.wins + tally.losses;
    const hitRatePct = sampleSize > 0 ? (tally.wins / sampleSize) * 100 : null;
    out.set(key, {
      sport: sport!,
      marketFamily: marketFamily!,
      sampleSize,
      hitRatePct: hitRatePct != null ? Math.round(hitRatePct * 10) / 10 : null,
      confidenceDelta: deltaFromHitRate(hitRatePct, sampleSize),
      label:
        hitRatePct != null && sampleSize >= CALIBRATION_MIN_SAMPLE
          ? hitRatePct < PERF_COLD_PCT
            ? "cold"
            : hitRatePct > PERF_HOT_PCT
              ? "hot"
              : "neutral"
          : "neutral",
    });
  }
  return out;
}

export function calibrationDeltaForPick(
  pick: { sport?: string; market?: string; isProp?: boolean; propMarketKey?: string },
  calibration: Map<string, CalibrationBucket> | undefined,
  perfByFamily?: Map<string, MarketPerf>,
): number {
  const fam = familyKeyForPick(pick);
  let delta = 0;
  if (calibration && fam && pick.sport) {
    const key = `${pick.sport.toLowerCase()}|${fam}`;
    delta += calibration.get(key)?.confidenceDelta ?? 0;
  }
  if (perfByFamily && fam) {
    const perf = perfByFamily.get(fam);
    if (perf && perf.hitRatePct != null && perf.decided >= MIN_PERF_SAMPLE) {
      if (perf.hitRatePct < PERF_COLD_PCT) delta -= PERF_MAGNITUDE;
      else if (perf.hitRatePct > PERF_HOT_PCT) delta += PERF_MAGNITUDE;
    }
  }
  return Math.max(-15, Math.min(15, delta));
}

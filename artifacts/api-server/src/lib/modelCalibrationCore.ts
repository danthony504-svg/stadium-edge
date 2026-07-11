// Pure calibration math — no database imports (testable in isolation).

export type CalibrationBucket = {
  sport: string;
  marketFamily: string;
  sampleSize: number;
  wins: number;
  losses: number;
  hitRatePct: number | null;
  confidenceDelta: number;
  label: "cold" | "neutral" | "hot";
};

export type GradedRow = {
  sport: string;
  market: string;
  player: string | null;
  status: "win" | "loss" | "push";
};

export const CALIBRATION_MIN_SAMPLE = 15;
const COLD_HIT_PCT = 42;
const HOT_HIT_PCT = 58;
const MAX_DELTA = 12;

function familyFromGraded(row: GradedRow): string {
  const m = (row.market ?? "").toLowerCase();
  if (row.player) {
    if (m.includes("strikeout")) return "strikeouts";
    if (m.includes("total base")) return "total bases";
    if (m.includes("home run")) return "home runs";
    if (m.includes("rebound")) return "rebounds";
    if (m.includes("assist")) return "assists";
    if (m.includes("point")) return "points";
    return m || "props";
  }
  if (/\bspread|run line|puck line|handicap\b/.test(m)) return "spread";
  if (/\btotal|over|under\b/.test(m)) return "total";
  if (/moneyline|\bml\b|h2h/.test(m)) return "moneyline";
  return m || "other";
}

function deltaFromHitRate(hitRatePct: number | null, sample: number): number {
  if (hitRatePct == null || sample < CALIBRATION_MIN_SAMPLE) return 0;
  if (hitRatePct < COLD_HIT_PCT) {
    return -Math.round(((COLD_HIT_PCT - hitRatePct) / COLD_HIT_PCT) * MAX_DELTA);
  }
  if (hitRatePct > HOT_HIT_PCT) {
    return Math.round(((hitRatePct - HOT_HIT_PCT) / (100 - HOT_HIT_PCT)) * MAX_DELTA);
  }
  return 0;
}

function labelFromHit(hitRatePct: number | null): CalibrationBucket["label"] {
  if (hitRatePct == null) return "neutral";
  if (hitRatePct < COLD_HIT_PCT) return "cold";
  if (hitRatePct > HOT_HIT_PCT) return "hot";
  return "neutral";
}

export function computeCalibrationFromGraded(rows: GradedRow[]): CalibrationBucket[] {
  const buckets = new Map<string, { wins: number; losses: number }>();
  for (const row of rows) {
    if (row.status !== "win" && row.status !== "loss") continue;
    const sport = (row.sport ?? "unknown").toLowerCase();
    const fam = familyFromGraded(row);
    const key = `${sport}|${fam}`;
    const t = buckets.get(key) ?? { wins: 0, losses: 0 };
    if (row.status === "win") t.wins += 1;
    else t.losses += 1;
    buckets.set(key, t);
  }

  const out: CalibrationBucket[] = [];
  for (const [key, tally] of buckets) {
    const [sport, marketFamily] = key.split("|");
    const sampleSize = tally.wins + tally.losses;
    const hitRatePct = sampleSize > 0 ? (tally.wins / sampleSize) * 100 : null;
    out.push({
      sport: sport!,
      marketFamily: marketFamily!,
      sampleSize,
      wins: tally.wins,
      losses: tally.losses,
      hitRatePct: hitRatePct != null ? Math.round(hitRatePct * 10) / 10 : null,
      confidenceDelta: deltaFromHitRate(hitRatePct, sampleSize),
      label: labelFromHit(hitRatePct),
    });
  }
  return out.sort((a, b) => b.sampleSize - a.sampleSize);
}

export function calibrationDeltaForPick(
  sport: string | undefined,
  marketFamily: string | null,
  buckets: CalibrationBucket[],
): number {
  if (!sport || !marketFamily) return 0;
  const hit = buckets.find(
    (b) => b.sport === sport.toLowerCase() && b.marketFamily === marketFamily.toLowerCase(),
  );
  return hit?.confidenceDelta ?? 0;
}

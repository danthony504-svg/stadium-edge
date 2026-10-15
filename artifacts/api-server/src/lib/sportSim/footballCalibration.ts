/**
 * Precommitted holdout seeds and closing-line join.
 * The primary seed is the first entry. Do not reorder these to chase a PASS.
 */
import { existsSync, readFileSync } from "node:fs";

export const FOOTBALL_CALIBRATION_SEEDS = [20241015, 7, 42, 99, 123456789] as const;
export const FOOTBALL_CALIBRATION_PRIMARY_SEED = FOOTBALL_CALIBRATION_SEEDS[0];

/** Official near-coin window. Boundary sweeps are diagnostics and do not replace this. */
export const DOG_COHORT_LO = 0.45;
export const DOG_COHORT_HI = 0.55;
export const DOG_COHORT_COVER_MAX = 0.7;

export const DOG_COHORT_BOUNDARY_SWEEP = [
  { lo: 0.43, hi: 0.57 },
  { lo: 0.44, hi: 0.56 },
  { lo: 0.45, hi: 0.55 },
  { lo: 0.46, hi: 0.54 },
  { lo: 0.47, hi: 0.53 },
] as const;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type HoldoutProbRow = {
  eventId: string;
  pHome: number;
  yHome: number;
  awayCovered75: number;
};

export function dogCohort(
  rows: HoldoutProbRow[],
  lo = DOG_COHORT_LO,
  hi = DOG_COHORT_HI,
): { lo: number; hi: number; n: number; awayCoverRate: number | null } {
  const band = rows.filter((r) => r.pHome > lo && r.pHome < hi);
  const n = band.length;
  const covers = band.reduce((sum, r) => sum + r.awayCovered75, 0);
  return { lo, hi, n, awayCoverRate: n ? covers / n : null };
}

/** Games whose probability sits within 0.01 of either official boundary. */
export function boundarySensitiveCount(rows: HoldoutProbRow[]): number {
  return rows.filter(
    (r) =>
      (r.pHome >= DOG_COHORT_LO - 0.01 && r.pHome <= DOG_COHORT_LO + 0.01) ||
      (r.pHome >= DOG_COHORT_HI - 0.01 && r.pHome <= DOG_COHORT_HI + 0.01),
  ).length;
}

export type ClosingLineRow = {
  eventId: string;
  closeSpreadHome: number;
  closeMlHome: number;
  book?: string;
  source?: string;
};

export function americanToImplied(american: number): number | null {
  if (!Number.isFinite(american) || american === 0) return null;
  if (american < 0) return -american / (-american + 100);
  return 100 / (american + 100);
}

export function loadClosingLineArchive(path: string): {
  path: string;
  present: boolean;
  parseError: string | null;
  rows: ClosingLineRow[];
  dropped: number;
} {
  if (!existsSync(path)) {
    return { path, present: false, parseError: null, rows: [], dropped: 0 };
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as
      | ClosingLineRow[]
      | { rows?: ClosingLineRow[] };
    const list = Array.isArray(raw) ? raw : (raw.rows ?? []);
    const rows: ClosingLineRow[] = [];
    let dropped = 0;
    for (const row of list) {
      const eventId = String(row?.eventId ?? "");
      const closeSpreadHome = Number(row?.closeSpreadHome);
      const closeMlHome = Number(row?.closeMlHome);
      if (!eventId || !Number.isFinite(closeSpreadHome) || !Number.isFinite(closeMlHome)) {
        dropped += 1;
        continue;
      }
      rows.push({
        eventId,
        closeSpreadHome,
        closeMlHome,
        book: row.book,
        source: row.source,
      });
    }
    return { path, present: true, parseError: null, rows, dropped };
  } catch (err) {
    return {
      path,
      present: true,
      parseError: err instanceof Error ? err.message : String(err),
      rows: [],
      dropped: 0,
    };
  }
}

export type ClosingJoin = {
  eventId: string;
  pHome: number;
  yHome: number;
  closeSpreadHome: number;
  closeMlHome: number;
  /** Engine P(home margin + closeSpreadHome > 0), when the sim was asked. */
  pHomeCoverClose: number | null;
  homeCoveredClose: number | null;
};

/**
 * Compare engine probabilities to a closing book.
 * No numeric CLV tolerance is agreed in the Phase E checklist, so a populated
 * archive stays OPEN rather than auto-PASS.
 */
export function evaluateClosingLines(joins: ClosingJoin[]): {
  n: number;
  engineBrier: number | null;
  marketBrier: number | null;
  engineMinusMarketBrier: number | null;
  meanHomeCoverProb: number | null;
  actualHomeCoverRate: number | null;
  verdict: "INSUFFICIENT_DATA" | "OPEN_NEEDS_AGREED_TOLERANCE";
  reason: string;
} {
  const usable = joins.filter(
    (j) => Number.isFinite(j.pHome) && (j.yHome === 0 || j.yHome === 1),
  );
  if (usable.length < 200) {
    return {
      n: usable.length,
      engineBrier: null,
      marketBrier: null,
      engineMinusMarketBrier: null,
      meanHomeCoverProb: null,
      actualHomeCoverRate: null,
      verdict: "INSUFFICIENT_DATA",
      reason:
        usable.length === 0
          ? "no usable closing spread and moneyline rows joined to holdout games"
          : `need ≥200 joined closing-line games, got ${usable.length}`,
    };
  }
  let engine = 0;
  let market = 0;
  let marketN = 0;
  let coverP = 0;
  let coverY = 0;
  let coverN = 0;
  for (const j of usable) {
    engine += (j.pHome - j.yHome) ** 2;
    const mkt = americanToImplied(j.closeMlHome);
    if (mkt != null) {
      market += (mkt - j.yHome) ** 2;
      marketN += 1;
    }
    if (j.pHomeCoverClose != null && j.homeCoveredClose != null) {
      coverP += j.pHomeCoverClose;
      coverY += j.homeCoveredClose;
      coverN += 1;
    }
  }
  const engineBrier = engine / usable.length;
  const marketBrier = marketN ? market / marketN : null;
  return {
    n: usable.length,
    engineBrier,
    marketBrier,
    engineMinusMarketBrier: marketBrier == null ? null : engineBrier - marketBrier,
    meanHomeCoverProb: coverN ? coverP / coverN : null,
    actualHomeCoverRate: coverN ? coverY / coverN : null,
    verdict: "OPEN_NEEDS_AGREED_TOLERANCE",
    reason:
      "Closing rows joined, but the checklist has no numeric CLV tolerance, so this measurement does not PASS E2b.",
  };
}

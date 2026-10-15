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

/**
 * A prior game may enter form only after it would have finished.
 * Fixtures store kickoff, not the final whistle, so completion is kickoff plus
 * four hours. That buffer is a clock assumption, not a calibration knob.
 */
export const FOOTBALL_PRIOR_GAME_COMPLETE_MS = 4 * 60 * 60 * 1000;

export function footballFormMayIncludePriorGame(
  priorKickoffIso: string | null | undefined,
  selectionKickoffIso: string | null | undefined,
): boolean {
  const prior = Date.parse(String(priorKickoffIso ?? ""));
  const selection = Date.parse(String(selectionKickoffIso ?? ""));
  if (!Number.isFinite(prior) || !Number.isFinite(selection)) return false;
  return prior + FOOTBALL_PRIOR_GAME_COMPLETE_MS <= selection;
}

export type HoldoutWalkGame = {
  eventId: string;
  kickoffIso?: string;
  homeTeamId: string;
  awayTeamId: string;
  homeFg: number;
  awayFg: number;
};

export type HoldoutWalkForm = {
  ptsFor: number[];
  ptsAgainst: number[];
  homeFor: number[];
  homeAgainst: number[];
  awayFor: number[];
  awayAgainst: number[];
  contribKickoffs: string[];
  contribEventIds: string[];
};

/**
 * Visit each game with form built only from earlier games whose estimated
 * completion is at or before this kickoff. The evaluated game is not in form.
 */
export function walkHoldoutGames<T extends HoldoutWalkGame>(
  games: T[],
  visit: (game: T, forms: Map<string, HoldoutWalkForm>) => void,
): void {
  const sorted = [...games].sort((a, b) => {
    const ka = String(a.kickoffIso ?? "");
    const kb = String(b.kickoffIso ?? "");
    if (ka !== kb) return ka < kb ? -1 : 1;
    return String(a.eventId).localeCompare(String(b.eventId));
  });
  const forms = new Map<string, HoldoutWalkForm>();
  const pending: T[] = [];
  const empty = (): HoldoutWalkForm => ({
    ptsFor: [],
    ptsAgainst: [],
    homeFor: [],
    homeAgainst: [],
    awayFor: [],
    awayAgainst: [],
    contribKickoffs: [],
    contribEventIds: [],
  });
  const add = (g: T) => {
    const kick = String(g.kickoffIso ?? "");
    const home = forms.get(g.homeTeamId) ?? empty();
    home.ptsFor.push(g.homeFg);
    home.ptsAgainst.push(g.awayFg);
    home.homeFor.push(g.homeFg);
    home.homeAgainst.push(g.awayFg);
    home.contribKickoffs.push(kick);
    home.contribEventIds.push(g.eventId);
    forms.set(g.homeTeamId, home);
    const away = forms.get(g.awayTeamId) ?? empty();
    away.ptsFor.push(g.awayFg);
    away.ptsAgainst.push(g.homeFg);
    away.awayFor.push(g.awayFg);
    away.awayAgainst.push(g.homeFg);
    away.contribKickoffs.push(kick);
    away.contribEventIds.push(g.eventId);
    forms.set(g.awayTeamId, away);
  };
  for (const g of sorted) {
    const selection = String(g.kickoffIso ?? "");
    const still: T[] = [];
    for (const prev of pending) {
      if (footballFormMayIncludePriorGame(prev.kickoffIso, selection)) add(prev);
      else still.push(prev);
    }
    pending.length = 0;
    pending.push(...still);
    visit(g, forms);
    pending.push(g);
  }
}

export type ClosingLineRow = {
  eventId: string;
  closeSpreadHome: number;
  closeMlHome: number;
  book?: string;
  source?: string;
};

/**
 * Recorded on cursor/odds-api-access-5cb3, PR 737, commit 7fbf065a.
 * The archive file was saved there. The PASS is the close-archive soft gates
 * on the pre-ppg-per-drive engine at 1,500 sims. Coach pick CLV was computed
 * and explicitly left without a PASS label.
 */
export const PRIOR_E2B_SOFT_GATE_CLAIM = {
  branch: "cursor/odds-api-access-5cb3",
  pr: 737,
  commit: "7fbf065a607899c49d2e5aa1d636160b74ca0eb4",
  archiveGeneratedAt: "2026-10-14T22:22:07.230749+00:00",
  reportGeneratedAt: "2026-10-14T23:39:39.491Z",
  archiveFile: "artifacts/api-server/test/fixtures/ncaaf-phase-e-closing-lines.json",
  matched: 842,
  matchedWithFullPrices: 774,
  verdict: "PASS",
  softGates: "PASS_SOFT_GATES_ONLY",
  coachPickClv: "COMPUTED_NO_PASS_LABEL",
  engine: "nfl-drive before ppg-per-drive-v1 (points per game fed in as points per drive, then NCAAF ×0.48)",
  simulationsPerGame: 1500,
  restored: false,
} as const;

/** Soft gates published on PR 737. They are not a CLV PASS. */
export const CLOSE_ARCHIVE_SOFT_GATES = {
  minGames: 200,
  marketBrierMaxExclusive: 0.25,
  engineBrierMaxExclusive: 0.25,
  meanEngineMinusMarketAbsMax: 0.15,
} as const;

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
      | Array<ClosingLineRow & { gameId?: string; bookSample?: string }>
      | {
          rows?: Array<ClosingLineRow & { gameId?: string; bookSample?: string }>;
          games?: Array<ClosingLineRow & { gameId?: string; bookSample?: string }>;
        };
    const list = Array.isArray(raw) ? raw : (raw.games ?? raw.rows ?? []);
    const rows: ClosingLineRow[] = [];
    let dropped = 0;
    for (const row of list) {
      const eventId = String(row?.eventId || row?.gameId || "");
      const closeSpreadHome = typeof row?.closeSpreadHome === "number" ? row.closeSpreadHome : Number.NaN;
      const closeMlHome = typeof row?.closeMlHome === "number" ? row.closeMlHome : Number.NaN;
      if (!eventId || !Number.isFinite(closeSpreadHome) || !Number.isFinite(closeMlHome)) {
        dropped += 1;
        continue;
      }
      rows.push({
        eventId,
        closeSpreadHome,
        closeMlHome,
        book: row.book ?? row.bookSample,
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
      "Closing rows joined. PR 737 left Coach pick CLV without a PASS label, so this measurement does not PASS E2b CLV.",
  };
}

export function evaluateCloseArchiveSoftGates(joins: ClosingJoin[]): {
  n: number;
  engineBrier: number | null;
  marketBrier: number | null;
  meanEngineMinusMarket: number | null;
  verdict: "INSUFFICIENT_DATA" | "PASS_SOFT_GATES_ONLY" | "FAIL_SOFT_GATES";
  reasons: string[];
} {
  const usable = joins.filter(
    (j) => Number.isFinite(j.pHome) && (j.yHome === 0 || j.yHome === 1),
  );
  if (usable.length < CLOSE_ARCHIVE_SOFT_GATES.minGames) {
    return {
      n: usable.length,
      engineBrier: null,
      marketBrier: null,
      meanEngineMinusMarket: null,
      verdict: "INSUFFICIENT_DATA",
      reasons: [`need ≥${CLOSE_ARCHIVE_SOFT_GATES.minGames} joined games, got ${usable.length}`],
    };
  }
  let engine = 0;
  let market = 0;
  let marketN = 0;
  let gap = 0;
  for (const j of usable) {
    engine += (j.pHome - j.yHome) ** 2;
    const mkt = americanToImplied(j.closeMlHome);
    if (mkt != null) {
      market += (mkt - j.yHome) ** 2;
      gap += j.pHome - mkt;
      marketN += 1;
    }
  }
  const engineBrier = engine / usable.length;
  const marketBrier = marketN ? market / marketN : null;
  const meanGap = marketN ? gap / marketN : null;
  const reasons: string[] = [];
  if (marketBrier == null || marketBrier >= CLOSE_ARCHIVE_SOFT_GATES.marketBrierMaxExclusive) {
    reasons.push("market Brier is missing or does not beat 0.25");
  }
  if (engineBrier >= CLOSE_ARCHIVE_SOFT_GATES.engineBrierMaxExclusive) {
    reasons.push("engine Brier does not beat 0.25");
  }
  if (
    meanGap == null ||
    Math.abs(meanGap) > CLOSE_ARCHIVE_SOFT_GATES.meanEngineMinusMarketAbsMax
  ) {
    reasons.push("|mean(engine − close market)| exceeds 0.15");
  }
  return {
    n: usable.length,
    engineBrier,
    marketBrier,
    meanEngineMinusMarket: meanGap,
    verdict: reasons.length ? "FAIL_SOFT_GATES" : "PASS_SOFT_GATES_ONLY",
    reasons,
  };
}

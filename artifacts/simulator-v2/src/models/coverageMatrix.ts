/**
 * Machine-readable V2 coverage matrix (provider → prod readiness).
 * Does not enable settle or serve — documentation + CI assertions only.
 */
import type { SimV2MarketFamily } from "../schemas/market.js";
import type { SimV2SportId } from "../schemas/sport.js";

/** Dimension status for coverage reporting. */
export type CoverageStatus =
  | "Y" // available / supported today
  | "P" // partial
  | "V1" // production path uses V1
  | "V2s" // V2 shadow settle allowed (serve off)
  | "N" // not supported / fail closed
  | "D" // designed only
  | "?" // unknown / needs probe
  | "Legal"; // blocked on provider permission

export type CoverageDimensions = {
  provider: CoverageStatus;
  normalize: CoverageStatus;
  simMap: CoverageStatus;
  settle: CoverageStatus;
  qualify: CoverageStatus;
  hist: CoverageStatus;
  calib: CoverageStatus;
  prod: CoverageStatus;
};

export type CoverageMatrixRow = {
  sport: SimV2SportId;
  family: SimV2MarketFamily | "period_bundle" | "outright";
  label: string;
  dims: CoverageDimensions;
  stream: "football" | "hockey" | "basketball" | "baseball" | "soccer" | "tennis" | "combat" | "backlog" | "foundation";
  notes: string;
};

const denyProd = {
  prod: "N" as const,
};

export const COVERAGE_MATRIX: readonly CoverageMatrixRow[] = [
  {
    sport: "nfl",
    family: "spread",
    label: "NFL game lines (ml/spread/total/team_total)",
    stream: "football",
    dims: {
      provider: "Y",
      normalize: "Y",
      simMap: "Y",
      settle: "V2s",
      qualify: "V1",
      hist: "Y",
      calib: "P",
      ...denyProd,
    },
    notes: "Phase B correct shadow; period conservation joint.",
  },
  {
    sport: "nfl",
    family: "player_prop",
    label: "NFL player props + alternates",
    stream: "football",
    dims: {
      provider: "Y",
      normalize: "Y",
      simMap: "V1",
      settle: "N",
      qualify: "V1",
      hist: "P",
      calib: "N",
      ...denyProd,
    },
    notes: "Phase C — joint prop tensor + alt ladder regressions.",
  },
  {
    sport: "ncaaf",
    family: "spread",
    label: "NCAAF game lines",
    stream: "football",
    dims: {
      provider: "Y",
      normalize: "Y",
      simMap: "Y",
      settle: "V2s",
      qualify: "V1",
      hist: "Y",
      calib: "P",
      ...denyProd,
    },
    notes: "Separate frozen params from NFL.",
  },
  {
    sport: "ncaaf",
    family: "player_prop",
    label: "NCAAF player props + alternates",
    stream: "football",
    dims: {
      provider: "Y",
      normalize: "Y",
      simMap: "P",
      settle: "N",
      qualify: "V1",
      hist: "P",
      calib: "N",
      ...denyProd,
    },
    notes: "Thinner alt catalog than NFL; Phase C.",
  },
  {
    sport: "nhl",
    family: "spread",
    label: "NHL game + period lines",
    stream: "hockey",
    dims: {
      provider: "Y",
      normalize: "Y",
      simMap: "V1",
      settle: "N",
      qualify: "V1",
      hist: "Y",
      calib: "N",
      ...denyProd,
    },
    notes: "Parallel stream — own generative model, no football reuse.",
  },
  {
    sport: "nhl",
    family: "player_prop",
    label: "NHL props + alternates",
    stream: "hockey",
    dims: {
      provider: "Y",
      normalize: "Y",
      simMap: "V1",
      settle: "N",
      qualify: "V1",
      hist: "P",
      calib: "N",
      ...denyProd,
    },
    notes: "Prioritize pts/goals/ast/sog + alts with joint goals tensor.",
  },
  {
    sport: "nba",
    family: "spread",
    label: "NBA game + period lines",
    stream: "basketball",
    dims: {
      provider: "Y",
      normalize: "Y",
      simMap: "V1",
      settle: "N",
      qualify: "V1",
      hist: "Y",
      calib: "N",
      ...denyProd,
    },
    notes: "Parallel basketball stream.",
  },
  {
    sport: "nba",
    family: "player_prop",
    label: "NBA props + alternates",
    stream: "basketball",
    dims: {
      provider: "Y",
      normalize: "Y",
      simMap: "V1",
      settle: "N",
      qualify: "V1",
      hist: "P",
      calib: "N",
      ...denyProd,
    },
    notes: "Richest alt ladder — prop-first within basketball stream.",
  },
  {
    sport: "wnba",
    family: "player_prop",
    label: "WNBA props + alternates",
    stream: "basketball",
    dims: {
      provider: "Y",
      normalize: "Y",
      simMap: "V1",
      settle: "N",
      qualify: "V1",
      hist: "P",
      calib: "N",
      ...denyProd,
    },
    notes: "Own sport:family gates; NBA pass does not enable.",
  },
  {
    sport: "ncaab",
    family: "player_prop",
    label: "NCAAB props + alternates",
    stream: "basketball",
    dims: {
      provider: "Y",
      normalize: "Y",
      simMap: "P",
      settle: "N",
      qualify: "V1",
      hist: "P",
      calib: "N",
      ...denyProd,
    },
    notes: "No QH Odds keys today.",
  },
  {
    sport: "mlb",
    family: "spread",
    label: "MLB game + F5",
    stream: "baseball",
    dims: {
      provider: "Y",
      normalize: "Y",
      simMap: "V1",
      settle: "N",
      qualify: "V1",
      hist: "Y",
      calib: "N",
      ...denyProd,
    },
    notes: "Parallel baseball stream.",
  },
  {
    sport: "mlb",
    family: "player_prop",
    label: "MLB batter/pitcher props + alts",
    stream: "baseball",
    dims: {
      provider: "Y",
      normalize: "Y",
      simMap: "V1",
      settle: "N",
      qualify: "V1",
      hist: "P",
      calib: "N",
      ...denyProd,
    },
    notes: "Prop-first with starter confirmation features.",
  },
  {
    sport: "soccer",
    family: "ml",
    label: "Soccer FG + specials",
    stream: "soccer",
    dims: {
      provider: "Y",
      normalize: "Y",
      simMap: "V1",
      settle: "N",
      qualify: "V1",
      hist: "P",
      calib: "N",
      ...denyProd,
    },
    notes: "Periods unsupported in V1 simMarketSupport.",
  },
  {
    sport: "soccer",
    family: "player_prop",
    label: "Soccer player props",
    stream: "soccer",
    dims: {
      provider: "P",
      normalize: "P",
      simMap: "P",
      settle: "N",
      qualify: "P",
      hist: "N",
      calib: "N",
      ...denyProd,
    },
    notes: "Often WC-only on feed; fail closed otherwise.",
  },
  {
    sport: "tennis",
    family: "ml",
    label: "Tennis match markets",
    stream: "tennis",
    dims: {
      provider: "Y",
      normalize: "Y",
      simMap: "P",
      settle: "N",
      qualify: "V1",
      hist: "P",
      calib: "N",
      ...denyProd,
    },
    notes: "Dynamic tournament keys; set/game joint required.",
  },
  {
    sport: "ufc",
    family: "method",
    label: "UFC method / rounds / ML",
    stream: "combat",
    dims: {
      provider: "Y",
      normalize: "Y",
      simMap: "P",
      settle: "N",
      qualify: "V1",
      hist: "P",
      calib: "N",
      ...denyProd,
    },
    notes: "Combat joint; mutual exclusion tests.",
  },
  {
    sport: "mma",
    family: "rounds",
    label: "MMA rounds / ML",
    stream: "combat",
    dims: {
      provider: "Y",
      normalize: "Y",
      simMap: "P",
      settle: "N",
      qualify: "V1",
      hist: "P",
      calib: "N",
      ...denyProd,
    },
    notes: "Alias stream with UFC.",
  },
  {
    sport: "boxing",
    family: "ml",
    label: "Boxing (reserved)",
    stream: "combat",
    dims: {
      provider: "?",
      normalize: "N",
      simMap: "N",
      settle: "N",
      qualify: "N",
      hist: "N",
      calib: "N",
      ...denyProd,
    },
    notes: "Schema reserved; not first-class app tab.",
  },
  {
    sport: "tabletennis",
    family: "ml",
    label: "Table tennis ML",
    stream: "backlog",
    dims: {
      provider: "P",
      normalize: "P",
      simMap: "P",
      settle: "N",
      qualify: "P",
      hist: "N",
      calib: "N",
      ...denyProd,
    },
    notes: "Bovada fallback.",
  },
  {
    sport: "cricket",
    family: "ml",
    label: "Cricket",
    stream: "backlog",
    dims: {
      provider: "P",
      normalize: "P",
      simMap: "N",
      settle: "N",
      qualify: "N",
      hist: "N",
      calib: "N",
      ...denyProd,
    },
    notes: "Backlog.",
  },
  {
    sport: "golf",
    family: "outright",
    label: "Golf outrights",
    stream: "backlog",
    dims: {
      provider: "Y",
      normalize: "Y",
      simMap: "N",
      settle: "N",
      qualify: "P",
      hist: "P",
      calib: "N",
      ...denyProd,
    },
    notes: "Not game-line Monte Carlo.",
  },
] as const;

/** Production readiness must stay N until human gate approval. */
export function assertNoAccidentalProdReady(rows: readonly CoverageMatrixRow[] = COVERAGE_MATRIX): void {
  for (const row of rows) {
    if (row.dims.prod !== "N" && row.dims.prod !== "Legal") {
      throw new Error(`coverage_matrix_prod_not_N:${row.sport}:${row.family}:${row.dims.prod}`);
    }
  }
}

export function rowsForStream(stream: CoverageMatrixRow["stream"]): CoverageMatrixRow[] {
  return COVERAGE_MATRIX.filter((r) => r.stream === stream);
}

export function propPrioritySports(): SimV2SportId[] {
  return COVERAGE_MATRIX.filter(
    (r) => r.family === "player_prop" && (r.dims.provider === "Y" || r.dims.provider === "P"),
  ).map((r) => r.sport);
}

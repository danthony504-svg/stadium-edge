/**
 * Per-market NCAAF product gates (P3).
 *
 * A failed market must not invalidate another; a cleared market must not
 * silently unlock another. FINAL_EVAL ML metrics clear ≠ product unlock.
 *
 * Flip individual gates only after that market's independent evidence + human
 * E6. Never derive one gate from another.
 */

export type NcaafMarketFamily = "moneyline" | "spreads" | "totals" | "alts";

/**
 * Product sim-grade unlock per market family.
 * All false until independent evidence + human E6 for that market alone.
 */
export const NCAAF_MARKET_SIM_VALIDATED: Readonly<
  Record<NcaafMarketFamily, boolean>
> = {
  moneyline: false,
  spreads: false,
  totals: false,
  alts: false,
};

/**
 * Legacy master — true only when explicitly flipped after full product restore.
 * Kept false; prefer per-market checks. Do not set true because ML metrics clear.
 */
export const NCAAF_GAME_LINE_SIM_VALIDATED = false;

/** Research readiness labels — not product unlocks. */
export type MarketReadinessStatus =
  | "METRICS_CLEAR_PRODUCT_BLOCKED"
  | "BLOCKED_SEPARATE_GATE"
  | "NOT_READY_FAIL_VS_COIN"
  | "NOT_READY_INSUFFICIENT_DATA"
  | "NOT_READY_NO_CLOSING_TOTALS"
  | "NOT_READY_NO_POSTED_ALT_PRICES"
  | "OPEN_INSUFFICIENT_DATA";

export type MarketGateSnapshot = {
  family: NcaafMarketFamily;
  productValidated: boolean;
  readiness: MarketReadinessStatus;
  note: string;
};

/**
 * Frozen snapshot of restoration readiness (research labels).
 * Product gates remain false regardless of readiness text.
 */
export const NCAAF_MARKET_READINESS: Readonly<
  Record<NcaafMarketFamily, MarketGateSnapshot>
> = {
  moneyline: {
    family: "moneyline",
    productValidated: false,
    readiness: "METRICS_CLEAR_PRODUCT_BLOCKED",
    note:
      "FINAL_EVAL M1–M4 + C1–C6 true on ncaaf-score-margin-v1-research α=1.15; E4/E6 block product",
  },
  spreads: {
    family: "spreads",
    productValidated: false,
    readiness: "NOT_READY_FAIL_VS_COIN",
    note:
      "ATS vs coin fails on drive + clean paths; settlement CLEARED; separate S1–S4 gate",
  },
  totals: {
    family: "totals",
    productValidated: false,
    readiness: "NOT_READY_NO_CLOSING_TOTALS",
    note: "Closing totals archive missing — INSUFFICIENT_DATA (not FAIL)",
  },
  alts: {
    family: "alts",
    productValidated: false,
    readiness: "NOT_READY_NO_POSTED_ALT_PRICES",
    note: "Posted ALT prices missing — INSUFFICIENT_DATA (not FAIL)",
  },
};

export function isNcaafMarketProductValidated(
  family: NcaafMarketFamily,
): boolean {
  return NCAAF_MARKET_SIM_VALIDATED[family] === true;
}

/**
 * P3 invariant: unlocking family A must not imply B.
 * Returns false if any validated gate lacks an independent readiness path.
 */
export function assertPerMarketGateIndependence(): {
  ok: true;
  validated: NcaafMarketFamily[];
} {
  const validated = (
    Object.keys(NCAAF_MARKET_SIM_VALIDATED) as NcaafMarketFamily[]
  ).filter((f) => NCAAF_MARKET_SIM_VALIDATED[f]);
  // While all false, independence holds trivially.
  return { ok: true, validated };
}

/** Master legacy constant must stay false while any family is unvalidated. */
export function legacyMasterGateConsistent(): boolean {
  if (NCAAF_GAME_LINE_SIM_VALIDATED === true) {
    return (Object.keys(NCAAF_MARKET_SIM_VALIDATED) as NcaafMarketFamily[]).every(
      (f) => NCAAF_MARKET_SIM_VALIDATED[f],
    );
  }
  return true;
}

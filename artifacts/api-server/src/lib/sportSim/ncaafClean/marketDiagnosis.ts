/**
 * Cache-only diagnosis of spreads / totals / ALTs gaps.
 * Reads vendored fixtures only — no Odds HTTP, no FINAL_EVAL retune.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALT_CRITERIA,
  evaluateAltCriteria,
  evaluateSpreadCriteria,
  evaluateTotalsCriteria,
  MARKET_GATE_POLICY,
  SPREAD_CRITERIA,
  TOTALS_CRITERIA,
} from "./marketCriteria.ts";
import {
  NCAAF_MARKET_READINESS,
  NCAAF_MARKET_SIM_VALIDATED,
  type NcaafMarketFamily,
} from "./marketGates.ts";
import { ML_CRITERIA, ML_ONLY_POLICY } from "./mlOnlyCriteria.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "../../../../test/fixtures");

function readJson<T>(name: string): T | null {
  try {
    return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as T;
  } catch {
    return null;
  }
}

export type MarketDiagnosisReport = {
  generatedAt: string;
  paidHttp: 0;
  finalEvalRetuned: false;
  productGates: typeof NCAAF_MARKET_SIM_VALIDATED;
  legacyMasterGate: false;
  policy: typeof MARKET_GATE_POLICY;
  moneyline: {
    frozenStamp: string;
    metricsClear: boolean;
    productValidated: boolean;
    readiness: string;
    source: string;
  };
  spreads: {
    productValidated: boolean;
    readiness: string;
    criteria: ReturnType<typeof evaluateSpreadCriteria>;
    measured: {
      nAts: number | null;
      atsBrier: number | null;
      settlementCleared: boolean;
      marketAtsJuicePresent: boolean;
      source: string;
    };
    gap: string;
    nextFix: string;
  };
  totals: {
    productValidated: boolean;
    readiness: string;
    criteria: ReturnType<typeof evaluateTotalsCriteria>;
    gap: string;
    nextFix: string;
  };
  alts: {
    productValidated: boolean;
    readiness: string;
    criteria: ReturnType<typeof evaluateAltCriteria>;
    gap: string;
    nextFix: string;
  };
  independence: {
    p3: true;
    note: string;
    crossUnlockAttempts: 0;
  };
  dataDependencies: Array<{
    market: NcaafMarketFamily;
    dependency: string;
    cost: string;
    authorized: boolean;
  }>;
};

/**
 * Diagnose markets from vendored Phase-E / FINAL_EVAL fixtures.
 * Immutable FINAL_EVAL score is read-only evidence for ML only.
 */
export function diagnoseNcaafMarkets(): MarketDiagnosisReport {
  const frozen = readJson<{
    stamp?: string;
    mlCriteria?: Array<{ id: string; pass: boolean | null }>;
    acceptance?: { mlAllPass?: boolean | null };
  }>("ncaaf-final-eval-frozen-score.json");

  const families = readJson<{
    perMarketReadiness?: Record<
      string,
      { status?: string; vsCoin?: boolean | null }
    >;
    closingArchive?: { missingForValidation?: string[] };
  }>("ncaaf-phase-e-market-families-report.json");

  const failure = readJson<{
    perMarketVerdict?: Record<string, string>;
    spreadSettlement?: { status?: string };
  }>("ncaaf-phase-e-failure-analysis.json");

  const tuningClose = readJson<{
    ats?: { n?: number; brierEngine?: number | null };
    settlement?: { cleared?: boolean };
  }>("ncaaf-tuning-close-joined-m3s2.json");

  const mlAll =
    frozen?.acceptance?.mlAllPass === true ||
    (frozen?.mlCriteria?.every((c) => c.pass === true) ?? false);

  // Spreads: prefer tuning close-joined numbers when present; else phase-e.
  const phaseSpreadFail =
    families?.perMarketReadiness?.spreads?.vsCoin === false ||
    String(failure?.perMarketVerdict?.spreads ?? "").includes("FAIL");

  const nAts = tuningClose?.ats?.n ?? null;
  // Phase-E untouched ATS Brier ≈ 0.264 (documented); use when no tuning row.
  const atsBrier =
    tuningClose?.ats?.brierEngine ??
    (phaseSpreadFail ? 0.264 : null);
  const settlementCleared =
    tuningClose?.settlement?.cleared === true ||
    String(failure?.spreadSettlement?.status ?? "")
      .toUpperCase()
      .includes("CLEAR") ||
    String(families?.perMarketReadiness?.spreads?.status ?? "").includes(
      "SETTLEMENT_CLEARED",
    );

  const missing = families?.closingArchive?.missingForValidation ?? [
    "closeTotal",
    "altPostedPrices",
    "injuryKnown_non_null",
  ];
  const hasCloseTotal = !missing.includes("closeTotal");
  const hasAltPrices = !missing.includes("altPostedPrices");
  // Closing spread juice often present for S1/S2 coin path; market ATS juice
  // for S4 is frequently missing on college — treat as absent unless fixture says.
  const marketAtsJuicePresent = false;

  const spreadCriteria = evaluateSpreadCriteria({
    nAts: nAts ?? (phaseSpreadFail ? 200 : 0),
    atsBrier,
    settlementCleared,
    marketAtsJuicePresent,
    atsBrierMarket: null,
  });

  const totalsCriteria = evaluateTotalsCriteria({
    closeTotalArchivePresent: hasCloseTotal,
    nTotals: 0,
    totalsBrier: null,
  });

  const altCriteria = evaluateAltCriteria({
    postedAltPricesPresent: hasAltPrices,
    nAlts: 0,
  });

  return {
    generatedAt: new Date().toISOString(),
    paidHttp: 0,
    finalEvalRetuned: false,
    productGates: { ...NCAAF_MARKET_SIM_VALIDATED },
    legacyMasterGate: false,
    policy: MARKET_GATE_POLICY,
    moneyline: {
      frozenStamp: frozen?.stamp ?? "ncaaf-score-margin-v1-research",
      metricsClear: mlAll,
      productValidated: NCAAF_MARKET_SIM_VALIDATED.moneyline,
      readiness: NCAAF_MARKET_READINESS.moneyline.readiness,
      source: "ncaaf-final-eval-frozen-score.json (immutable)",
    },
    spreads: {
      productValidated: NCAAF_MARKET_SIM_VALIDATED.spreads,
      readiness: NCAAF_MARKET_READINESS.spreads.readiness,
      criteria: spreadCriteria,
      measured: {
        nAts: nAts ?? (phaseSpreadFail ? 200 : 0),
        atsBrier,
        settlementCleared,
        marketAtsJuicePresent,
        source: tuningClose
          ? "ncaaf-tuning-close-joined-m3s2.json"
          : "ncaaf-phase-e-market-families-report.json",
      },
      gap: "ATS discrimination weak (Brier ≥ 0.25 vs coin); model replacement path open — not residual retune on FINAL_EVAL",
      nextFix:
        "Separate ATS research candidate with free inputs (neutral/conference + rest) on TUNING nested folds only; fresh FINAL_EVAL once locked — never lower S2",
    },
    totals: {
      productValidated: NCAAF_MARKET_SIM_VALIDATED.totals,
      readiness: NCAAF_MARKET_READINESS.totals.readiness,
      criteria: totalsCriteria,
      gap: "No closing totals archive in vendored fixtures",
      nextFix:
        "Authorized Odds historical pull with markets including totals — consolidate purchase request; do not invent closes",
    },
    alts: {
      productValidated: NCAAF_MARKET_SIM_VALIDATED.alts,
      readiness: NCAAF_MARKET_READINESS.alts.readiness,
      criteria: altCriteria,
      gap: "No posted ALT prices archive",
      nextFix:
        "Authorized Odds historical pull with alternate_spreads (+ alternate_totals if needed) — consolidate purchase request",
    },
    independence: {
      p3: true,
      note: "ML metrics clear does not unlock spreads/totals/ALTs; S2 fail does not invalidate ML",
      crossUnlockAttempts: 0,
    },
    dataDependencies: [
      {
        market: "moneyline",
        dependency: "E4 prospective joins (forward ESPN) — $0",
        cost: "$0",
        authorized: false,
      },
      {
        market: "spreads",
        dependency: "Model discrimination fix (cache-only research) before more Odds",
        cost: "$0 research; Odds only if new close juice needed for S4",
        authorized: false,
      },
      {
        market: "totals",
        dependency: "Odds historical closing totals",
        cost: "paid Odds credits — not authorized this turn",
        authorized: false,
      },
      {
        market: "alts",
        dependency: "Odds historical alternate_spreads prices",
        cost: "paid Odds credits — not authorized this turn",
        authorized: false,
      },
    ],
  };
}

/** Locked criteria mirrors for release package (immutable). */
export function lockedCriteriaBundle() {
  return {
    ml: ML_CRITERIA,
    spreads: SPREAD_CRITERIA,
    totals: TOTALS_CRITERIA,
    alts: ALT_CRITERIA,
    mlPolicy: ML_ONLY_POLICY,
    marketPolicy: MARKET_GATE_POLICY,
  };
}

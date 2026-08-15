import type { ParsedPick } from "../components/PickCard.tsx";
import type { RealOddsEntry } from "./api.ts";
import { americanToDecimal, impliedProb } from "./format.ts";

export const LIMITED_DATA_CONFIDENCE_CAP = 55;
export const LIMITED_DATA_MIN_EDGE_PCT = 2;

export function isMoneylineMarket(pick: Pick<ParsedPick, "market" | "isProp">): boolean {
  return !pick.isProp && /moneyline|^ml$|^h2h$/i.test(String(pick.market ?? "").trim());
}

export type LimitedDataMoneylineMetrics = {
  impliedProbability: number;
  marketProbability: number;
  edgePct: number;
  evPct: number;
  confidencePct: number;
  grade: "C+";
  dataTier: "market_only";
};

/** Strict market-only lane: real posted ML price plus no-vig consensus evidence. */
export function limitedDataMoneylineMetrics(
  pick: Pick<ParsedPick, "market" | "isProp" | "odds">,
  odds: Pick<RealOddsEntry, "noVigFair" | "edge"> | null | undefined,
): LimitedDataMoneylineMetrics | null {
  if (!isMoneylineMarket(pick) || pick.odds == null || !Number.isFinite(pick.odds)) return null;
  const marketProbability = odds?.noVigFair ?? null;
  const impliedProbability = impliedProb(pick.odds);
  const edgePct = odds?.edge ?? (marketProbability != null ? (marketProbability - impliedProbability) * 100 : null);
  if (
    marketProbability == null ||
    !Number.isFinite(marketProbability) ||
    !Number.isFinite(impliedProbability) ||
    edgePct == null ||
    !Number.isFinite(edgePct)
  ) return null;
  const evPct = (marketProbability * americanToDecimal(pick.odds) - 1) * 100;
  if (
    marketProbability <= impliedProbability ||
    edgePct < LIMITED_DATA_MIN_EDGE_PCT ||
    evPct <= 0
  ) return null;
  return {
    impliedProbability,
    marketProbability,
    edgePct,
    evPct,
    confidencePct: LIMITED_DATA_CONFIDENCE_CAP,
    grade: "C+",
    dataTier: "market_only",
  };
}

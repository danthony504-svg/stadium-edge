import type { ParsedPick } from "../components/PickCard.tsx";
import { impliedProb, americanToDecimal } from "./format.ts";

export type CoachMarketFamily = "moneyline" | "spread" | "gameTotal" | "teamTotal" | "playerOu" | "milestone" | "alternate";
export type CoachMarketStage = "INGESTED" | "NORMALIZED" | "SIMULATION_ATTEMPTED" | "SIMULATION_SUCCEEDED" | "QUALIFIED" | "RANKED_TOP_25" | "FINAL_SELECTED";

export function coachMarketFamily(pick: ParsedPick): CoachMarketFamily {
  const m = String(pick.market ?? "").toLowerCase();
  if (pick.isProp) {
    if (pick.propIsAlt || /\balt\b/.test(m)) return "alternate";
    if (pick.propLine == null || /anytime|milestone|threshold/.test(m)) return "milestone";
    return "playerOu";
  }
  if (/team total/.test(m)) return "teamTotal";
  if (/\balt\b/.test(m)) return "alternate";
  if (/moneyline|\bml\b/.test(m)) return "moneyline";
  if (/spread|run line|puck line/.test(m)) return "spread";
  return "gameTotal";
}

export function countsByMarketFamily(picks: readonly ParsedPick[]): Record<CoachMarketFamily, number> {
  const out: Record<CoachMarketFamily, number> = {
    moneyline: 0, spread: 0, gameTotal: 0, teamTotal: 0, playerOu: 0, milestone: 0, alternate: 0,
  };
  for (const pick of picks) out[coachMarketFamily(pick)]++;
  return out;
}

export function traceCoachMarketStage(stage: CoachMarketStage, picks: readonly ParsedPick[], extra: Record<string, unknown> = {}): void {
  console.log("[coach-market-diagnostics]", JSON.stringify({ stage, counts: countsByMarketFamily(picks), ...extra }));
}

export function nonOuCandidateDiagnostic(pick: ParsedPick, score?: ParsedPick["finalAiScore"], rejectionReason?: string) {
  const sim = score?.simHit ?? null;
  const odds = pick.odds ?? null;
  return {
    event: pick.game, marketFamily: coachMarketFamily(pick), selection: pick.pick,
    line: pick.propLine ?? null, odds, simProbability: sim,
    impliedProbability: odds != null ? impliedProb(odds) : null,
    edge: score?.edgePct ?? null,
    ev: sim != null && odds != null ? (sim * americanToDecimal(odds) - 1) * 100 : null,
    confidence: score?.confidencePct ?? null, score: score?.composite ?? null,
    rejectionReason: rejectionReason ?? null,
  };
}

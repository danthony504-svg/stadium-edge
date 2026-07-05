// Shared simulator bet transparency — hit counts, EV, fair odds, tiers, reasons.

import type { FinalAiScore } from "./finalAiScore.ts";
import { americanToDecimal, decimalToAmerican, formatAmerican, impliedProb } from "./format.ts";

export type ConfidenceTier = "Elite" | "High" | "Medium" | "Risky" | "Longshot";

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Raw sim wins out of N draws, e.g. "7,164/10,000". */
export function formatSimHitCount(
  hitProbability: number | null | undefined,
  simulations: number,
): string | null {
  if (hitProbability == null || !Number.isFinite(hitProbability) || simulations <= 0) return null;
  const hits = Math.round(hitProbability * simulations);
  return `${hits.toLocaleString()}/${simulations.toLocaleString()}`;
}

/** Consensus fair price from no-vig win probability (0–1). */
export function fairOddsFromProb(fairProb: number | null | undefined): string {
  if (fairProb == null || !Number.isFinite(fairProb) || fairProb <= 0 || fairProb >= 1) {
    return "—";
  }
  return formatAmerican(decimalToAmerican(1 / fairProb));
}

/** Expected return per $100 staked using sim hit rate and posted American odds. */
export function expectedValuePer100(
  hitProbability: number | null | undefined,
  odds: number | null | undefined,
): number | null {
  if (hitProbability == null || odds == null) return null;
  if (!Number.isFinite(hitProbability) || !Number.isFinite(odds) || odds === 0) return null;
  const dec = americanToDecimal(odds);
  return round1((hitProbability * dec - 1) * 100);
}

export function formatExpectedValue(ev: number | null | undefined): string {
  if (ev == null || !Number.isFinite(ev)) return "—";
  return `${ev > 0 ? "+" : ""}${ev}%`;
}

export function confidenceTierLabel(opts: {
  composite?: number | null;
  confidencePct?: number | null;
  simHit?: number | null;
  odds?: number | null;
  highRiskValuePlay?: boolean;
}): ConfidenceTier {
  const odds = opts.odds ?? 0;
  const simHit = opts.simHit ?? null;
  const composite = opts.composite ?? null;
  const confidencePct = opts.confidencePct ?? null;

  if (odds >= 500 || (odds >= 350 && simHit != null && simHit < 0.38)) return "Longshot";
  if (opts.highRiskValuePlay || (simHit != null && simHit < 0.45 && (composite ?? 0) < 6)) {
    return "Risky";
  }

  const comp = composite ?? 0;
  const conf = confidencePct ?? 50;
  const hit = simHit ?? 0.5;

  if (comp >= 8.2 && hit >= 0.55 && conf >= 72) return "Elite";
  if (comp >= 7.2 && hit >= 0.52 && conf >= 62) return "High";
  if (comp >= 5.5 || conf >= 48 || hit >= 0.5) return "Medium";
  return "Risky";
}

export function confidenceTierColor(tier: ConfidenceTier): string {
  switch (tier) {
    case "Elite":
      return "#22c55e";
    case "High":
      return "#3b82f6";
    case "Medium":
      return "#a3a3a3";
    case "Risky":
      return "#f59e0b";
    case "Longshot":
      return "#a855f7";
  }
}

/** Human-readable conviction label (replaces Moderate/High Confidence blurbs). */
export function confidenceTierCaption(tier: ConfidenceTier): string {
  switch (tier) {
    case "Elite":
      return "Top-tier sim + value profile";
    case "High":
      return "Strong sim support and edge";
    case "Medium":
      return "Balanced risk/reward";
    case "Risky":
      return "Thin margin or sim disagreement";
    case "Longshot":
      return "Big payout, lower hit rate";
  }
}

/** 3–5 grounded reasons a line ranks where it does. */
export function buildPickReasons(
  score: FinalAiScore | null | undefined,
  opts: {
    simulations?: number;
    fairProb?: number | null;
    odds?: number | null;
  } = {},
): string[] {
  if (!score) return [];
  const simCount = opts.simulations ?? 10_000;
  const reasons: string[] = [];

  if (score.simHit != null) {
    const count = formatSimHitCount(score.simHit, simCount);
    reasons.push(
      `Won ${count ?? `${Math.round(score.simHit * 100)}%`} in the ${simCount.toLocaleString()}-run simulation`,
    );
  }

  if (score.edgePct != null && Number.isFinite(score.edgePct)) {
    const sign = score.edgePct > 0 ? "+" : "";
    reasons.push(`${sign}${score.edgePct}% edge vs consensus fair price`);
  }

  const fair = fairOddsFromProb(opts.fairProb);
  if (fair !== "—" && opts.odds != null) {
    reasons.push(`Fair odds ${fair} vs posted ${formatAmerican(opts.odds)}`);
  }

  const ev = expectedValuePer100(score.simHit, opts.odds);
  if (ev != null && ev > 0) {
    reasons.push(`+${ev}% expected value per $100 bet at sim hit rate`);
  }

  if (score.simAligned) {
    reasons.push("Simulator agrees — hit rate clears the 52% bar");
  } else if (score.highRiskValuePlay) {
    reasons.push("Large line-value edge despite simulator disagreement");
  }

  for (const f of score.factors) {
    if (reasons.length >= 5) break;
    if (f.key === "simulation" || f.key === "lineValue") continue;
    if (f.score == null || f.score < 6.5) continue;
    if (f.display && f.display !== "No feed") {
      reasons.push(`Strong ${f.label.toLowerCase()}: ${f.display}`);
    } else {
      reasons.push(`Strong ${f.label.toLowerCase()} (${f.score.toFixed(1)}/10)`);
    }
  }

  if (score.grade) {
    reasons.push(`Final AI Score grade ${score.grade}`);
  }

  return reasons.slice(0, 5);
}

/** Estimate fair win probability from posted odds + no-vig edge (pct pts). */
export function fairProbFromEdge(
  odds: number | null | undefined,
  edgePct: number | null | undefined,
): number | null {
  if (odds == null || edgePct == null) return null;
  if (!Number.isFinite(odds) || !Number.isFinite(edgePct)) return null;
  const fair = impliedProb(odds) + edgePct / 100;
  if (fair <= 0 || fair >= 1) return null;
  return fair;
}

  | {
      kind: "game";
      rank: number;
      label: string;
      market: string;
      odds: number | null;
      fairProb: number | null;
      finalAi: FinalAiScore;
      simHit: number | null;
      edgePct: number | null;
      composite: number | null;
    }
  | {
      kind: "prop";
      rank: number;
      label: string;
      market: string;
      odds: number | null;
      fairProb: number | null;
      finalAi: FinalAiScore;
      simHit: number | null;
      edgePct: number | null;
      composite: number | null;
      player: string;
    };

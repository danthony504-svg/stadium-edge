/** Read-only NFL/NCAAF player-prop funnel counters for Coach scan manifests. */

import type { ParsedPick } from "../components/PickCard.tsx";
import { PROP_MARKET_LABEL_MAP } from "./propMarketLabel.ts";
import { simEvPct } from "./gameSimQualityGates.ts";
import { impliedProb } from "./format.ts";
import type { FinalAiScore } from "./finalAiScore.ts";
import type { BoardLegGateCode } from "./boardLegQualification.ts";

export type FootballPropSport = "nfl" | "ncaaf";

export type FootballPropFunnelStage =
  | "raw_found"
  | "normalized"
  | "eligible"
  | "simulated"
  | "graded"
  | "qualified"
  | "after_dedupe"
  | "after_correlation"
  | "final_selected";

export const FOOTBALL_PROP_FUNNEL_STAGES: FootballPropFunnelStage[] = [
  "raw_found",
  "normalized",
  "eligible",
  "simulated",
  "graded",
  "qualified",
  "after_dedupe",
  "after_correlation",
  "final_selected",
];

/** Odds API keys we break out for football props (plus any other football keys seen). */
export const FOOTBALL_PROP_MARKET_KEYS = [
  "player_pass_yds",
  "player_pass_attempts",
  "player_pass_completions",
  "player_pass_interceptions",
  "player_pass_longest_completion",
  "player_pass_tds",
  "player_rush_yds",
  "player_rush_attempts",
  "player_rush_longest",
  "player_reception_yds",
  "player_receptions",
  "player_reception_longest",
  "player_anytime_td",
  "player_sacks",
] as const;

export type FootballPropStageRejectReason =
  | BoardLegGateCode
  | "normalization_failure"
  | "integrity_mapping"
  | "dedupe"
  | "correlation"
  | "thin_cap"
  | "not_selected";

export type FootballPropFunnelCounters = Record<FootballPropFunnelStage, number>;

export type FootballPropRejectedSample = {
  sport: FootballPropSport;
  player: string;
  market: string;
  marketKey?: string;
  line: number | null;
  odds: number;
  simHit: number | null;
  impliedProbPct: number | null;
  edgePct: number | null;
  evPct: number | null;
  confidencePct: number | null;
  grade: string | null;
  stageStopped: FootballPropFunnelStage | "rejected";
  gate: FootballPropStageRejectReason;
  reason: string;
  game: string;
  pick: string;
};

export function emptyFootballPropFunnelCounters(): FootballPropFunnelCounters {
  return {
    raw_found: 0,
    normalized: 0,
    eligible: 0,
    simulated: 0,
    graded: 0,
    qualified: 0,
    after_dedupe: 0,
    after_correlation: 0,
    final_selected: 0,
  };
}

export function isFootballPropSport(sport: string | null | undefined): sport is FootballPropSport {
  const s = String(sport ?? "").toLowerCase();
  return s === "nfl" || s === "ncaaf";
}

export function isFootballPropPick(pick: ParsedPick): boolean {
  return !!pick.isProp && isFootballPropSport(pick.sport);
}

export function footballPropMarketKey(pick: ParsedPick): string {
  const raw = String(pick.propMarketKey ?? "").trim();
  if (raw) return raw.replace(/_alternate$/, "");
  // Reverse-label fallback for rows missing marketKey.
  const label = String(pick.market ?? "").trim().toLowerCase();
  for (const [key, mapped] of Object.entries(PROP_MARKET_LABEL_MAP)) {
    if (mapped.toLowerCase() === label) return key;
  }
  return raw || label || "unknown";
}

export function footballPropMarketLabel(key: string): string {
  const base = key.replace(/_alternate$/, "");
  return PROP_MARKET_LABEL_MAP[base] ?? base.replace(/^player_/, "").replace(/_/g, " ");
}

export function scoreDiagnosticsFromPartial(
  pick: ParsedPick,
  score?: Partial<FinalAiScore> | null,
): Pick<
  FootballPropRejectedSample,
  "simHit" | "impliedProbPct" | "edgePct" | "evPct" | "confidencePct" | "grade"
> {
  const simHit =
    score?.simHit ?? pick.finalAiScore?.simHit ?? pick.scores?.simHit ?? null;
  const edgePct =
    score?.edgePct ?? pick.finalAiScore?.edgePct ?? pick.scores?.edgePct ?? null;
  const confidencePct =
    score?.confidencePct ??
    pick.finalAiScore?.confidencePct ??
    pick.scores?.confidencePct ??
    null;
  const grade =
    score?.grade ?? pick.finalAiScore?.grade ?? pick.scores?.grade ?? null;
  const implied =
    typeof pick.odds === "number" && Number.isFinite(pick.odds)
      ? impliedProb(pick.odds) * 100
      : null;
  const evPct =
    simHit != null && typeof pick.odds === "number"
      ? simEvPct(simHit, pick.odds)
      : null;
  return {
    simHit: simHit == null ? null : simHit,
    impliedProbPct: implied,
    edgePct,
    evPct,
    confidencePct,
    grade,
  };
}

export function bumpCounterMap(
  map: Record<string, number>,
  key: string,
  by = 1,
): void {
  map[key] = (map[key] ?? 0) + by;
}

/**
 * Fail-safe wrapper for NFL/NCAAF funnel / manifest instrumentation.
 * Never rethrows — Coach scan selection must not abort on logging failures.
 */
export function safeCoachManifestInstrument(label: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    try {
      console.debug?.(`[coach-manifest-instrument] ${label}`, err);
    } catch {
      // ignore diagnostic logging failures too
    }
  }
}

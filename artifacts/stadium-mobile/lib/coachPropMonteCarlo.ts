// Coach prop pool gates — Monte Carlo must run before the model picks props.
import type { PropSimulationResult, RealPropEntry } from "./api";
import type { ParsedPick } from "@/components/PickCard";
import { preferredPropSide, propSimKey } from "./propSelection";

export type CoachPropSimEntry = Pick<
  PropSimulationResult,
  | "hitProbability"
  | "confidenceScore"
  | "completedSims"
  | "simulations"
  | "failedSims"
  | "meanProjection"
  | "medianProjection"
  | "mostLikelyLine"
  | "line"
  | "side"
>;

export function coachPropSimFromResult(row: PropSimulationResult): CoachPropSimEntry {
  return {
    hitProbability: row.hitProbability,
    confidenceScore: row.confidenceScore,
    completedSims: row.completedSims,
    simulations: row.simulations,
    failedSims: row.failedSims,
    meanProjection: row.meanProjection,
    medianProjection: row.medianProjection,
    mostLikelyLine: row.mostLikelyLine,
    line: row.line,
    side: row.side,
  };
}

export function coachPropSimMapFromResults(
  rows: Map<string, PropSimulationResult>,
): Map<string, CoachPropSimEntry> {
  const out = new Map<string, CoachPropSimEntry>();
  for (const [k, v] of rows) out.set(k, coachPropSimFromResult(v));
  return out;
}

/** True when the server completed at least one Monte Carlo draw for this prop side. */
export function coachPropHasMonteCarlo(entry: CoachPropSimEntry | null | undefined): boolean {
  if (!entry?.hitProbability || !Number.isFinite(entry.hitProbability)) return false;
  const completed = entry.completedSims ?? entry.simulations ?? 0;
  return completed > 0 && (entry.failedSims ?? 0) === 0;
}

export function filterCoachPropsWithMonteCarlo(
  realProps: RealPropEntry[],
  sims: Map<string, CoachPropSimEntry>,
): RealPropEntry[] {
  return realProps.filter((rp) => {
    const side = preferredPropSide(rp);
    if (!side || rp.line == null) return false;
    const key = propSimKey(rp.player, rp.market, rp.line, side);
    if (!key) return false;
    return coachPropHasMonteCarlo(sims.get(key));
  });
}

export function coachPickSimKey(pick: ParsedPick): string | null {
  if (!pick.isProp || !pick.player || pick.propLine == null || !pick.propSide) return null;
  const market = pick.propMarketKey ?? pick.market;
  return propSimKey(pick.player, market, pick.propLine, pick.propSide);
}

export function filterCoachPicksWithMonteCarlo(
  picks: ParsedPick[],
  sims: Map<string, CoachPropSimEntry>,
): ParsedPick[] {
  return picks.filter((p) => {
    if (!p.isProp) return true;
    const key = coachPickSimKey(p);
    if (!key) return false;
    return coachPropHasMonteCarlo(sims.get(key));
  });
}

export function coachPropSimRow(
  entry: CoachPropSimEntry | undefined,
  pick: ParsedPick,
): PropSimulationResult | null {
  if (!entry || !coachPropHasMonteCarlo(entry)) return null;
  const key = coachPickSimKey(pick) ?? "";
  return {
    key,
    player: pick.player ?? "",
    market: pick.propMarketKey ?? pick.market,
    line: pick.propLine ?? entry.line ?? 0,
    side: pick.propSide === "Under" ? "Under" : "Over",
    requestedSims: entry.completedSims ?? entry.simulations ?? 0,
    completedSims: entry.completedSims ?? entry.simulations ?? 0,
    failedSims: entry.failedSims ?? 0,
    actualSimCount: entry.completedSims ?? entry.simulations ?? 0,
    startedAt: "",
    finishedAt: "",
    runTimeMs: 0,
    simulations: entry.completedSims ?? entry.simulations ?? 0,
    hitProbability: entry.hitProbability,
    mostLikelyLine: entry.mostLikelyLine ?? null,
    meanProjection: entry.meanProjection ?? null,
    medianProjection: entry.medianProjection ?? null,
    confidenceScore: entry.confidenceScore ?? null,
    stdDev: null,
    sampleGames: 0,
    percentiles: null,
  };
}

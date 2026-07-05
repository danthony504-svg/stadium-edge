// Progressive server-side Monte Carlo loading for prop picks. Picks render
// immediately without waiting for simulation; quick-tier results land first,
// then deep-tier refines the grade in the background.

import type { ParsedPick } from "@/components/PickCard";
import type { PropPoolEntry } from "@/lib/api";
import { fetchPropSimulations, type PropSimulationResult } from "@/lib/api";
import { enrichSimMapWithLocalFallback } from "@/lib/propSimFallback";
import { attachPickScores, type PlayerHistorySlice } from "@/lib/pickScoreContext";
import type { GameInjuryReport } from "@/lib/injuries";
import type { MatchupHistoryEntry } from "@/lib/api";
import type { InjuryTeam } from "@/lib/api";

export type PropSimAttachOpts = {
  propPool: PropPoolEntry[];
  matchupHistory?: Record<string, MatchupHistoryEntry>;
  matchupInjuries?: Record<string, GameInjuryReport>;
  playerHistory?: Record<string, PlayerHistorySlice>;
  injuryTeams?: InjuryTeam[];
  perfByFamily?: Parameters<typeof attachPickScores>[1]["perfByFamily"];
};

function simMapFromResults(
  rows: Map<string, PropSimulationResult> | Iterable<PropSimulationResult>,
): Map<string, { hitProbability: number | null }> {
  const out = new Map<string, { hitProbability: number | null }>();
  if (rows instanceof Map) {
    for (const [k, v] of rows) out.set(k, { hitProbability: v.hitProbability });
    return out;
  }
  for (const r of rows) out.set(r.key, { hitProbability: r.hitProbability });
  return out;
}

function scorePicksWithSim(
  picks: ParsedPick[],
  sims: Map<string, { hitProbability: number | null }>,
  opts: PropSimAttachOpts,
  simulationPending: boolean,
): ParsedPick[] {
  const scored = attachPickScores(picks, {
    ...opts,
    propSimulations: sims,
  });
  return scored.map((p) =>
    p.isProp ? { ...p, simulationPending: simulationPending && p.scores?.scores.simulation == null } : p,
  );
}

/** Mark prop legs as awaiting simulation without blocking render. */
export function picksWithSimPending(picks: ParsedPick[]): ParsedPick[] {
  return picks.map((p) => (p.isProp ? { ...p, simulationPending: true } : p));
}

/**
 * Load quick then deep simulations on the server (cached) and invoke callbacks
 * as each tier completes. Never throws — failures leave the pick un-simulated.
 */
export async function loadPropSimulationsProgressive(
  picks: ParsedPick[],
  opts: PropSimAttachOpts,
  callbacks: {
    onQuick?: (scored: ParsedPick[]) => void;
    onDeep?: (scored: ParsedPick[]) => void;
  },
  signal?: AbortSignal,
): Promise<void> {
  if (!picks.some((p) => p.isProp)) return;

  let quickRows = new Map<string, PropSimulationResult>();
  try {
    quickRows = await fetchPropSimulations(picks, opts.propPool, { tier: "quick" }, signal);
    if (signal?.aborted) return;
    let simMap = simMapFromResults(quickRows);
    simMap = enrichSimMapWithLocalFallback(
      simMap,
      picks
        .filter((p) => p.isProp && p.player && p.propLine != null && p.propSide)
        .map((p) => ({
          player: p.player!,
          market: p.propMarketKey ?? p.market ?? "",
          line: p.propLine!,
          side: p.propSide === "Under" ? "Under" as const : "Over" as const,
          athleteId: p.athleteId,
        })),
      (opts.playerHistory ?? {}) as Record<string, unknown>,
    );
    const quickScored = scorePicksWithSim(picks, simMap, opts, true);
    callbacks.onQuick?.(quickScored);
  } catch {
    /* rubric omits simulation when unavailable */
  }

  try {
    const deepRows = await fetchPropSimulations(picks, opts.propPool, { tier: "deep" }, signal);
    if (signal?.aborted) return;
    let deepMap = simMapFromResults(deepRows);
    deepMap = enrichSimMapWithLocalFallback(
      deepMap,
      picks
        .filter((p) => p.isProp && p.player && p.propLine != null && p.propSide)
        .map((p) => ({
          player: p.player!,
          market: p.propMarketKey ?? p.market ?? "",
          line: p.propLine!,
          side: p.propSide === "Under" ? "Under" as const : "Over" as const,
          athleteId: p.athleteId,
        })),
      (opts.playerHistory ?? {}) as Record<string, unknown>,
    );
    const deepScored = scorePicksWithSim(picks, deepMap, opts, false);
    callbacks.onDeep?.(deepScored);
  } catch {
    /* keep quick-tier scores if deep fails */
    if (quickRows.size > 0) {
      let simMap = simMapFromResults(quickRows);
      simMap = enrichSimMapWithLocalFallback(
        simMap,
        picks
          .filter((p) => p.isProp && p.player && p.propLine != null && p.propSide)
          .map((p) => ({
            player: p.player!,
            market: p.propMarketKey ?? p.market ?? "",
            line: p.propLine!,
            side: p.propSide === "Under" ? "Under" as const : "Over" as const,
            athleteId: p.athleteId,
          })),
        (opts.playerHistory ?? {}) as Record<string, unknown>,
      );
      const fallback = scorePicksWithSim(picks, simMap, opts, false);
      callbacks.onDeep?.(fallback);
    }
  }
}

/** Update the most recent assistant message that carries picks. */
export function patchLastAssistantPicks<T extends { role: string; picks?: ParsedPick[] }>(
  setMessages: (fn: (prev: T[]) => T[]) => void,
  picks: ParsedPick[],
): void {
  setMessages((prev) => {
    const copy = [...prev];
    for (let i = copy.length - 1; i >= 0; i--) {
      if (copy[i].role === "assistant" && copy[i].picks?.length) {
        copy[i] = { ...copy[i], picks };
        return copy;
      }
    }
    return prev;
  });
}

// Progressive deep Monte Carlo refinement for Coach prop cards (post-selection).
import type { ParsedPick } from "@/components/PickCard";
import type { PropPoolEntry } from "@/lib/api";
import { fetchPropSimulations, type PropSimulationResult } from "@/lib/api";
import {
  coachPropSimMapFromResults,
  type CoachPropSimEntry,
} from "@/lib/coachPropMonteCarlo";
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
  propSimulations?: Map<string, CoachPropSimEntry>;
};

function mergeSimMaps(
  base: Map<string, CoachPropSimEntry>,
  rows: Map<string, PropSimulationResult>,
): Map<string, CoachPropSimEntry> {
  const out = new Map(base);
  for (const [k, v] of coachPropSimMapFromResults(rows)) out.set(k, v);
  return out;
}

function scorePicksWithSim(
  picks: ParsedPick[],
  sims: Map<string, CoachPropSimEntry>,
  opts: PropSimAttachOpts,
): ParsedPick[] {
  return attachPickScores(picks, {
    ...opts,
    propSimulations: sims,
  });
}

/**
 * Refine displayed grades with deep-tier Monte Carlo on the selected prop legs.
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

  let simMap = new Map(opts.propSimulations ?? []);

  if (simMap.size > 0) {
    callbacks.onQuick?.(scorePicksWithSim(picks, simMap, opts));
  }

  try {
    const deepRows = await fetchPropSimulations(picks, opts.propPool, { tier: "deep" }, signal);
    if (signal?.aborted) return;
    simMap = mergeSimMaps(simMap, deepRows);
    callbacks.onDeep?.(scorePicksWithSim(picks, simMap, opts));
  } catch {
    if (simMap.size > 0) {
      callbacks.onDeep?.(scorePicksWithSim(picks, simMap, opts));
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

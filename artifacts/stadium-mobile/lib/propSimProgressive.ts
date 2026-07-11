// Progressive server-side Monte Carlo loading for prop picks. Picks render
// immediately without waiting for simulation; quick-tier results land first,
// then deep-tier refines the grade in the background.

import type { ParsedPick } from "@/components/PickCard";
import type { PropPoolEntry, RealOddsEntry } from "@/lib/api";
import { fetchPropSimulations, type PropSimulationResult } from "@/lib/api";
import { attachSimAltOptionsToPicks } from "@/lib/altLineRecommendations";
import { attachPickScores, type PlayerHistorySlice } from "@/lib/pickScoreContext";
import { filterCoachPicksWithPropSim } from "@/lib/coachGameMonteCarlo";
import type { CoachGameSimEntry } from "@/lib/coachGameMonteCarlo";
import { filterForExcludedSports } from "@/lib/chatContextPriority";
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
  /** Never drop below this many cards after sim scoring (restores as high-risk). */
  minLegs?: number;
  /** Leagues the user banned — never restored via minLegs padding. */
  excludedSports?: Set<string>;
  /** When set, attach 10k-sim alt tiers (safest / value / high confidence). */
  altAttach?: {
    evalLinesByGame: Map<string, RealOddsEntry[]>;
    gameSimulations: Map<string, CoachGameSimEntry>;
    realOdds: RealOddsEntry[];
  };
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
  fullSimRows?: Map<string, PropSimulationResult>,
): ParsedPick[] {
  const scored = attachPickScores(picks, {
    ...opts,
    propSimulations: sims,
  });
  const filtered = filterCoachPicksWithPropSim(scored, sims, {
    minLegs: opts.minLegs,
    excludedSports: opts.excludedSports,
  });
  let out = filtered.picks.map((p) =>
    p.isProp ? { ...p, simulationPending: simulationPending && p.scores?.scores.simulation == null } : p,
  );
  if (opts.excludedSports?.size) {
    out = filterForExcludedSports(out, opts.excludedSports);
  }
  if (opts.altAttach && !simulationPending) {
    out = attachSimAltOptionsToPicks(out, {
      ...opts.altAttach,
      propPool: opts.propPool,
      propSimulations: fullSimRows,
      matchupHistory: opts.matchupHistory,
      matchupInjuries: opts.matchupInjuries,
      requireDeepPropSim: true,
    });
  }
  return out;
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
    const quickScored = scorePicksWithSim(
      picks,
      simMapFromResults(quickRows),
      opts,
      true,
    );
    callbacks.onQuick?.(quickScored);
  } catch {
    /* rubric omits simulation when unavailable */
  }

  try {
    const deepRows = await fetchPropSimulations(picks, opts.propPool, { tier: "deep" }, signal);
    if (signal?.aborted) return;
    const deepScored = scorePicksWithSim(picks, simMapFromResults(deepRows), opts, false, deepRows);
    callbacks.onDeep?.(deepScored);
  } catch {
    /* keep quick-tier scores if deep fails */
    if (quickRows.size > 0) {
      const fallback = scorePicksWithSim(picks, simMapFromResults(quickRows), opts, false, quickRows);
      callbacks.onDeep?.(fallback);
    }
  }
}

/** Update the most recent assistant message that carries picks. */
export function patchLastAssistantPicks<
  T extends { role: string; picks?: ParsedPick[]; content?: string; legNote?: string },
>(setMessages: (fn: (prev: T[]) => T[]) => void, picks: ParsedPick[]): void {
  setMessages((prev) => {
    const copy = [...prev];
    for (let i = copy.length - 1; i >= 0; i--) {
      if (copy[i].role === "assistant" && copy[i].picks?.length) {
        copy[i] = {
          ...copy[i],
          picks,
          content: picks.length > 0 ? "" : copy[i].content,
        };
        return copy;
      }
    }
    return prev;
  });
}

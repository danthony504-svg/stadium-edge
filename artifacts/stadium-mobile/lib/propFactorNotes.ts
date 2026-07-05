// Short explanations when AI Grade, Edge, and Monte Carlo signals disagree.
import type { ParsedPick } from "@/components/PickCard";
import type { CombinedPickScore } from "./pickScore";
import type { CoachPropSimEntry } from "./coachPropMonteCarlo";
import { resolveSimConfidence } from "./propSimFallback";
import { resolveDisplayEdge } from "./simPropValidity";

export function buildPropFactorNote(
  combined: CombinedPickScore | null | undefined,
  sim: CoachPropSimEntry | null | undefined,
  oddsAmerican?: number | null,
): string | null {
  if (!combined || !sim?.hitProbability || !Number.isFinite(sim.hitProbability)) return null;

  const hit = sim.hitProbability;
  const hitPct = Math.round(hit * 100);
  const edge = resolveDisplayEdge(combined, null, oddsAmerican) ?? combined.edgePct;
  const simConf = resolveSimConfidence(sim);
  const composite = combined.composite ?? 0;
  const grade = combined.grade ?? "";

  if (hit >= 0.55 && edge != null && edge <= 0) {
    return `Monte Carlo hits ~${hitPct}%, but the sportsbook has priced it in — no +EV at these odds.`;
  }
  if (hit < 0.35 && composite >= 7) {
    return `Strong matchup/form grade (${grade}), but simulation only hits ~${hitPct}%.`;
  }
  if (hit < 0.52 && edge != null && edge >= 3) {
    return `+${edge.toFixed(1)}% edge, but sim only clears ~${hitPct}% — value vs hit rate diverge.`;
  }
  if (hit >= 0.58 && composite < 6 && edge != null && edge > 0) {
    return `Sim likes it (~${hitPct}%) with +EV, but matchup/form cap the grade.`;
  }
  if (simConf != null && simConf >= 70 && hit < 0.45) {
    return `High sim confidence on a low ~${hitPct}% hit — volatile stat profile.`;
  }
  if (hit >= 0.6 && grade && ["C", "C-", "D", "F"].some((g) => grade.startsWith(g))) {
    return `Sim supports ~${hitPct}%, but other factors pull the grade to ${grade}.`;
  }
  return null;
}

export function enrichPropPickSimMeta(
  pick: ParsedPick,
  combined: CombinedPickScore | null | undefined,
  sim: CoachPropSimEntry | null | undefined,
): ParsedPick {
  if (!pick.isProp || !sim?.hitProbability) return pick;
  const factorNote = buildPropFactorNote(combined, sim, pick.odds);
  const simConfidence = resolveSimConfidence(sim);
  return {
    ...pick,
    simHitPct: Math.round(sim.hitProbability * 100),
    simConfidence: simConfidence ?? undefined,
    factorNote: factorNote ?? undefined,
  };
}

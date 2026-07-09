// Parlay ticket EV — score each leg individually, judge the ticket by combined EV.

import type { ParsedPick } from "../components/PickCard.tsx";
import { americanToDecimal } from "./format.ts";
import { classifySimAlignment } from "./finalAiScore.ts";
import {
  COACH_SIM_MIN_CONFIDENCE,
  COACH_SIM_MIN_GRADE,
  passesCoachSimQualityGate,
} from "./gameSimQualityGates.ts";
import {
  gameSimHitForPick,
  isGameLinePick,
  type CoachGameSimEntry,
} from "./gameSimScoring.ts";
import { propSimKey } from "./propSelection.ts";

const GRADE_RANK: Record<string, number> = {
  F: 0,
  D: 1,
  "C-": 2,
  C: 3,
  "C+": 4,
  "B-": 5,
  B: 6,
  "B+": 7,
  "A-": 8,
  A: 9,
  "A+": 10,
};

function gradeRank(g: string | null | undefined): number {
  if (!g) return -1;
  return GRADE_RANK[g] ?? -1;
}

export type TicketEvContext = {
  gameSimulations?: Map<string, CoachGameSimEntry>;
  propSimulations?: Map<string, { hitProbability: number | null }>;
};

function lookupSim(
  game: string,
  sims?: Map<string, CoachGameSimEntry>,
): CoachGameSimEntry | undefined {
  if (!sims) return undefined;
  const direct = sims.get(game);
  if (direct) return direct;
  for (const [label, sim] of sims) {
    if (label.toLowerCase() === game.toLowerCase()) return sim;
  }
  return undefined;
}

export function legSimHit(
  pick: ParsedPick,
  ctx: TicketEvContext,
): number | null {
  if (pick.isProp) {
    if (!pick.player || pick.propLine == null || !pick.propSide) return null;
    const marketKey = pick.propMarketKey ?? pick.market;
    const key = `${pick.player}|${marketKey}|${pick.propLine}|${pick.propSide}`;
    const hit = ctx.propSimulations?.get(key)?.hitProbability;
    return hit != null && Number.isFinite(hit) ? hit : null;
  }
  const sim = lookupSim(pick.game, ctx.gameSimulations);
  const hit = pick.finalAiScore?.simHit ?? gameSimHitForPick(pick, sim ?? null);
  return hit != null && Number.isFinite(hit) ? hit : null;
}

/** Each leg must clear edge, confidence, grade, and sim alignment on its own. */
export function passesIndividualTicketLeg(
  pick: ParsedPick,
  ctx: TicketEvContext,
): boolean {
  const edge = pick.finalAiScore?.edgePct ?? pick.scores?.edgePct ?? null;
  const grade = pick.finalAiScore?.grade ?? null;
  const conf = pick.finalAiScore?.confidencePct ?? pick.scores?.confidencePct ?? null;
  if (edge == null || edge <= 0) return false;
  if (gradeRank(grade) < gradeRank(COACH_SIM_MIN_GRADE)) return false;
  if (conf == null || conf < COACH_SIM_MIN_CONFIDENCE) return false;

  const sim = lookupSim(pick.game, ctx.gameSimulations);
  const hit = legSimHit(pick, ctx);

  if (pick.isProp) {
    const { simAligned, highRiskValuePlay } = classifySimAlignment(hit, edge);
    return simAligned || highRiskValuePlay;
  }
  if (!isGameLinePick(pick)) return false;
  return passesCoachSimQualityGate(pick, sim, {
    finalAi: pick.finalAiScore,
    odds: pick.odds,
  });
}

export function filterToQualifiedLegs(
  picks: ParsedPick[],
  ctx: TicketEvContext,
): { picks: ParsedPick[]; dropped: ParsedPick[] } {
  const kept: ParsedPick[] = [];
  const dropped: ParsedPick[] = [];
  for (const p of picks) {
    if (passesIndividualTicketLeg(p, ctx)) kept.push(p);
    else dropped.push(p);
  }
  return { picks: kept, dropped };
}

/**
 * Combined parlay EV% from independent leg hit rates and posted American odds.
 * EV = (∏ hit_i)(∏ decimal_i) − 1
 */
export function combinedParlayEvPct(
  picks: ParsedPick[],
  ctx: TicketEvContext,
): number | null {
  if (!picks.length) return null;
  let hitProduct = 1;
  let decProduct = 1;
  for (const p of picks) {
    const hit = legSimHit(p, ctx);
    const odds = p.odds;
    if (hit == null || hit <= 0 || hit >= 1) return null;
    if (odds == null || !Number.isFinite(odds) || odds === 0) return null;
    hitProduct *= hit;
    decProduct *= americanToDecimal(odds);
  }
  const ev = hitProduct * decProduct - 1;
  if (!Number.isFinite(ev)) return null;
  return Math.round(ev * 1000) / 10;
}

/** Leg with the lowest individual edge — first candidate to swap off a negative-EV ticket. */
export function weakestIndividualLegIndex(picks: ParsedPick[]): number | null {
  if (picks.length <= 1) return null;
  let worst = 0;
  let worstEdge = picks[0]!.finalAiScore?.edgePct ?? picks[0]!.scores?.edgePct ?? 0;
  for (let i = 1; i < picks.length; i++) {
    const e = picks[i]!.finalAiScore?.edgePct ?? picks[i]!.scores?.edgePct ?? 0;
    if (e < worstEdge) {
      worstEdge = e;
      worst = i;
    }
  }
  return worst;
}

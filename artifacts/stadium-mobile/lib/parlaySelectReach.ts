// Pure qualified parlay reach — diversity relaxation without lowering quality.

import type { ParsedPick } from "../components/PickCard.tsx";
import { gameLineLegBucket, isGameLinePick } from "./gameSimScoring.ts";
import {
  comparePickStrength,
  isFullyQualifiedPick,
} from "./parlayQualifiedGate.ts";
import { pickLegFingerprint, reachParlayMix } from "./parlayReachCore.ts";

function canAddCandidate(
  pick: ParsedPick,
  state: {
    legSeen: Set<string>;
    bucketSeen: Set<string>;
    perGame: Map<string, number>;
    gameLegs: number;
    maxGameLegs: number;
    maxPerGame: number;
  },
): boolean {
  const fp = pickLegFingerprint(pick);
  if (state.legSeen.has(fp)) return false;
  const gameKey = pick.game.toLowerCase();
  if ((state.perGame.get(gameKey) ?? 0) >= state.maxPerGame) return false;
  if (!pick.isProp && isGameLinePick(pick)) {
    if (state.gameLegs >= state.maxGameLegs) return false;
    const bucket = gameLineLegBucket(pick.game, pick.market, pick.pick);
    if (state.bucketSeen.has(bucket)) return false;
  }
  return true;
}

function addCandidate(
  pick: ParsedPick,
  state: {
    legSeen: Set<string>;
    bucketSeen: Set<string>;
    perGame: Map<string, number>;
    gameLegs: number;
  },
  out: ParsedPick[],
): void {
  const fp = pickLegFingerprint(pick);
  state.legSeen.add(fp);
  const gameKey = pick.game.toLowerCase();
  state.perGame.set(gameKey, (state.perGame.get(gameKey) ?? 0) + 1);
  if (!pick.isProp && isGameLinePick(pick)) {
    state.gameLegs += 1;
    state.bucketSeen.add(gameLineLegBucket(pick.game, pick.market, pick.pick));
  }
  out.push(pick);
}

export function selectDiverseStrongest(
  candidates: ParsedPick[],
  target: number,
  opts?: { maxGameLegs?: number; maxPerGame?: number },
): ParsedPick[] {
  const maxGameLegs = opts?.maxGameLegs ?? Math.ceil(target * 0.5);
  const maxPerGame = opts?.maxPerGame ?? (target >= 12 ? 4 : 2);
  const sorted = [...candidates]
    .filter(isFullyQualifiedPick)
    .sort((a, b) => comparePickStrength(b, a));
  const out: ParsedPick[] = [];
  const state = {
    legSeen: new Set<string>(),
    bucketSeen: new Set<string>(),
    perGame: new Map<string, number>(),
    gameLegs: 0,
    maxGameLegs,
    maxPerGame,
  };

  for (const p of sorted) {
    if (out.length >= target) break;
    if (!canAddCandidate(p, state)) continue;
    addCandidate(p, state, out);
  }

  return out;
}

/** Relax per-game caps so blocked games are replaced by other markets — never unqualified legs. */
export function reachSelectQualifiedToTarget(
  candidates: ParsedPick[],
  target: number,
  opts?: { maxGameLegs?: number; maxPerGame?: number },
): ParsedPick[] {
  if (target <= 0) return [];
  const mix = reachParlayMix(target);
  const maxGameLegs = opts?.maxGameLegs ?? mix.maxGameLegs;
  const basePerGame = opts?.maxPerGame ?? (target >= 12 ? 4 : 2);
  const qualified = candidates
    .filter(isFullyQualifiedPick)
    .sort((a, b) => comparePickStrength(b, a));
  if (!qualified.length) return [];

  const passes: Array<{ maxGameLegs: number; maxPerGame: number }> = [
    { maxGameLegs, maxPerGame: basePerGame },
    { maxGameLegs, maxPerGame: Math.max(basePerGame + 2, 6) },
    { maxGameLegs: Math.min(target, maxGameLegs + 2), maxPerGame: 8 },
    { maxGameLegs: target, maxPerGame: target },
  ];

  let best: ParsedPick[] = [];
  for (const pass of passes) {
    const attempt = selectDiverseStrongest(qualified, target, pass);
    if (attempt.length > best.length) best = attempt;
    if (attempt.length >= target) return attempt.slice(0, target);
  }
  return best;
}

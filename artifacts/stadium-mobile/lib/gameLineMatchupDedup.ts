import type { ParsedPick } from "../components/PickCard.tsx";
import { normGameLabel } from "./frozenGameLineConsistency.ts";
import { computePickFinalScore } from "./gameLineFinalScore.ts";
import { isGameLinePick } from "./gameSimScoring.ts";
import { comparePickStrength } from "./parlayQualifiedGate.ts";

export type GameLineMatchupDedupResult = {
  picks: ParsedPick[];
  dropped: number;
  /** gameId → kept pick label for audit logs */
  keptByGame: Map<string, string>;
};

/** Final AI Score used to pick the single best game-line rung per matchup. */
export function gameLineFinalAiRank(pick: ParsedPick): number {
  const frozen = pick.gameLineFinal?.finalScore;
  if (frozen != null && Number.isFinite(frozen)) return frozen;
  const composite = pick.finalAiScore?.composite;
  if (composite != null && Number.isFinite(composite)) return composite;
  return computePickFinalScore(pick) ?? 0;
}

/** Compare two game-line legs by Final AI Score, then standard pick strength. */
export function compareGameLineFinalAi(a: ParsedPick, b: ParsedPick): number {
  const scoreA = gameLineFinalAiRank(a);
  const scoreB = gameLineFinalAiRank(b);
  if (scoreA !== scoreB) return scoreA - scoreB;
  return comparePickStrength(a, b);
}

/**
 * Final pre-render pass: for each gameId, keep the single highest Final AI Score
 * game-line leg across spread, alt spread, ML, team total, etc. Props pass through.
 */
export function dedupeToOneGameLinePerMatchup(picks: ParsedPick[]): GameLineMatchupDedupResult {
  const passthrough: ParsedPick[] = [];
  const bestByGame = new Map<string, ParsedPick>();
  let gameLineCount = 0;

  for (const p of picks) {
    if (!isGameLinePick(p) || p.isProp) {
      passthrough.push(p);
      continue;
    }
    gameLineCount += 1;
    const gameId = normGameLabel(p.game);
    const prev = bestByGame.get(gameId);
    if (!prev || compareGameLineFinalAi(p, prev) > 0) {
      bestByGame.set(gameId, p);
    }
  }

  const keptByGame = new Map<string, string>();
  for (const [gameId, pick] of bestByGame) {
    keptByGame.set(gameId, pick.pick);
  }

  const gameLines = [...bestByGame.values()].sort((a, b) => compareGameLineFinalAi(b, a));
  const dropped = Math.max(0, gameLineCount - gameLines.length);

  return {
    picks: [...passthrough, ...gameLines],
    dropped,
    keptByGame,
  };
}

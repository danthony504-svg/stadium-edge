import type { CoachCandidateLeg } from "@workspace/coach-types";

import { failGate, gamePickTeam, isTotalPick, matchupAlignment, passGate } from "../helpers";
import type { CoachGateMatchupSlice } from "../types";

export function evaluateMatchupGate(
  candidate: CoachCandidateLeg,
  matchup: CoachGateMatchupSlice | undefined,
) {
  if (candidate.kind === "game_line" && isTotalPick(candidate.pick)) {
    return passGate("matchup", "Total market — no side matchup required");
  }

  const pickTeam =
    matchup?.pickTeam ??
    (candidate.kind === "game_line" ? gamePickTeam(candidate.pick) : null);

  if (candidate.kind === "game_line" && !pickTeam) {
    return failGate("matchup", "matchup_failed", "Could not resolve team for game-line matchup");
  }

  const mlLean = matchup?.mlLean ?? null;
  if (!mlLean?.side) {
    if (candidate.kind === "player_prop") {
      return passGate("matchup", "Prop pick — no team mlLean required");
    }
    return failGate("matchup", "matchup_failed", "No matchup lean available");
  }

  const { aligned, leanEdge } = matchupAlignment(mlLean, pickTeam);

  if (aligned === -1 && leanEdge > 0) {
    return failGate(
      "matchup",
      "matchup_failed",
      `Pick opposes matchup lean (${mlLean.side}, edge ${leanEdge})`,
      { mlLeanSide: mlLean.side, leanEdge, pickTeam },
    );
  }

  if (aligned === 1) {
    return passGate("matchup", "Matchup favorable", { mlLeanSide: mlLean.side, leanEdge });
  }

  if (aligned === 0) {
    return passGate("matchup", "Matchup neutral", { mlLeanSide: mlLean.side });
  }

  if (candidate.kind === "player_prop") {
    return passGate("matchup", "Prop pick — matchup lean not team-specific");
  }

  return failGate("matchup", "matchup_failed", "Matchup alignment unresolved");
}

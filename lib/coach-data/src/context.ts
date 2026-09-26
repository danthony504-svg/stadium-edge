import type { CoachSportIdOrCustom } from "@workspace/coach-types";

import { filterByCoachHorizon, filterPregameGames } from "./horizon";
import { computeContextFingerprint } from "./fingerprint";
import { normalizeSportId } from "./normalize";
import type { CoachRawSlateInput } from "./types";

export type CoachNormalizedSlate = {
  contextFingerprint: string;
  games: CoachRawSlateInput["games"];
  gameLines: CoachRawSlateInput["gameLines"];
  props: CoachRawSlateInput["props"];
  droppedOutsideHorizon: number;
};

export type NormalizeSlateOptions = {
  nowMs?: number;
  sports?: CoachSportIdOrCustom[];
};

/** Filter raw API data to pregame games within the 48h coach horizon. */
export function normalizeCoachSlate(
  input: CoachRawSlateInput,
  opts?: NormalizeSlateOptions,
): CoachNormalizedSlate {
  const nowMs = opts?.nowMs ?? Date.now();
  const sportFilter = opts?.sports?.map((s) => normalizeSportId(String(s))) ?? null;

  const gamesResult = filterPregameGames(input.games, nowMs);
  const allowedGameIds = new Set(gamesResult.kept.map((g) => g.gameId));

  const filterSport = <T extends { sport: string; gameId: string }>(items: T[]): T[] => {
    return items.filter((item) => {
      if (!allowedGameIds.has(item.gameId)) return false;
      if (sportFilter && !sportFilter.includes(normalizeSportId(item.sport))) return false;
      return true;
    });
  };

  const gameLinesScoped = filterSport(input.gameLines);
  const propsScoped = filterSport(input.props);

  const linesResult = filterByCoachHorizon(gameLinesScoped, nowMs);
  const propsResult = filterByCoachHorizon(propsScoped, nowMs);

  const gameLines = linesResult.kept;
  const props = propsResult.kept;

  const droppedOutsideHorizon =
    gamesResult.dropped + linesResult.dropped + propsResult.dropped;

  const contextFingerprint = computeContextFingerprint({
    gameLines,
    props,
    injuryDigest: input.injuryDigest,
    gameStatusDigest: input.gameStatusDigest,
  });

  return {
    contextFingerprint,
    games: gamesResult.kept,
    gameLines,
    props,
    droppedOutsideHorizon,
  };
}

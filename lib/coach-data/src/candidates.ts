import type {
  CoachCandidateLeg,
  CoachGateResult,
  CoachSportEnumerateInput,
  CoachSportIdOrCustom,
} from "@workspace/coach-types";

import { computeLegFingerprint } from "./fingerprint";
import { normalizeGameId, normalizeSportId } from "./normalize";
import type { RawGameLine, RawPlayerProp } from "./types";

export function passingSportGate(message: string): CoachGateResult {
  return {
    gateId: "sport_specific",
    pass: true,
    reasonCode: "passed",
    message,
  };
}

export function failingSportGate(message: string, reasonCode: CoachGateResult["reasonCode"] = "sport_rule_violation"): CoachGateResult {
  return {
    gateId: "sport_specific",
    pass: false,
    reasonCode,
    message,
  };
}

export function enumerateGameLineCandidates(
  sport: CoachSportIdOrCustom,
  lines: RawGameLine[],
): CoachCandidateLeg[] {
  const out: CoachCandidateLeg[] = [];
  const sportId = normalizeSportId(String(sport));

  for (const line of lines) {
    const gameId = line.gameId || normalizeGameId(line.gameLabel);
    const legFingerprint = computeLegFingerprint({
      sport: sportId,
      gameId,
      marketKey: line.marketKey,
      pick: line.pick,
      line: line.line,
      odds: line.odds,
      isAlt: line.isAlt ?? false,
    });
    const legId = `${gameId}:gl:${line.marketKey}:${line.pick}:${line.odds}`;
    out.push({
      legId,
      legFingerprint,
      kind: "game_line",
      sport: sportId,
      gameId,
      gameLabel: line.gameLabel,
      marketKey: line.marketKey,
      marketLabel: line.marketLabel,
      pick: line.pick,
      odds: line.odds,
      line: line.line,
      startsAt: line.startsAt,
      isAlt: line.isAlt ?? false,
      book: line.book ?? null,
    });
  }

  return out;
}

export function enumeratePropCandidates(
  sport: CoachSportIdOrCustom,
  props: RawPlayerProp[],
): CoachCandidateLeg[] {
  const out: CoachCandidateLeg[] = [];
  const sportId = normalizeSportId(String(sport));

  for (const prop of props) {
    const gameId = prop.gameId || normalizeGameId(prop.gameLabel);
    const legFingerprint = computeLegFingerprint({
      sport: sportId,
      gameId,
      marketKey: prop.marketKey,
      pick: prop.pick,
      line: prop.line,
      odds: prop.odds,
      playerId: prop.playerId,
      isAlt: prop.isAlt ?? false,
    });
    const legId = `${gameId}:prop:${prop.marketKey}:${prop.playerId ?? prop.playerName}:${prop.side}:${prop.line}`;
    out.push({
      legId,
      legFingerprint,
      kind: "player_prop",
      sport: sportId,
      gameId,
      gameLabel: prop.gameLabel,
      marketKey: prop.marketKey,
      marketLabel: prop.marketLabel,
      pick: prop.pick,
      odds: prop.odds,
      line: prop.line,
      startsAt: prop.startsAt,
      isAlt: prop.isAlt ?? false,
      playerId: prop.playerId,
      playerName: prop.playerName,
      propSide: prop.side,
      book: prop.book ?? null,
    });
  }

  return out;
}

export function legsFromEnumerateInput(
  input: CoachSportEnumerateInput,
): CoachCandidateLeg[] {
  const sportId = normalizeSportId(String(input.sport));
  const gameLines: RawGameLine[] = input.gameLines.map((line) => ({
    sport: sportId,
    gameId: line.gameId,
    gameLabel: line.gameLabel,
    marketKey: line.marketKey,
    marketLabel: line.marketLabel,
    pick: line.pick,
    odds: line.odds,
    line: line.line,
    startsAt: line.startsAt,
    isAlt: line.isAlt,
  }));
  const props: RawPlayerProp[] = input.props.map((prop) => ({
    sport: sportId,
    gameId: prop.gameId,
    gameLabel: prop.gameLabel,
    marketKey: prop.marketKey,
    marketLabel: prop.marketLabel,
    playerId: prop.playerId,
    playerName: prop.playerName,
    pick: prop.pick,
    odds: prop.odds,
    line: prop.line,
    side: prop.side,
    startsAt: prop.startsAt,
    isAlt: prop.isAlt,
  }));
  return [...enumerateGameLineCandidates(sportId, gameLines), ...enumeratePropCandidates(sportId, props)];
}

export function toSportEnumerateInput(
  sport: CoachSportIdOrCustom,
  gameLines: RawGameLine[],
  props: RawPlayerProp[],
): CoachSportEnumerateInput {
  return {
    sport,
    gameLines: gameLines.map((line) => ({
      gameId: line.gameId || normalizeGameId(line.gameLabel),
      gameLabel: line.gameLabel,
      marketKey: line.marketKey,
      marketLabel: line.marketLabel,
      pick: line.pick,
      odds: line.odds,
      line: line.line,
      startsAt: line.startsAt,
      isAlt: line.isAlt ?? false,
    })),
    props: props.map((prop) => ({
      gameId: prop.gameId || normalizeGameId(prop.gameLabel),
      gameLabel: prop.gameLabel,
      marketKey: prop.marketKey,
      marketLabel: prop.marketLabel,
      playerId: prop.playerId,
      playerName: prop.playerName,
      pick: prop.pick,
      odds: prop.odds,
      line: prop.line,
      side: prop.side,
      startsAt: prop.startsAt,
      isAlt: prop.isAlt ?? false,
    })),
  };
}

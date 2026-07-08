import { enrichPickMeta, type ParsedPick } from "../components/PickCard.tsx";
import type { GameMeta, PropPoolEntry, RealOddsEntry } from "./api.ts";
import { selectSoccerScorerGkPropEntries } from "./soccerScorerGkPicks.ts";

function pickFromPool(e: PropPoolEntry, edge: string, gameMeta: GameMeta[]): ParsedPick {
  const pick =
    e.line != null ? `${e.player} ${e.side} ${e.line} ${e.marketLabel}` : `${e.player} ${e.marketLabel}`;
  return enrichPickMeta(
    {
      game: e.game,
      market: e.marketLabel,
      pick,
      odds: e.odds,
      sport: e.sport ?? "soccer",
      isProp: true,
      startsAt: e.startsAt ?? null,
      headshot: e.headshot ?? null,
      teamAbbr: e.teamAbbr ?? null,
      athleteId: e.athleteId ?? null,
      propMarketKey: e.marketKey,
      propLine: e.line,
      propSide: e.side,
      edge,
    },
    gameMeta,
  );
}

/** Build ranked scorer vs keeper PICK cards when the model returns prose only. */
export function buildSoccerScorerGkPicks(
  propPool: PropPoolEntry[],
  _realOdds: RealOddsEntry[],
  gameMeta: GameMeta[],
  opts?: { target?: number },
): ParsedPick[] {
  const entries = selectSoccerScorerGkPropEntries(propPool, opts);
  const edges = [
    "Top posted anytime-goal price on the next WC slate — ranked from real goalscorer lines, not projected xG.",
    "Posted shots-on-target line for a volume attacker — secondary angle when goalscorer odds are thin.",
  ];
  return entries.map((e, i) =>
    pickFromPool(
      e,
      e.marketKey === "player_goal_scorer_anytime" ? edges[0]! : edges[1]!,
      gameMeta,
    ),
  );
}

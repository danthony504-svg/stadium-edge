import type { PlayerProp } from "./api";

type PlayerEntry<Game> = {
  game: Game;
  prop: PlayerProp;
  marketCount: number;
};

export function topPlayersByPosition<Game extends { props: readonly PlayerProp[] }>(
  games: readonly Game[],
  market: string | null,
) {
  const positions = new Map<string, PlayerEntry<Game>[]>();

  for (const game of games) {
    const players = new Map<string, { position: string; markets: Set<string>; prop?: PlayerProp }>();
    for (const prop of game.props) {
      const position = prop.position?.trim().toUpperCase();
      if (!position || !prop.athleteId || prop.alt) continue;
      let player = players.get(prop.athleteId);
      if (!player) {
        player = { position, markets: new Set() };
        players.set(prop.athleteId, player);
      }
      player.markets.add(prop.market);
      if (!player.prop && (!market || prop.market === market)) player.prop = prop;
    }

    for (const { position, markets, prop } of players.values()) {
      if (!prop) continue;
      const entry = { game, prop, marketCount: markets.size };
      const group = positions.get(position);
      if (group) group.push(entry);
      else positions.set(position, [entry]);
    }
  }

  const compare = (left: PlayerEntry<Game>, right: PlayerEntry<Game>) => {
    if (market && left.prop.line !== right.prop.line) {
      if (left.prop.line == null) return 1;
      if (right.prop.line == null) return -1;
      return right.prop.line - left.prop.line;
    }
    return right.marketCount - left.marketCount || left.prop.player.localeCompare(right.prop.player);
  };

  return [...positions.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([position, entries]) => {
      const seen = new Set<string | null>();
      const players: PlayerEntry<Game>[] = [];
      for (const entry of entries.sort(compare)) {
        if (seen.has(entry.prop.athleteId)) continue;
        seen.add(entry.prop.athleteId);
        players.push(entry);
        if (players.length === 2) break;
      }
      return { position, players };
    });
}

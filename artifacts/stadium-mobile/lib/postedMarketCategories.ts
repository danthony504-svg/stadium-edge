/** Market categories are strictly the deduplicated markets posted for this selected sport. */
export function postedMarketKeys(games: ReadonlyArray<{ props: ReadonlyArray<{ market: string }> }>): string[] {
  const markets = new Set<string>();
  for (const game of games) for (const prop of game.props) {
    if (typeof prop.market === "string" && prop.market.trim()) markets.add(prop.market);
  }
  return [...markets].sort();
}

import type { PlayerProp } from "./api.ts";

export function simulatorNbaProjectionQuotes(posted: readonly PlayerProp[], eventId: string) {
  const quotes = new Map<string, {
    key: string;
    prop: PlayerProp;
    side: "Over" | "Under";
    price: number;
    book: string;
    updatedAt: string;
  }>();
  for (const prop of posted) {
    const supported = prop.alt ? /^player_assists(?:_alternate)?$/.test(prop.market) : prop.market === "player_rebounds";
    if (!supported || prop.priceSource === "PrizePicks" ||
        prop.line == null || !Number.isFinite(prop.line) ||
        !prop.athleteId || !prop.playerTeamId) continue;
    for (const side of ["Over", "Under"] as const) {
      const price = side === "Over" ? prop.overPrice : prop.underPrice;
      const book = side === "Over" ? prop.overBook : prop.underBook;
      const updatedAt = side === "Over" ? prop.overSourceUpdatedAt : prop.underSourceUpdatedAt;
      if (price == null || !Number.isFinite(price) || price === 0 ||
          !book || !updatedAt || !Number.isFinite(Date.parse(updatedAt))) continue;
      const key = JSON.stringify([eventId, prop.athleteId, prop.playerTeamId, prop.market, prop.line, side, book, price, updatedAt]);
      quotes.set(key, { key, prop, side, price, book, updatedAt });
    }
  }
  return [...quotes.values()];
}

import { isAlternateOrPeriodMarket, isPeriodMainMarket, marketFamily } from "./altLinePool.ts";

type GameSide = { market: string; pick: string };

const byText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Fixed ordering for the cap. Period main sides first, then market and selection text. */
export function compareCoachAlternateSides(a: GameSide, b: GameSide): number {
  return Number(isPeriodMainMarket(b.market)) - Number(isPeriodMainMarket(a.market)) ||
    byText(a.market.toLowerCase(), b.market.toLowerCase()) ||
    byText(a.pick.toLowerCase(), b.pick.toLowerCase());
}

/** Every eligible moneyline across the board is evaluated before the second pass. */
export function coachGameLinePasses<T extends GameSide>(entries: readonly [string, T[]][]) {
  const moneylines = new Map<string, T[]>();
  const remaining = new Map<string, T[]>();
  for (const [game, lines] of entries) {
    for (const line of lines) {
      const pass = marketFamily(line.market).endsWith("moneyline") && !isAlternateOrPeriodMarket(line.market) ? moneylines : remaining;
      const sides = pass.get(game);
      if (sides) sides.push(line);
      else pass.set(game, [line]);
    }
  }
  return { moneylines, remaining };
}

export function coachGameSideCounts<T extends GameSide>(eligible: T[], isHeld: (line: T) => boolean, maxAlternates: number) {
  const held: T[] = [];
  const main: T[] = [];
  const alternates: T[] = [];
  for (const side of eligible) {
    if (isHeld(side)) held.push(side);
    else if (isAlternateOrPeriodMarket(side.market)) alternates.push(side);
    else main.push(side);
  }
  alternates.sort(compareCoachAlternateSides);
  return { held, scoreable: main.concat(alternates.slice(0, maxAlternates)), capped: alternates.slice(maxAlternates) };
}

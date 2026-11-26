import { firstBasketMarkets, supportedVoidRule, type BookRule, type FirstBasketSnapshot, type Market, type Method, type Quote } from "./nbaFirstBasketModel.js";

type Outcome = { name?: string; description?: string; price?: number };
export type RawFirstBasketOdds = { id?: string; commence_time?: string; bookmakers?: {
  key?: string; markets?: { key?: string; last_update?: string; outcomes?: Outcome[] }[];
}[] };
const prob = (price: number) => price > 0 ? 100 / (100 + price) : -price / (100 - price);
const valid = (p: unknown): p is number => typeof p === "number" && Number.isFinite(p) && Math.abs(p) >= 100;
const normalize = (value: string) => value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");

function methodOf(name: string): Method | undefined {
  const key = normalize(name);
  if (["ft", "freethrow", "1point", "1pt", "1"].includes(key)) return "FT";
  if (["2", "2point", "2points", "2pt", "twopointer", "2pointer"].includes(key)) return "2";
  if (["3", "3point", "3points", "3pt", "threepointer", "3pointer"].includes(key)) return "3";
}

export function firstBasketQuotes(game: FirstBasketSnapshot, data: RawFirstBasketOdds, now: number): Quote[] {
  if (!game.oddsEventId || game.oddsEventId !== data.id ||
      !(Math.abs(Date.parse(data.commence_time ?? "") - game.startsAt) <= 15 * 60_000)) return [];
  const rules = new Map<string, BookRule>();
  for (const entry of game.bookRules ?? []) {
    const key = `${entry.book}:${entry.market}`;
    if (!supportedVoidRule(entry.voidRule)) continue;
    if (rules.has(key) && JSON.stringify(rules.get(key)) !== JSON.stringify(entry)) return [];
    rules.set(key, entry);
  }
  const teams = [game.home, game.away];
  const names = new Map<string, { id: string; teamId: string } | null>();
  for (const team of teams) for (const player of team.starters) {
    const key = normalize(player.name);
    names.set(key, names.has(key) ? null : { id: player.id, teamId: team.id });
  }
  const rows: Quote[] = [];
  for (const book of data.bookmakers ?? []) {
    if (!book.key) continue;
    for (const item of book.markets ?? []) {
      const market = item.key as Market;
      const terms = rules.get(`${book.key}:${market}`);
      const rule = terms?.rule;
      const updated = Date.parse(item.last_update ?? "");
      if (!terms || !firstBasketMarkets.includes(market) || (rule !== "points" && rule !== "field_goal") ||
          !Number.isFinite(updated) || updated > now || now - updated > 5 * 60_000) continue;
      const outcomes = item.outcomes ?? [];
      const classified = outcomes.flatMap(outcome => {
        const name = outcome.name ?? "";
        const side = name.toLowerCase().trim();
        const player = names.get(normalize(outcome.description ?? name));
        if (!player || !valid(outcome.price)) return [];
        return [{ ...player, side, method: methodOf(name), price: outcome.price }];
      });
      const binary = classified.some(outcome => outcome.side === "yes" || outcome.side === "no");
      const keyOf = (row: typeof classified[number]) => `${row.id}:${row.method ?? ""}`;
      const tally = new Map<string, { yes: number[]; no: number[] }>();
      for (const row of classified) {
        if (row.side !== "yes" && row.side !== "no") continue;
        const pair = tally.get(keyOf(row)) ?? { yes: [], no: [] };
        pair[row.side].push(row.price);
        tally.set(keyOf(row), pair);
      }
      const completeFields = new Map<string, number>();
      if (!binary && terms.exhaustiveStarterField === true && terms.voidRule.notStarter === "void" &&
          classified.length === outcomes.length) {
        for (const team of market === "player_first_team_basket" ? teams : [null]) {
          const field = classified.filter(row => !team || row.teamId === team.id);
          const eligible = (team ? team.starters.length : 10) *
            (market === "player_method_of_first_basket" ? rule === "points" ? 3 : 2 : 1);
          const hasValidMethods = market !== "player_method_of_first_basket" ||
            field.every(row => row.method && (rule === "points" || row.method !== "FT"));
          if (field.length === eligible && hasValidMethods && new Set(field.map(keyOf)).size === eligible) {
            completeFields.set(team?.id ?? "game", field.reduce((sum, row) => sum + prob(row.price), 0));
          }
        }
      }
      for (const row of classified) {
        if ((binary && row.side !== "yes") || (market === "player_method_of_first_basket" && (!row.method || (rule === "field_goal" && row.method === "FT")))) continue;
        const pair = tally.get(keyOf(row));
        if (binary && pair?.yes.length !== 1) continue;
        const total = binary ? (pair?.no.length === 1 ? prob(row.price) + prob(pair.no[0]!) : null)
          : completeFields.get(market === "player_first_team_basket" ? row.teamId : "game");
        rows.push({ book: book.key, market, rule, playerId: row.id, method: row.method,
          price: row.price, voidRule: terms.voidRule, noVig: total ? prob(row.price) / total : null,
          completeField: !binary && total != null });
      }
    }
  }
  return rows;
}

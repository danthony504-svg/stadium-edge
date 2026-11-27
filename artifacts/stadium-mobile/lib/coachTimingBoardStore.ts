import AsyncStorage from "@react-native-async-storage/async-storage";
import type { loadScanInputs } from "./coach/buildParlay.ts";

export type CoachTimingBoard = Partial<Awaited<ReturnType<typeof loadScanInputs>>>;
const INDEX = "@stadium/coach-timing-boards-v1";
const entryKey = (requestId: string) => `${INDEX}/${requestId}`;
const MAX_RECORDS = 5;
const MAX_AGE_MS = 7 * 86400_000;

function fields<T extends object, K extends keyof T>(row: T, keys: readonly K[]): Pick<T, K> {
  return Object.fromEntries(keys.map(key => [key, row[key]])) as Pick<T, K>;
}

function publicBoard(board: CoachTimingBoard | null) {
  if (!board) return null;
  const oddsGames = (games: CoachTimingBoard["oddsGames"]) => games?.map(game => ({
    ...fields(game, ["id", "sport", "homeTeam", "awayTeam", "commenceTime"]),
    markets: game.markets.map(market => ({
      key: market.key,
      outcomes: market.outcomes.map(outcome => ({
        ...fields(outcome, ["name", "price", "point", "noVigFair", "edge", "bookSpread"]),
        books: outcome.books?.map(book => fields(book, ["book", "price", "point"])),
      })),
    })),
  }));
  const props = (rows: CoachTimingBoard["propPool"]) => rows?.map(row => fields(row, [
    "sport", "game", "marketLabel", "player", "line", "side", "odds", "edge", "bookSpread",
    "startsAt", "teamAbbr", "athleteId", "playerTeamId", "position", "marketKey", "alt",
    "eventId", "sourceUpdatedAt", "sportsbook",
  ]));
  const gameLines = (rows: CoachTimingBoard["realOdds"]) => rows?.map(row => fields(row, [
    "sport", "game", "market", "pick", "odds", "startsAt", "noVigFair", "edge", "bookSpread",
  ]));
  return {
    sports: board.sports, prioritySports: board.prioritySports, slateDay: board.slateDay,
    oddsGames: oddsGames(board.oddsGames), oddsGamesBeforeTeamFilter: oddsGames(board.oddsGamesBeforeTeamFilter),
    espnGames: board.espnGames?.map(game => fields(game, [
      "id", "sport", "name", "shortName", "status", "startsAt", "homeTeam", "awayTeam",
      "homeScore", "awayScore", "homeTeamId", "awayTeamId", "homeAbbr", "awayAbbr",
      "venue", "clock", "period", "periodLabel", "state",
    ])),
    propPool: props(board.propPool), rawPropPool: props(board.rawPropPool),
    realOdds: gameLines(board.realOdds), liveOdds: gameLines(board.liveOdds),
  };
}

async function recentEntries(ids: string[]) {
  const rows = await Promise.all(ids.map(async id => {
    const value = await AsyncStorage.getItem(entryKey(id));
    return { id, value, savedAt: value ? Number(JSON.parse(value).savedAt) : 0 };
  }));
  const cutoff = Date.now() - MAX_AGE_MS;
  return rows.filter(row => row.value && row.savedAt >= cutoff).slice(0, MAX_RECORDS);
}
let pending = Promise.resolve();

export function recordCoachTimingBoard(
  requestId: string,
  timing: Record<string, unknown>,
  board: CoachTimingBoard | null,
  boardState: "not_loaded" | "partial" | "loaded",
): Promise<void> {
  pending = pending.then(async () => {
    let snapshotSaved = false;
    try {
      const previous: string[] = JSON.parse(await AsyncStorage.getItem(INDEX) ?? "[]");
      const ids = [requestId, ...previous.filter(id => id !== requestId)];
      await AsyncStorage.setItem(entryKey(requestId), JSON.stringify({
        version: 1, requestId, boardState, timing, savedAt: Date.now(), board: publicBoard(board),
      }));
      const keep = (await recentEntries(ids)).map(row => row.id);
      await AsyncStorage.setItem(INDEX, JSON.stringify(keep));
      snapshotSaved = true;
      for (const id of ids.filter(id => !keep.includes(id))) await AsyncStorage.removeItem(entryKey(id));
    } catch { /* The timing log reports whether persistence succeeded. */ }
    console.info("[coach-build-timing]", { ...timing, requestId, boardState, snapshotSaved });
  });
  return pending;
}

export function readCoachTimingBoards(): Promise<string | null> {
  const result = pending.then(async () => {
    const ids: string[] = JSON.parse(await AsyncStorage.getItem(INDEX) ?? "[]");
    const recent = await recentEntries(ids);
    const keep = recent.map(row => row.id);
    if (keep.length !== ids.length) {
      await AsyncStorage.setItem(INDEX, JSON.stringify(keep));
      for (const id of ids.filter(id => !keep.includes(id))) await AsyncStorage.removeItem(entryKey(id));
    }
    const present = recent.map(row => row.value);
    return present.length ? `[${present.join(",")}]` : null;
  });
  pending = result.then(() => {}, () => {});
  return result;
}

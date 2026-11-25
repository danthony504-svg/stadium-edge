import AsyncStorage from "@react-native-async-storage/async-storage";

import { fetchSimulatorPlayerFinal } from "@/lib/simulatorApi";

const storageKey = "stadium-edge:simulator-player-accuracy:v1";

export type PlayerProjection = {
  playerKey: string;
  label: string;
  value: number;
  matchupGames: number;
};

type TrackedGame = {
  sport: string;
  eventId: string;
  homeTeamId: string;
  awayTeamId: string;
  startsAt: string;
  capturedAt?: number;
  players: PlayerProjection[];
  firstBasketPick: string | null;
  checkedAt?: number;
  actuals?: Record<string, number>;
  firstBasketCorrect?: boolean;
};

let pending: Promise<unknown> = Promise.resolve();

function updateJournal<T>(sport: string, update: (games: TrackedGame[]) => T): Promise<T> {
  const operation = pending.then(async () => {
    const key = `${storageKey}:${sport}`;
    const stored = await AsyncStorage.getItem(key);
    const games = stored ? JSON.parse(stored) as TrackedGame[] : [];
    const result = update(games);
    await AsyncStorage.setItem(key, JSON.stringify(games));
    return result;
  });
  pending = operation.catch(() => undefined);
  return operation;
}

function sameGame(a: TrackedGame, b: TrackedGame) {
  return a.sport === b.sport && a.eventId === b.eventId &&
    a.homeTeamId === b.homeTeamId && a.awayTeamId === b.awayTeamId;
}

export function trackSimulatorProjections(snapshot: TrackedGame) {
  return updateJournal(snapshot.sport, (games) => {
    if (!(Date.now() < Date.parse(snapshot.startsAt))) return;
    const game = games.find((entry) => sameGame(entry, snapshot));
    if (!game) {
      games.push({ ...snapshot, capturedAt: Date.now() });
      return;
    }
    const recorded = new Set(game.players.map(({ playerKey, label }) => `${playerKey}/${label}`));
    game.players.push(...snapshot.players.filter(({ playerKey, label }) => !recorded.has(`${playerKey}/${label}`)));
    game.firstBasketPick ??= snapshot.firstBasketPick;
  });
}

export async function refreshSimulatorAccuracy(
  sport: string,
  signal: AbortSignal,
  readActual: (label: string, stats: Record<string, string>) => number | null,
) {
  const due = await updateJournal(sport, (games) => games
    .filter((game) => game.sport === sport && (!game.actuals || (game.firstBasketPick && game.firstBasketCorrect == null)) &&
      Date.now() >= Date.parse(game.startsAt) && Date.now() - (game.checkedAt ?? 0) >= 300_000)
    .sort((a, b) => (a.checkedAt ?? 0) - (b.checkedAt ?? 0))
    .slice(0, 4));
  await Promise.all(due.map(async (game) => {
    const final = await fetchSimulatorPlayerFinal(game, signal).catch(() => null);
    if (signal.aborted) return;
    await updateJournal(sport, (games) => {
      const saved = games.find((entry) => sameGame(entry, game));
      if (!saved) return;
      saved.checkedAt = Date.now();
      if (!final) return;
      if (Object.keys(final.players).length) {
        saved.actuals = Object.fromEntries(saved.players.flatMap(({ playerKey, label }) => {
          const actual = readActual(label, final.players[playerKey] ?? {});
          return actual == null ? [] : [[`${playerKey}/${label}`, actual]];
        }));
      }
      if (saved.firstBasketPick && final.firstBasket) {
        const { teamId, playerId } = final.firstBasket;
        saved.firstBasketCorrect = saved.firstBasketPick === `${teamId}/${playerId}`;
      }
    });
  }));
  return updateJournal(sport, (games) => games.filter((game) => game.sport === sport));
}

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { loadScanInputs } from "./coach/buildParlay.ts";

export type CoachTimingBoard = Partial<Awaited<ReturnType<typeof loadScanInputs>>>;
const INDEX = "@stadium/coach-timing-boards-v1";
const entryKey = (requestId: string) => `${INDEX}/${requestId}`;
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
      const keep = ids.slice(0, 5);
      await AsyncStorage.setItem(entryKey(requestId), JSON.stringify({
        version: 1, requestId, boardState, timing, board,
      }));
      await AsyncStorage.setItem(INDEX, JSON.stringify(keep));
      snapshotSaved = true;
      for (const id of ids.slice(5)) await AsyncStorage.removeItem(entryKey(id));
    } catch { /* The timing log reports whether persistence succeeded. */ }
    console.info("[coach-build-timing]", { ...timing, requestId, boardState, snapshotSaved });
  });
  return pending;
}

export async function readCoachTimingBoards(): Promise<string | null> {
  await pending;
  const ids: string[] = JSON.parse(await AsyncStorage.getItem(INDEX) ?? "[]");
  const records = await Promise.all(ids.map(id => AsyncStorage.getItem(entryKey(id))));
  const present = records.filter((value): value is string => value != null);
  return present.length ? `[${present.join(",")}]` : null;
}

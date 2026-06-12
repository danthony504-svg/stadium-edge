import AsyncStorage from "@react-native-async-storage/async-storage";

import { PROPS_SPORTS } from "@/lib/api";

// Lightweight persistence of the last-loaded props snapshot per sport, used to
// render the Props tab INSTANTLY from cache on open (even after an app relaunch)
// while fresh data revalidates in the background. We persist to AsyncStorage
// rather than installing a React Query persister — it's the same idea, scoped to
// just this screen's data, with no extra dependency.
//
// Snapshots are freshness-capped (ignored when too old) so a stale slate never
// shows as if it were live, and bounded in size (only the first N games) so a
// load-more session can't grow the stored blob without limit.
const PREFIX = "props-cache:v1:";
const MAX_AGE_MS = 30 * 60_000; // ignore snapshots older than 30 min
const MAX_PERSISTED_GAMES = 12; // bound the stored blob for instant first paint

const keyFor = (sport: string) => `${PREFIX}${sport}`;

// A persisted snapshot mirrors the screen's page shape ({ games, total }) but is
// kept generic here so this module doesn't depend on the screen's local types.
export type PropsSnapshot<G> = { games: G[]; total: number };
type Stored<G> = { at: number; games: G[]; total: number };

// Load all per-sport snapshots in one batched read. Returns only snapshots that
// are still within the freshness window; anything stale or unparseable is
// omitted so the caller falls back to a true cold load.
export async function loadAllPropsSnapshots<G>(): Promise<Record<string, PropsSnapshot<G>>> {
  const out: Record<string, PropsSnapshot<G>> = {};
  try {
    const pairs = await AsyncStorage.multiGet(PROPS_SPORTS.map(keyFor));
    const now = Date.now();
    for (const [key, raw] of pairs) {
      if (!raw) continue;
      const sport = key.slice(PREFIX.length);
      try {
        const parsed = JSON.parse(raw) as Stored<G>;
        if (!parsed || typeof parsed.at !== "number" || !Array.isArray(parsed.games)) continue;
        if (now - parsed.at > MAX_AGE_MS) continue;
        out[sport] = { games: parsed.games, total: parsed.total ?? parsed.games.length };
      } catch {
        // Corrupt entry — ignore and let the sport cold-load.
      }
    }
  } catch {
    // AsyncStorage unavailable — cold load everywhere (no crash).
  }
  return out;
}

// Persist one sport's snapshot after a successful fetch. Bounded to the first
// MAX_PERSISTED_GAMES games so the stored blob stays small even after load-more.
export async function savePropsSnapshot<G>(
  sport: string,
  page: PropsSnapshot<G>,
): Promise<void> {
  try {
    const stored: Stored<G> = {
      at: Date.now(),
      games: page.games.slice(0, MAX_PERSISTED_GAMES),
      total: page.total,
    };
    await AsyncStorage.setItem(keyFor(sport), JSON.stringify(stored));
  } catch {
    // Best-effort cache write — never block or crash the UI on a storage error.
  }
}

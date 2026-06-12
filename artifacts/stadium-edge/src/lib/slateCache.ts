// Lightweight localStorage persistence of the last-loaded game slate, used to
// paint the browse surfaces (Home / All Sports / Upcoming) INSTANTLY from cache
// on open or refresh while fresh data revalidates in the background. Mirrors the
// mobile Props tab's AsyncStorage snapshot pattern (lib/propsCache.ts) — same
// idea, scoped to just the slate the web app reads, with no extra dependency.
//
// The snapshot is freshness-capped (ignored when too old) so a stale slate never
// shows as if it were live, and bounded in size (only the first N games per
// sport) so the stored blob stays small. Live, in-progress games are NOT
// persisted by callers — they change too fast to show from a stale snapshot.

const KEY = "stadium_edge_slate_v1";
const MAX_AGE_MS = 30 * 60_000; // ignore snapshots older than 30 min
const MAX_GAMES_PER_SPORT = 16; // bound stored ESPN games per sport
const MAX_ODDS_PER_SPORT = 10; // bound stored bookmaker-odds games per sport (markets are heavy)
const MAX_UPCOMING = 24; // bound the stored upcoming list

export type SlateSnapshot = {
  games: Record<string, any[]>;
  odds: Record<string, any[]>;
  upcoming: any[];
};

type Stored = SlateSnapshot & { at: number };

function boundBySport(map: Record<string, any[]> | undefined, cap: number): Record<string, any[]> {
  const out: Record<string, any[]> = {};
  for (const [k, v] of Object.entries(map || {})) {
    out[k] = Array.isArray(v) ? v.slice(0, cap) : [];
  }
  return out;
}

// Read the persisted slate. Returns null when there's no snapshot, it's stale,
// or it can't be parsed — the caller then falls back to a true cold load.
export function loadSlateSnapshot(): SlateSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored;
    if (!parsed || typeof parsed.at !== "number") return null;
    if (Date.now() - parsed.at > MAX_AGE_MS) return null;
    return {
      games: parsed.games && typeof parsed.games === "object" ? parsed.games : {},
      odds: parsed.odds && typeof parsed.odds === "object" ? parsed.odds : {},
      upcoming: Array.isArray(parsed.upcoming) ? parsed.upcoming : [],
    };
  } catch {
    return null;
  }
}

// Persist the freshest slate after a successful fetch. Best-effort — never throws
// (a quota error or unavailable storage must not break the UI).
export function saveSlateSnapshot(snap: SlateSnapshot): void {
  if (typeof window === "undefined") return;
  try {
    const stored: Stored = {
      at: Date.now(),
      games: boundBySport(snap.games, MAX_GAMES_PER_SPORT),
      odds: boundBySport(snap.odds, MAX_ODDS_PER_SPORT),
      upcoming: Array.isArray(snap.upcoming) ? snap.upcoming.slice(0, MAX_UPCOMING) : [],
    };
    window.localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    // Quota exceeded or storage unavailable — drop the write silently.
  }
}

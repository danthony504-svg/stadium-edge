import { useAuth } from "@clerk/expo";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { parlayAmerican } from "@/lib/format";
import { getSync, putSync } from "@/lib/api";

export type Leg = {
  id: string;
  game: string;
  market: string;
  pick: string;
  odds: number;
  sport?: string;
  edge?: string;
};

export type SavedSlip = {
  id: string;
  createdAt: number;
  legs: Leg[];
  stake: number;
  combinedOdds: number | null;
};

// The latest picks the AI Coach recommended (from its most recent parlay).
// Structurally compatible with the parser's ParsedPick so coach output flows in
// directly. Held in-memory only (never persisted) so finished/stale games don't
// resurface across app launches. Surfaced on the Player Props + Picks tabs.
export type AiPick = {
  game: string;
  market: string;
  pick: string;
  odds: number;
  sport?: string;
  edge?: string;
  isProp?: boolean;
  // Render-only (real ESPN data): player headshot for props, team logo/code for
  // game-level picks. Optional so a feed miss just falls back to initials.
  headshot?: string | null;
  teamLogo?: string | null;
  teamAbbr?: string | null;
  // Game totals carry BOTH teams' logos/codes for a matchup-style avatar.
  awayLogo?: string | null;
  homeLogo?: string | null;
  awayAbbr?: string | null;
  homeAbbr?: string | null;
};

type BetSlipState = {
  legs: Leg[];
  savedSlips: SavedSlip[];
  stake: number;
  combinedOdds: number | null;
  hydrated: boolean;
  aiPicks: AiPick[];
  addLeg: (leg: Omit<Leg, "id">) => boolean;
  removeLeg: (id: string) => void;
  clearLegs: () => void;
  hasLeg: (game: string, market: string, pick: string) => boolean;
  setStake: (n: number) => void;
  saveCurrentSlip: () => boolean;
  deleteSlip: (id: string) => void;
  deleteSlips: (ids: string[]) => void;
  setAiPicks: (picks: AiPick[]) => void;
};

const STORAGE_KEY = "stadium-edge:betslip:v1";

// Cap how many slips a user can keep so storage never grows unbounded. Oldest
// slips fall off the end when a new one is saved (newest are prepended).
const MAX_SAVED_SLIPS = 25;

const BetSlipContext = createContext<BetSlipState | null>(null);

const legKey = (game: string, market: string, pick: string) =>
  `${game}|${market}|${pick}`.toLowerCase();

// Union two saved-slip lists by id (newest first, capped). Used when a user
// signs in so slips made on this device merge with slips from another device
// instead of either side clobbering the other.
function mergeSlips(a: SavedSlip[], b: SavedSlip[]): SavedSlip[] {
  const byId = new Map<string, SavedSlip>();
  for (const s of [...a, ...b]) {
    if (s && typeof s.id === "string") byId.set(s.id, s);
  }
  return Array.from(byId.values())
    .sort((x, y) => (y.createdAt ?? 0) - (x.createdAt ?? 0))
    .slice(0, MAX_SAVED_SLIPS);
}

export function BetSlipProvider({ children }: { children: React.ReactNode }) {
  const [legs, setLegs] = useState<Leg[]>([]);
  const [savedSlips, setSavedSlips] = useState<SavedSlip[]>([]);
  const [stake, setStakeState] = useState(10);
  const [hydrated, setHydrated] = useState(false);
  const [aiPicks, setAiPicksState] = useState<AiPick[]>([]);
  const loaded = useRef(false);

  // Load persisted state once.
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed.legs)) setLegs(parsed.legs);
          if (Array.isArray(parsed.savedSlips)) setSavedSlips(parsed.savedSlips);
          if (Number.isFinite(parsed.stake)) setStakeState(parsed.stake);
        }
      } catch {
        // ignore corrupt storage
      } finally {
        loaded.current = true;
        setHydrated(true);
      }
    })();
  }, []);

  // Persist on change (after hydration).
  useEffect(() => {
    if (!loaded.current) return;
    AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ legs, savedSlips, stake }),
    ).catch(() => {});
  }, [legs, savedSlips, stake]);

  // ---------- Cross-device sync (signed-in users only) ----------
  // Anonymous users are local-only (the effects below no-op). When signed in we
  // pull the account's saved slips once, merge them with this device's slips,
  // then debounce-push every change up so other devices stay in step.
  const { isSignedIn, userId } = useAuth();
  const syncedUserRef = useRef<string | null>(null);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped to retry the initial pull when the Clerk token isn't ready yet (a
  // signed-in GET that 401s/errors must NOT be treated as "server empty").
  const [pullRetry, setPullRetry] = useState(0);

  // Pull-and-merge once per signed-in session. Only a successful authenticated
  // 2xx response marks the session synced; until then the push effect stays
  // disabled so empty/stale local state can never clobber the server.
  useEffect(() => {
    if (!hydrated) return;
    if (!isSignedIn || !userId) {
      // Signed out — reset so a later sign-in re-pulls. Local slips are kept.
      syncedUserRef.current = null;
      if (pullRetry !== 0) setPullRetry(0);
      return;
    }
    if (syncedUserRef.current === userId) return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    (async () => {
      try {
        const { data } = await getSync<SavedSlip[]>("savedSlips");
        if (cancelled) return;
        if (Array.isArray(data) && data.length > 0) {
          setSavedSlips((local) => mergeSlips(data, local));
        }
        // Authenticated read succeeded (server empty or not) — safe to push.
        syncedUserRef.current = userId;
      } catch {
        // Token not ready / transient error — retry a few times with backoff.
        if (!cancelled && pullRetry < 5) {
          retryTimer = setTimeout(() => {
            if (!cancelled) setPullRetry((r) => r + 1);
          }, 1500);
        }
      }
    })();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [hydrated, isSignedIn, userId, pullRetry]);

  // Debounced push of saved slips for a signed-in, already-pulled session.
  useEffect(() => {
    if (!hydrated) return;
    if (!isSignedIn || !userId) return;
    if (syncedUserRef.current !== userId) return; // wait for initial pull

    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      putSync("savedSlips", savedSlips).catch(() => {});
    }, 800);
    return () => {
      if (pushTimer.current) clearTimeout(pushTimer.current);
    };
  }, [savedSlips, hydrated, isSignedIn, userId]);

  const combinedOdds = useMemo(
    () => parlayAmerican(legs.map((l) => l.odds)),
    [legs],
  );

  const hasLeg = useCallback(
    (game: string, market: string, pick: string) =>
      legs.some((l) => l.id === legKey(game, market, pick)),
    [legs],
  );

  const addLeg = useCallback((leg: Omit<Leg, "id">) => {
    const id = legKey(leg.game, leg.market, leg.pick);
    let added = false;
    setLegs((prev) => {
      if (prev.some((l) => l.id === id)) return prev;
      added = true;
      return [...prev, { ...leg, id }];
    });
    return added;
  }, []);

  const removeLeg = useCallback((id: string) => {
    setLegs((prev) => prev.filter((l) => l.id !== id));
  }, []);

  const clearLegs = useCallback(() => setLegs([]), []);

  const setStake = useCallback((n: number) => {
    setStakeState(Number.isFinite(n) && n >= 0 ? n : 0);
  }, []);

  const saveCurrentSlip = useCallback(() => {
    let ok = false;
    setLegs((prev) => {
      if (prev.length === 0) return prev;
      ok = true;
      const slip: SavedSlip = {
        id: `${Date.now()}`,
        createdAt: Date.now(),
        legs: prev,
        stake,
        combinedOdds: parlayAmerican(prev.map((l) => l.odds)),
      };
      setSavedSlips((s) => [slip, ...s].slice(0, MAX_SAVED_SLIPS));
      return [];
    });
    return ok;
  }, [stake]);

  const deleteSlip = useCallback((id: string) => {
    setSavedSlips((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const deleteSlips = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const drop = new Set(ids);
    setSavedSlips((prev) => prev.filter((s) => !drop.has(s.id)));
  }, []);

  const setAiPicks = useCallback((picks: AiPick[]) => setAiPicksState(picks), []);

  const value = useMemo(
    () => ({
      legs,
      savedSlips,
      stake,
      combinedOdds,
      hydrated,
      aiPicks,
      addLeg,
      removeLeg,
      clearLegs,
      hasLeg,
      setStake,
      saveCurrentSlip,
      deleteSlip,
      deleteSlips,
      setAiPicks,
    }),
    [
      legs,
      savedSlips,
      stake,
      combinedOdds,
      hydrated,
      aiPicks,
      addLeg,
      removeLeg,
      clearLegs,
      hasLeg,
      setStake,
      saveCurrentSlip,
      deleteSlip,
      deleteSlips,
      setAiPicks,
    ],
  );

  return <BetSlipContext.Provider value={value}>{children}</BetSlipContext.Provider>;
}

export function useBetSlip(): BetSlipState {
  const ctx = useContext(BetSlipContext);
  if (!ctx) throw new Error("useBetSlip must be used within BetSlipProvider");
  return ctx;
}

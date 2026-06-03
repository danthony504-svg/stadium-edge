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

type BetSlipState = {
  legs: Leg[];
  savedSlips: SavedSlip[];
  stake: number;
  combinedOdds: number | null;
  hydrated: boolean;
  addLeg: (leg: Omit<Leg, "id">) => boolean;
  removeLeg: (id: string) => void;
  clearLegs: () => void;
  hasLeg: (game: string, market: string, pick: string) => boolean;
  setStake: (n: number) => void;
  saveCurrentSlip: () => boolean;
  deleteSlip: (id: string) => void;
};

const STORAGE_KEY = "stadium-edge:betslip:v1";

const BetSlipContext = createContext<BetSlipState | null>(null);

const legKey = (game: string, market: string, pick: string) =>
  `${game}|${market}|${pick}`.toLowerCase();

export function BetSlipProvider({ children }: { children: React.ReactNode }) {
  const [legs, setLegs] = useState<Leg[]>([]);
  const [savedSlips, setSavedSlips] = useState<SavedSlip[]>([]);
  const [stake, setStakeState] = useState(10);
  const [hydrated, setHydrated] = useState(false);
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
      setSavedSlips((s) => [slip, ...s]);
      return [];
    });
    return ok;
  }, [stake]);

  const deleteSlip = useCallback((id: string) => {
    setSavedSlips((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const value = useMemo(
    () => ({
      legs,
      savedSlips,
      stake,
      combinedOdds,
      hydrated,
      addLeg,
      removeLeg,
      clearLegs,
      hasLeg,
      setStake,
      saveCurrentSlip,
      deleteSlip,
    }),
    [
      legs,
      savedSlips,
      stake,
      combinedOdds,
      hydrated,
      addLeg,
      removeLeg,
      clearLegs,
      hasLeg,
      setStake,
      saveCurrentSlip,
      deleteSlip,
    ],
  );

  return <BetSlipContext.Provider value={value}>{children}</BetSlipContext.Provider>;
}

export function useBetSlip(): BetSlipState {
  const ctx = useContext(BetSlipContext);
  if (!ctx) throw new Error("useBetSlip must be used within BetSlipProvider");
  return ctx;
}

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

import type { ParsedPick } from "@/components/PickCard";
import {
  captureCoachPicks,
  type TrackedPick,
} from "@/lib/pickTracker";
import {
  computeSignalPerfMap,
  computeTrackedAnalytics,
  emptyTrackedAnalytics,
  type TrackedAnalytics,
} from "@/lib/pickTrackerAnalytics";

const STORAGE_KEY = "stadium-edge:pick-tracker:v1";

type PickTrackerState = {
  picks: TrackedPick[];
  hydrated: boolean;
  analytics: TrackedAnalytics;
  signalPerf: Map<string, { decided: number; hitRatePct: number | null }>;
  captureFromCoach: (picks: ParsedPick[]) => void;
};

const EMPTY: PickTrackerState = {
  picks: [],
  hydrated: false,
  analytics: emptyTrackedAnalytics(),
  signalPerf: new Map(),
  captureFromCoach: () => {},
};

const PickTrackerContext = createContext<PickTrackerState>(EMPTY);

function sanitizeStoredPicks(raw: unknown): TrackedPick[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (p): p is TrackedPick =>
      !!p &&
      typeof p === "object" &&
      typeof (p as TrackedPick).id === "string" &&
      typeof (p as TrackedPick).game === "string" &&
      typeof (p as TrackedPick).pick === "string" &&
      typeof (p as TrackedPick).odds === "number",
  );
}

export function PickTrackerProvider({ children }: { children: React.ReactNode }) {
  const [picks, setPicks] = useState<TrackedPick[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) setPicks(sanitizeStoredPicks(JSON.parse(raw)));
      } catch {
        // ignore corrupt storage
      } finally {
        loaded.current = true;
        setHydrated(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(picks)).catch(() => {});
  }, [picks]);

  const captureFromCoach = useCallback((coachPicks: ParsedPick[]) => {
    if (coachPicks.length === 0) return;
    setPicks((prev) => captureCoachPicks(prev, coachPicks));
  }, []);

  const analytics = useMemo(() => {
    try {
      return computeTrackedAnalytics(picks);
    } catch {
      return emptyTrackedAnalytics();
    }
  }, [picks]);

  const signalPerf = useMemo(() => {
    try {
      return computeSignalPerfMap(picks);
    } catch {
      return new Map();
    }
  }, [picks]);

  const value = useMemo(
    () => ({
      picks,
      hydrated,
      analytics,
      signalPerf,
      captureFromCoach,
    }),
    [picks, hydrated, analytics, signalPerf, captureFromCoach],
  );

  return (
    <PickTrackerContext.Provider value={value}>{children}</PickTrackerContext.Provider>
  );
}

export function usePickTracker(): PickTrackerState {
  return useContext(PickTrackerContext);
}

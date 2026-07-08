import { useAuth } from "@clerk/expo";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQueries } from "@tanstack/react-query";
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
  getGames,
  gradeBets,
  getSync,
  putSync,
  type EspnGame,
  type GradeLegInput,
} from "@/lib/api";
import {
  FORCE_ARCHIVE_MS,
  legGameMatch,
  legGameStatus,
} from "@/lib/pickGradingFeed";
import {
  captureCoachPicks,
  mergeTrackedPicks,
  type TrackedPick,
} from "@/lib/pickTracker";
import {
  computeSignalPerfMap,
  computeTrackedAnalytics,
  type TrackedAnalytics,
} from "@/lib/pickTrackerAnalytics";
import { getSync, putSync } from "@/lib/api";

const STORAGE_KEY = "stadium-edge:pick-tracker:v1";

type PickTrackerState = {
  picks: TrackedPick[];
  hydrated: boolean;
  analytics: TrackedAnalytics;
  signalPerf: Map<string, { decided: number; hitRatePct: number | null }>;
  captureFromCoach: (picks: ParsedPick[]) => void;
};

const PickTrackerContext = createContext<PickTrackerState | null>(null);

export function PickTrackerProvider({ children }: { children: React.ReactNode }) {
  const [picks, setPicks] = useState<TrackedPick[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const loaded = useRef(false);
  const gradingRef = useRef<Set<string>>(new Set());

  const { isSignedIn, userId } = useAuth();
  const syncedUserRef = useRef<string | null>(null);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pullRetry, setPullRetry] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setPicks(parsed);
        }
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

  useEffect(() => {
    if (!hydrated) return;
    if (!isSignedIn || !userId) {
      syncedUserRef.current = null;
      if (pullRetry !== 0) setPullRetry(0);
      return;
    }
    if (syncedUserRef.current === userId) return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    (async () => {
      try {
        const { data } = await getSync<TrackedPick[]>("tracker");
        if (cancelled) return;
        if (Array.isArray(data) && data.length > 0) {
          setPicks((local) => mergeTrackedPicks(data, local));
        }
        syncedUserRef.current = userId;
      } catch {
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

  useEffect(() => {
    if (!hydrated) return;
    if (!isSignedIn || !userId) return;
    if (syncedUserRef.current !== userId) return;

    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      putSync("tracker", picks).catch(() => {});
    }, 800);
    return () => {
      if (pushTimer.current) clearTimeout(pushTimer.current);
    };
  }, [picks, hydrated, isSignedIn, userId]);

  const captureFromCoach = useCallback((coachPicks: ParsedPick[]) => {
    if (coachPicks.length === 0) return;
    setPicks((prev) => captureCoachPicks(prev, coachPicks));
  }, []);

  const sports = useMemo(() => {
    const s = new Set<string>();
    for (const p of picks) {
      if (p.status === "pending" && p.sport) s.add(p.sport);
    }
    return Array.from(s);
  }, [picks]);

  const gameQueries = useQueries({
    queries: sports.map((sport) => ({
      queryKey: ["games", sport],
      queryFn: ({ signal }: { signal: AbortSignal }) => getGames(sport, signal),
      staleTime: 60_000,
      enabled: hydrated && sports.length > 0,
    })),
  });

  const allGames = useMemo(() => {
    const out: EspnGame[] = [];
    for (const q of gameQueries) {
      if (q.data) out.push(...q.data);
    }
    return out;
  }, [gameQueries]);

  useEffect(() => {
    if (!hydrated || picks.length === 0) return;
    const pending = picks.filter((p) => p.status === "pending");
    if (pending.length === 0) return;

    const status = legGameStatus(allGames);
    const ready = pending.filter(
      (p) =>
        !gradingRef.current.has(p.id) &&
        status(p.game, p.sport, p.capturedAt) === "over",
    );
    if (ready.length === 0) return;

    let cancelled = false;
    const claimed: string[] = [];

    (async () => {
      const updates = new Map<string, TrackedPick>();
      try {
        for (const pick of ready) {
          gradingRef.current.add(pick.id);
          claimed.push(pick.id);

          const g = legGameMatch(allGames, pick.game, pick.sport);
          const startsAt = g?.startsAt ?? pick.startsAt ?? new Date(pick.capturedAt).toISOString();
          const startTs = Date.parse(startsAt);
          const input: GradeLegInput[] = [
            {
              game: pick.game,
              market: pick.market,
              pick: pick.pick,
              sport: pick.sport,
              odds: pick.odds,
              startsAt,
            },
          ];

          let graded;
          try {
            graded = await gradeBets(input);
          } catch {
            continue;
          }
          if (cancelled) return;

          const r = graded[0];
          const expired =
            Number.isFinite(startTs) && Date.now() - startTs > FORCE_ARCHIVE_MS;

          if (r?.result === "ungraded" && !expired) continue;

          updates.set(pick.id, {
            ...pick,
            status: r?.result ?? "ungraded",
            family: r?.family,
            side: r?.side,
            finalResult: r?.detail,
            settledAt: Date.now(),
          });
        }

        if (!cancelled && updates.size > 0) {
          setPicks((prev) =>
            prev.map((p) => updates.get(p.id) ?? p),
          );
        }
      } finally {
        for (const id of claimed) gradingRef.current.delete(id);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [picks, allGames, hydrated]);

  const analytics = useMemo(() => computeTrackedAnalytics(picks), [picks]);
  const signalPerf = useMemo(() => computeSignalPerfMap(picks), [picks]);

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
  const ctx = useContext(PickTrackerContext);
  if (!ctx) throw new Error("usePickTracker must be used within PickTrackerProvider");
  return ctx;
}

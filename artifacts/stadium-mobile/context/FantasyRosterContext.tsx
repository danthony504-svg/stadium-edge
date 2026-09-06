import { useAuth } from "@clerk/expo";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { getSync, putSync } from "@/lib/api";
import {
  createDefaultFantasyRosters,
  defaultFantasyRoster,
  positionEligibleForSlot,
  type FantasyRosterPlayer,
  type FantasyRostersSync,
  type FantasyRosterSlot,
} from "@/lib/fantasyRoster";
import type { FantasyScoringFormat } from "@/lib/fantasyScoring";
import type { FantasyTradeAnalysis } from "@/lib/fantasyTrade";

const STORAGE_KEY = "stadium-edge:fantasy-rosters:v1";

type FantasyRosterState = {
  rosters: FantasyRostersSync;
  hydrated: boolean;
  defaultRoster: ReturnType<typeof defaultFantasyRoster>;
  addPlayer: (player: Omit<FantasyRosterPlayer, "rosterSlot" | "dateAdded">) => void;
  movePlayer: (athleteId: string, rosterSlot: FantasyRosterSlot) => void;
  removePlayer: (athleteId: string) => void;
  setScoringFormat: (format: FantasyScoringFormat) => void;
  saveTradeAnalysis: (analysis: FantasyTradeAnalysis) => void;
};

const FantasyRosterContext = createContext<FantasyRosterState | null>(null);

function isRosterSync(value: unknown): value is FantasyRostersSync {
  return !!value && typeof value === "object" && "rosters" in value &&
    typeof (value as { rosters?: unknown }).rosters === "object";
}

export function FantasyRosterProvider({ children }: { children: React.ReactNode }) {
  const [rosters, setRosters] = useState<FantasyRostersSync>(createDefaultFantasyRosters);
  const [hydrated, setHydrated] = useState(false);
  const { isSignedIn, userId } = useAuth();
  const accountKey = userId ?? "anonymous";
  const [cacheOwner, setCacheOwner] = useState<string | null>(null);
  const syncedUserRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pullRetry, setPullRetry] = useState(0);

  useEffect(() => {
    setHydrated(false);
    setCacheOwner(null);
    setRosters(createDefaultFantasyRosters());
    void AsyncStorage.getItem(`${STORAGE_KEY}:${accountKey}`).then((raw) => {
      if (raw) {
        try {
          const data: unknown = JSON.parse(raw);
          if (isRosterSync(data)) setRosters(data);
        } catch { /* Ignore corrupt local cache. */ }
      }
    }).catch(() => {}).finally(() => {
      setCacheOwner(accountKey);
      setHydrated(true);
    });
  }, [accountKey]);

  useEffect(() => {
    if (hydrated && cacheOwner === accountKey) {
      void AsyncStorage.setItem(`${STORAGE_KEY}:${accountKey}`, JSON.stringify(rosters)).catch(() => {});
    }
  }, [hydrated, cacheOwner, accountKey, rosters]);

  // The account copy is authoritative after a successful pull. This prevents a
  // stale device cache from reviving dropped players when a user signs in.
  useEffect(() => {
    if (!hydrated || !isSignedIn || !userId || syncedUserRef.current === userId) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    void getSync<FantasyRostersSync>("fantasyRosters").then(({ data }) => {
      if (cancelled) return;
      if (isRosterSync(data)) setRosters(data);
      else {
        dirtyRef.current = true; // first signed-in roster: seed the account once
        setRosters((current) => ({ ...current }));
      }
      syncedUserRef.current = userId;
    }).catch(() => {
      if (!cancelled && pullRetry < 5) retry = setTimeout(() => setPullRetry((n) => n + 1), 1500);
    });
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
    };
  }, [hydrated, isSignedIn, userId, pullRetry]);

  useEffect(() => {
    if (!hydrated || !isSignedIn || !userId || syncedUserRef.current !== userId || !dirtyRef.current) return;
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      void putSync("fantasyRosters", rosters).then(() => { dirtyRef.current = false; }).catch(() => {});
    }, 350);
    return () => { if (pushTimer.current) clearTimeout(pushTimer.current); };
  }, [rosters, hydrated, isSignedIn, userId]);

  useEffect(() => {
    if (!isSignedIn) {
      syncedUserRef.current = null;
      if (pullRetry) setPullRetry(0);
    }
  }, [isSignedIn, pullRetry]);

  const update = useCallback((fn: (current: ReturnType<typeof defaultFantasyRoster>) => ReturnType<typeof defaultFantasyRoster>) => {
    dirtyRef.current = true;
    setRosters((current) => {
      const roster = fn(defaultFantasyRoster(current));
      return { ...current, rosters: { ...current.rosters, [roster.id]: roster } };
    });
  }, []);
  const addPlayer = useCallback((player: Omit<FantasyRosterPlayer, "rosterSlot" | "dateAdded">) => update((roster) => {
    if (roster.players.some((existing) => existing.athleteId === player.athleteId)) return roster;
    return { ...roster, players: [...roster.players, { ...player, rosterSlot: "Bench", dateAdded: Date.now() }], updatedAt: Date.now() };
  }), [update]);
  const movePlayer = useCallback((athleteId: string, rosterSlot: FantasyRosterSlot) => update((roster) => {
    const player = roster.players.find((candidate) => candidate.athleteId === athleteId);
    if (!player || !positionEligibleForSlot(player.position, rosterSlot)) return roster;
    return {
      ...roster,
      players: roster.players.map((candidate) => candidate.athleteId === athleteId ? { ...candidate, rosterSlot } : candidate),
      updatedAt: Date.now(),
    };
  }), [update]);
  const removePlayer = useCallback((athleteId: string) => update((roster) => ({
    ...roster, players: roster.players.filter((player) => player.athleteId !== athleteId), updatedAt: Date.now(),
  })), [update]);
  const setScoringFormat = useCallback((scoringFormat: FantasyScoringFormat) => update((roster) => ({ ...roster, scoringFormat, updatedAt: Date.now() })), [update]);
  const saveTradeAnalysis = useCallback((analysis: FantasyTradeAnalysis) => {
    dirtyRef.current = true;
    setRosters((current) => ({
      ...current,
      tradeHistory: [analysis, ...(current.tradeHistory ?? [])].slice(0, 20),
    }));
  }, []);

  const value = useMemo(() => ({ rosters, hydrated, defaultRoster: defaultFantasyRoster(rosters), addPlayer, movePlayer, removePlayer, setScoringFormat, saveTradeAnalysis }), [rosters, hydrated, addPlayer, movePlayer, removePlayer, setScoringFormat, saveTradeAnalysis]);
  return <FantasyRosterContext.Provider value={value}>{children}</FantasyRosterContext.Provider>;
}

export function useFantasyRoster(): FantasyRosterState {
  const value = useContext(FantasyRosterContext);
  if (!value) throw new Error("useFantasyRoster must be used within FantasyRosterProvider");
  return value;
}

// Learn which rubric factors correlate with settled W/L and nudge pick-score
// weights over time. Only REAL settled legs with a stored factor snapshot count.

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { BetResult } from "@/context/BetSlipContext";
import type { ParsedPick } from "@/components/PickCard";
import {
  decided,
  emptyFactorLedger,
  learnedWeightAdjustments,
  MIN_FACTOR_SAMPLE,
  strongFactorsFromScores,
  type FactorKey,
  type FactorLedger,
} from "./factorLearningCore";

export {
  MIN_FACTOR_SAMPLE,
  MAX_WEIGHT_DELTA,
  strongFactorsFromScores,
  learnedWeightAdjustments,
  type FactorKey,
  type FactorLedger,
} from "./factorLearningCore";

const STORAGE_KEY = "stadium-edge:factor-learning:v1";
const SNAPSHOT_KEY = "stadium-edge:coach-factor-snapshots:v1";

function legKey(game: string, market: string, pick: string): string {
  return `${game}|${market}|${pick}`.toLowerCase();
}

function pickLegKey(p: ParsedPick): string {
  return legKey(p.game, p.market, p.pick);
}

type SnapshotMap = Record<string, FactorKey[]>;

let ledgerCache: FactorLedger | null = null;
let snapshotCache: SnapshotMap | null = null;
const ingestedResultIds = new Set<string>();

export async function loadFactorLedger(): Promise<FactorLedger> {
  if (ledgerCache) return ledgerCache;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      ledgerCache = { ...emptyFactorLedger(), ...JSON.parse(raw) };
      return ledgerCache!;
    }
  } catch {
    /* ignore corrupt storage */
  }
  ledgerCache = emptyFactorLedger();
  return ledgerCache;
}

async function saveFactorLedger(ledger: FactorLedger): Promise<void> {
  ledgerCache = ledger;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(ledger));
  } catch {
    /* best-effort */
  }
}

async function loadSnapshots(): Promise<SnapshotMap> {
  if (snapshotCache) return snapshotCache;
  try {
    const raw = await AsyncStorage.getItem(SNAPSHOT_KEY);
    if (raw) {
      snapshotCache = JSON.parse(raw) as SnapshotMap;
      return snapshotCache;
    }
  } catch {
    /* ignore */
  }
  snapshotCache = {};
  return snapshotCache;
}

async function saveSnapshots(map: SnapshotMap): Promise<void> {
  snapshotCache = map;
  try {
    await AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(map));
  } catch {
    /* best-effort */
  }
}

/** Store factor presence for coach picks so settled legs can be attributed. */
export async function registerCoachPickSnapshots(picks: ParsedPick[]): Promise<void> {
  const map = await loadSnapshots();
  let changed = false;
  for (const p of picks) {
    const factors = strongFactorsFromScores(p.scores?.scores);
    if (!factors.length) continue;
    const key = pickLegKey(p);
    map[key] = factors;
    changed = true;
  }
  if (!changed) return;
  const keys = Object.keys(map);
  if (keys.length > 400) {
    for (const k of keys.slice(0, keys.length - 400)) delete map[k];
  }
  await saveSnapshots(map);
}

export async function getLearnedWeightAdjustments(): Promise<Partial<Record<FactorKey, number>>> {
  const ledger = await loadFactorLedger();
  return learnedWeightAdjustments(ledger);
}

/** Ingest newly settled slips; match legs to coach factor snapshots. */
export async function ingestSettledResults(results: BetResult[]): Promise<void> {
  const ledger = await loadFactorLedger();
  const snapshots = await loadSnapshots();
  let changed = false;

  for (const res of results) {
    if (ingestedResultIds.has(res.id)) continue;
    ingestedResultIds.add(res.id);
    for (const leg of res.legs) {
      if (leg.result !== "win" && leg.result !== "loss") continue;
      const key = legKey(leg.game, leg.market, leg.pick);
      const factors = snapshots[key];
      if (!factors?.length) continue;
      for (const f of factors) {
        if (leg.result === "win") ledger[f].wins += 1;
        else ledger[f].losses += 1;
        changed = true;
      }
    }
  }

  if (changed) await saveFactorLedger(ledger);
}

/** For Model Report / debug — factor win rates when sample is sufficient. */
export function factorInsights(ledger: FactorLedger): string[] {
  const labels: Record<FactorKey, string> = {
    lineValue: "Line value",
    matchup: "Matchup",
    trend: "Recent form",
    injury: "Injuries",
    lineShopping: "Line shopping",
    simulation: "Simulation",
  };
  const out: string[] = [];
  for (const k of Object.keys(labels) as FactorKey[]) {
    const t = ledger[k];
    if (decided(t) < MIN_FACTOR_SAMPLE) continue;
    const d = decided(t);
    const pct = d > 0 ? (t.wins / d) * 100 : 0;
    if (pct >= 56) {
      out.push(`${labels[k]} factor strong in winners (${pct.toFixed(0)}%, ${t.wins}-${t.losses})`);
    } else if (pct <= 44) {
      out.push(`${labels[k]} factor weak in results (${pct.toFixed(0)}%, ${t.wins}-${t.losses})`);
    }
  }
  return out.slice(0, 4);
}

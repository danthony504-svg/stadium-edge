import type { PickSubScores } from "./pickScore.ts";

export const MIN_FACTOR_SAMPLE = 15;
const WIN_PCT_BOOST = 56;
const WIN_PCT_REDUCE = 44;
export const MAX_WEIGHT_DELTA = 0.04;

type Tally = { wins: number; losses: number; pushes: number };

function emptyTally(): Tally {
  return { wins: 0, losses: 0, pushes: 0 };
}

function decided(t: Tally): number {
  return t.wins + t.losses;
}

export type FactorKey = keyof PickSubScores;
const FACTOR_KEYS: FactorKey[] = [
  "lineValue",
  "matchup",
  "trend",
  "injury",
  "lineShopping",
  "simulation",
];

export type FactorLedger = Record<FactorKey, Tally>;

export function emptyFactorLedger(): FactorLedger {
  return {
    lineValue: emptyTally(),
    matchup: emptyTally(),
    trend: emptyTally(),
    injury: emptyTally(),
    lineShopping: emptyTally(),
    simulation: emptyTally(),
  };
}

/** A factor was materially present when the pick was made (sub-score >= 6.5). */
export function strongFactorsFromScores(scores: PickSubScores | null | undefined): FactorKey[] {
  if (!scores) return [];
  const out: FactorKey[] = [];
  for (const k of FACTOR_KEYS) {
    const s = scores[k];
    if (s != null && Number.isFinite(s) && s >= 6.5) out.push(k);
  }
  return out;
}

function winPct(t: Tally): number | null {
  const d = decided(t);
  return d > 0 ? (t.wins / d) * 100 : null;
}

/** Weight deltas keyed by rubric factor (-MAX..+MAX). */
export function learnedWeightAdjustments(ledger: FactorLedger): Partial<Record<FactorKey, number>> {
  const out: Partial<Record<FactorKey, number>> = {};
  for (const k of FACTOR_KEYS) {
    const t = ledger[k];
    if (decided(t) < MIN_FACTOR_SAMPLE) continue;
    const pct = winPct(t)!;
    if (pct >= WIN_PCT_BOOST) out[k] = MAX_WEIGHT_DELTA;
    else if (pct <= WIN_PCT_REDUCE) out[k] = -MAX_WEIGHT_DELTA;
  }
  return out;
}

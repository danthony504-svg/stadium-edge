import type { PropSimulationResult } from "./api";
import { americanToImplied } from "./pickScore";
import { isBinaryNullLineMarket } from "./binaryPropMarket";

/** Model probability minus the posted price's break-even chance, in percentage points. */
export function simulatorModelEdge(hit: number | null | undefined, odds: number | null | undefined): number | null {
  const implied = americanToImplied(odds);
  if (hit == null || !Number.isFinite(hit) || hit < 0 || hit > 1 || implied == null) return null;
  return Math.round((hit - implied) * 1000) / 10;
}

export function formatPropProjectedStat(r: PropSimulationResult): string {
  const raw = r.medianProjection ?? r.meanProjection ?? r.mostLikelyLine;
  if (raw == null || !Number.isFinite(raw)) return "—";
  if (isBinaryNullLineMarket(r.market)) {
    // A binary median/mode is an event outcome, never a player counting stat.
    return raw === 0 ? "No" : raw === 1 ? "Yes" : "—";
  }
  return Number.isInteger(raw) ? String(raw) : raw.toFixed(1);
}

export function propSimulationCount(r: Pick<PropSimulationResult, "simulations" | "hitProbability">): number {
  return r.hitProbability != null && Number.isFinite(r.hitProbability) && r.hitProbability >= 0 && r.hitProbability <= 1 && Number.isSafeInteger(r.simulations) && r.simulations > 0 ? r.simulations : 0;
}

export function propSimulationEvidence(r: PropSimulationResult): string {
  const count = propSimulationCount(r);
  const history = Number.isFinite(r.sampleGames) ? Math.max(0, Math.trunc(r.sampleGames)) : 0;
  if (count) return `${count.toLocaleString("en-US")} simulations · ${history} history games`;
  return r.hitProbability != null
    ? `History estimate · ${history} games · 0 simulations`
    : "Simulation unavailable · 0 simulations";
}

export function propSimulationSummaryLabel(rows: PropSimulationResult[]): string {
  if (!rows.length) return "No prop simulations";
  const counts = rows.map(propSimulationCount);
  if (counts.every(n => n === 0)) return "No prop MC draws";
  if (counts.some(n => n === 0)) return "Mixed result sources";
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  return min === max ? `${min.toLocaleString("en-US")} sims/prop` : `${min.toLocaleString("en-US")}–${max.toLocaleString("en-US")} sims/prop`;
}

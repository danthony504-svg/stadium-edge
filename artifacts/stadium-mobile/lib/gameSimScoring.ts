// Shared game-outcome Monte Carlo scoring — used by Game Simulator and AI Coach
// so ML / spread / total / alt legs never contradict the same sim engine.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { GameSimulationResult } from "./api.ts";

/** Same period-scoped family logic as PickCard.marketFamily (kept local for tests). */
function gameMarketFamily(market: string): string {
  const m = String(market ?? "").toLowerCase();
  let period = "";
  if (/\b1h\b|first half|1st half/.test(m)) period = "1h:";
  else if (/\b2h\b|second half|2nd half/.test(m)) period = "2h:";
  else if (/\bf5\b|first 5|1st 5/.test(m)) period = "f5:";
  let fam: string;
  if (/spread|run ?line|puck ?line/.test(m)) fam = "spread";
  else if (/total|over|under|o\/u/.test(m)) fam = "total";
  else if (/money|h2h|\bml\b/.test(m)) fam = "moneyline";
  else fam = m;
  return period + fam;
}

/** Same floor as prop Monte Carlo — game-line legs must clear this in the shared sim. */
export const GAME_SIM_MIN_HIT = 0.52;

export type GameCoverQuery = {
  id: string;
  kind: "ml" | "spread" | "total";
  teamSide?: "home" | "away";
  line?: number;
  totalSide?: "over" | "under";
};

export type CoachGameSimEntry = GameSimulationResult & {
  coverHitRates?: Record<string, number>;
};

const GENERIC = new Set([
  "fc", "sc", "the", "of", "and", "los", "san", "new", "city", "club", "cf",
  "afc", "ac", "real",
]);

function tokens(s: string): string[] {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !GENERIC.has(t));
}

function splitLabel(label: string): { away: string; home: string } {
  const parts = String(label || "").split(" @ ");
  return { away: (parts[0] || "").trim(), home: (parts[1] || "").trim() };
}

function numLine(pick: string): number | null {
  const m = String(pick).match(/([+-]?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function sideOfTeam(team: string, away: string, home: string): "home" | "away" | null {
  const t = tokens(team);
  if (!t.length) return null;
  const overlap = (a: string[], b: string[]) => a.filter((x) => b.includes(x)).length;
  const ho = overlap(t, tokens(home));
  const ao = overlap(t, tokens(away));
  if (ho > ao && ho > 0) return "home";
  if (ao > ho && ao > 0) return "away";
  return null;
}

function gamePickTeam(pick: ParsedPick): string | null {
  const p = pick.pick || "";
  if (/\b(over|under)\b/i.test(p)) return null;
  const team = p
    .replace(/\s*(ml|moneyline)\s*$/i, "")
    .replace(/\s*[+-]?\d+(?:\.\d+)?\s*$/, "")
    .trim();
  return team || null;
}

/** Moneyline, spread/run line, or game total — not a player prop. */
export function isGameLinePick(pick: ParsedPick): boolean {
  if (pick.isProp) return false;
  const fam = gameMarketFamily(pick.market);
  return fam.endsWith("moneyline") || fam.endsWith("spread") || fam.endsWith("total");
}

/** Stable key for a game-line leg's cover query inside a game's sim result. */
export function gamePickCoverQueryId(pick: ParsedPick): string | null {
  if (!isGameLinePick(pick)) return null;
  return `${pick.game}|${pick.market}|${pick.pick}`.toLowerCase();
}

/** Build the server cover query for one game-line pick. */
export function buildGameCoverQuery(pick: ParsedPick): GameCoverQuery | null {
  if (!isGameLinePick(pick)) return null;
  const id = gamePickCoverQueryId(pick);
  if (!id) return null;
  const { away, home } = splitLabel(pick.game);
  const fam = gameMarketFamily(pick.market);
  const p = pick.pick;

  if (fam.endsWith("total")) {
    const line = numLine(p);
    if (line == null) return null;
    const over = /\bover\b/i.test(p);
    const under = /\bunder\b/i.test(p);
    if (!over && !under) return null;
    return { id, kind: "total", line, totalSide: over ? "over" : "under" };
  }

  const team = gamePickTeam(pick);
  if (!team) return null;
  const teamSide = sideOfTeam(team, away, home);
  if (!teamSide) return null;

  if (fam.endsWith("moneyline")) {
    return { id, kind: "ml", teamSide };
  }
  if (fam.endsWith("spread")) {
    const line = numLine(p);
    if (line == null) return null;
    return { id, kind: "spread", teamSide, line };
  }
  return null;
}

export function gameSimHasValidRun(sim: CoachGameSimEntry | null | undefined): boolean {
  if (!sim) return false;
  const n = sim.simulations ?? 0;
  return n > 0 && Number.isFinite(sim.homeWinProbability) && Number.isFinite(sim.awayWinProbability);
}

/** Monte Carlo hit probability for this pick from the shared game sim. */
export function gameSimHitForPick(
  pick: ParsedPick,
  sim: CoachGameSimEntry | null | undefined,
): number | null {
  if (!gameSimHasValidRun(sim)) return null;
  const query = buildGameCoverQuery(pick);
  if (!query) return null;
  const fromCover = sim!.coverHitRates?.[query.id];
  if (fromCover != null && Number.isFinite(fromCover)) return fromCover;

  // Fallback when cover rates were not requested — ML only from win probs.
  if (query.kind === "ml" && query.teamSide) {
    return query.teamSide === "home" ? sim!.homeWinProbability : sim!.awayWinProbability;
  }
  return null;
}

/** True when sim supports the pick at or above the coach floor. */
export function gameSimAgreesWithPick(
  pick: ParsedPick,
  sim: CoachGameSimEntry | null | undefined,
  minHit = GAME_SIM_MIN_HIT,
): boolean {
  const hit = gameSimHitForPick(pick, sim);
  return hit != null && hit >= minHit;
}

export type GameSimDisagreement = {
  pick: ParsedPick;
  hit: number | null;
  reason: string;
};

export function gameSimDisagreement(
  pick: ParsedPick,
  sim: CoachGameSimEntry | null | undefined,
  minHit = GAME_SIM_MIN_HIT,
): GameSimDisagreement | null {
  if (!isGameLinePick(pick)) return null;
  if (!gameSimHasValidRun(sim)) {
    return {
      pick,
      hit: null,
      reason: `No game simulator data for ${pick.game} — cannot verify this line.`,
    };
  }
  const hit = gameSimHitForPick(pick, sim);
  if (hit == null) {
    return {
      pick,
      hit: null,
      reason: `Simulator could not score ${pick.pick} on ${pick.game}.`,
    };
  }
  if (hit >= minHit) return null;
  const pct = Math.round(hit * 100);
  return {
    pick,
    hit,
    reason: `Game simulator only gives ${pick.pick} a ${pct}% cover rate (needs ≥${Math.round(minHit * 100)}%).`,
  };
}

export function gameSimAlignmentNote(
  pick: ParsedPick,
  sim: CoachGameSimEntry | null | undefined,
): string {
  const hit = gameSimHitForPick(pick, sim);
  if (hit == null) return "";
  const pct = Math.round(hit * 100);
  return `_Game simulator: ${pick.pick} covers in ${pct}% of ${sim?.simulations?.toLocaleString() ?? "10,000"} runs._`;
}

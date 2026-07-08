// Shared game-outcome Monte Carlo scoring — used by Game Simulator and AI Coach
// so ML / spread / total / alt legs never contradict the same sim engine.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { GameSimulationResult, RealOddsEntry } from "./api.ts";
import { fourQuestionsNoteForPick } from "./gameLineFourQuestions.ts";

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
  kind: "ml" | "spread" | "total" | "teamTotal";
  teamSide?: "home" | "away";
  line?: number;
  totalSide?: "over" | "under";
};

export type CoachGameSimEntry = GameSimulationResult & {
  coverHitRates?: Record<string, number>;
  outcomes?: { homeScores: number[]; awayScores: number[] };
};

export function gameLabelsMatch(a: string, b: string): boolean {
  const pa = splitLabel(a);
  const pb = splitLabel(b);
  if (!pa.away || !pa.home || !pb.away || !pb.home) {
    return String(a).toLowerCase().trim() === String(b).toLowerCase().trim();
  }
  const overlap = (x: string, y: string) => {
    const tx = tokens(x);
    const ty = tokens(y);
    return tx.some((t) => ty.includes(t)) || ty.some((t) => tx.includes(t));
  };
  return overlap(pa.away, pb.away) && overlap(pa.home, pb.home);
}

/** Fuzzy lookup — pick labels and sim map keys may differ by nickname. */
export function lookupGameSim(
  gameLabel: string,
  simByGame: Map<string, CoachGameSimEntry> | undefined,
): CoachGameSimEntry | undefined {
  if (!simByGame) return undefined;
  const direct = simByGame.get(gameLabel);
  if (direct) return direct;
  for (const [label, sim] of simByGame) {
    if (gameLabelsMatch(label, gameLabel)) return sim;
  }
  return undefined;
}

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

function teamNick(team: string): string {
  const parts = String(team ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

const normGame = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** One leg per team-sided bucket when backfilling or deduping multi-leg tickets. */
export function gameLineLegBucket(game: string, market: string, pick: string): string {
  const g = normGame(game);
  const fam = gameMarketFamily(market);
  if (/\b(over|under)\b/i.test(pick) && !/team total/i.test(market)) {
    return `${g}|game-total`;
  }
  if (/team total/i.test(market)) {
    const team = gamePickTeam({ game, market, pick, odds: 0 });
    return team ? `${g}|team-total|${teamNick(team)}` : `${g}|team-total`;
  }
  if (fam.endsWith("moneyline") || fam.endsWith("spread")) {
    const team = gamePickTeam({ game, market, pick, odds: 0 });
    if (team) return `${g}|team|${teamNick(team)}`;
  }
  return `${g}|${fam}`;
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

/** Default ML cover queries for both sides — used when no odds board is loaded. */
export function buildDefaultGameCoverQueries(
  gameLabel: string,
  homeTeam: string,
  awayTeam: string,
): GameCoverQuery[] {
  const base = { game: gameLabel, isProp: false as const, odds: 0 };
  const home = buildGameCoverQuery({ ...base, market: "Moneyline", pick: `${homeTeam} ML` });
  const away = buildGameCoverQuery({ ...base, market: "Moneyline", pick: `${awayTeam} ML` });
  return [home, away].filter((q): q is GameCoverQuery => q != null);
}

/** Dedupe cover queries by id — default ML + posted spread/total lines share one draw. */
export function mergeCoverQueries(...lists: GameCoverQuery[][]): GameCoverQuery[] {
  const seen = new Set<string>();
  const out: GameCoverQuery[] = [];
  for (const list of lists) {
    for (const q of list) {
      if (seen.has(q.id)) continue;
      seen.add(q.id);
      out.push(q);
    }
  }
  return out;
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
    const isTeamTotal = /team total/i.test(pick.market);
    if (isTeamTotal) {
      const team = gamePickTeam(pick);
      if (!team) return null;
      const teamSide = sideOfTeam(team, away, home);
      if (!teamSide) return null;
      return { id, kind: "teamTotal", teamSide, line, totalSide: over ? "over" : "under" };
    }
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

function coverQueryHits(
  q: GameCoverQuery,
  homeScore: number,
  awayScore: number,
): boolean {
  const total = homeScore + awayScore;
  if (q.kind === "ml") {
    if (q.teamSide === "home") return homeScore > awayScore;
    if (q.teamSide === "away") return awayScore > homeScore;
    return false;
  }
  if (q.kind === "spread") {
    const line = q.line ?? 0;
    if (q.teamSide === "home") return homeScore + line > awayScore;
    if (q.teamSide === "away") return awayScore + line > homeScore;
    return false;
  }
  if (q.kind === "total") {
    const line = q.line ?? 0;
    if (q.totalSide === "over") return total > line;
    if (q.totalSide === "under") return total < line;
    return false;
  }
  if (q.kind === "teamTotal") {
    const line = q.line ?? 0;
    const score = q.teamSide === "home" ? homeScore : awayScore;
    if (q.totalSide === "over") return score > line;
    if (q.totalSide === "under") return score < line;
    return false;
  }
  return false;
}

/** Derive hit rates for arbitrary lines from a saved 10k draw set. */
export function deriveCoverHitRatesFromOutcomes(
  outcomes: { homeScores: number[]; awayScores: number[] },
  queries: GameCoverQuery[],
): Record<string, number> {
  const n = outcomes.homeScores.length;
  if (!n || n !== outcomes.awayScores.length) return {};
  const rates: Record<string, number> = {};
  for (const q of queries) {
    let hits = 0;
    for (let i = 0; i < n; i++) {
      if (coverQueryHits(q, outcomes.homeScores[i]!, outcomes.awayScores[i]!)) hits += 1;
    }
    rates[q.id] = Math.round((hits / n) * 1000) / 1000;
  }
  return rates;
}

export function gameSimHasValidRun(sim: CoachGameSimEntry | null | undefined): boolean {
  if (!sim) return false;
  const n = sim.simulations ?? 0;
  return n > 0 && Number.isFinite(sim.homeWinProbability) && Number.isFinite(sim.awayWinProbability);
}

function spreadLinesMatch(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) < 0.001;
}

function coverQueriesEquivalent(a: GameCoverQuery, b: GameCoverQuery): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "ml") return a.teamSide === b.teamSide;
  if (a.kind === "spread") {
    return a.teamSide === b.teamSide && spreadLinesMatch(a.line, b.line);
  }
  if (a.kind === "total") {
    return a.totalSide === b.totalSide && spreadLinesMatch(a.line, b.line);
  }
  if (a.kind === "teamTotal") {
    return (
      a.teamSide === b.teamSide &&
      a.totalSide === b.totalSide &&
      spreadLinesMatch(a.line, b.line)
    );
  }
  return false;
}

/** Match cover rates when pick text differs by nickname (Sox +1.5 vs Chicago White Sox +1.5). */
function fuzzyCoverHitRate(
  pick: ParsedPick,
  target: GameCoverQuery,
  sim: CoachGameSimEntry,
): number | null {
  const rates = sim.coverHitRates;
  if (!rates) return null;
  for (const [id, rate] of Object.entries(rates)) {
    if (rate == null || !Number.isFinite(rate)) continue;
    const parts = id.split("|");
    if (parts.length < 3) continue;
    const gameLabel = parts[0]!;
    const market = parts[1]!;
    const pickText = parts.slice(2).join("|");
    if (!gameLabelsMatch(gameLabel, pick.game)) continue;
    const probe: ParsedPick = {
      game: pick.game,
      market,
      pick: pickText,
      odds: pick.odds,
      isProp: false,
      sport: pick.sport,
    };
    const q = buildGameCoverQuery(probe);
    if (!q || !coverQueriesEquivalent(q, target)) continue;
    return rate;
  }
  if (sim.outcomes) {
    for (const [id] of Object.entries(rates)) {
      const parts = id.split("|");
      if (parts.length < 3) continue;
      const gameLabel = parts[0]!;
      const market = parts[1]!;
      const pickText = parts.slice(2).join("|");
      if (!gameLabelsMatch(gameLabel, pick.game)) continue;
      const probe: ParsedPick = {
        game: pick.game,
        market,
        pick: pickText,
        odds: pick.odds,
        isProp: false,
        sport: pick.sport,
      };
      const q = buildGameCoverQuery(probe);
      if (!q || !coverQueriesEquivalent(q, target)) continue;
      const derived = deriveCoverHitRatesFromOutcomes(sim.outcomes, [q]);
      const hit = derived[q.id];
      if (hit != null && Number.isFinite(hit)) return hit;
    }
  }
  return null;
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

  const fuzzy = fuzzyCoverHitRate(pick, query, sim!);
  if (fuzzy != null) return fuzzy;

  if (sim!.outcomes) {
    const derived = deriveCoverHitRatesFromOutcomes(sim!.outcomes, [query]);
    const hit = derived[query.id];
    if (hit != null && Number.isFinite(hit)) return hit;
  }

  // Fallback when cover rates were not requested — ML only from win probs.
  if (query.kind === "ml" && query.teamSide) {
    return query.teamSide === "home" ? sim!.homeWinProbability : sim!.awayWinProbability;
  }
  return null;
}

/** When the ticket pick label misses sim keys, probe sibling posted lines for the same cover query. */
export function probeGameSimHitFromLines(
  pick: ParsedPick,
  sim: CoachGameSimEntry | null | undefined,
  lines: Array<{ game: string; market: string; pick: string; odds: number; sport?: string }>,
): number | null {
  const direct = gameSimHitForPick(pick, sim);
  if (direct != null) return direct;
  if (!sim) return null;
  for (const row of lines) {
    if (!/spread|moneyline|total/i.test(row.market)) continue;
    const hit = gameSimHitForPick(
      {
        ...pick,
        game: row.game,
        market: row.market,
        pick: row.pick,
        odds: row.odds,
        sport: row.sport ?? pick.sport,
        isProp: false,
      },
      sim,
    );
    if (hit != null) return hit;
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
  realOdds?: RealOddsEntry[],
): string {
  const note = fourQuestionsNoteForPick(pick, sim, realOdds);
  if (note) return note;
  const hit = gameSimHitForPick(pick, sim);
  if (hit == null) return "";
  const pct = Math.round(hit * 100);
  return `_Game simulator: ${pick.pick} covers in ${pct}% of ${sim?.simulations?.toLocaleString() ?? "10,000"} runs._`;
}

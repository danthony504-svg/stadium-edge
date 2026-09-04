// Shared game-outcome Monte Carlo scoring — used by Game Simulator and AI Coach
// so ML / spread / total / alt legs never contradict the same sim engine.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { GameSimulationResult, RealOddsEntry } from "./api.ts";
import { fourQuestionsNoteForPick } from "./gameLineFourQuestions.ts";
import { parseMarketPeriod, type SimPeriodScope, marketSupportsSimulation } from "./simMarketSupport.ts";
import { periodScoresForDraw, raceToHits, sportSupportsPeriod } from "./gamePeriodScoring.ts";

/** Same period-scoped family logic as PickCard.marketFamily (kept local for tests). */
function gameMarketFamily(market: string): string {
  const period = parseMarketPeriod(market);
  const prefix =
    period === "fg"
      ? ""
      : period === "h1"
        ? "1h:"
        : period === "h2"
          ? "2h:"
          : period === "f5"
            ? "f5:"
            : `${period}:`;
  const m = String(market ?? "").toLowerCase();
  let fam: string;
  if (/spread|run ?line|puck ?line/.test(m)) fam = "spread";
  else if (/total|over|under|o\/u/.test(m)) fam = "total";
  else if (/money|h2h|\bml\b/.test(m)) fam = "moneyline";
  else if (/race to/.test(m)) fam = "raceto";
  else fam = m;
  return prefix + fam;
}

/** Same floor as prop Monte Carlo — game-line legs must clear this in the shared sim. */
export const GAME_SIM_MIN_HIT = 0.52;

export type GameCoverQuery = {
  id: string;
  kind: "ml" | "spread" | "total" | "teamTotal" | "raceTo";
  teamSide?: "home" | "away";
  line?: number;
  totalSide?: "over" | "under";
  period?: SimPeriodScope;
  raceTarget?: number;
};

export type CoachGameSimEntry = GameSimulationResult & {
  coverHitRates?: Record<string, number>;
  outcomes?: { homeScores: number[]; awayScores: number[] };
  /** Bounded transport evidence supplied by the Coach game-sim caller. */
  requestedCoverQueryIds?: string[];
  requestedCoverQueryCount?: number;
};

export type GameSimScoreDiagnostic = {
  sport: string; event: string; marketFamily: "moneyline" | "spread" | "gameTotal" | "teamTotal" | "alternateGameLine" | "other"; selection: string;
  line: number | null; odds: number | null; homeTeam: string; awayTeam: string;
  simulationShape: string[]; homeScoreSource: string; awayScoreSource: string;
  submittedCoverQueryIds: string[]; submittedCoverQueryCount: number;
  returnedCoverHitRateIds: string[]; returnedCoverHitRateCount: number;
  outcomesReturned: boolean; homeScoreDrawCount: number; awayScoreDrawCount: number;
  sampleHomeScore: number | null; sampleAwayScore: number | null;
  winnerSource: string | null; totalSource: string | null;
  parsedTeam: string | null; parsedSide: string | null; parsedLine: number | null;
  wins: number; losses: number; pushes: number; simHitRate: number | null;
  nullReason: string | null;
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
  if (/team total/i.test(pick.market)) {
    const team = p
      .replace(/\bteam total\b/gi, "")
      .replace(/\s+\b(over|under)\b\s+[+-]?\d+(?:\.\d+)?\s*$/i, "")
      .trim();
    return team || null;
  }
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

/** Stable matchup key — nickname vs full-name labels collapse to the same game. */
export function canonicalGameKey(game: string): string {
  const { away, home } = splitLabel(game);
  if (!away || !home) return normGame(game);
  const a = teamNick(away);
  const h = teamNick(home);
  if (!a || !h) return normGame(game);
  return `${a}|${h}`;
}

/** Exact leg identity for spread/ML/total dedupe across label variants. */
export function normalizedGamePickKey(game: string, market: string, pick: string): string {
  const gk = canonicalGameKey(game);
  const fam = gameMarketFamily(market);
  if (/\b(over|under)\b/i.test(pick) && !/team total/i.test(market)) {
    const side = /\bover\b/i.test(pick) ? "over" : "under";
    const line = numLine(pick);
    return `${gk}|${fam}|${side}|${line ?? ""}`;
  }
  const team = gamePickTeam({ game, market, pick, odds: 0 });
  if (team) {
    if (fam.endsWith("moneyline")) return `${gk}|${fam}|${teamNick(team)}`;
    const line = numLine(pick);
    return `${gk}|${fam}|${teamNick(team)}|${line ?? ""}`;
  }
  return `${gk}|${fam}|${normGame(pick)}`;
}

/** One leg per team-sided bucket when backfilling or deduping multi-leg tickets. */
export function gameLineLegBucket(game: string, market: string, pick: string): string {
  const g = canonicalGameKey(game);
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
  const m = String(pick.market ?? "").toLowerCase();
  if (/team total|race to/.test(m)) return true;
  const fam = gameMarketFamily(pick.market);
  return (
    fam.endsWith("moneyline") ||
    fam.endsWith("spread") ||
    fam.endsWith("total") ||
    fam.endsWith("raceto")
  );
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
  const period = parseMarketPeriod(pick.market);

  if (/race to/i.test(pick.market)) {
    const team = gamePickTeam(pick);
    if (!team) return null;
    const teamSide = sideOfTeam(team, away, home);
    if (!teamSide) return null;
    const targetMatch = pick.market.match(/race to\s+(\d+(?:\.\d+)?)/i);
    const raceTarget = targetMatch ? Number(targetMatch[1]) : null;
    if (raceTarget == null || !Number.isFinite(raceTarget)) return null;
    return { id, kind: "raceTo", teamSide, raceTarget, period: period === "fg" ? undefined : period };
  }

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
      return { id, kind: "teamTotal", teamSide, line, totalSide: over ? "over" : "under", period: period === "fg" ? undefined : period };
    }
    return { id, kind: "total", line, totalSide: over ? "over" : "under", period: period === "fg" ? undefined : period };
  }

  const team = gamePickTeam(pick);
  if (!team) return null;
  const teamSide = sideOfTeam(team, away, home);
  if (!teamSide) return null;

  if (fam.endsWith("moneyline")) {
    return { id, kind: "ml", teamSide, period: period === "fg" ? undefined : period };
  }
  if (fam.endsWith("spread")) {
    const line = numLine(p);
    if (line == null) return null;
    return { id, kind: "spread", teamSide, line, period: period === "fg" ? undefined : period };
  }
  return null;
}

function coverQueryResult(
  q: GameCoverQuery,
  homeScore: number,
  awayScore: number,
  sport = "nba",
): boolean | null {
  if (q.kind === "raceTo") {
    const target = q.raceTarget ?? 0;
    const side = q.teamSide ?? "home";
    if (target <= 0) return false;
    return raceToHits(target, side, homeScore, awayScore);
  }
  const period: SimPeriodScope = q.period ?? "fg";
  const scoped =
    period === "fg" || !sportSupportsPeriod(sport, period)
      ? { home: homeScore, away: awayScore }
      : periodScoresForDraw(sport, period, homeScore, awayScore);
  const hs = scoped.home;
  const as = scoped.away;
  const total = hs + as;

  if (q.kind === "ml") {
    if (hs === as) return null;
    if (q.teamSide === "home") return hs > as;
    if (q.teamSide === "away") return as > hs;
    return false;
  }
  if (q.kind === "spread") {
    const line = q.line ?? 0;
    if (q.teamSide === "home") {
      const margin = hs + line - as;
      return margin === 0 ? null : margin > 0;
    }
    if (q.teamSide === "away") {
      const margin = as + line - hs;
      return margin === 0 ? null : margin > 0;
    }
    return false;
  }
  if (q.kind === "total") {
    const line = q.line ?? 0;
    if (total === line) return null;
    if (q.totalSide === "over") return total > line;
    if (q.totalSide === "under") return total < line;
    return false;
  }
  if (q.kind === "teamTotal") {
    const line = q.line ?? 0;
    const score = q.teamSide === "home" ? hs : as;
    if (score === line) return null;
    if (q.totalSide === "over") return score > line;
    if (q.totalSide === "under") return score < line;
    return false;
  }
  return false;
}

function diagnosticMarketFamily(pick: ParsedPick): GameSimScoreDiagnostic["marketFamily"] {
  const market = String(pick.market ?? "").toLowerCase();
  if (/\balt\b/.test(market)) return "alternateGameLine";
  if (/team total/.test(market)) return "teamTotal";
  if (/moneyline|\bml\b/.test(market)) return "moneyline";
  if (/spread|run line|puck line/.test(market)) return "spread";
  if (/total/.test(market)) return "gameTotal";
  return "other";
}

function outcomeCounts(
  sim: CoachGameSimEntry | null | undefined,
  query: GameCoverQuery | null,
  sport: string,
): { wins: number; losses: number; pushes: number } {
  if (!sim?.outcomes || !query) return { wins: 0, losses: 0, pushes: 0 };
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  for (let i = 0; i < sim.outcomes.homeScores.length; i++) {
    const result = coverQueryResult(query, sim.outcomes.homeScores[i]!, sim.outcomes.awayScores[i]!, sport);
    if (result == null) pushes += 1;
    else if (result) wins += 1;
    else losses += 1;
  }
  return { wins, losses, pushes };
}

function responseEvidence(sim: CoachGameSimEntry | null | undefined) {
  const rates = sim?.coverHitRates ?? {};
  const outcomes = sim?.outcomes;
  return {
    submittedCoverQueryIds: (sim?.requestedCoverQueryIds ?? []).slice(0, 80),
    submittedCoverQueryCount: sim?.requestedCoverQueryCount ?? 0,
    returnedCoverHitRateIds: Object.keys(rates).slice(0, 80),
    returnedCoverHitRateCount: Object.keys(rates).length,
    outcomesReturned: !!outcomes,
    homeScoreDrawCount: outcomes?.homeScores?.length ?? 0,
    awayScoreDrawCount: outcomes?.awayScores?.length ?? 0,
  };
}

/** Derive hit rates for arbitrary lines from a saved 10k draw set. */
export function deriveCoverHitRatesFromOutcomes(
  outcomes: { homeScores: number[]; awayScores: number[] },
  queries: GameCoverQuery[],
  sport = "nba",
): Record<string, number> {
  const n = outcomes.homeScores.length;
  if (!n || n !== outcomes.awayScores.length) return {};
  const rates: Record<string, number> = {};
  for (const q of queries) {
    let hits = 0;
    let decisions = 0;
    for (let i = 0; i < n; i++) {
      const result = coverQueryResult(q, outcomes.homeScores[i]!, outcomes.awayScores[i]!, sport);
      if (result == null) continue;
      decisions += 1;
      if (result) hits += 1;
    }
    if (decisions > 0) rates[q.id] = Math.round((hits / decisions) * 1000) / 1000;
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
  if ((a.period ?? "fg") !== (b.period ?? "fg")) return false;
  if (a.kind === "raceTo") {
    return a.teamSide === b.teamSide && spreadLinesMatch(a.raceTarget ?? null, b.raceTarget ?? null);
  }
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
      const derived = deriveCoverHitRatesFromOutcomes(sim.outcomes, [q], pick.sport ?? "nba");
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
  onDiagnostic?: (diagnostic: GameSimScoreDiagnostic) => void,
): number | null {
  const { away, home } = splitLabel(pick.game);
  const team = gamePickTeam(pick);
  let query: GameCoverQuery | null = null;
  let hit: number | null = null;
  let nullReason: string | null = null;
  if (!gameSimHasValidRun(sim)) nullReason = "missing simulation result";
  else if (!marketSupportsSimulation(pick.market ?? "", pick)) nullReason = "unsupported market family";
  else {
    query = buildGameCoverQuery(pick);
    if (!query) nullReason = team ? "unable to determine home/away" : "missing team identity";
  }
  if (nullReason) {
    const counts = outcomeCounts(sim, query, pick.sport ?? "nba");
    onDiagnostic?.({
      sport: pick.sport ?? "", event: pick.game, marketFamily: diagnosticMarketFamily(pick), selection: pick.pick,
      line: numLine(pick.pick), odds: pick.odds ?? null, homeTeam: home, awayTeam: away,
      simulationShape: sim ? Object.keys(sim).sort() : [], homeScoreSource: sim?.outcomes ? "outcomes.homeScores" : "none",
      awayScoreSource: sim?.outcomes ? "outcomes.awayScores" : "none",
      sampleHomeScore: sim?.outcomes?.homeScores[0] ?? null, sampleAwayScore: sim?.outcomes?.awayScores[0] ?? null,
      winnerSource: "homeWinProbability/awayWinProbability", totalSource: sim?.outcomes ? "homeScores + awayScores" : null,
      parsedTeam: team, parsedSide: query?.teamSide ?? null, parsedLine: query?.line ?? null,
      ...responseEvidence(sim),
      ...counts, simHitRate: null, nullReason,
    });
    return null;
  }
  if (!query) return null;
  const fromCover = sim!.coverHitRates?.[query.id];
  if (fromCover != null && Number.isFinite(fromCover)) hit = fromCover;

  if (hit == null) {
    const fuzzy = fuzzyCoverHitRate(pick, query, sim!);
    if (fuzzy != null) hit = fuzzy;
  }

  if (hit == null && sim!.outcomes) {
    const derived = deriveCoverHitRatesFromOutcomes(sim!.outcomes, [query], pick.sport ?? "nba");
    const derivedHit = derived[query.id];
    if (derivedHit != null && Number.isFinite(derivedHit)) hit = derivedHit;
  }

  // Fallback when cover rates were not requested — ML only from win probs.
  if (hit == null && query.kind === "ml" && query.teamSide) {
    hit = query.teamSide === "home" ? sim!.homeWinProbability : sim!.awayWinProbability;
  }
  if (hit == null) nullReason = sim!.outcomes ? "no gradable draws" : "other";
  const counts = outcomeCounts(sim, query, pick.sport ?? "nba");
  onDiagnostic?.({
    sport: pick.sport ?? "", event: pick.game, marketFamily: diagnosticMarketFamily(pick), selection: pick.pick,
    line: numLine(pick.pick), odds: pick.odds ?? null, homeTeam: home, awayTeam: away,
    simulationShape: Object.keys(sim!).sort(), homeScoreSource: sim!.outcomes ? "outcomes.homeScores" : "none",
    awayScoreSource: sim!.outcomes ? "outcomes.awayScores" : "none",
    sampleHomeScore: sim!.outcomes?.homeScores[0] ?? null, sampleAwayScore: sim!.outcomes?.awayScores[0] ?? null,
    winnerSource: "homeWinProbability/awayWinProbability", totalSource: sim!.outcomes ? "homeScores + awayScores" : null,
    parsedTeam: team, parsedSide: query.teamSide ?? null, parsedLine: query.line ?? null,
    ...responseEvidence(sim),
    ...counts, simHitRate: hit, nullReason,
  });
  return hit;
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

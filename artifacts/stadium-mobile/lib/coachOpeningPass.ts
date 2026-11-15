import type { EspnGame, OddsGame } from "./api.ts";
import { runCoachBounded } from "./coachAbortable.ts";

const MAX_OPENING_GAMES = 5;
const OPENING_BUDGET_MS = 18_000;
const MIN_FALLBACK_BUDGET_MS = 30_000;
const normalize = (value?: string | null) => (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Match both sides and the scheduled time. Unclear identities go to the full scan. */
export function pickOpeningCoachGames(odds: readonly OddsGame[], games: readonly EspnGame[], now = Date.now()) {
  const pairs: { odds: OddsGame; espn: EspnGame }[] = [];
  const seen = new Set<string>();
  for (const candidate of odds.filter(game => Date.parse(game.commenceTime) > now).sort((a, b) => Date.parse(a.commenceTime) - Date.parse(b.commenceTime))) {
    const start = Date.parse(candidate.commenceTime);
    if (!(start > now) || !normalize(candidate.homeTeam) || !normalize(candidate.awayTeam)) continue;
    const matches = games.filter(game =>
      game.sport.toLowerCase() === candidate.sport.toLowerCase() &&
      normalize(game.homeTeam) === normalize(candidate.homeTeam) &&
      normalize(game.awayTeam) === normalize(candidate.awayTeam) &&
      Date.parse(game.startsAt) > now &&
      Math.abs(Date.parse(game.startsAt) - start) <= 30 * 60_000,
    );
    if (matches.length !== 1) continue;
    const match = matches[0]!;
    const identity = match.sport + ":" + match.id;
    if (seen.has(identity)) continue;
    seen.add(identity);
    pairs.push({ odds: candidate, espn: match });
  }
  // Give each posted league one slot before filling the rest by kickoff.
  // A busy NFL kickoff window must not crowd out other available markets.
  const leagues = new Set<string>();
  const first = pairs.filter(pair => {
    const sport = pair.odds.sport.toLowerCase();
    if (leagues.has(sport)) return false;
    leagues.add(sport);
    return true;
  });
  const firstSet = new Set(first);
  const selected = [...first, ...pairs.filter(pair => !firstSet.has(pair))].slice(0, MAX_OPENING_GAMES);
  return { oddsGames: selected.map(pair => pair.odds), espnGames: selected.map(pair => pair.espn) };
}

export async function runCoachOpeningPass<T>(opts: {
  signal: AbortSignal;
  remainingMs: number;
  work: (signal: AbortSignal) => Promise<T>;
  accept: (result: T) => T | null;
  /** Deterministic short deadline for tests. */
  openingBudgetMs?: number;
}): Promise<T | null> {
  const budget = Math.min(opts.openingBudgetMs ?? OPENING_BUDGET_MS, opts.remainingMs - MIN_FALLBACK_BUDGET_MS);
  if (opts.signal.aborted || budget <= 0) return null;
  try {
    const result = await runCoachBounded(opts.work, budget, opts.signal);
    return opts.signal.aborted ? null : opts.accept(result);
  } catch (error) {
    if (opts.signal.aborted) throw error;
    // A failed probe gets no new request budget and never blocks the full path.
    return null;
  }
}

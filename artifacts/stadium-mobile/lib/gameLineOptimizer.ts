// After the 10k game sim, rank EVERY posted full-game line by Final AI Score and
// swap each Coach game-line leg to the best win-probability + value combination.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { GameInjuryReport } from "./injuries.ts";
import type { MatchupHistoryEntry, RealOddsEntry } from "./api.ts";
import { buildFinalAiScore, type FinalAiScore } from "./finalAiScore.ts";
import {
  buildGameCoverQuery,
  isGameLinePick,
  type CoachGameSimEntry,
} from "./gameSimScoring.ts";
import { scoreGameLinePick } from "./pickScoreContext.ts";

const norm = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function teamsMatch(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  const nick = (s: string) => {
    const t = norm(s).split(" ").filter(Boolean);
    return t[t.length - 1] ?? "";
  };
  const na = nick(a);
  const nb = nick(b);
  if (na.length > 2 && na === nb) return true;
  const ta = new Set(x.split(" ").filter((w) => w.length > 2));
  return y
    .split(" ")
    .filter((w) => w.length > 2)
    .some((w) => ta.has(w));
}

export type EvaluatedGameLine = {
  entry: RealOddsEntry;
  pick: ParsedPick;
  finalAiScore: FinalAiScore;
  winProb: number | null;
  edgePct: number | null;
};

const FULL_GAME_MARKET = /^(moneyline|spread|alt spread|total|alt total|team total)$/i;

const oddsEntryKey = (e: RealOddsEntry) =>
  `${e.game}|${e.market.toLowerCase()}|${e.pick}`;

/** Union odds rows; later sources win so eval ladder lines carry edge/no-vig for alts. */
export function mergeOddsEntries(...sources: RealOddsEntry[][]): RealOddsEntry[] {
  const map = new Map<string, RealOddsEntry>();
  for (const list of sources) {
    for (const e of list) map.set(oddsEntryKey(e), e);
  }
  return [...map.values()];
}

function pickTeamName(pick: string): string | null {
  const p = String(pick ?? "");
  if (/\b(over|under)\b/i.test(p)) return null;
  return (
    p
      .replace(/\s*(ml|moneyline)\s*$/i, "")
      .replace(/\s*[+-]?\d+(?:\.\d+)?\s*$/, "")
      .trim() || null
  );
}

function isTeamSidedEntry(entry: RealOddsEntry): boolean {
  return pickTeamName(entry.pick) != null;
}

function isGameTotalEntry(entry: RealOddsEntry): boolean {
  return /\b(over|under)\b/i.test(entry.pick) && !/team total/i.test(entry.market);
}

function committedTeamForGame(
  game: string,
  away: string,
  home: string,
  matchupHistory?: Record<string, MatchupHistoryEntry>,
): string | null {
  const lean = matchupHistory?.[game]?.mlLean?.side;
  if (lean) return lean;
  return null;
}

function candidatesForPick(
  pick: ParsedPick,
  allLines: RealOddsEntry[],
  matchupHistory?: Record<string, MatchupHistoryEntry>,
): RealOddsEntry[] {
  const lines = allLines.filter(
    (e) => e.game === pick.game && FULL_GAME_MARKET.test(e.market.trim()),
  );
  const parts = pick.game.split(" @ ");
  const away = parts[0]?.trim() ?? "";
  const home = parts[1]?.trim() ?? "";
  const pickTeam = pickTeamName(pick.pick);
  const leanTeam = committedTeamForGame(pick.game, away, home, matchupHistory);

  if (isGameTotalEntry({ ...pick, market: pick.market, pick: pick.pick, odds: pick.odds, sport: pick.sport ?? "mlb", game: pick.game })) {
    return lines.filter((e) => isGameTotalEntry(e));
  }
  if (/team total/i.test(pick.market)) {
    const team = pickTeam;
    if (!team) return lines.filter((e) => /team total/i.test(e.market));
    return lines.filter(
      (e) => /team total/i.test(e.market) && pickTeamName(e.pick) && teamsMatch(pickTeamName(e.pick)!, team),
    );
  }
  // ML / spread family — same team (lean team or original pick team).
  const team = leanTeam ?? pickTeam;
  if (!team) return lines.filter((e) => isTeamSidedEntry(e));
  return lines.filter((e) => {
    const t = pickTeamName(e.pick);
    return t != null && teamsMatch(t, team);
  });
}

function entryToPick(entry: RealOddsEntry, template?: ParsedPick): ParsedPick {
  return {
    game: entry.game,
    market: entry.market,
    pick: entry.pick,
    odds: entry.odds,
    sport: entry.sport ?? template?.sport,
    isProp: false,
    startsAt: entry.startsAt ?? template?.startsAt ?? null,
  };
}

function rankEvaluated(a: EvaluatedGameLine, b: EvaluatedGameLine): number {
  const ac = a.finalAiScore.composite ?? -1;
  const bc = b.finalAiScore.composite ?? -1;
  if (bc !== ac) return bc - ac;
  const ae = a.edgePct ?? -999;
  const be = b.edgePct ?? -999;
  if (be !== ae) return be - ae;
  const aw = a.winProb ?? 0;
  const bw = b.winProb ?? 0;
  return bw - aw;
}

export function evaluateGameLines(input: {
  lines: RealOddsEntry[];
  gameSim: CoachGameSimEntry | null | undefined;
  realOdds: RealOddsEntry[];
  matchupHistory?: Record<string, MatchupHistoryEntry>;
  matchupInjuries?: Record<string, GameInjuryReport>;
}): EvaluatedGameLine[] {
  const oddsForScore = mergeOddsEntries(input.realOdds, input.lines);
  const out: EvaluatedGameLine[] = [];
  for (const entry of input.lines) {
    const pick = entryToPick(entry);
    if (!isGameLinePick(pick)) continue;
    const rubric = scoreGameLinePick(
      pick,
      oddsForScore,
      input.matchupHistory,
      input.matchupInjuries,
      input.gameSim,
    );
    if (!rubric) continue;
    const finalAiScore = buildFinalAiScore({
      pick,
      rubricScores: rubric.scores,
      edgePct: rubric.edgePct,
      odds: entry.odds,
      fairProb: entry.noVigFair ?? null,
      gameSim: input.gameSim,
    });
    out.push({
      entry,
      pick,
      finalAiScore,
      winProb: finalAiScore.simHit,
      edgePct: finalAiScore.edgePct,
    });
  }
  return out.sort(rankEvaluated);
}

export function bestGameLine(evaluated: EvaluatedGameLine[]): EvaluatedGameLine | null {
  return evaluated.length ? evaluated[0]! : null;
}

export type GameLineRecommendations = {
  overall: EvaluatedGameLine | null;
  byTeam: { away: EvaluatedGameLine | null; home: EvaluatedGameLine | null };
  ranked: EvaluatedGameLine[];
};

/** Rank every posted rung; surface best Final AI Score per team after the 10k sim. */
export function recommendBestLinesForGame(input: {
  awayTeam: string;
  homeTeam: string;
  evalLines: RealOddsEntry[];
  gameSim: CoachGameSimEntry;
  realOdds?: RealOddsEntry[];
  matchupHistory?: Record<string, MatchupHistoryEntry>;
  matchupInjuries?: Record<string, GameInjuryReport>;
}): GameLineRecommendations {
  const odds = mergeOddsEntries(input.realOdds ?? [], input.evalLines);
  const ranked = evaluateGameLines({
    lines: input.evalLines,
    gameSim: input.gameSim,
    realOdds: odds,
    matchupHistory: input.matchupHistory,
    matchupInjuries: input.matchupInjuries,
  });

  const bestForTeam = (team: string): EvaluatedGameLine | null => {
    const pool = ranked.filter((row) => {
      const t = pickTeamName(row.entry.pick);
      return t != null && teamsMatch(t, team);
    });
    return bestGameLine(pool);
  };

  return {
    overall: bestGameLine(ranked),
    byTeam: {
      away: bestForTeam(input.awayTeam),
      home: bestForTeam(input.homeTeam),
    },
    ranked,
  };
}

export type GameLineOptimizeResult = {
  picks: ParsedPick[];
  swapped: number;
  note: string;
};

/**
 * Replace each game-line leg with the highest Final AI Score line in its pool
 * (all ML/spread/alt/total/team-total rungs scored against the same 10k sim).
 */
export function optimizeGameLinePicksToBestFinalAi(
  picks: ParsedPick[],
  simByGame: Map<string, CoachGameSimEntry>,
  opts: {
    evalLinesByGame: Map<string, RealOddsEntry[]>;
    realOdds: RealOddsEntry[];
    matchupHistory?: Record<string, MatchupHistoryEntry>;
    matchupInjuries?: Record<string, GameInjuryReport>;
  },
): GameLineOptimizeResult {
  let swapped = 0;
  const notes: string[] = [];
  const out = picks.map((pick) => {
    if (!isGameLinePick(pick) || pick.isProp) return pick;
    const evalLines = opts.evalLinesByGame.get(pick.game) ?? [];
    if (!evalLines.length) return pick;

    const pool = candidatesForPick(pick, evalLines, opts.matchupHistory);
    if (!pool.length) return pick;

    const sim = simByGame.get(pick.game);
    const gameEvalLines = opts.evalLinesByGame.get(pick.game) ?? [];
    const ranked = evaluateGameLines({
      lines: pool,
      gameSim: sim,
      realOdds: mergeOddsEntries(opts.realOdds, gameEvalLines),
      matchupHistory: opts.matchupHistory,
      matchupInjuries: opts.matchupInjuries,
    });
    const best = bestGameLine(ranked);
    if (!best) return pick;

    const same =
      pick.market === best.entry.market &&
      pick.pick === best.entry.pick &&
      pick.odds === best.entry.odds;
    if (same) return pick;

    swapped += 1;
    const wp = best.winProb != null ? `${Math.round(best.winProb * 100)}%` : "—";
    const edge =
      best.edgePct != null ? `${best.edgePct > 0 ? "+" : ""}${best.edgePct}%` : "—";
    notes.push(
      `**${pick.game}**: ${best.entry.pick} (${best.entry.market}) — Final AI **${best.finalAiScore.grade ?? "—"}**, sim ${wp}, edge ${edge}`,
    );

    return {
      ...pick,
      market: best.entry.market,
      pick: best.entry.pick,
      odds: best.entry.odds,
      sport: best.entry.sport ?? pick.sport,
    };
  });

  const note =
    swapped > 0
      ? `_After the 10k sim, ${swapped} game line${swapped === 1 ? "" : "s"} moved to the highest **Final AI Score** among all posted ML / spread / alt / total / team-total rungs (not just the main or plus-money alt):_\n${notes.map((n) => `• ${n}`).join("\n")}`
      : "";

  return { picks: out, swapped, note };
}

/** Build cover queries for every eval line so the sim scores all rungs in one draw. */
export function coverQueriesFromEvalLines(
  evalLinesByGame: Map<string, RealOddsEntry[]>,
): ReturnType<typeof buildGameCoverQuery>[] {
  const seen = new Set<string>();
  const out: NonNullable<ReturnType<typeof buildGameCoverQuery>>[] = [];
  for (const lines of evalLinesByGame.values()) {
    for (const e of lines) {
      const q = buildGameCoverQuery(entryToPick(e));
      if (!q || seen.has(q.id)) continue;
      seen.add(q.id);
      out.push(q);
    }
  }
  return out;
}

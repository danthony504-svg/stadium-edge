// After the 10k game sim, rank EVERY posted full-game line by Final AI Score and
// swap each Coach game-line leg to the best win-probability + value combination.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { GameInjuryReport } from "./injuries.ts";
import type { MatchupHistoryEntry, OddsGame, RealOddsEntry } from "./api.ts";
import { buildAllEvalGameLines } from "./api.ts";
import { buildFinalAiScore, type FinalAiScore } from "./finalAiScore.ts";
import {
  buildGameCoverQuery,
  gameSimHitForPick,
  isGameLinePick,
  lookupGameSim,
  type CoachGameSimEntry,
} from "./gameSimScoring.ts";
import { simFavoredTeamSide } from "./gameSideConsistency.ts";
import { scoreGameLinePick, findBackingOddsRow } from "./pickScoreContext.ts";
import { isMainTicketQualified } from "./parlayQualifiedGate.ts";

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

/** Fuzzy match for "Away @ Home" labels (full name vs nickname). */
export function gameLabelsMatch(a: string, b: string): boolean {
  const pa = String(a ?? "").split(" @ ");
  const pb = String(b ?? "").split(" @ ");
  if (pa.length !== 2 || pb.length !== 2) {
    return norm(a) === norm(b);
  }
  return teamsMatch(pa[0]!, pb[0]!) && teamsMatch(pa[1]!, pb[1]!);
}

/** Fuzzy lookup — pick labels and odds API labels may differ by nickname. */
export function evalLinesForGame(
  gameLabel: string,
  evalLinesByGame: Map<string, RealOddsEntry[]>,
): RealOddsEntry[] {
  const direct = evalLinesByGame.get(gameLabel);
  if (direct?.length) return direct;
  for (const [k, lines] of evalLinesByGame) {
    if (gameLabelsMatch(k, gameLabel) && lines.length) return lines;
  }
  return [];
}

/** Full eval ladder for every odds API game (props/alt backfill source). */
export function buildEvalLinesForAllGames(oddsGames: OddsGame[]): Map<string, RealOddsEntry[]> {
  const map = new Map<string, RealOddsEntry[]>();
  for (const og of oddsGames) {
    const label = `${og.awayTeam} @ ${og.homeTeam}`;
    map.set(label, buildAllEvalGameLines(og));
  }
  return map;
}
/** Map each pick's game label to the full eval ladder from Odds API games. */
export function buildEvalLinesByGameMap(
  pickGameLabels: Iterable<string>,
  oddsGames: OddsGame[],
): Map<string, RealOddsEntry[]> {
  const picks = [...pickGameLabels];
  const map = new Map<string, RealOddsEntry[]>();
  for (const og of oddsGames) {
    const oddsLabel = `${og.awayTeam} @ ${og.homeTeam}`;
    for (const pickGame of picks) {
      if (!gameLabelsMatch(pickGame, oddsLabel)) continue;
      const lines = buildAllEvalGameLines(og);
      if (!map.has(pickGame)) map.set(pickGame, lines);
      if (!map.has(oddsLabel)) map.set(oddsLabel, lines);
      break;
    }
  }
  return map;
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

function simFavoredTeamForGame(
  game: string,
  sim: CoachGameSimEntry | null | undefined,
): string | null {
  const side = simFavoredTeamSide(sim);
  if (!side) return null;
  const parts = game.split(" @ ");
  if (parts.length !== 2) return null;
  return (side === "home" ? parts[1] : parts[0])!.trim() || null;
}

function candidatesForPick(
  pick: ParsedPick,
  allLines: RealOddsEntry[],
  matchupHistory?: Record<string, MatchupHistoryEntry>,
  excludeMoneyline = false,
  simFavoredTeam?: string | null,
): RealOddsEntry[] {
  let lines = allLines.filter(
    (e) => e.game === pick.game && FULL_GAME_MARKET.test(e.market.trim()),
  );
  if (excludeMoneyline) {
    lines = lines.filter((e) => !/^moneyline$/i.test(e.market.trim()));
  }
  const parts = pick.game.split(" @ ");
  const away = parts[0]?.trim() ?? "";
  const home = parts[1]?.trim() ?? "";
  const pickTeam = pickTeamName(pick.pick);
  const leanTeam = committedTeamForGame(pick.game, away, home, matchupHistory);

  if (isGameTotalPick(pick)) {
    return lines.filter((e) => isGameTotalEntry(e));
  }
  if (/team total/i.test(pick.market)) {
    const team = pickTeam;
    if (!team) return lines.filter((e) => /team total/i.test(e.market));
    return lines.filter(
      (e) => /team total/i.test(e.market) && pickTeamName(e.pick) && teamsMatch(pickTeamName(e.pick)!, team),
    );
  }
  // ML / spread family — sim-favored team wins over mlLean / scaffold team.
  const team = simFavoredTeam ?? leanTeam ?? pickTeam;
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

function isGameTotalPick(pick: ParsedPick): boolean {
  return /\b(over|under)\b/i.test(pick.pick) && !/team total/i.test(pick.market);
}

function bucketKeyForPick(pick: ParsedPick): string | null {
  if (!isGameLinePick(pick) || pick.isProp) return null;
  if (isGameTotalPick(pick)) return `${pick.game}|game-total`;
  if (/team total/i.test(pick.market)) {
    const team = pickTeamName(pick.pick);
    return team ? `${pick.game}|team-total|${norm(team)}` : `${pick.game}|team-total`;
  }
  const team = pickTeamName(pick.pick);
  if (!team) return `${pick.game}|team-sided`;
  return `${pick.game}|team|${norm(team)}`;
}

function pickLegKey(pick: ParsedPick): string {
  return `${pick.game}|${pick.market}|${pick.pick}|${pick.odds}`;
}

function simForGame(
  gameLabel: string,
  simByGame: Map<string, CoachGameSimEntry>,
): CoachGameSimEntry | undefined {
  const direct = simByGame.get(gameLabel);
  if (direct) return direct;
  for (const [label, sim] of simByGame) {
    if (gameLabelsMatch(label, gameLabel)) return sim;
  }
  return undefined;
}

/** Prefer sim-aligned game lines with positive edge — no high-risk bypass on game lines. */
function selectBestEvaluated(ranked: EvaluatedGameLine[]): EvaluatedGameLine | null {
  if (!ranked.length) return null;
  const eligible = ranked.filter((r) =>
    isMainTicketQualified(r.finalAiScore, r.pick.odds ?? null),
  );
  if (eligible.length) return bestGameLine(eligible);
  return null;
}

function rankBestForBucket(
  pick: ParsedPick,
  evalLines: RealOddsEntry[],
  sim: CoachGameSimEntry | null | undefined,
  opts: {
    realOdds: RealOddsEntry[];
    matchupHistory?: Record<string, MatchupHistoryEntry>;
    matchupInjuries?: Record<string, GameInjuryReport>;
    excludeMoneyline?: boolean;
  },
): EvaluatedGameLine | null {
  const pool = candidatesForPick(
    pick,
    evalLines,
    opts.matchupHistory,
    opts.excludeMoneyline,
    simFavoredTeamForGame(pick.game, sim),
  );
  if (!pool.length) return null;
  const ranked = evaluateGameLines({
    lines: pool,
    gameSim: sim,
    realOdds: mergeOddsEntries(opts.realOdds, evalLines),
    matchupHistory: opts.matchupHistory,
    matchupInjuries: opts.matchupInjuries,
  });
  return selectBestEvaluated(ranked);
}

function rankEvaluated(a: EvaluatedGameLine, b: EvaluatedGameLine): number {
  const ac = a.finalAiScore.composite ?? -1;
  const bc = b.finalAiScore.composite ?? -1;
  if (bc !== ac) return bc - ac;
  const awp = a.finalAiScore.simAligned ? 1 : 0;
  const bwp = b.finalAiScore.simAligned ? 1 : 0;
  if (bwp !== awp) return bwp - awp;
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
    return selectBestEvaluated(pool);
  };

  return {
    overall: selectBestEvaluated(ranked),
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
    excludeMoneyline?: boolean;
  },
): GameLineOptimizeResult {
  let swapped = 0;
  let deduped = 0;
  const bestByBucket = new Map<string, EvaluatedGameLine>();

  for (const pick of picks) {
    const bucket = bucketKeyForPick(pick);
    if (!bucket || bestByBucket.has(bucket)) continue;
    const evalLines = evalLinesForGame(pick.game, opts.evalLinesByGame);
    if (!evalLines.length) continue;
    const sim = simForGame(pick.game, simByGame);
    const best = rankBestForBucket(pick, evalLines, sim, opts);
    if (best) bestByBucket.set(bucket, best);
  }

  const seenLegs = new Set<string>();
  const out: ParsedPick[] = [];

  for (const pick of picks) {
    if (!isGameLinePick(pick) || pick.isProp) {
      out.push(pick);
      continue;
    }

    const bucket = bucketKeyForPick(pick);
    const best = bucket ? bestByBucket.get(bucket) : null;
    if (!best) {
      const key = pickLegKey(pick);
      if (seenLegs.has(key)) {
        deduped += 1;
        continue;
      }
      // No sim-aligned line with non-negative edge — drop chalk ML/spread.
      if (isGameLinePick(pick)) continue;
      seenLegs.add(key);
      out.push(pick);
      continue;
    }

    const optimized: ParsedPick = {
      ...pick,
      market: best.entry.market,
      pick: best.entry.pick,
      odds: best.entry.odds,
      sport: best.entry.sport ?? pick.sport,
    };

    const same =
      pick.market === optimized.market &&
      pick.pick === optimized.pick &&
      pick.odds === optimized.odds;
    if (!same) swapped += 1;

    const legKey = pickLegKey(optimized);
    if (seenLegs.has(legKey)) {
      deduped += 1;
      continue;
    }
    seenLegs.add(legKey);
    out.push(optimized);
  }

  return { picks: out, swapped, note: "" };
}

function findOddsRowForNote(
  pick: ParsedPick,
  rows: RealOddsEntry[],
): RealOddsEntry | undefined {
  const exact = rows.find(
    (e) =>
      gameLabelsMatch(e.game, pick.game) &&
      e.market === pick.market &&
      e.pick === pick.pick,
  );
  if (exact) return exact;
  return findBackingOddsRow(pick, rows);
}

function resolveOddsRowForNote(
  pick: ParsedPick,
  evalLines: RealOddsEntry[],
  realOdds: RealOddsEntry[],
): RealOddsEntry | undefined {
  const merged = mergeOddsEntries(realOdds, evalLines);
  return (
    findOddsRowForNote(pick, evalLines) ??
    findOddsRowForNote(pick, realOdds) ??
    findBackingOddsRow(pick, merged)
  );
}

function probeSimHitFromEvalLadder(
  pick: ParsedPick,
  sim: CoachGameSimEntry | undefined,
  evalLines: RealOddsEntry[],
): number | null {
  if (!sim) return null;
  const direct = gameSimHitForPick(pick, sim);
  if (direct != null) return direct;
  for (const row of evalLines) {
    if (!/spread|moneyline|total/i.test(row.market)) continue;
    const hit = gameSimHitForPick(
      {
        ...pick,
        game: row.game,
        market: row.market,
        pick: row.pick,
        odds: row.odds,
        isProp: false,
        sport: row.sport ?? pick.sport,
      },
      sim,
    );
    if (hit != null) return hit;
  }
  return null;
}

function formatGameLineScoreNote(
  pick: ParsedPick,
  scored: EvaluatedGameLine | null,
  sim: CoachGameSimEntry | undefined,
  match: RealOddsEntry | null,
  opts?: {
    realOdds: RealOddsEntry[];
    evalLines?: RealOddsEntry[];
    matchupHistory?: Record<string, MatchupHistoryEntry>;
    matchupInjuries?: Record<string, GameInjuryReport>;
  },
): string {
  const simHit =
    pick.finalAiScore?.simHit ??
    scored?.winProb ??
    probeSimHitFromEvalLadder(pick, sim, opts?.evalLines ?? []) ??
    gameSimHitForPick(pick, sim) ??
    (match
      ? gameSimHitForPick(
          { ...pick, market: match.market, pick: match.pick },
          sim,
        )
      : null);
  const resolvedRow =
    match ??
    (opts ? resolveOddsRowForNote(pick, opts.evalLines ?? [], opts.realOdds) : undefined);
  let edge =
    pick.finalAiScore?.edgePct ??
    scored?.edgePct ??
    resolvedRow?.edge ??
    pick.scores?.edgePct ??
    null;
  if (edge == null && opts) {
    const rubric = scoreGameLinePick(
      pick,
      opts.realOdds,
      opts.matchupHistory,
      opts.matchupInjuries,
      sim,
    );
    edge = rubric?.edgePct ?? null;
  }
  const grade = scored?.finalAiScore.grade ?? pick.finalAiScore?.grade ?? "—";
  const wp = simHit != null ? `${Math.round(simHit * 100)}%` : "—";
  const edgeStr = edge != null ? `${edge > 0 ? "+" : ""}${edge}%` : "—";
  return `${pick.game}: ${pick.pick} (${pick.market}) — Final AI ${grade}, sim ${wp}, edge ${edgeStr}`;
}

function isTeamSidedGameLine(pick: ParsedPick): boolean {
  if (!isGameLinePick(pick) || pick.isProp) return false;
  const m = String(pick.market ?? "").toLowerCase();
  if (/total|over|under|o\/u/.test(m) || /\b(over|under)\b/i.test(pick.pick)) return false;
  return pickTeamName(pick.pick) != null;
}

/**
 * Transparency note for game-line legs on the FINAL ticket — built after dedupe
 * and side alignment so dropped opposing legs are never listed.
 */
export function buildGameLineOptimizerNote(
  picks: ParsedPick[],
  simByGame: Map<string, CoachGameSimEntry>,
  opts: {
    evalLinesByGame: Map<string, RealOddsEntry[]>;
    realOdds: RealOddsEntry[];
    matchupHistory?: Record<string, MatchupHistoryEntry>;
    matchupInjuries?: Record<string, GameInjuryReport>;
  },
): string {
  const gameLines = picks.filter((p) => isGameLinePick(p) && !p.isProp);
  if (!gameLines.length) return "";

  const lines: string[] = [];
  const seenBuckets = new Set<string>();
  const seenTeamSidedGame = new Set<string>();

  for (const pick of gameLines) {
    if (isTeamSidedGameLine(pick)) {
      const gameKey = norm(pick.game);
      if (seenTeamSidedGame.has(gameKey)) continue;
      seenTeamSidedGame.add(gameKey);
    }
    const bucket = bucketKeyForPick(pick);
    if (bucket && seenBuckets.has(bucket)) continue;
    if (bucket) seenBuckets.add(bucket);

    const evalLines = evalLinesForGame(pick.game, opts.evalLinesByGame);
    const sim = lookupGameSim(pick.game, simByGame) ?? simForGame(pick.game, simByGame);
    let match = resolveOddsRowForNote(pick, evalLines, opts.realOdds);
    if (!match && pick.odds != null) {
      match = {
        sport: pick.sport ?? "mlb",
        game: pick.game,
        market: pick.market,
        pick: pick.pick,
        odds: pick.odds,
        edge: pick.finalAiScore?.edgePct ?? pick.scores?.edgePct ?? null,
        noVigFair: null,
      } as RealOddsEntry;
    }
    if (!match) {
      lines.push(
        formatGameLineScoreNote(pick, null, sim, null, {
          realOdds: mergeOddsEntries(opts.realOdds, evalLines),
          evalLines,
          matchupHistory: opts.matchupHistory,
          matchupInjuries: opts.matchupInjuries,
        }),
      );
      continue;
    }
    const mergedOdds = mergeOddsEntries(opts.realOdds, evalLines);
    const ranked = evaluateGameLines({
      lines: [match],
      gameSim: sim,
      realOdds: mergedOdds,
      matchupHistory: opts.matchupHistory,
      matchupInjuries: opts.matchupInjuries,
    });
    lines.push(
      formatGameLineScoreNote(pick, ranked[0] ?? null, sim, match, {
        realOdds: mergedOdds,
        evalLines,
        matchupHistory: opts.matchupHistory,
        matchupInjuries: opts.matchupInjuries,
      }),
    );
  }

  if (!lines.length) return "";
  return `_After the 10k sim, ${lines.length} game line${lines.length === 1 ? "" : "s"} on this ticket use the highest Final AI Score among posted ML / spread / alt / total / team-total rungs:_\n${lines.map((n) => `• ${n}`).join("\n")}`;
}

/** Fill remaining parlay slots with highest Final AI Score game lines (alts/totals) from the full eval ladder. */
export function backfillGameLinesFromEvalScores(
  existing: ParsedPick[],
  target: number,
  evalLinesByGame: Map<string, RealOddsEntry[]>,
  simByGame: Map<string, CoachGameSimEntry>,
  opts: {
    realOdds: RealOddsEntry[];
    matchupHistory?: Record<string, MatchupHistoryEntry>;
    matchupInjuries?: Record<string, GameInjuryReport>;
    maxGameLegs?: number;
  },
): ParsedPick[] {
  if (existing.length >= target) return existing;
  const maxGame =
    opts.maxGameLegs ?? Math.max(3, Math.ceil(target * 0.35));
  const gameCount = existing.filter((p) => isGameLinePick(p) && !p.isProp).length;
  if (gameCount >= maxGame) return existing;

  const seenLegs = new Set(existing.map((p) => pickLegKey(p)));
  const seenBuckets = new Set(
    existing
      .map((p) => bucketKeyForPick(p))
      .filter((b): b is string => b != null),
  );

  const lineMap = new Map<string, RealOddsEntry>();
  for (const lines of evalLinesByGame.values()) {
    for (const e of lines) lineMap.set(oddsEntryKey(e), e);
  }

  const ranked: EvaluatedGameLine[] = [];
  const byGame = new Map<string, RealOddsEntry[]>();
  for (const e of lineMap.values()) {
    const arr = byGame.get(e.game) ?? [];
    arr.push(e);
    byGame.set(e.game, arr);
  }
  for (const [game, lines] of byGame) {
    const sim = simForGame(game, simByGame);
    ranked.push(
      ...evaluateGameLines({
        lines,
        gameSim: sim,
        realOdds: mergeOddsEntries(opts.realOdds, lines),
        matchupHistory: opts.matchupHistory,
        matchupInjuries: opts.matchupInjuries,
      }),
    );
  }
  ranked.sort(rankEvaluated);

  const out = [...existing];
  for (const row of ranked) {
    if (out.length >= target) break;
    if (out.filter((p) => isGameLinePick(p) && !p.isProp).length >= maxGame) break;
    const bucket = bucketKeyForPick(row.pick);
    if (bucket && seenBuckets.has(bucket)) continue;
    const leg = pickLegKey(row.pick);
    if (seenLegs.has(leg)) continue;
    if (!isMainTicketQualified(row.finalAiScore, row.pick.odds ?? null)) continue;
    seenLegs.add(leg);
    if (bucket) seenBuckets.add(bucket);
    out.push(row.pick);
  }
  return out;
}

/** Build cover queries for every eval line so the sim scores all rungs in one draw. */
export function coverQueriesFromEvalLines(
  evalLinesByGame: Map<string, RealOddsEntry[]>,
): NonNullable<ReturnType<typeof buildGameCoverQuery>>[] {
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

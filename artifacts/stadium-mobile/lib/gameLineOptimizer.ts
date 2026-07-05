// After the 10k game sim, rank EVERY posted full-game line by expected value and
// swap each Coach game-line leg to the highest-EV qualified rung.

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
import { selectBestGameLineByEv, gameLineRowQualifies, selectBestGameLineWithReason, isBestEvAmongRows } from "./altLineEvSelect.ts";
import { rankGameLineByFinalScore, computeGameLineFinalScoreBreakdown } from "./gameLineFinalScore.ts";
import {
  filterRowsForCloseGameSpread,
  selectBestTeamSpreadLine,
  type CloseGameSpreadRow,
  type CloseGameSpreadOpts,
} from "./closeGameSpreadSelect.ts";
import { isFullyQualifiedPick, resolvePickEdgePct, resolvePickExpectedValue } from "./parlayQualifiedGate.ts";

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

function teamSideFromName(
  game: string,
  team: string,
): "home" | "away" | null {
  const parts = game.split(" @ ");
  if (parts.length !== 2) return null;
  const away = parts[0]!.trim();
  const home = parts[1]!.trim();
  if (teamsMatch(team, home)) return "home";
  if (teamsMatch(team, away)) return "away";
  return null;
}

function toCloseGameRows(ranked: EvaluatedGameLine[]): CloseGameSpreadRow[] {
  return ranked.map((r) => ({
    entry: r.entry,
    finalAiScore: r.finalAiScore,
    winProb: r.winProb,
    edgePct: r.edgePct,
  }));
}

function fromCloseGameRow(row: CloseGameSpreadRow, ranked: EvaluatedGameLine[]): EvaluatedGameLine {
  return ranked.find((r) => r.entry === row.entry) ?? {
    entry: row.entry,
    pick: entryToPick(row.entry),
    finalAiScore: row.finalAiScore,
    winProb: row.winProb,
    edgePct: row.edgePct,
  };
}

/** Pick the highest-EV qualified line from evaluated game lines. */
function selectBestEvaluated(
  ranked: EvaluatedGameLine[],
  _opts?: CloseGameSpreadOpts,
): EvaluatedGameLine | null {
  void _opts;
  if (!ranked.length) return null;
  const best = selectBestGameLineByEv(toCloseGameRows(ranked));
  return best ? fromCloseGameRow(best, ranked) : null;
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
    longshotAsk?: boolean;
  },
): EvaluatedGameLine | null {
  const spreadOpts: CloseGameSpreadOpts = { longshotAsk: opts.longshotAsk };
  const favoredTeam = simFavoredTeamForGame(pick.game, sim);
  const pool = candidatesForPick(
    pick,
    evalLines,
    opts.matchupHistory,
    opts.excludeMoneyline,
    favoredTeam,
  );
  if (!pool.length) return null;
  const ranked = evaluateGameLines({
    lines: pool,
    gameSim: sim,
    realOdds: mergeOddsEntries(opts.realOdds, evalLines),
    matchupHistory: opts.matchupHistory,
    matchupInjuries: opts.matchupInjuries,
  });

  const team = favoredTeam ?? pickTeamName(pick.pick);
  if (team) {
    const bestLine = selectBestTeamSpreadLine(
      toCloseGameRows(ranked),
      sim,
      evalLines,
      team,
      pick.game,
      spreadOpts,
    );
    return bestLine ? fromCloseGameRow(bestLine, ranked) : null;
  }

  return selectBestEvaluated(ranked, spreadOpts);
}

function rankEvaluated(a: EvaluatedGameLine, b: EvaluatedGameLine): number {
  const rowA: CloseGameSpreadRow = {
    entry: a.entry,
    finalAiScore: a.finalAiScore,
    winProb: a.winProb,
    edgePct: a.edgePct,
  };
  const rowB: CloseGameSpreadRow = {
    entry: b.entry,
    finalAiScore: b.finalAiScore,
    winProb: b.winProb,
    edgePct: b.edgePct,
  };
  return rankGameLineByFinalScore(rowA, rowB);
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

export function filterEvaluatedForCloseGameSpread(
  rows: EvaluatedGameLine[],
  sim: CoachGameSimEntry | null | undefined,
  evalLines: RealOddsEntry[],
  opts?: CloseGameSpreadOpts,
): EvaluatedGameLine[] {
  const closeRows = filterRowsForCloseGameSpread(toCloseGameRows(rows), sim, evalLines, opts);
  const keep = new Set(closeRows.map((r) => r.entry));
  return rows.filter((r) => keep.has(r.entry));
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

function allFullGameLines(
  evalLines: RealOddsEntry[],
  excludeMoneyline?: boolean,
): RealOddsEntry[] {
  let lines = evalLines.filter((e) => FULL_GAME_MARKET.test(String(e.market ?? "").trim()));
  if (excludeMoneyline) {
    lines = lines.filter((e) => !/^moneyline$/i.test(String(e.market ?? "").trim()));
  }
  return lines;
}

/**
 * Evaluate every ML / spread / alt / total / team-total rung for one game and
 * return the single highest-qualified Final Score line. Attaches gameLineFinal
 * metadata so cards and optimizer notes never re-derive a different pick.
 */
export function finalizeGameLinePickForGame(
  game: string,
  template: ParsedPick,
  simByGame: Map<string, CoachGameSimEntry>,
  opts: {
    evalLinesByGame: Map<string, RealOddsEntry[]>;
    realOdds: RealOddsEntry[];
    matchupHistory?: Record<string, MatchupHistoryEntry>;
    matchupInjuries?: Record<string, GameInjuryReport>;
    excludeMoneyline?: boolean;
    longshotAsk?: boolean;
  },
): ParsedPick | null {
  void opts.longshotAsk;
  const evalLines = evalLinesForGame(game, opts.evalLinesByGame);
  const pool = allFullGameLines(evalLines, opts.excludeMoneyline);
  if (!pool.length) return null;
  const sim = simForGame(game, simByGame);
  const ranked = evaluateGameLines({
    lines: pool,
    gameSim: sim,
    realOdds: mergeOddsEntries(opts.realOdds, pool),
    matchupHistory: opts.matchupHistory,
    matchupInjuries: opts.matchupInjuries,
  });
  const selection = selectBestGameLineWithReason(toCloseGameRows(ranked));
  if (!selection) return null;
  const row = selection.row;
  const breakdown = computeGameLineFinalScoreBreakdown(row);
  const allRows = toCloseGameRows(ranked);
  const finalPick: ParsedPick = {
    ...template,
    game,
    market: row.entry.market,
    pick: row.entry.pick,
    odds: row.entry.odds ?? -110,
    sport: row.entry.sport ?? template.sport,
    isProp: false,
    finalAiScore: row.finalAiScore,
    scores: row.finalAiScore.rubric,
    highRiskValuePlay: row.finalAiScore.highRiskValuePlay,
    gameLineFinal: {
      reason: selection.reason,
      finalScore: breakdown.finalScore,
      bullets: selection.bullets,
      isBestEv: isBestEvAmongRows(row, allRows),
    },
  };
  if (!isFullyQualifiedPick(finalPick, { realOdds: mergeOddsEntries(opts.realOdds, pool) })) {
    return null;
  }
  return finalPick;
}

/**
 * One final game-line pick per matchup — every screen reads the same object.
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
    longshotAsk?: boolean;
  },
): GameLineOptimizeResult {
  const props: ParsedPick[] = [];
  const templatesByGame = new Map<string, ParsedPick>();
  let swapped = 0;

  for (const pick of picks) {
    if (!isGameLinePick(pick) || pick.isProp) {
      props.push(pick);
      continue;
    }
    if (!templatesByGame.has(pick.game)) templatesByGame.set(pick.game, pick);
  }

  const finalized: ParsedPick[] = [];
  for (const [game, template] of templatesByGame) {
    const finalPick = finalizeGameLinePickForGame(game, template, simByGame, opts);
    if (!finalPick) continue;
    if (
      finalPick.market !== template.market ||
      finalPick.pick !== template.pick ||
      finalPick.odds !== template.odds
    ) {
      swapped += 1;
    }
    finalized.push(finalPick);
  }

  return { picks: [...props, ...finalized], swapped, note: "" };
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

function formatFinalGameLineNote(
  pick: ParsedPick,
  realOdds: RealOddsEntry[],
): string | null {
  const score = pick.finalAiScore;
  const edge = resolvePickEdgePct(pick, { realOdds });
  const ev = resolvePickExpectedValue(pick, { realOdds });
  const simHit = score?.simHit;
  const grade = score?.grade;
  const conf = score?.confidencePct;
  if (
    simHit == null ||
    !Number.isFinite(simHit) ||
    edge == null ||
    !Number.isFinite(edge) ||
    edge <= 0 ||
    ev == null ||
    !Number.isFinite(ev) ||
    ev <= 0 ||
    !grade ||
    conf == null ||
    !Number.isFinite(conf) ||
    score?.composite == null ||
    !Number.isFinite(score.composite) ||
    score.composite <= 0 ||
    !pick.gameLineFinal
  ) {
    return null;
  }

  const header = `**${pick.pick}** (${pick.market}) · ${pick.game}`;
  const metrics = `Sim ${Math.round(simHit * 100)}% · Edge +${edge}% · EV +${ev.toFixed(1)}% · Conf ${conf} · Grade ${grade}`;
  const bullets = pick.gameLineFinal.bullets ?? [];
  const why =
    bullets.length > 0
      ? `Selected because:\n${bullets.map((b) => `  • ${b}`).join("\n")}`
      : pick.gameLineFinal.reason
        ? `Selected because: ${pick.gameLineFinal.reason}`
        : "";
  return why ? `${header}\n${metrics}\n${why}` : `${header}\n${metrics}`;
}

function isTeamSidedGameLine(pick: ParsedPick): boolean {
  if (!isGameLinePick(pick) || pick.isProp) return false;
  const m = String(pick.market ?? "").toLowerCase();
  if (/total|over|under|o\/u/.test(m) || /\b(over|under)\b/i.test(pick.pick)) return false;
  return pickTeamName(pick.pick) != null;
}

/**
 * Transparency note for game-line legs on the FINAL ticket. Reads only the
 * finalized pick objects — never re-runs line selection (cards use the same data).
 */
export function buildGameLineOptimizerNote(
  picks: ParsedPick[],
  _simByGame: Map<string, CoachGameSimEntry>,
  opts: {
    evalLinesByGame: Map<string, RealOddsEntry[]>;
    realOdds: RealOddsEntry[];
    matchupHistory?: Record<string, MatchupHistoryEntry>;
    matchupInjuries?: Record<string, GameInjuryReport>;
    longshotAsk?: boolean;
  },
): string {
  void _simByGame;
  void opts;
  const gameLines = picks.filter((p) => {
    if (!isGameLinePick(p) || p.isProp) return false;
    return isFullyQualifiedPick(p, { realOdds: opts.realOdds });
  });
  if (!gameLines.length) return "";

  const lines: string[] = [];
  const seenGames = new Set<string>();

  for (const pick of gameLines) {
    const gameKey = norm(pick.game);
    if (seenGames.has(gameKey)) continue;
    seenGames.add(gameKey);
    const line = formatFinalGameLineNote(pick, opts.realOdds);
    if (line) lines.push(line);
  }

  if (!lines.length) return "";
  const intro = `_After the 10k sim, ${lines.length} qualified game line${lines.length === 1 ? "" : "s"} — every metric is grounded (Sim, Edge, EV, Confidence, Grade). Each pick below shows why it was selected:_`;
  return `${intro}\n\n${lines.map((n) => `• ${n}`).join("\n\n")}`;
}

/** Fill remaining parlay slots with highest-EV qualified game lines from the eval ladder. */
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
  const byGameFiltered: EvaluatedGameLine[] = [];
  const gameGroups = new Map<string, EvaluatedGameLine[]>();
  for (const row of ranked) {
    const arr = gameGroups.get(row.entry.game) ?? [];
    arr.push(row);
    gameGroups.set(row.entry.game, arr);
  }
  for (const [game, rows] of gameGroups) {
    const sim = simForGame(game, simByGame);
    const lines = byGame.get(game) ?? [];
    byGameFiltered.push(
      ...filterEvaluatedForCloseGameSpread(rows, sim, lines),
    );
  }
  byGameFiltered.sort(rankEvaluated);

  const out = [...existing];
  for (const row of byGameFiltered) {
    if (out.length >= target) break;
    if (out.filter((p) => isGameLinePick(p) && !p.isProp).length >= maxGame) break;
    const bucket = bucketKeyForPick(row.pick);
    if (bucket && seenBuckets.has(bucket)) continue;
    const leg = pickLegKey(row.pick);
    if (seenLegs.has(leg)) continue;
    if (!gameLineRowQualifies({
      entry: row.entry,
      finalAiScore: row.finalAiScore,
      winProb: row.winProb,
      edgePct: row.edgePct,
    })) continue;
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

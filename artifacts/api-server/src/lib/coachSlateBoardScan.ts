import { serverPickFinalAiScore, serverPickRankScore } from "./coachSlatePickScore.js";
import {
  coachSlateSimsInProcess,
  pooled,
  slateLoopbackPost,
} from "./coachSlateLoopback.js";
import { runPropSimsInProcess, type InProcessPropSimRow } from "./coachSlateInProcessSims.js";
import {
  fetchServerGameSimulations,
  qualifiesServerAiLine,
  simHitForGameLine,
} from "./coachSlateGameSims.js";
import { stageServerTicketBalanced } from "./coachSlateBalancedStaging.js";
import { serverBoardLegQualifies } from "./coachSlateLegQualification.js";
import { buildSlateTicketsIndex, primaryBoardScanFromRanked } from "./coachSlateTickets.js";
import type {
  BuiltChatContext,
  FullBoardScanResult,
  ParsedPick,
  PropPoolEntry,
  RealOddsEntry,
  SlateTicketsIndex,
} from "./coachSlateTypes.js";

export type ServerBoardScanBundle = {
  scan: FullBoardScanResult;
  tickets: SlateTicketsIndex;
};

function propSimKey(entry: PropPoolEntry): string {
  return JSON.stringify([entry.sport, entry.eventId ?? null, entry.espnEventId ?? null, entry.startsAt ?? null,
    entry.game, entry.homeTeamId ?? null, entry.awayTeamId ?? null, entry.athleteId ?? null,
    entry.playerTeamId ?? null, entry.player, entry.marketKey ?? entry.marketLabel, entry.line, entry.side]);
}

/** Seat a server slate pick — preserves provider identity fields from the pool. */
export function pickFromPoolEntry(e: PropPoolEntry): ParsedPick {
  const pick =
    e.line != null
      ? `${e.player} ${e.side} ${e.line} ${e.marketLabel}`
      : `${e.player} ${e.marketLabel}`;
  return {
    game: e.game,
    market: e.marketLabel,
    pick,
    odds: e.odds,
    sport: e.sport,
    isProp: true,
    propIsAlt: !!e.alt,
    startsAt: e.startsAt,
    headshot: e.headshot,
    teamAbbr: e.teamAbbr,
    player: e.player,
    athleteId: e.athleteId,
    playerTeamId: e.playerTeamId ?? null,
    homeTeamId: e.homeTeamId ?? null,
    awayTeamId: e.awayTeamId ?? null,
    eventId: e.eventId ?? null,
    sportsbook: e.sportsbook ?? null,
    propMarketKey: e.marketKey,
    propLine: e.line,
    propSide: e.side,
  };
}

function pickFromOdds(o: RealOddsEntry): ParsedPick {
  return {
    game: o.game,
    market: o.market,
    pick: o.pick,
    odds: o.odds,
    sport: o.sport,
    isProp: false,
    startsAt: o.startsAt,
  };
}

function legFingerprint(p: ParsedPick): string {
  if (p.isProp) {
    return `prop|${p.game}|${p.player}|${p.propMarketKey ?? p.market}|${p.propLine}|${p.propSide}`;
  }
  return `game|${p.game}|${p.market}|${p.pick}`;
}

const COACH_HORIZON_MS = 48 * 60 * 60 * 1000;

function isCoachBettableStartsAt(startsAt?: string | null): boolean {
  if (!startsAt) return false;
  const t = Date.parse(startsAt);
  if (!Number.isFinite(t)) return false;
  const now = Date.now();
  return t > now && t < now + COACH_HORIZON_MS;
}

function rankScoreForPick(p: ParsedPick, hit: number | null | undefined): number {
  const edge = typeof p.edge === "string" ? parseFloat(p.edge) : (p as { edgeNum?: number }).edgeNum;
  return serverPickRankScore(p.odds, edge, hit);
}

async function fetchBoardPropSimulations(
  propPool: PropPoolEntry[],
  tier: "quick" | "deep",
  limit = tier === "quick" ? 96 : Infinity,
): Promise<Map<string, InProcessPropSimRow>> {
  const out = new Map<string, InProcessPropSimRow>();
  const events = new Map<string, PropPoolEntry[]>();
  const seen = new Set<string>();
  for (const entry of propPool) {
    if (entry.line == null) continue;
    const key = propSimKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    const event = JSON.stringify([entry.sport, entry.eventId ?? null, entry.espnEventId ?? null, entry.game,
      entry.startsAt ?? null, entry.homeTeamId ?? null, entry.awayTeamId ?? null]);
    const entries = events.get(event) ?? [];
    entries.push(entry);
    events.set(event, entries);
    if (seen.size >= limit) break;
  }
  const batchSize = tier === "deep" ? 24 : 20;
  const batches = [...events.values()].flatMap(entries =>
    Array.from({ length: Math.ceil(entries.length / batchSize) }, (_, i) =>
      entries.slice(i * batchSize, (i + 1) * batchSize)),
  );
  await pooled(batches, 2, async entries => {
    const event = entries[0]!;
    const [awayTeam, homeTeam] = event.game.split(" @ ");
    const props = entries.map(entry => ({
      player: entry.player,
      market: entry.marketKey ?? entry.marketLabel,
      line: entry.line!,
      side: entry.side,
      athleteId: entry.athleteId ?? null,
      playerTeamId: entry.playerTeamId ?? null,
      homeTeamId: entry.homeTeamId ?? null,
      awayTeamId: entry.awayTeamId ?? null,
    }));
    const payload = {
      sport: event.sport, tier, startsAt: event.startsAt, espnEventId: event.espnEventId ?? undefined,
      homeTeam: homeTeam?.trim(), awayTeam: awayTeam?.trim(),
      homeTeamId: event.homeTeamId ?? undefined, awayTeamId: event.awayTeamId ?? undefined,
      props,
    };
    const response = coachSlateSimsInProcess()
      ? await runPropSimsInProcess(payload)
      : await slateLoopbackPost<{ props?: InProcessPropSimRow[] }>(
          "/sports/simulate/props", payload, tier === "deep" ? 180_000 : 45_000,
        );
    if (response?.props?.length !== props.length) return;
    for (const [index, request] of props.entries()) {
      const row = response.props[index];
      if (row && row.player === request.player && row.market === request.market &&
          row.line === request.line && row.side === request.side) {
        out.set(propSimKey(entries[index]!), row);
      }
    }
  });
  return out;
}

function propLadderKey(p: ParsedPick): string {
  return `${p.game}|${p.player}|${p.propMarketKey ?? p.market}|${p.propSide}`.toLowerCase();
}

function gameLadderKeyFromPick(p: ParsedPick): string {
  const side = /\bover\b/i.test(p.pick)
    ? "over"
    : /\bunder\b/i.test(p.pick)
      ? "under"
      : p.pick.replace(/\s*[+-]?\d+(?:\.\d+)?\s*$/, "").trim().toLowerCase();
  const fam = p.market.replace(/^alt\s+/i, "").toLowerCase();
  return `${p.game}|${fam}|${side}`.toLowerCase();
}

function collapseServerRankedByLadder(
  rows: Array<{ pick: ParsedPick; rankScore: number; isAlt: boolean }>,
): Array<{ pick: ParsedPick; rankScore: number; isAlt: boolean }> {
  const byLadder = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.pick.isProp ? propLadderKey(row.pick) : gameLadderKeyFromPick(row.pick);
    const arr = byLadder.get(key) ?? [];
    arr.push(row);
    byLadder.set(key, arr);
  }
  const out: typeof rows = [];
  for (const ladder of byLadder.values()) {
    ladder.sort((a, b) => {
      if (a.isAlt !== b.isAlt) return a.isAlt ? 1 : -1;
      return b.rankScore - a.rankScore;
    });
    for (const row of ladder) {
      if (serverBoardLegQualifies(row.pick, row.pick.finalAiScore)) {
        out.push(row);
        break;
      }
    }
  }
  return out;
}

/** Server board scan — 10k game + prop sims, balanced category mix, no filler. */
export async function runServerBoardScan(
  built: BuiltChatContext,
  opts?: {
    deepSim?: boolean;
    onPropDecision?: (decision: {
      entry: PropPoolEntry;
      hitProbability: number | null;
      grade?: string | null;
      rankScore: number;
      exclusion: "missing_simulation" | "below_scan_probability" | "staging_quality" | null;
    }) => void;
    onPartial?: (partial: FullBoardScanResult, tickets: SlateTicketsIndex) => void | Promise<void>;
  },
): Promise<ServerBoardScanBundle> {
  const { context, propPool } = built;
  const realOdds = context.realOdds ?? [];
  const activeSports = context.selectedSports?.length
    ? context.selectedSports
    : [...new Set(realOdds.map((o) => o.sport).filter(Boolean))];

  const evalLinesByGame = new Map<string, RealOddsEntry[]>();
  for (const o of realOdds) {
    const rows = evalLinesByGame.get(o.game) ?? [];
    rows.push(o);
    evalLinesByGame.set(o.game, rows);
  }

  const propSims = await fetchBoardPropSimulations(propPool, opts?.deepSim !== false ? "deep" : "quick");

  const gameSimulations = await fetchServerGameSimulations(realOdds);
  const ranked: Array<{ pick: ParsedPick; rankScore: number; isAlt: boolean }> = [];
  let totalScanned = 0;
  let lastPartialAt = 0;

  const scanCtx = () => ({
    evalLinesByGame,
    gameSimulations,
    totalScanned,
    sports: activeSports,
    matchupHistory: context.matchupHistory,
  });

  const maybeEmitPartial = async () => {
    if (!opts?.onPartial || ranked.length === 0) return;
    const now = Date.now();
    if (now - lastPartialAt < 3000) return;
    lastPartialAt = now;
    const tickets = buildSlateTicketsIndex(ranked, scanCtx(), stageServerTicketBalanced);
    const scan = primaryBoardScanFromRanked(ranked, scanCtx(), stageServerTicketBalanced);
    if (!scan.picks.length) return;
    await opts.onPartial(scan, tickets);
  };

  for (const o of realOdds) {
    if (!isCoachBettableStartsAt(o.startsAt)) continue;
    totalScanned++;
    const isAlt = /^alt /i.test(o.market) || /alt/i.test(o.market);
    const simHit = simHitForGameLine(o, gameSimulations.get(o.game));
    if (!qualifiesServerAiLine(o, simHit)) continue;
    const pick = pickFromOdds(o);
    if (o.edge != null) (pick as ParsedPick & { edgeNum?: number }).edgeNum = o.edge;
    if (simHit != null) {
      pick.finalAiScore = serverPickFinalAiScore(simHit, o.odds, o.edge);
    }
    const score = rankScoreForPick(pick, simHit);
    ranked.push({ pick, rankScore: score, isAlt });
    if (ranked.length % 12 === 0) await maybeEmitPartial();
  }

  for (const e of propPool) {
    if (!isCoachBettableStartsAt(e.startsAt)) continue;
    totalScanned++;
    const pick = pickFromPoolEntry(e);
    const simulation = propSims.get(propSimKey(e));
    const minHit = simulation?.hitProbability ?? null;
    const edge = e.edge ?? 0;
    if (edge <= 0 && (minHit ?? 0) < 0.52) {
      if (opts?.onPropDecision) {
        const score = serverPickFinalAiScore(minHit, e.odds, e.edge);
        opts.onPropDecision({
          entry: e, hitProbability: minHit, grade: score?.grade,
          rankScore: rankScoreForPick(pick, minHit),
          exclusion: minHit == null ? "missing_simulation" : "below_scan_probability",
        });
      }
      continue;
    }
    if (e.edge != null) (pick as ParsedPick & { edgeNum?: number }).edgeNum = e.edge;
    if (minHit != null) {
      pick.finalAiScore = serverPickFinalAiScore(minHit, e.odds, e.edge);
      if (simulation?.projectionBreakdown) pick.projectionBreakdown = simulation.projectionBreakdown;
    }
    const score = rankScoreForPick(pick, minHit);
    opts?.onPropDecision?.({
      entry: e, hitProbability: minHit, grade: pick.finalAiScore?.grade, rankScore: score,
      exclusion: serverBoardLegQualifies(pick, pick.finalAiScore) ? null : "staging_quality",
    });
    ranked.push({ pick, rankScore: score, isAlt: !!e.alt });
    if (ranked.length % 12 === 0) await maybeEmitPartial();
  }

  ranked.sort((a, b) => b.rankScore - a.rankScore);
  const collapsed = collapseServerRankedByLadder(ranked);
  collapsed.sort((a, b) => b.rankScore - a.rankScore);
  const ctx = scanCtx();
  const tickets = buildSlateTicketsIndex(collapsed, ctx, stageServerTicketBalanced);
  const scan = primaryBoardScanFromRanked(collapsed, ctx, stageServerTicketBalanced);

  return { scan, tickets };
}

export async function enrichServerPropSims(
  built: BuiltChatContext,
): Promise<Map<string, { hitProbability: number | null }>> {
  const quick = await fetchBoardPropSimulations(built.propPool, "quick", 40);
  const out = new Map<string, { hitProbability: number | null }>();
  for (const entry of built.propPool) {
    const row = quick.get(propSimKey(entry));
    if (!row) continue;
    const key = `${row.player}|${row.market}|${row.line}|${row.side}`;
    if (!out.has(key)) out.set(key, { hitProbability: row.hitProbability ?? null });
  }
  return out;
}

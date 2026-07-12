import { pooled, slateLoopbackPost } from "./coachSlateLoopback.js";
import {
  fetchServerGameSimulations,
  qualifiesServerAiLine,
  simHitForGameLine,
} from "./coachSlateGameSims.js";
import { buildSlateTicketsIndex, primaryBoardScanFromRanked } from "./coachSlateTickets.js";
import type {
  BuiltChatContext,
  FullBoardScanResult,
  ParsedPick,
  PropPoolEntry,
  RealOddsEntry,
  SlateTicketsIndex,
} from "./coachSlateTypes.js";

type PropSimRow = {
  player: string;
  market: string;
  line: number;
  side: "Over" | "Under";
  hitProbability?: number | null;
  tier?: string;
};

export type ServerBoardScanBundle = {
  scan: FullBoardScanResult;
  tickets: SlateTicketsIndex;
};

function propSimKey(player: string, market: string, line: number, side: string): string {
  return `${player}|${market}|${line}|${side}`;
}

function pickFromPoolEntry(e: PropPoolEntry): ParsedPick {
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

function americanImplied(odds: number): number {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

function serverPickFinalAiScore(
  simHit: number | null,
  odds: number,
  edge: number | null | undefined,
): ParsedPick["finalAiScore"] {
  if (simHit == null || !Number.isFinite(simHit)) return undefined;
  const implied = americanImplied(odds);
  const simAligned = simHit > implied;
  const edgePct = edge ?? Math.round((simHit - implied) * 1000) / 10;
  const grade = simHit >= 0.58 ? "B" : simHit >= 0.54 ? "B-" : "C+";
  const confidencePct = Math.round(simHit * 100);
  const recommends = simAligned && edgePct > 0 && simHit >= 0.52;
  return {
    composite: Math.round((simHit * 100 + edgePct) * 10) / 10,
    grade,
    confidencePct,
    edgePct,
    simHit,
    simAligned,
    highRiskValuePlay: false,
    recommends,
    factors: [],
    rubric: { composite: Math.round(simHit * 100), grade, confidencePct, edgePct, scores: {} as never },
  };
}

function rankScoreForPick(
  p: ParsedPick,
  propSims: Map<string, number | null>,
  gameSimHit?: number | null,
): number {
  const edge = typeof p.edge === "string" ? parseFloat(p.edge) : (p as { edgeNum?: number }).edgeNum;
  const edgeVal = Number.isFinite(edge) ? (edge as number) : 0;
  let sim = gameSimHit ?? 0;
  if (p.isProp && p.player && p.propLine != null && p.propSide) {
    const k = propSimKey(p.player, p.propMarketKey ?? p.market, p.propLine, p.propSide);
    const hit = propSims.get(k);
    if (hit != null) sim = hit;
  }
  const oddsBoost = Math.min(30, Math.abs(p.odds) / 50);
  return edgeVal * 2 + sim * 100 + oddsBoost;
}

async function fetchPropSimulationsDeep(
  entries: PropPoolEntry[],
  tier: "quick" | "deep" = "deep",
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  const bySport = new Map<string, PropPoolEntry[]>();
  for (const e of entries) {
    if (e.line == null) continue;
    const rows = bySport.get(e.sport) ?? [];
    rows.push(e);
    bySport.set(e.sport, rows);
  }
  for (const [sport, sportEntries] of bySport) {
    const props = sportEntries.map((e) => ({
      player: e.player,
      market: e.marketKey ?? e.marketLabel,
      line: e.line!,
      side: e.side,
      athleteId: e.athleteId ?? null,
    }));
    if (!props.length) continue;
    const parts = sportEntries[0]!.game.split(" @ ");
    const resp = await slateLoopbackPost<{ props?: PropSimRow[] }>(
      "/sports/simulate/props",
      {
        sport,
        tier,
        homeTeam: parts[1]?.trim(),
        awayTeam: parts[0]?.trim(),
        props,
      },
      tier === "deep" ? 180_000 : 45_000,
    );
    for (const row of resp?.props ?? []) {
      out.set(propSimKey(row.player, row.market, row.line, row.side), row.hitProbability ?? null);
    }
  }
  return out;
}

async function fetchAllPropSimulations(
  propPool: PropPoolEntry[],
  batchSize = 24,
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  const seen = new Set<string>();
  const entries: PropPoolEntry[] = [];
  for (const e of propPool) {
    if (e.line == null) continue;
    const k = propSimKey(e.player, e.marketKey ?? e.marketLabel, e.line, e.side);
    if (seen.has(k)) continue;
    seen.add(k);
    entries.push(e);
  }

  for (let i = 0; i < entries.length; i += batchSize) {
    const slice = entries.slice(i, i + batchSize);
    const wave = await fetchPropSimulationsDeep(slice, "deep");
    for (const [k, v] of wave) out.set(k, v);
  }
  return out;
}

async function fetchQuickPropSims(
  propPool: PropPoolEntry[],
  limit: number,
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  const seen = new Set<string>();
  const batches = new Map<
    string,
    Array<{
      player: string;
      market: string;
      line: number;
      side: "Over" | "Under";
      athleteId?: string | null;
      game: string;
    }>
  >();

  for (const e of propPool) {
    if (e.line == null) continue;
    const k = propSimKey(e.player, e.marketKey ?? e.marketLabel, e.line, e.side);
    if (seen.has(k)) continue;
    seen.add(k);
    const rows = batches.get(e.sport) ?? [];
    rows.push({
      player: e.player,
      market: e.marketKey ?? e.marketLabel,
      line: e.line,
      side: e.side,
      athleteId: e.athleteId,
      game: e.game,
    });
    batches.set(e.sport, rows);
    if (seen.size >= limit) break;
  }

  await pooled([...batches.entries()], 2, async ([sport, entries]) => {
    const props = entries.slice(0, 20).map((e) => ({
      player: e.player,
      market: e.market,
      line: e.line,
      side: e.side,
      athleteId: e.athleteId ?? null,
    }));
    const parts = entries[0]?.game.split(" @ ") ?? [];
    const resp = await slateLoopbackPost<{ props?: PropSimRow[] }>(
      "/sports/simulate/props",
      { sport, tier: "quick", homeTeam: parts[1]?.trim(), awayTeam: parts[0]?.trim(), props },
      45_000,
    );
    for (const row of resp?.props ?? []) {
      out.set(propSimKey(row.player, row.market, row.line, row.side), row.hitProbability ?? null);
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
    const qualifying = ladder.find((r) => r.pick.finalAiScore?.recommends || (r.pick.finalAiScore?.simAligned && (r.pick.finalAiScore.edgePct ?? 0) > 0));
    if (qualifying) out.push(qualifying);
  }
  return out;
}

function stageTicket(
  ranked: Array<{ pick: ParsedPick; rankScore: number; isAlt: boolean }>,
  target: number,
): { picks: ParsedPick[]; breakdown: FullBoardScanResult["staging"] } {
  const mains = ranked.filter((r) => !r.isAlt).sort((a, b) => b.rankScore - a.rankScore);
  const alts = ranked.filter((r) => r.isAlt).sort((a, b) => b.rankScore - a.rankScore);
  const used = new Set<string>();
  const picks: ParsedPick[] = [];

  for (const row of mains) {
    const fp = legFingerprint(row.pick);
    if (used.has(fp)) continue;
    used.add(fp);
    picks.push({ ...row.pick, ticketRole: "main" });
    if (picks.length >= target) break;
  }

  for (const row of alts) {
    if (picks.length >= target) break;
    const fp = legFingerprint(row.pick);
    if (used.has(fp)) continue;
    used.add(fp);
    picks.push({ ...row.pick, ticketRole: "alt" });
    if (picks.length >= target) break;
  }

  const finalPicks = picks.slice(0, target);
  return {
    picks: finalPicks,
    breakdown: {
      mainQualified: mains.length,
      altQualified: alts.length,
      mainOnTicket: finalPicks.filter((p) => p.ticketRole === "main").length,
      altOnTicket: finalPicks.filter((p) => p.ticketRole === "alt").length,
    },
  };
}

/** Server board scan — 10k game + prop sims, all parlay sizes, no filler. */
export async function runServerBoardScan(
  built: BuiltChatContext,
  opts?: {
    deepSim?: boolean;
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

  const quickSims = await fetchQuickPropSims(propPool, 96);
  let propSims = quickSims;
  if (opts?.deepSim !== false) {
    const deepSims = await fetchAllPropSimulations(propPool);
    for (const [k, v] of deepSims) propSims.set(k, v);
  }

  const gameSimulations = await fetchServerGameSimulations(realOdds);
  const ranked: Array<{ pick: ParsedPick; rankScore: number; isAlt: boolean }> = [];
  let totalScanned = 0;
  let lastPartialAt = 0;

  const scanCtx = () => ({
    evalLinesByGame,
    gameSimulations,
    totalScanned,
    sports: activeSports,
  });

  const maybeEmitPartial = async () => {
    if (!opts?.onPartial || ranked.length === 0) return;
    const now = Date.now();
    if (now - lastPartialAt < 3000) return;
    lastPartialAt = now;
    const tickets = buildSlateTicketsIndex(ranked, scanCtx(), stageTicket);
    const scan = primaryBoardScanFromRanked(ranked, scanCtx(), stageTicket);
    if (!scan.picks.length) return;
    await opts.onPartial(scan, tickets);
  };

  for (const o of realOdds) {
    totalScanned++;
    const isAlt = /^alt /i.test(o.market) || /alt/i.test(o.market);
    const simHit = simHitForGameLine(o, gameSimulations.get(o.game));
    if (!qualifiesServerAiLine(o, simHit)) continue;
    const pick = pickFromOdds(o);
    if (o.edge != null) (pick as ParsedPick & { edgeNum?: number }).edgeNum = o.edge;
    if (simHit != null) {
      pick.finalAiScore = serverPickFinalAiScore(simHit, o.odds, o.edge);
    }
    const score = rankScoreForPick(pick, propSims, simHit);
    ranked.push({ pick, rankScore: score, isAlt });
    if (ranked.length % 12 === 0) await maybeEmitPartial();
  }

  for (const e of propPool) {
    totalScanned++;
    const pick = pickFromPoolEntry(e);
    const k = propSimKey(e.player, e.marketKey ?? e.marketLabel, e.line!, e.side);
    const minHit = propSims.get(k);
    const edge = e.edge ?? 0;
    if (edge <= 0 && (minHit ?? 0) < 0.52) continue;
    if (minHit != null && minHit < 0.52 && edge <= 0) continue;
    if (minHit != null) {
      pick.finalAiScore = serverPickFinalAiScore(minHit, e.odds, e.edge);
    }
    const score = rankScoreForPick(pick, propSims, minHit ?? null);
    ranked.push({ pick, rankScore: score, isAlt: !!e.alt });
    if (ranked.length % 12 === 0) await maybeEmitPartial();
  }

  ranked.sort((a, b) => b.rankScore - a.rankScore);
  const collapsed = collapseServerRankedByLadder(ranked);
  collapsed.sort((a, b) => b.rankScore - a.rankScore);
  const ctx = scanCtx();
  const tickets = buildSlateTicketsIndex(collapsed, ctx, stageTicket);
  const scan = primaryBoardScanFromRanked(collapsed, ctx, stageTicket);

  return { scan, tickets };
}

export async function enrichServerPropSims(
  built: BuiltChatContext,
): Promise<Map<string, { hitProbability: number | null }>> {
  const quick = await fetchQuickPropSims(built.propPool, 40);
  const out = new Map<string, { hitProbability: number | null }>();
  for (const [k, v] of quick) out.set(k, { hitProbability: v });
  return out;
}

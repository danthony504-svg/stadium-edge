import { pooled, slateLoopbackPost } from "./coachSlateLoopback.js";
import type {
  BuiltChatContext,
  CoachGameSimEntry,
  FullBoardScanResult,
  ParsedPick,
  PropPoolEntry,
  RealOddsEntry,
} from "./coachSlateTypes.js";
import { SLATE_PRE_ANALYSIS_TARGET as TARGET } from "./coachSlateTypes.js";

type PropSimRow = {
  player: string;
  market: string;
  line: number;
  side: "Over" | "Under";
  hitProbability?: number | null;
  tier?: string;
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
  propPool: PropPoolEntry[],
  limit: number,
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  const seen = new Set<string>();
  const bySport = new Map<string, PropPoolEntry[]>();

  for (const e of propPool) {
    if (e.line == null) continue;
    const k = propSimKey(e.player, e.marketKey ?? e.marketLabel, e.line, e.side);
    if (seen.has(k)) continue;
    seen.add(k);
    const rows = bySport.get(e.sport) ?? [];
    rows.push(e);
    bySport.set(e.sport, rows);
    if (seen.size >= limit) break;
  }

  for (const [sport, entries] of bySport) {
    const props = entries.slice(0, 24).map((e) => ({
      player: e.player,
      market: e.marketKey ?? e.marketLabel,
      line: e.line!,
      side: e.side,
      athleteId: e.athleteId ?? null,
    }));
    if (!props.length) continue;
    const parts = entries[0]!.game.split(" @ ");
    const resp = await slateLoopbackPost<{ props?: PropSimRow[] }>(
      "/sports/simulate/props",
      {
        sport,
        tier: "deep",
        homeTeam: parts[1]?.trim(),
        awayTeam: parts[0]?.trim(),
        props,
      },
      180_000,
    );
    for (const row of resp?.props ?? []) {
      const k = propSimKey(row.player, row.market, row.line, row.side);
      out.set(k, row.hitProbability ?? null);
    }
  }
  return out;
}

async function fetchQuickPropSims(
  propPool: PropPoolEntry[],
  limit: number,
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  const seen = new Set<string>();
  const batches = new Map<string, Array<{ player: string; market: string; line: number; side: "Over" | "Under"; athleteId?: string | null; game: string }>>();

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

  const gap = Math.max(0, target - picks.length);
  for (const row of alts) {
    if (gap <= 0 && picks.length >= target) break;
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

/** Server board scan — deep 10k sims on top props + game-line edge ranking. */
export async function runServerBoardScan(
  built: BuiltChatContext,
  opts?: { deepSim?: boolean },
): Promise<FullBoardScanResult> {
  const target = TARGET;
  const { context, propPool } = built;
  const realOdds = context.realOdds ?? [];

  const evalLinesByGame = new Map<string, RealOddsEntry[]>();
  for (const o of realOdds) {
    const rows = evalLinesByGame.get(o.game) ?? [];
    rows.push(o);
    evalLinesByGame.set(o.game, rows);
  }

  const quickSims = await fetchQuickPropSims(propPool, 48);
  let propSims = quickSims;
  if (opts?.deepSim !== false) {
    const deepSims = await fetchPropSimulationsDeep(propPool, 64);
    for (const [k, v] of deepSims) propSims.set(k, v);
  }

  const gameSimulations = new Map<string, CoachGameSimEntry>();
  const ranked: Array<{ pick: ParsedPick; rankScore: number; isAlt: boolean }> = [];
  let totalScanned = 0;

  for (const o of realOdds) {
    totalScanned++;
    const isAlt = o.market.startsWith("Alt ");
    const pick = pickFromOdds(o);
    if (o.edge != null) (pick as ParsedPick & { edgeNum?: number }).edgeNum = o.edge;
    const score = rankScoreForPick(pick, propSims);
    if (score > 0 || (o.edge ?? 0) > 0) {
      ranked.push({ pick, rankScore: score, isAlt });
    }
  }

  for (const e of propPool) {
    totalScanned++;
    const pick = pickFromPoolEntry(e);
    const score = rankScoreForPick(pick, propSims);
    const minHit = propSims.get(
      propSimKey(e.player, e.marketKey ?? e.marketLabel, e.line!, e.side),
    );
    if ((e.edge ?? 0) > 0 || (minHit ?? 0) >= 0.52) {
      ranked.push({ pick, rankScore: score, isAlt: !!e.alt });
    }
  }

  ranked.sort((a, b) => b.rankScore - a.rankScore);
  const { picks, breakdown } = stageTicket(ranked, target);

  return {
    picks,
    evalLinesByGame,
    gameSimulations,
    totalScanned,
    totalQualified: ranked.length,
    staging: breakdown,
    note:
      picks.length >= target
        ? `Server precomputed ${picks.length} legs from ${totalScanned} scanned markets.`
        : `Server scan found ${picks.length} qualifying legs (${totalScanned} markets scanned).`,
  };
}

export async function enrichServerPropSims(
  built: BuiltChatContext,
): Promise<Map<string, { hitProbability: number | null }>> {
  const quick = await fetchQuickPropSims(built.propPool, 40);
  const out = new Map<string, { hitProbability: number | null }>();
  for (const [k, v] of quick) out.set(k, { hitProbability: v });
  return out;
}

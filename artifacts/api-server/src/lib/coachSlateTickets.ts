import {
  SLATE_PARLAY_SIZES,
  SLATE_PRE_ANALYSIS_TARGET,
  serializeBoardScan,
  type CoachGameSimEntry,
  type FullBoardScanResult,
  type ParsedPick,
  type RealOddsEntry,
  type SlateTicketsIndex,
} from "./coachSlateTypes.js";
import { dedupeServerCoachGameLinePicks } from "./coachSlateGameSideConsistency.js";

type RankedLeg = { pick: ParsedPick; rankScore: number; isAlt: boolean };

type StageTicketFn = (
  ranked: RankedLeg[],
  target: number,
) => { picks: ParsedPick[]; breakdown: FullBoardScanResult["staging"] };

function scanNote(target: number, picks: number, totalScanned: number, qualified: number): string {
  return picks >= target
    ? `Server precomputed ${picks} AI-simulated legs from ${totalScanned} posted markets (10k sim each).`
    : `Server scan: ${picks} AI Recommended legs after evaluating ${totalScanned} markets (${qualified} qualified) — no filler added.`;
}

function scanFromRanked(
  ranked: RankedLeg[],
  target: number,
  ctx: {
    evalLinesByGame: Map<string, RealOddsEntry[]>;
    gameSimulations: Map<string, CoachGameSimEntry>;
    totalScanned: number;
    matchupHistory?: Record<string, unknown>;
  },
  stageTicket: StageTicketFn,
): FullBoardScanResult {
  const sorted = [...ranked].sort((a, b) => b.rankScore - a.rankScore);
  const staged = stageTicket(sorted, target);
  const picks = dedupeServerCoachGameLinePicks(staged.picks, {
    simByGame: ctx.gameSimulations,
    matchupHistory: ctx.matchupHistory as
      | Record<string, { mlLean?: { side?: string } }>
      | undefined,
  });
  console.log(
    "[coach-ticket-trace] server-staged",
    JSON.stringify({
      requestedLegs: target,
      pickCount: picks.length,
      pickIds: picks.map((p) =>
        p.isProp
          ? `prop|${p.game}|${p.player}|${p.market}`
          : `game|${p.game}|${p.market}|${p.pick}`,
      ),
    }),
  );
  return {
    picks,
    evalLinesByGame: ctx.evalLinesByGame,
    gameSimulations: ctx.gameSimulations,
    totalScanned: ctx.totalScanned,
    totalQualified: sorted.length,
    staging: staged.breakdown,
    note: scanNote(target, picks.length, ctx.totalScanned, sorted.length),
    scanComplete: true,
    requestedLegs: target,
  };
}

/** Stage every supported parlay size from one ranked board — global + per sport. */
export function buildSlateTicketsIndex(
  ranked: RankedLeg[],
  ctx: {
    evalLinesByGame: Map<string, RealOddsEntry[]>;
    gameSimulations: Map<string, CoachGameSimEntry>;
    totalScanned: number;
    sports: string[];
    matchupHistory?: Record<string, unknown>;
  },
  stageTicket: StageTicketFn,
): SlateTicketsIndex {
  const sorted = [...ranked].sort((a, b) => b.rankScore - a.rankScore);
  const global: SlateTicketsIndex["global"] = {};
  const bySport: SlateTicketsIndex["bySport"] = {};

  for (const size of SLATE_PARLAY_SIZES) {
    const scan = scanFromRanked(sorted, size, ctx, stageTicket);
    if (scan.picks.length > 0) {
      global[size] = serializeBoardScan(scan);
    }
  }

  for (const sport of ctx.sports) {
    const sportRanked = sorted.filter((r) => r.pick.sport === sport);
    if (!sportRanked.length) continue;
    const sportTickets: Partial<Record<(typeof SLATE_PARLAY_SIZES)[number], ReturnType<typeof serializeBoardScan>>> =
      {};
    for (const size of SLATE_PARLAY_SIZES) {
      const scan = scanFromRanked(sportRanked, size, ctx, stageTicket);
      if (scan.picks.length > 0) {
        sportTickets[size] = serializeBoardScan(scan);
      }
    }
    if (Object.keys(sportTickets).length > 0) {
      bySport[sport] = sportTickets;
    }
  }

  return { global, bySport };
}

/** Primary 15-leg scan used as legacy boardScan field. */
export function primaryBoardScanFromRanked(
  ranked: RankedLeg[],
  ctx: {
    evalLinesByGame: Map<string, RealOddsEntry[]>;
    gameSimulations: Map<string, CoachGameSimEntry>;
    totalScanned: number;
    matchupHistory?: Record<string, unknown>;
  },
  stageTicket: StageTicketFn,
): FullBoardScanResult {
  return scanFromRanked(ranked, SLATE_PRE_ANALYSIS_TARGET, ctx, stageTicket);
}

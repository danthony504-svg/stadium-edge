import type { ParsedPick } from "@/components/PickCard";
import type { BuiltChatContext } from "./api.ts";
import type { TicketStagingBreakdown } from "./fullBoardMarketCopy.ts";
import type {
  SlateParlayLegCount,
  SerializedBoardScan,
  SlatePreAnalysisSnapshot,
  SlateTicketsIndex,
} from "./slatePreAnalysisCache.ts";
import type {
  CoachV2PickDisplay,
  CoachV2Shortfall,
  CoachV2Snapshot,
  CoachV2Ticket,
} from "./coachV2Types.ts";

function formatEdge(edgePct: number): string {
  const sign = edgePct >= 0 ? "+" : "";
  return `${sign}${edgePct.toFixed(1)}%`;
}

export function coachV2PickToParsedPick(pick: CoachV2PickDisplay): ParsedPick {
  return {
    game: pick.game,
    market: pick.market,
    pick: pick.pick,
    odds: pick.odds,
    edge: formatEdge(pick.edgePct),
    sport: String(pick.sport),
    isProp: pick.isProp,
    startsAt: pick.startsAt,
    player: pick.player ?? undefined,
    propLine: pick.propLine ?? null,
    propSide: pick.propSide ?? undefined,
    propIsAlt: pick.propIsAlt,
    headshot: pick.headshot ?? null,
    teamAbbr: pick.teamAbbr ?? null,
    teamLogo: pick.teamLogo ?? null,
    finalAiScore: {
      composite: pick.compositeScore,
      grade: pick.grade,
      simHit: pick.simHitPct,
    },
  };
}

function emptyBuilt(activeSports: string[]): BuiltChatContext {
  const sports = activeSports.length ? activeSports : ["mlb"];
  return {
    context: {
      selectedSports: sports,
      currentSlip: [],
      realGames: [],
      realOdds: [],
      realProps: [],
    },
    propPool: [],
    gameMeta: [],
    upsetSpots: [],
    todayOnly: false,
    tomorrowOnly: false,
  };
}

function stagingFromTicket(ticket: CoachV2Ticket): TicketStagingBreakdown {
  const altOnTicket = ticket.picks.filter((p) => p.propIsAlt).length;
  const mainOnTicket = ticket.deliveredLegs - altOnTicket;
  return {
    mainQualified: ticket.propCount + ticket.gameLineCount,
    altQualified: altOnTicket,
    mainOnTicket,
    altOnTicket,
  };
}

export function coachV2TicketToBoardScan(
  ticket: CoachV2Ticket,
  snapshot: CoachV2Snapshot,
  shortfall?: CoachV2Shortfall | null,
): SerializedBoardScan {
  const note =
    shortfall?.message ??
    (ticket.deliveredLegs < ticket.requestedLegs
      ? `Only ${ticket.deliveredLegs} legs passed all AI gates. No filler picks added.`
      : "");
  return {
    picks: ticket.picks.map(coachV2PickToParsedPick),
    evalLinesByGame: {},
    gameSimulations: {},
    totalScanned: snapshot.manifest.candidatesEvaluated,
    totalQualified: snapshot.manifest.gatesPassed,
    staging: stagingFromTicket(ticket),
    note,
    scanComplete: snapshot.manifest.scanComplete,
  };
}

function convertTicketsIndex(snapshot: CoachV2Snapshot): SlateTicketsIndex {
  const global: SlateTicketsIndex["global"] = {};
  for (const [size, ticket] of Object.entries(snapshot.tickets.global ?? {})) {
    if (!ticket) continue;
    global[Number(size) as SlateParlayLegCount] = coachV2TicketToBoardScan(ticket, snapshot);
  }
  const bySport: SlateTicketsIndex["bySport"] = {};
  for (const [sport, sizes] of Object.entries(snapshot.tickets.bySport ?? {})) {
    const sportTickets: Partial<Record<SlateParlayLegCount, SerializedBoardScan>> = {};
    for (const [size, ticket] of Object.entries(sizes ?? {})) {
      if (!ticket) continue;
      sportTickets[Number(size) as SlateParlayLegCount] = coachV2TicketToBoardScan(ticket, snapshot);
    }
    if (Object.keys(sportTickets).length) bySport[sport] = sportTickets;
  }
  return { global, bySport };
}

/** Adapt server v2 snapshot into legacy mobile cache shape for coach.tsx. */
export function coachV2SnapshotToLegacy(snapshot: CoachV2Snapshot): SlatePreAnalysisSnapshot {
  const tickets = convertTicketsIndex(snapshot);
  const defaultSize = Object.keys(tickets.global ?? {})
    .map(Number)
    .sort((a, b) => b - a)[0];
  const boardScan =
    defaultSize != null ? tickets.global?.[defaultSize as SlateParlayLegCount] ?? null : null;

  return {
    at: snapshot.at,
    fingerprint: snapshot.fingerprint,
    built: emptyBuilt(snapshot.activeSports.map(String)),
    propSimulations: snapshot.tickets.global
      ? Object.values(snapshot.tickets.global).flatMap((ticket) =>
          (ticket?.picks ?? []).map(
            (p) =>
              [
                `${p.game}|${p.market}|${p.pick}`,
                { hitProbability: p.simHitPct / 100 },
              ] as const,
          ),
        )
      : [],
    boardScan,
    tickets,
    activeSports: snapshot.activeSports.map(String),
    deepSimComplete: snapshot.deepSimComplete,
  };
}

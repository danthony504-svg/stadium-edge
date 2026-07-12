/** Types mirroring stadium-mobile/lib/slatePreAnalysisCache.ts for cross-client snapshots. */

export const SLATE_PRE_ANALYSIS_TARGET = 9;
export const SLATE_PRE_ANALYSIS_MAX_MS = 15 * 60_000;
export const COACH_SLATE_ROW_ID = "global";

export type ParsedPick = {
  game: string;
  market: string;
  pick: string;
  odds: number;
  edge?: string;
  sport?: string;
  isProp?: boolean;
  startsAt?: string | null;
  headshot?: string | null;
  teamLogo?: string | null;
  teamAbbr?: string | null;
  awayLogo?: string | null;
  homeLogo?: string | null;
  awayAbbr?: string | null;
  homeAbbr?: string | null;
  propIsAlt?: boolean;
  player?: string;
  athleteId?: string | null;
  propMarketKey?: string;
  propLine?: number | null;
  propSide?: string;
  ticketRole?: "main" | "alt";
  highRiskValuePlay?: boolean;
  scores?: { composite?: number | null };
  finalAiScore?: { composite?: number | null; grade?: string | null };
};

export type RealOddsEntry = {
  sport: string;
  game: string;
  market: string;
  pick: string;
  odds: number;
  startsAt?: string;
  noVigFair?: number | null;
  edge?: number | null;
  bookSpread?: number | null;
};

export type RealPropEntry = {
  sport: string;
  game: string;
  startsAt?: string;
  player: string;
  athleteId?: string | null;
  market: string;
  line: number | null;
  over: number | null;
  under: number | null;
  alt?: boolean;
  ev?: number | null;
  evSide?: string | null;
  fairProb?: number | null;
  edge?: number | null;
  simHitPct?: number;
  selectionScore?: number;
};

export type PropPoolEntry = {
  sport: string;
  game: string;
  marketLabel: string;
  player: string;
  line: number | null;
  side: "Over" | "Under";
  odds: number;
  headshot?: string | null;
  teamAbbr?: string | null;
  athleteId?: string | null;
  marketKey?: string;
  alt?: boolean;
  edge?: number | null;
  bookSpread?: number | null;
  startsAt?: string;
};

export type GameMeta = {
  game: string;
  sport: string;
  startsAt?: string;
  homeAbbr?: string | null;
  awayAbbr?: string | null;
  homeLogo?: string | null;
  awayLogo?: string | null;
};

export type BuiltChatContext = {
  context: {
    selectedSports: string[];
    currentSlip: unknown[];
    realGames: Array<{ sport: string; game: string; status?: string; startsAt?: string }>;
    realOdds: RealOddsEntry[];
    realProps: RealPropEntry[];
    matchupHistory?: Record<string, unknown>;
    matchupInjuries?: Record<string, unknown>;
    playerHistory?: Record<string, unknown>;
  };
  propPool: PropPoolEntry[];
  gameMeta: GameMeta[];
  upsetSpots: unknown[];
  todayOnly: boolean;
  tomorrowOnly: boolean;
};

export type TicketStagingBreakdown = {
  mainQualified: number;
  altQualified: number;
  mainOnTicket: number;
  altOnTicket: number;
};

export type CoachGameSimEntry = {
  winProbHome?: number | null;
  winProbAway?: number | null;
  coverProbs?: Record<string, number | null>;
};

export type SerializedBoardScan = {
  picks: ParsedPick[];
  evalLinesByGame: Record<string, RealOddsEntry[]>;
  gameSimulations: Record<string, CoachGameSimEntry>;
  totalScanned: number;
  totalQualified: number;
  staging: TicketStagingBreakdown;
  note: string;
};

export type SlatePreAnalysisSnapshot = {
  at: number;
  fingerprint: string;
  built: BuiltChatContext;
  propSimulations: Array<[string, { hitProbability: number | null }]>;
  boardScan: SerializedBoardScan | null;
  deepSimComplete: boolean;
};

export type FullBoardScanResult = {
  picks: ParsedPick[];
  evalLinesByGame: Map<string, RealOddsEntry[]>;
  gameSimulations: Map<string, CoachGameSimEntry>;
  totalScanned: number;
  totalQualified: number;
  staging: TicketStagingBreakdown;
  note: string;
};

export function computeSlateFingerprint(built: BuiltChatContext): string {
  const { context, propPool } = built;
  const odds = context.realOdds ?? [];
  const kickoffs = odds
    .map((o) => o.startsAt ?? "")
    .filter(Boolean)
    .sort()
    .slice(0, 24)
    .join("|");
  const prices = odds
    .slice(0, 40)
    .map((o) => `${o.game}:${o.market}:${o.odds}`)
    .join(";");
  return `${odds.length}:${propPool.length}:${kickoffs}:${prices}`;
}

export function serializeBoardScan(scan: FullBoardScanResult): SerializedBoardScan {
  const evalLinesByGame: Record<string, RealOddsEntry[]> = {};
  for (const [game, lines] of scan.evalLinesByGame) {
    evalLinesByGame[game] = lines;
  }
  const gameSimulations: Record<string, CoachGameSimEntry> = {};
  for (const [game, sim] of scan.gameSimulations) {
    gameSimulations[game] = sim;
  }
  return {
    picks: scan.picks,
    evalLinesByGame,
    gameSimulations,
    totalScanned: scan.totalScanned,
    totalQualified: scan.totalQualified,
    staging: scan.staging,
    note: scan.note,
  };
}

export function isSlateSnapshotFresh(
  snapshot: SlatePreAnalysisSnapshot | null,
  maxMs = SLATE_PRE_ANALYSIS_MAX_MS,
): boolean {
  if (!snapshot) return false;
  return Date.now() - snapshot.at <= maxMs;
}

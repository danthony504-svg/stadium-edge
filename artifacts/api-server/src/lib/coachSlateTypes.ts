/** Types mirroring stadium-mobile/lib/slatePreAnalysisCache.ts for cross-client snapshots. */

/** Precompute enough legs for instant 15-leg longshot asks — no filler. */
export const SLATE_PRE_ANALYSIS_TARGET = 15;
/** Supported parlay sizes precomputed 24/7 — global + per-sport. */
export const SLATE_PARLAY_SIZES = [3, 4, 5, 6, 8, 9, 10, 15] as const;
export type SlateParlayLegCount = (typeof SLATE_PARLAY_SIZES)[number];
export const SLATE_PRE_ANALYSIS_MAX_MS = 15 * 60_000;
/** Serve slightly stale snapshots for instant Coach load while a refresh runs. */
export const SLATE_INSTANT_SERVE_MAX_MS = 30 * 60_000;
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
  scores?: {
    composite?: number | null;
    grade?: string | null;
    confidencePct?: number | null;
    edgePct?: number | null;
    simHit?: number | null;
  };
  finalAiScore?: {
    composite?: number | null;
    grade?: string | null;
    simHit?: number | null;
    confidencePct?: number | null;
    edgePct?: number | null;
  };
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
  scanComplete?: boolean;
  requestedLegs?: number;
};

export type SlateTicketsIndex = {
  /** Cross-sport combined tickets keyed by leg count. */
  global: Partial<Record<SlateParlayLegCount, SerializedBoardScan>>;
  /** Per-sport tickets keyed by leg count. */
  bySport: Partial<Record<string, Partial<Record<SlateParlayLegCount, SerializedBoardScan>>>>;
};

export type SlatePreAnalysisSnapshot = {
  at: number;
  fingerprint: string;
  built: BuiltChatContext;
  propSimulations: Array<[string, { hitProbability: number | null }]>;
  boardScan: SerializedBoardScan | null;
  /** Pre-staged tickets for every supported parlay size (global + per sport). */
  tickets?: SlateTicketsIndex | null;
  /** Sports included in this snapshot (for client sport routing). */
  activeSports?: string[];
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
  scanComplete?: boolean;
  requestedLegs?: number;
};

export function computeSlateFingerprint(
  built: BuiltChatContext,
  opts?: { injuryDigest?: string; gameStatusDigest?: string },
): string {
  const { context, propPool } = built;
  const odds = context.realOdds ?? [];
  const kickoffs = odds
    .map((o) => o.startsAt ?? "")
    .filter(Boolean)
    .sort()
    .slice(0, 32)
    .join("|");
  const prices = odds
    .slice(0, 80)
    .map((o) => `${o.game}:${o.market}:${o.pick}:${o.odds}`)
    .join(";");
  const inj = opts?.injuryDigest ?? "";
  const status = opts?.gameStatusDigest ?? "";
  return `${odds.length}:${propPool.length}:${kickoffs}:${prices}:${inj}:${status}`;
}

export function isSlateSnapshotInstantServe(
  snapshot: SlatePreAnalysisSnapshot | null,
  maxMs = SLATE_INSTANT_SERVE_MAX_MS,
): boolean {
  if (!snapshot) return false;
  return Date.now() - snapshot.at <= maxMs;
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
    scanComplete: scan.scanComplete ?? true,
    requestedLegs: scan.requestedLegs ?? scan.picks.length,
  };
}

export function isSlateSnapshotFresh(
  snapshot: SlatePreAnalysisSnapshot | null,
  maxMs = SLATE_PRE_ANALYSIS_MAX_MS,
): boolean {
  if (!snapshot) return false;
  return Date.now() - snapshot.at <= maxMs;
}

/** Pick the nearest precomputed ticket size at or below the requested leg count. */
export function nearestSlateParlaySize(requested: number): SlateParlayLegCount {
  const capped = Math.min(Math.max(3, Math.round(requested)), SLATE_PRE_ANALYSIS_TARGET);
  let best: SlateParlayLegCount = SLATE_PARLAY_SIZES[0];
  for (const size of SLATE_PARLAY_SIZES) {
    if (size <= capped) best = size;
    else break;
  }
  return best;
}

/** Resolve the best precomputed board scan for a leg count and optional sport filter. */
export function resolveSlateBoardScan(
  snapshot: SlatePreAnalysisSnapshot,
  opts?: { legs?: number; sport?: string | null },
): SerializedBoardScan | null {
  const legs = opts?.legs ?? SLATE_PRE_ANALYSIS_TARGET;
  const size = nearestSlateParlaySize(legs);
  const sport = opts?.sport?.toLowerCase().trim() || null;

  const tickets = snapshot.tickets;
  if (tickets) {
    if (sport && tickets.bySport?.[sport]?.[size]) {
      return tickets.bySport[sport]![size]!;
    }
    if (tickets.global?.[size]) {
      return tickets.global[size]!;
    }
  }

  if (snapshot.boardScan?.picks?.length === legs) return snapshot.boardScan;
  return null;
}

const PREMIUM_PICK_MASK = "••••••";

type GradeKeep = {
  composite?: number | null;
  grade?: string | null;
  confidencePct?: number | null;
  edgePct?: number | null;
  simHit?: number | null;
};

/** Keep teaser metrics only — never invent confidence/edge when absent. */
function keepGradeSlice(src: GradeKeep | null | undefined): GradeKeep | undefined {
  if (!src || typeof src !== "object") return undefined;
  return {
    composite: src.composite ?? null,
    grade: src.grade ?? null,
    confidencePct: src.confidencePct ?? null,
    edgePct: src.edgePct ?? null,
    simHit: src.simHit ?? null,
  };
}

/**
 * Strip identity / lines / odds for non-subscribers.
 * Keep AI grade / confidence / edge metrics for the teaser strip.
 * Aligned with stadium-mobile `redactPremiumPickFields`.
 */
export function redactPremiumPickForClient(pick: ParsedPick): ParsedPick {
  const grade = pick.finalAiScore;
  const scores = pick.scores;
  return {
    game: PREMIUM_PICK_MASK,
    market: pick.market,
    pick: PREMIUM_PICK_MASK,
    odds: 0,
    sport: pick.sport,
    isProp: pick.isProp,
    startsAt: null,
    headshot: null,
    teamLogo: null,
    teamAbbr: null,
    awayLogo: null,
    homeLogo: null,
    awayAbbr: null,
    homeAbbr: null,
    player: undefined,
    athleteId: null,
    // Clear market keys that can re-identify a prop selection.
    propMarketKey: undefined,
    propLine: null,
    propSide: undefined,
    edge: undefined,
    propIsAlt: undefined,
    ticketRole: undefined,
    highRiskValuePlay: undefined,
    scores: keepGradeSlice(scores) ?? keepGradeSlice(grade),
    finalAiScore: keepGradeSlice(grade),
  };
}

function redactBoardScan(scan: SerializedBoardScan | null): SerializedBoardScan | null {
  if (!scan) return null;
  return {
    ...scan,
    picks: (scan.picks ?? []).map(redactPremiumPickForClient),
    // Identity-bearing ladders / sims stay empty for non-subscribers.
    evalLinesByGame: {},
    gameSimulations: {},
    note: scan.note,
  };
}

const EMPTY_BUILT_CONTEXT: BuiltChatContext["context"] = {
  selectedSports: [],
  currentSlip: [],
  realGames: [],
  realOdds: [],
  realProps: [],
};

/**
 * Redact identity-bearing built context for non-subscribers.
 * Tolerates malformed / partial snapshots so free-user reads never 500.
 */
function redactBuiltContext(built: BuiltChatContext | null | undefined): BuiltChatContext {
  const ctx =
    built && typeof built === "object" && built.context && typeof built.context === "object"
      ? built.context
      : EMPTY_BUILT_CONTEXT;
  const propPool = Array.isArray(built?.propPool) ? built!.propPool : [];
  const gameMeta = Array.isArray(built?.gameMeta) ? built!.gameMeta : [];
  return {
    upsetSpots: Array.isArray(built?.upsetSpots) ? built!.upsetSpots : [],
    todayOnly: built?.todayOnly === true,
    tomorrowOnly: built?.tomorrowOnly === true,
    context: {
      ...EMPTY_BUILT_CONTEXT,
      ...ctx,
      selectedSports: Array.isArray(ctx.selectedSports) ? ctx.selectedSports : [],
      currentSlip: Array.isArray(ctx.currentSlip) ? ctx.currentSlip : [],
      realOdds: (Array.isArray(ctx.realOdds) ? ctx.realOdds : []).map((o) => ({
        sport: o?.sport ?? "",
        game: PREMIUM_PICK_MASK,
        market: o?.market ?? "",
        pick: PREMIUM_PICK_MASK,
        odds: 0,
        startsAt: undefined,
        noVigFair: null,
        edge: null,
        bookSpread: null,
      })),
      realProps: (Array.isArray(ctx.realProps) ? ctx.realProps : []).map((p) => ({
        sport: p?.sport ?? "",
        game: PREMIUM_PICK_MASK,
        startsAt: undefined,
        player: PREMIUM_PICK_MASK,
        athleteId: null,
        market: p?.market ?? "",
        line: null,
        over: null,
        under: null,
        alt: p?.alt,
        ev: null,
        evSide: null,
        fairProb: null,
        edge: null,
        simHitPct: undefined,
        selectionScore: undefined,
      })),
      realGames: (Array.isArray(ctx.realGames) ? ctx.realGames : []).map((g) => ({
        sport: g?.sport ?? "",
        game: PREMIUM_PICK_MASK,
        status: g?.status,
        startsAt: undefined,
      })),
    },
    propPool: propPool.map((p) => ({
      ...p,
      game: PREMIUM_PICK_MASK,
      player: PREMIUM_PICK_MASK,
      line: null,
      odds: 0,
      edge: null,
      bookSpread: null,
      startsAt: undefined,
      headshot: null,
      teamAbbr: null,
      athleteId: null,
      side: p?.side ?? "Over",
    })),
    gameMeta: gameMeta.map((g) => ({
      game: PREMIUM_PICK_MASK,
      sport: g?.sport ?? "",
      startsAt: undefined,
      homeAbbr: null,
      awayAbbr: null,
      homeLogo: null,
      awayLogo: null,
    })),
  };
}

/**
 * Client-facing snapshot with boardScan resolved to the requested ticket.
 * When `premiumUnlocked` is false, pick sides/lines/odds/grades/sims are redacted.
 * Never throws on malformed snapshot rows — returns a safe empty redacted shell.
 */
export function snapshotForClient(
  snapshot: SlatePreAnalysisSnapshot,
  opts?: { legs?: number; sport?: string | null; premiumUnlocked?: boolean },
): SlatePreAnalysisSnapshot {
  try {
    if (!snapshot || typeof snapshot !== "object") {
      return emptyRedactedSnapshot();
    }
    const boardScan = resolveSlateBoardScan(snapshot, opts);
    if (opts?.premiumUnlocked) {
      return { ...snapshot, boardScan };
    }
    let tickets: SlateTicketsIndex | null | undefined = snapshot.tickets;
    if (snapshot.tickets) {
      const global: SlateTicketsIndex["global"] = {};
      for (const [k, v] of Object.entries(snapshot.tickets.global ?? {})) {
        const size = Number(k) as SlateParlayLegCount;
        global[size] = redactBoardScan(v ?? null) ?? undefined;
      }
      const bySport: SlateTicketsIndex["bySport"] = {};
      for (const [sport, byLegs] of Object.entries(snapshot.tickets.bySport ?? {})) {
        if (!byLegs || typeof byLegs !== "object") continue;
        const next: Partial<Record<SlateParlayLegCount, SerializedBoardScan>> = {};
        for (const [k, v] of Object.entries(byLegs ?? {})) {
          const size = Number(k) as SlateParlayLegCount;
          next[size] = redactBoardScan(v ?? null) ?? undefined;
        }
        bySport[sport] = next;
      }
      tickets = { global, bySport };
    }
    return {
      ...snapshot,
      built: redactBuiltContext(snapshot.built),
      propSimulations: [],
      boardScan: redactBoardScan(boardScan),
      tickets: tickets ?? null,
    };
  } catch {
    // Fail closed on identity: never surface a partial/raw snapshot after a redact error.
    return emptyRedactedSnapshot(snapshot);
  }
}

function emptyRedactedSnapshot(
  seed?: SlatePreAnalysisSnapshot | null,
): SlatePreAnalysisSnapshot {
  return {
    at: typeof seed?.at === "number" ? seed.at : 0,
    fingerprint: typeof seed?.fingerprint === "string" ? seed.fingerprint : "",
    built: redactBuiltContext(seed?.built),
    propSimulations: [],
    boardScan: null,
    tickets: null,
    activeSports: Array.isArray(seed?.activeSports) ? seed!.activeSports : [],
    deepSimComplete: false,
  };
}

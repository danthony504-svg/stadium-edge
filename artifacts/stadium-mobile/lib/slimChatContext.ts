/** Upload-only slimming for Coach /api/chat POST bodies. Local propPool stays full. */

type SlimMatchupEntry = {
  home: unknown;
  away: unknown;
  homePace: number | null;
  awayPace: number | null;
  homeVenueForm: unknown;
  awayVenueForm: unknown;
  homeStreak: unknown;
  awayStreak: unknown;
  homeSeason: unknown;
  awaySeason: unknown;
  homeRest: unknown;
  awayRest: unknown;
  h2h: unknown;
  lastMeeting: unknown;
  mlLean: { side: string; edge: number; reasons: string[]; upset?: { dogOdds: number } } | null;
};

export type SlimChatContextInput = {
  selectedSports: string[];
  currentSlip: { game: string; market: string; pick: string; odds: number }[];
  realGames: unknown[];
  realOdds: {
    sport: string;
    game: string;
    market: string;
    pick: string;
    odds: number;
    startsAt?: string;
    noVigFair?: number | null;
    edge?: number | null;
    bookSpread?: number | null;
  }[];
  realProps: {
    sport: string;
    game: string;
    startsAt: string;
    player: string;
    athleteId?: string | null;
    market: string;
    line: number | null;
    over: number | null;
    under: number | null;
    alt: boolean;
    ev?: number | null;
    evSide?: "Over" | "Under" | null;
    fairProb?: number | null;
    edge?: number | null;
    simHitPct?: number | null;
    selectionScore?: number | null;
  }[];
  matchupHistory?: Record<string, SlimMatchupEntry>;
  fightAnalysis?: Record<string, unknown>;
  tennisAnalysis?: Record<string, unknown>;
  playerHistory?: Record<string, unknown>;
  mlbPlatoon?: Record<string, unknown>;
  mlbGameEnv?: Record<string, unknown>;
  modelStrengths?: string[];
  matchupInjuries?: Record<string, unknown>;
};

type SlimProp = SlimChatContextInput["realProps"][number];

function stripPropUploadFields(p: SlimProp): SlimProp {
  // Keep edge + pre-build selection signals for the model; drop verbose EV internals.
  const { ev: _ev, evSide: _es, fairProb: _fp, ...rest } = p;
  return rest;
}

/** Mains first, then capped alt ladder rungs — keeps upload size bounded but honest. */
function slimRealPropsForUpload(
  props: SlimProp[],
  opts?: { maxMains?: number; maxAlts?: number },
): SlimProp[] {
  const maxMains = opts?.maxMains ?? Number.POSITIVE_INFINITY;
  const maxAlts = opts?.maxAlts ?? 48;
  const mains = props.filter((p) => !p.alt).map(stripPropUploadFields).slice(0, maxMains);
  const alts = props.filter((p) => p.alt).map(stripPropUploadFields).slice(0, maxAlts);
  return [...mains, ...alts];
}

export function slimChatContextForUpload<T extends SlimChatContextInput>(context: T): T {
  const slimMatchup: Record<string, SlimMatchupEntry> = {};
  if (context.matchupHistory) {
    for (const [k, m] of Object.entries(context.matchupHistory)) {
      slimMatchup[k] = {
        home: null,
        away: null,
        homePace: m.homePace,
        awayPace: m.awayPace,
        homeVenueForm: null,
        awayVenueForm: null,
        homeStreak: null,
        awayStreak: null,
        homeSeason: null,
        awaySeason: null,
        homeRest: null,
        awayRest: null,
        h2h: null,
        lastMeeting: m.lastMeeting,
        mlLean: m.mlLean,
      };
    }
  }
  const slimHistory: Record<string, unknown> = {};
  if (context.playerHistory) {
    for (const [k, raw] of Object.entries(context.playerHistory)) {
      const h = raw as {
        player?: string;
        recent?: unknown[];
        vsOpponent?: unknown[];
      };
      slimHistory[k] = {
        player: h.player,
        recent: Array.isArray(h.recent) ? h.recent.slice(0, 5) : [],
        ...(Array.isArray(h.vsOpponent) && h.vsOpponent.length
          ? { vsOpponent: h.vsOpponent.slice(0, 2) }
          : {}),
      };
    }
  }
  const slimOdds = context.realOdds.map(
    ({ noVigFair: _nf, edge: _e, bookSpread: _bs, ...rest }) => rest,
  );
  const slimProps = slimRealPropsForUpload(context.realProps);
  const hasUfc = context.selectedSports?.includes("ufc");
  const hasTennis = context.selectedSports?.includes("tennis");
  return {
    ...context,
    realGames: [],
    realOdds: slimOdds,
    realProps: slimProps,
    matchupHistory: Object.keys(slimMatchup).length ? slimMatchup : context.matchupHistory,
    playerHistory: Object.keys(slimHistory).length ? slimHistory : context.playerHistory,
    fightAnalysis: hasUfc ? context.fightAnalysis : undefined,
    tennisAnalysis: hasTennis ? context.tennisAnalysis : undefined,
    mlbPlatoon: undefined,
    mlbGameEnv: undefined,
    matchupInjuries: undefined,
  };
}

/** Emergency upload tier when inline POST still connect-stalls — caps pool size. */
export function ultraSlimChatContextForUpload<T extends SlimChatContextInput>(context: T): T {
  const slim = slimChatContextForUpload(context);
  const slimOdds = slim.realOdds.slice(0, 24);
  const slimProps = slim.realProps.slice(0, 36);
  const slimMatchup: Record<string, SlimMatchupEntry> = {};
  if (slim.matchupHistory) {
    for (const [k, m] of Object.entries(slim.matchupHistory).slice(0, 3)) {
      slimMatchup[k] = {
        home: null,
        away: null,
        homePace: m.homePace,
        awayPace: m.awayPace,
        homeVenueForm: null,
        awayVenueForm: null,
        homeStreak: null,
        awayStreak: null,
        homeSeason: null,
        awaySeason: null,
        homeRest: null,
        awayRest: null,
        h2h: null,
        lastMeeting: null,
        mlLean: m.mlLean,
      };
    }
  }
  return {
    ...slim,
    realOdds: slimOdds,
    realProps: slimProps,
    matchupHistory: Object.keys(slimMatchup).length ? slimMatchup : undefined,
    playerHistory: undefined,
    fightAnalysis: undefined,
    tennisAnalysis: undefined,
    modelStrengths: slim.modelStrengths,
  };
}

/** Smallest upload tier for 2-3 leg generic parlays — keeps POST under ~10KB. */
export function microSlimChatContextForUpload<T extends SlimChatContextInput>(context: T): T {
  const ultra = ultraSlimChatContextForUpload(context);
  return {
    ...ultra,
    selectedSports: ultra.selectedSports?.slice(0, 4),
    realOdds: ultra.realOdds.slice(0, 16),
    realProps: slimRealPropsForUpload(ultra.realProps, { maxMains: 14, maxAlts: 6 }),
    matchupHistory: undefined,
    modelStrengths: undefined,
    fightAnalysis: undefined,
    tennisAnalysis: undefined,
    playerHistory: undefined,
    realGames: [],
  };
}

/** Props-only parlay upload — wide prop pool, almost no game-odds payload. */
export function propsOnlySlimChatContextForUpload<T extends SlimChatContextInput>(context: T): T {
  const micro = microSlimChatContextForUpload(context);
  return {
    ...micro,
    realOdds: micro.realOdds.slice(0, 4),
    realProps: slimRealPropsForUpload(micro.realProps, { maxMains: 32, maxAlts: 10 }),
  };
}

/** Soccer scorer vs goalkeeper picks — keep a wide prop board in the upload. */
export function soccerScorerGkSlimChatContextForUpload<T extends SlimChatContextInput>(context: T): T {
  const slim = slimChatContextForUpload(context);
  return {
    ...slim,
    selectedSports: ["soccer"],
    realOdds: slim.realOdds.slice(0, 8),
    realProps: slimRealPropsForUpload(slim.realProps, { maxMains: 48, maxAlts: 16 }),
    matchupHistory: undefined,
    playerHistory: undefined,
    modelStrengths: undefined,
    fightAnalysis: undefined,
    tennisAnalysis: undefined,
    realGames: slim.realGames.slice(0, 12),
  };
}

/** Upload tier for 4-8 leg generic parlays — wider pool than micro, still under ~20KB. */
export function compactSlimChatContextForUpload<T extends SlimChatContextInput>(context: T): T {
  const slim = slimChatContextForUpload(context);
  return {
    ...slim,
    selectedSports: slim.selectedSports?.slice(0, 4),
    realOdds: slim.realOdds.slice(0, 32),
    realProps: slimRealPropsForUpload(slim.realProps, { maxMains: 40, maxAlts: 16 }),
    matchupHistory: undefined,
    modelStrengths: undefined,
    fightAnalysis: undefined,
    tennisAnalysis: undefined,
    playerHistory: undefined,
    mlbPlatoon: undefined,
    mlbGameEnv: undefined,
    matchupInjuries: undefined,
    realGames: [],
  };
}

/** Upload tier for 9-15 leg generic parlays — enough breadth for big tickets, still cellular-safe. */
export function largeCompactSlimChatContextForUpload<T extends SlimChatContextInput>(context: T): T {
  const slim = slimChatContextForUpload(context);
  return {
    ...slim,
    selectedSports: slim.selectedSports?.slice(0, 6),
    realOdds: slim.realOdds.slice(0, 48),
    realProps: slimRealPropsForUpload(slim.realProps, { maxMains: 56, maxAlts: 24 }),
    matchupHistory: undefined,
    modelStrengths: undefined,
    fightAnalysis: undefined,
    tennisAnalysis: undefined,
    playerHistory: undefined,
    mlbPlatoon: undefined,
    mlbGameEnv: undefined,
    matchupInjuries: undefined,
    realGames: [],
  };
}

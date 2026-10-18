/**
 * Authoritative ESPN home/away team-id resolution for /sports/props.
 *
 * Fail-closed: exact normalized full-name (or exact abbr) match with correct
 * home/away orientation only. No fuzzy includes / nickname guessing.
 * Caller-supplied ids are accepted only when they match the resolved event.
 *
 * Sport isolation: NFL and NCAAF are separate families. An NCAAF Odds event /
 * ESPN scoreboard row must never resolve under sport=nfl (and vice versa) —
 * that surfaces as status `unresolved`, not a cross-sport bind. ESPN team ids
 * are NOT globally unique across sports (e.g. id "30" is JAX in NFL and USC
 * in college-football); callers must keep ESPN_SPORT_PATHS[sport] when loading
 * rosters so propBelongsToGameTeams compares ids inside one sport namespace.
 *
 * propBelongsToGameTeams stays the final player-level gate — this module only
 * supplies validated matchup team ids (or refuses to).
 */

import {
  espnCompetitorAbbr,
  espnCompetitorId,
  espnCompetitorName,
  resolveEspnCompetitorSides,
  type EspnTeamCompetitor,
} from "./espnCompetitors.js";
import {
  espnScoreboardDayKeys,
  mergeEspnEventsById,
} from "./espnScoreboardWindow.js";
import {
  ESPN_SOCCER_SCOREBOARD_PATHS,
  ESPN_SPORT_PATHS,
  cachedJson,
} from "./sports.js";

/**
 * Closed exact aliases (normalized form → canonical), scoped by sport family.
 * Not fuzzy — only whole-token renames that Odds and ESPN both use as the
 * full display string (or official abbr) for that sport.
 */
const EXACT_TEAM_ALIASES_BY_SPORT: Record<string, Record<string, string>> = {
  nfl: {
    washingtonfootballteam: "washingtoncommanders",
    washingtoncommanders: "washingtoncommanders",
    lavrams: "losangelesrams",
    larams: "losangelesrams",
    lachargers: "losangeleschargers",
    nyg: "newyorkgiants",
    nyj: "newyorkjets",
  },
};

export type PropEventTeamIdentityStatus =
  | "resolved"
  | "unresolved"
  | "caller_conflict"
  | "no_provider_props"
  | "team_filtered";

export type PropEspnGameRow = {
  id: string;
  sport: string;
  homeTeam: string | null;
  awayTeam: string | null;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeAbbr: string | null;
  awayAbbr: string | null;
  startsAt: string;
};

export type PropEventTeamIdentityDiag = {
  status: PropEventTeamIdentityStatus;
  reason: string;
  sport: string;
  oddsEventId: string | null;
  espnEventId: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  homeTeamId: string | null;
  awayTeamId: string | null;
  callerHomeTeamId: string | null;
  callerAwayTeamId: string | null;
  source: "espn_scoreboard" | null;
  preGateCount: number | null;
  postGateCount: number | null;
  rejectedUnassignedOrForeign: number | null;
};

export type ResolvePropEventTeamIdentityArgs = {
  sport: string;
  oddsEventId: string;
  /** Odds API home_team (authoritative orientation). */
  homeTeam: string;
  /** Odds API away_team (authoritative orientation). */
  awayTeam: string;
  startsAt?: string | null;
  callerHomeTeamId?: string | null;
  callerAwayTeamId?: string | null;
  /** Injected games for tests; production loads ESPN scoreboard. */
  espnGames?: PropEspnGameRow[];
};

export type ResolvePropEventTeamIdentityResult = {
  ok: boolean;
  homeTeamId: string | null;
  awayTeamId: string | null;
  espnEventId: string | null;
  diag: PropEventTeamIdentityDiag;
};

export function normalizePropTeamToken(s: string): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function canonicalTeamToken(s: string, sport?: string): string {
  const n = normalizePropTeamToken(s);
  if (!n) return "";
  const family = sport ? sportFamily(sport) : "";
  const aliases = family ? EXACT_TEAM_ALIASES_BY_SPORT[family] : undefined;
  return aliases?.[n] ?? n;
}

function sportFamily(sport: string): string {
  const n = String(sport ?? "")
    .toLowerCase()
    .trim();
  if (n === "nfl" || n.includes("americanfootball_nfl")) return "nfl";
  if (n === "ncaaf" || n === "cfb" || n.includes("americanfootball_ncaaf")) return "ncaaf";
  if (n.startsWith("soccer") || n.includes("soccer_")) return "soccer";
  return n;
}

/** Exact full-name or exact-abbr match with required home/away orientation. */
export function matchEspnGameForOddsEvent(
  games: PropEspnGameRow[],
  args: {
    sport: string;
    homeTeam: string;
    awayTeam: string;
    startsAt?: string | null;
  },
): { game: PropEspnGameRow; via: "full_name" | "abbr" } | null {
  const sport = String(args.sport ?? "")
    .toLowerCase()
    .trim();
  if (!sport) return null;
  const wantHome = canonicalTeamToken(args.homeTeam, sport);
  const wantAway = canonicalTeamToken(args.awayTeam, sport);
  if (!wantHome || !wantAway) return null;
  if (wantHome === wantAway) return null;

  const family = sportFamily(sport);
  const pool = games.filter((g) => {
    if (!g.homeTeamId || !g.awayTeamId) return false;
    const gs = String(g.sport ?? "")
      .toLowerCase()
      .trim();
    if (!gs) return false;
    // Hard sport isolation (NFL ≠ NCAAF even if names collide).
    if (sportFamily(gs) !== family) return false;
    if (family !== "soccer" && gs !== sport) return false;
    return true;
  });

  const pickUnique = (
    candidates: PropEspnGameRow[],
  ): PropEspnGameRow | null => {
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0]!;
    const startsAt = args.startsAt?.trim() || "";
    if (!startsAt) return null; // ambiguous without commence time
    const target = Date.parse(startsAt);
    if (!Number.isFinite(target)) return null;
    let best: PropEspnGameRow | null = null;
    let bestDiff = Infinity;
    let ties = 0;
    for (const g of candidates) {
      const t = Date.parse(g.startsAt ?? "");
      if (!Number.isFinite(t)) continue;
      const diff = Math.abs(t - target);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = g;
        ties = 1;
      } else if (diff === bestDiff) {
        ties += 1;
      }
    }
    // Same-day doubleheader window; refuse ties / far matches.
    if (!best || ties !== 1 || bestDiff > 6 * 60 * 60 * 1000) return null;
    return best;
  };

  const fullHits = pool.filter(
    (g) =>
      canonicalTeamToken(g.homeTeam ?? "", sport) === wantHome &&
      canonicalTeamToken(g.awayTeam ?? "", sport) === wantAway,
  );
  const full = pickUnique(fullHits);
  if (full) return { game: full, via: "full_name" };

  const abbrHits = pool.filter((g) => {
    const ha = canonicalTeamToken(g.homeAbbr ?? "", sport);
    const aa = canonicalTeamToken(g.awayAbbr ?? "", sport);
    if (!ha || !aa) return false;
    return ha === wantHome && aa === wantAway;
  });
  const abbr = pickUnique(abbrHits);
  if (abbr) return { game: abbr, via: "abbr" };

  return null;
}

export function reconcileCallerTeamIds(
  resolvedHomeTeamId: string,
  resolvedAwayTeamId: string,
  callerHomeTeamId: string | null | undefined,
  callerAwayTeamId: string | null | undefined,
):
  | { ok: true }
  | { ok: false; reason: string } {
  const ch = String(callerHomeTeamId ?? "").trim();
  const ca = String(callerAwayTeamId ?? "").trim();
  if (!ch && !ca) return { ok: true };
  if (!ch || !ca) {
    return { ok: false, reason: "partial_caller_team_ids" };
  }
  if (ch === resolvedHomeTeamId && ca === resolvedAwayTeamId) {
    return { ok: true };
  }
  if (ch === resolvedAwayTeamId && ca === resolvedHomeTeamId) {
    return { ok: false, reason: "caller_team_ids_swapped" };
  }
  return { ok: false, reason: "caller_team_ids_mismatch" };
}

function baseDiag(
  args: ResolvePropEventTeamIdentityArgs,
  status: PropEventTeamIdentityStatus,
  reason: string,
  extra?: Partial<PropEventTeamIdentityDiag>,
): PropEventTeamIdentityDiag {
  return {
    status,
    reason,
    sport: String(args.sport ?? "")
      .toLowerCase()
      .trim(),
    oddsEventId: args.oddsEventId || null,
    espnEventId: null,
    homeTeam: args.homeTeam || null,
    awayTeam: args.awayTeam || null,
    homeTeamId: null,
    awayTeamId: null,
    callerHomeTeamId: String(args.callerHomeTeamId ?? "").trim() || null,
    callerAwayTeamId: String(args.callerAwayTeamId ?? "").trim() || null,
    source: null,
    preGateCount: null,
    postGateCount: null,
    rejectedUnassignedOrForeign: null,
    ...extra,
  };
}

/**
 * Pure resolve against an ESPN game list (tests + production after load).
 */
export function resolvePropEventTeamIdentityFromGames(
  args: ResolvePropEventTeamIdentityArgs,
  games: PropEspnGameRow[],
): ResolvePropEventTeamIdentityResult {
  const sport = String(args.sport ?? "")
    .toLowerCase()
    .trim();
  const homeTeam = String(args.homeTeam ?? "").trim();
  const awayTeam = String(args.awayTeam ?? "").trim();
  const oddsEventId = String(args.oddsEventId ?? "").trim();

  if (!sport || !oddsEventId || !homeTeam || !awayTeam) {
    return {
      ok: false,
      homeTeamId: null,
      awayTeamId: null,
      espnEventId: null,
      diag: baseDiag(args, "unresolved", "missing_sport_event_or_teams"),
    };
  }

  // Refuse flipped query orientation vs Odds home/away tokens when both look swapped.
  // (Odds home/away are authoritative; matching requires that orientation.)
  const hit = matchEspnGameForOddsEvent(games, {
    sport,
    homeTeam,
    awayTeam,
    startsAt: args.startsAt,
  });
  if (!hit) {
    return {
      ok: false,
      homeTeamId: null,
      awayTeamId: null,
      espnEventId: null,
      diag: baseDiag(args, "unresolved", "no_authoritative_espn_match"),
    };
  }

  const homeTeamId = String(hit.game.homeTeamId);
  const awayTeamId = String(hit.game.awayTeamId);
  const reconciled = reconcileCallerTeamIds(
    homeTeamId,
    awayTeamId,
    args.callerHomeTeamId,
    args.callerAwayTeamId,
  );
  if (!reconciled.ok) {
    return {
      ok: false,
      homeTeamId: null,
      awayTeamId: null,
      espnEventId: hit.game.id,
      diag: baseDiag(args, "caller_conflict", reconciled.reason, {
        espnEventId: hit.game.id,
        homeTeamId,
        awayTeamId,
        source: "espn_scoreboard",
      }),
    };
  }

  return {
    ok: true,
    homeTeamId,
    awayTeamId,
    espnEventId: hit.game.id,
    diag: baseDiag(args, "resolved", `matched_via_${hit.via}`, {
      espnEventId: hit.game.id,
      homeTeamId,
      awayTeamId,
      source: "espn_scoreboard",
    }),
  };
}

type EspnScoreboardEvent = {
  id: string;
  date: string;
  competitions?: Array<{
    date?: string;
    competitors?: EspnTeamCompetitor[];
  }>;
};

function mapScoreboardToRows(
  events: EspnScoreboardEvent[],
  sportId: string,
): PropEspnGameRow[] {
  const mma = sportId === "ufc";
  const out: PropEspnGameRow[] = [];
  for (const e of events) {
    const competitions = mma
      ? (e.competitions ?? [])
      : e.competitions?.[0]
        ? [e.competitions[0]]
        : [];
    for (const comp of competitions) {
      const { home, away } = resolveEspnCompetitorSides(comp?.competitors, mma);
      out.push({
        id: mma ? String(comp?.date ? e.id : e.id) : e.id,
        sport: sportId,
        homeTeam: espnCompetitorName(home),
        awayTeam: espnCompetitorName(away),
        homeTeamId: espnCompetitorId(home),
        awayTeamId: espnCompetitorId(away),
        homeAbbr: espnCompetitorAbbr(home),
        awayAbbr: espnCompetitorAbbr(away),
        startsAt: comp?.date ?? e.date,
      });
    }
  }
  return out;
}

/**
 * Load ESPN scoreboard games for a sport. Uses the same cache key family as
 * /sports/games so Coach/props share one scoreboard pull.
 */
export async function loadEspnGamesForPropIdentity(
  sportId: string,
): Promise<PropEspnGameRow[]> {
  const sport = String(sportId ?? "")
    .toLowerCase()
    .trim();
  const path = ESPN_SPORT_PATHS[sport];
  if (!path) return [];

  const extraPaths =
    sport === "soccer"
      ? ESPN_SOCCER_SCOREBOARD_PATHS.filter((p) => p !== path)
      : [];
  const allPaths = [path, ...extraPaths].filter((p, i, a) => a.indexOf(p) === i);
  const dayKeys = espnScoreboardDayKeys(Date.now());
  const cacheKey = `games:${allPaths.join("+")}:days:${dayKeys[0]}-${dayKeys[dayKeys.length - 1]}`;

  const data = await cachedJson<{ events?: EspnScoreboardEvent[] }>(
    cacheKey,
    60 * 1000,
    async () => {
      const fetchEspn = async (p: string, qs: string) => {
        const url = `https://site.api.espn.com/apis/site/v2/sports/${p}/scoreboard${qs}`;
        const r = await fetch(url);
        if (!r.ok) throw new Error(`ESPN ${r.status}`);
        return (await r.json()) as { events?: EspnScoreboardEvent[] };
      };
      const loadPath = async (p: string): Promise<EspnScoreboardEvent[]> => {
        const batches = await Promise.all(
          dayKeys.map(async (day) => {
            try {
              const d = await fetchEspn(p, `?dates=${day}`);
              return d.events ?? [];
            } catch {
              return [] as EspnScoreboardEvent[];
            }
          }),
        );
        const merged = mergeEspnEventsById(batches);
        if (merged.length > 0) return merged;
        try {
          const def = await fetchEspn(p, "");
          return def.events ?? [];
        } catch {
          return [];
        }
      };
      const primary = await loadPath(path);
      const extra = (
        await Promise.all(
          extraPaths.map((p) => loadPath(p).catch(() => [] as EspnScoreboardEvent[])),
        )
      ).flat();
      return { events: mergeEspnEventsById([primary, extra]) };
    },
  );

  return mapScoreboardToRows(data.events ?? [], sport);
}

/**
 * Resolve ESPN team ids for a validated Odds event. Caches the authoritative
 * matchup ids per sport+oddsEventId (5 min) to avoid rescoring the slate.
 */
export async function resolvePropEventTeamIdentity(
  args: ResolvePropEventTeamIdentityArgs,
): Promise<ResolvePropEventTeamIdentityResult> {
  const sport = String(args.sport ?? "")
    .toLowerCase()
    .trim();
  const oddsEventId = String(args.oddsEventId ?? "").trim();
  const homeTeam = String(args.homeTeam ?? "").trim();
  const awayTeam = String(args.awayTeam ?? "").trim();

  if (!sport || !oddsEventId || !homeTeam || !awayTeam) {
    return resolvePropEventTeamIdentityFromGames(args, []);
  }

  if (args.espnGames) {
    return resolvePropEventTeamIdentityFromGames(args, args.espnGames);
  }

  type CachedMatch = {
    homeTeamId: string;
    awayTeamId: string;
    espnEventId: string;
    homeTeam: string;
    awayTeam: string;
  };

  // Cache only the ESPN match (not caller reconciliation).
  const cached = await cachedJson<CachedMatch | null>(
    `prop-event-team-identity:v1:${sport}:${oddsEventId}`,
    5 * 60 * 1000,
    async () => {
      const games = await loadEspnGamesForPropIdentity(sport);
      const hit = matchEspnGameForOddsEvent(games, {
        sport,
        homeTeam,
        awayTeam,
        startsAt: args.startsAt,
      });
      if (!hit?.game.homeTeamId || !hit.game.awayTeamId) return null;
      return {
        homeTeamId: String(hit.game.homeTeamId),
        awayTeamId: String(hit.game.awayTeamId),
        espnEventId: hit.game.id,
        homeTeam,
        awayTeam,
      };
    },
  );

  if (!cached) {
    return {
      ok: false,
      homeTeamId: null,
      awayTeamId: null,
      espnEventId: null,
      diag: baseDiag(args, "unresolved", "no_authoritative_espn_match"),
    };
  }

  // Defend against cache poison if Odds home/away for this eventId changed.
  if (
    canonicalTeamToken(cached.homeTeam, sport) !== canonicalTeamToken(homeTeam, sport) ||
    canonicalTeamToken(cached.awayTeam, sport) !== canonicalTeamToken(awayTeam, sport)
  ) {
    return {
      ok: false,
      homeTeamId: null,
      awayTeamId: null,
      espnEventId: cached.espnEventId,
      diag: baseDiag(args, "unresolved", "cached_identity_team_mismatch", {
        espnEventId: cached.espnEventId,
      }),
    };
  }

  const reconciled = reconcileCallerTeamIds(
    cached.homeTeamId,
    cached.awayTeamId,
    args.callerHomeTeamId,
    args.callerAwayTeamId,
  );
  if (!reconciled.ok) {
    return {
      ok: false,
      homeTeamId: null,
      awayTeamId: null,
      espnEventId: cached.espnEventId,
      diag: baseDiag(args, "caller_conflict", reconciled.reason, {
        espnEventId: cached.espnEventId,
        homeTeamId: cached.homeTeamId,
        awayTeamId: cached.awayTeamId,
        source: "espn_scoreboard",
      }),
    };
  }

  return {
    ok: true,
    homeTeamId: cached.homeTeamId,
    awayTeamId: cached.awayTeamId,
    espnEventId: cached.espnEventId,
    diag: baseDiag(args, "resolved", "matched_via_espn_scoreboard", {
      espnEventId: cached.espnEventId,
      homeTeamId: cached.homeTeamId,
      awayTeamId: cached.awayTeamId,
      source: "espn_scoreboard",
    }),
  };
}

export function finalizePropIdentityDiag(
  diag: PropEventTeamIdentityDiag,
  counts: {
    preGateCount: number;
    postGateCount: number;
  },
): PropEventTeamIdentityDiag {
  const rejected = Math.max(0, counts.preGateCount - counts.postGateCount);
  let status = diag.status;
  let reason = diag.reason;
  if (diag.status === "resolved" || diag.status === "no_provider_props" || diag.status === "team_filtered") {
    if (counts.preGateCount === 0) {
      status = "no_provider_props";
      reason = "resolved_teams_but_no_provider_props";
    } else if (counts.postGateCount === 0 && rejected > 0) {
      status = "team_filtered";
      reason = "all_props_rejected_unassigned_or_foreign_team";
    } else if (counts.postGateCount > 0) {
      status = "resolved";
      reason = rejected > 0 ? "resolved_with_partial_team_filter" : diag.reason;
    }
  }
  return {
    ...diag,
    status,
    reason,
    preGateCount: counts.preGateCount,
    postGateCount: counts.postGateCount,
    rejectedUnassignedOrForeign: rejected,
  };
}

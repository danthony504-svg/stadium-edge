/**
 * Pure helpers for /sports/live-odds board enrichment (Phase 1 Live Coach).
 * No recommendation / simulation logic — state + quote metadata only.
 */

export type LiveScoreboardStatus = {
  displayClock?: string | null;
  period?: number | null;
  type?: {
    description?: string | null;
    state?: string | null;
    shortDetail?: string | null;
  } | null;
};

export type LiveScoreboardCompetitor = {
  homeAway: "home" | "away";
  score?: string | number | null;
  team?: { displayName?: string | null } | null;
};

export type LiveScoreboardEvent = {
  id: string;
  date?: string;
  status?: LiveScoreboardStatus | null;
  competitions?: Array<{
    status?: LiveScoreboardStatus | null;
    competitors?: LiveScoreboardCompetitor[] | null;
  }> | null;
};

export type ExtractedLiveGameState = {
  eventId: string;
  awayTeam: string;
  homeTeam: string;
  matchup: string;
  awayScore: number | null;
  homeScore: number | null;
  state: "in";
  period: number | null;
  periodLabel: string | null;
  clock: string | null;
  startsAt: string | null;
};

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Prefer competition status, then event status (same as /sports/games). */
export function resolveLiveStatusObj(
  ev: LiveScoreboardEvent,
): LiveScoreboardStatus | null {
  const comp = ev.competitions?.[0];
  return comp?.status ?? ev.status ?? null;
}

/**
 * Extract in-progress game state from one ESPN scoreboard event.
 * Returns null when not state=in or teams/eventId missing.
 */
export function extractLiveGameStateFromEspnEvent(
  ev: LiveScoreboardEvent,
): ExtractedLiveGameState | null {
  const eventId = String(ev.id ?? "").trim();
  if (!eventId) return null;
  const comp = ev.competitions?.[0];
  const statusObj = resolveLiveStatusObj(ev);
  const state = String(statusObj?.type?.state ?? "").toLowerCase();
  if (state !== "in") return null;

  const awayC = comp?.competitors?.find((c) => c.homeAway === "away");
  const homeC = comp?.competitors?.find((c) => c.homeAway === "home");
  const awayTeam = String(awayC?.team?.displayName ?? "").trim();
  const homeTeam = String(homeC?.team?.displayName ?? "").trim();
  if (!awayTeam || !homeTeam) return null;

  const periodRaw = statusObj?.period;
  const period =
    typeof periodRaw === "number" && Number.isFinite(periodRaw) ? periodRaw : null;
  const periodLabel =
    statusObj?.type?.shortDetail ?? statusObj?.type?.description ?? null;
  const clockRaw = statusObj?.displayClock;
  const clock =
    typeof clockRaw === "string" && clockRaw.trim() ? clockRaw.trim() : null;

  return {
    eventId,
    awayTeam,
    homeTeam,
    matchup: `${awayTeam} @ ${homeTeam}`,
    awayScore: num(awayC?.score),
    homeScore: num(homeC?.score),
    state: "in",
    period,
    periodLabel: periodLabel != null ? String(periodLabel) : null,
    clock,
    startsAt: ev.date ?? null,
  };
}

/** ESPN pickcenter does not expose a genuine last_update — always null here. */
export function espnPickcenterProviderLastUpdate(
  _raw: unknown,
): string | null {
  return null;
}

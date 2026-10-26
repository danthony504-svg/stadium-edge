/**
 * Prefetch opponent defense packs for Coach board games.
 * Football gets real rush+pass yards allowed (box scores on the server).
 * Other sports get honest feed fields only (avgPointsAgainst + defensive
 * counting/rate stats) — never invented positional "allows X" splits.
 * Capped + concurrent so delivery budget stays intact.
 */

import { teamDefensePack } from "./propDefenseEvidence.ts";
import { getTeamDefense, type EspnGame, type TeamDefense } from "./api.ts";
import type {
  FootballOppDefenseSlice,
  RushDefenseSlice,
} from "./footballRushDefense.ts";

export type FootballOppDefenseMap = Record<string, FootballOppDefenseSlice>;
export { opponentTeamIdForProp, ownTeamIdForProp } from "./footballOppTeamId.ts";
export type { OppTeamIdEspnGame } from "./footballOppTeamId.ts";

const MAX_TEAMS = 24;
const CONCURRENCY = 4;

/** Sports we will load team-defense for on the Coach board. */
const DEFENSE_SPORTS = new Set([
  "nfl",
  "ncaaf",
  "nba",
  "wnba",
  "ncaab",
  "nhl",
  "soccer",
  "mlb",
]);

function teamKey(sport: string, teamId: string): string {
  return `${sport}#${teamId}`;
}

function sportPriority(sport: string): number {
  // Prefer football (box-score rush/pass) then basketball/NHL (opp D gates), then the rest.
  if (sport === "nfl" || sport === "ncaaf") return 0;
  if (sport === "nba" || sport === "wnba" || sport === "ncaab") return 1;
  if (sport === "nhl") return 1;
  if (sport === "soccer") return 2;
  return 3;
}

/**
 * Load opponent defense for unique home/away team ids on the Coach board.
 * Caps at MAX_TEAMS (football first). Failures omit entries.
 */
export async function loadFootballOppRushDefense(opts: {
  espnGames: EspnGame[];
  signal?: AbortSignal;
}): Promise<FootballOppDefenseMap> {
  const out: FootballOppDefenseMap = {};
  const wanted: Array<{ sport: string; teamId: string; teamName: string | null; pri: number }> =
    [];
  const seen = new Set<string>();

  const candidates: Array<{
    sport: string;
    teamId: string;
    teamName: string | null;
    pri: number;
  }> = [];

  for (const g of opts.espnGames) {
    const sport = String(g.sport ?? "").toLowerCase();
    if (!DEFENSE_SPORTS.has(sport)) continue;
    const pairs: Array<{ id: string | null | undefined; name: string | null | undefined }> = [
      { id: g.homeTeamId, name: g.homeTeam ?? g.homeAbbr },
      { id: g.awayTeamId, name: g.awayTeam ?? g.awayAbbr },
    ];
    for (const p of pairs) {
      const id = p.id != null ? String(p.id) : "";
      if (!id) continue;
      const k = teamKey(sport, id);
      if (seen.has(k)) continue;
      seen.add(k);
      candidates.push({
        sport,
        teamId: id,
        teamName: p.name ? String(p.name) : null,
        pri: sportPriority(sport),
      });
    }
  }
  candidates.sort((a, b) => a.pri - b.pri);
  for (const c of candidates) {
    wanted.push(c);
    if (wanted.length >= MAX_TEAMS) break;
  }

  for (let i = 0; i < wanted.length; i += CONCURRENCY) {
    if (opts.signal?.aborted) break;
    const batch = wanted.slice(i, i + CONCURRENCY);
    const rows = await Promise.all(
      batch.map(async (w) => {
        try {
          const def: TeamDefense = await getTeamDefense(w.sport, w.teamId, opts.signal);
          const slice = teamDefensePack(def, w.teamName);
          return slice ? { key: teamKey(w.sport, w.teamId), slice } : null;
        } catch {
          return null;
        }
      }),
    );
    for (const row of rows) {
      if (row) out[row.key] = row.slice;
    }
  }
  return out;
}

export function rushDefenseForOpponent(opts: {
  sport?: string | null;
  opponentTeamId?: string | null;
  map?: FootballOppDefenseMap | null;
}): RushDefenseSlice | null {
  return oppDefensePackForOpponent(opts)?.rush ?? null;
}

export function oppDefensePackForOpponent(opts: {
  sport?: string | null;
  opponentTeamId?: string | null;
  map?: FootballOppDefenseMap | null;
}): FootballOppDefenseSlice | null {
  const sport = String(opts.sport ?? "").toLowerCase();
  const id = opts.opponentTeamId != null ? String(opts.opponentTeamId) : "";
  if (!sport || !id || !opts.map) return null;
  return opts.map[teamKey(sport, id)] ?? null;
}

/** Own-team pack from the same defense map (O-line / QB tendency — no extra fetch). */
export function ownTeamPackForProp(opts: {
  sport?: string | null;
  ownTeamId?: string | null;
  map?: FootballOppDefenseMap | null;
}): FootballOppDefenseSlice | null {
  return oppDefensePackForOpponent({
    sport: opts.sport,
    opponentTeamId: opts.ownTeamId,
    map: opts.map,
  });
}

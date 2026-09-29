/**
 * Prefetch opponent rush-defense packs for NFL/NCAAF games on the Coach board.
 * Capped + concurrent so delivery budget stays intact.
 */

import { getTeamDefense, type EspnGame, type TeamDefense } from "./api.ts";
import type { RushDefenseSlice } from "./footballRushDefense.ts";

export type FootballOppDefenseMap = Record<string, RushDefenseSlice>;
export { opponentTeamIdForProp } from "./footballOppTeamId.ts";
export type { OppTeamIdEspnGame } from "./footballOppTeamId.ts";

const MAX_TEAMS = 12;
const CONCURRENCY = 4;

function teamKey(sport: string, teamId: string): string {
  return `${sport}#${teamId}`;
}

/**
 * Load rush-defense for unique home/away team ids on football board games.
 * Caps at MAX_TEAMS (prioritize games that appear first). Failures omit entries.
 */
export async function loadFootballOppRushDefense(opts: {
  espnGames: EspnGame[];
  signal?: AbortSignal;
}): Promise<FootballOppDefenseMap> {
  const out: FootballOppDefenseMap = {};
  const wanted: Array<{ sport: string; teamId: string; teamName: string | null }> = [];
  const seen = new Set<string>();

  for (const g of opts.espnGames) {
    const sport = String(g.sport ?? "").toLowerCase();
    if (sport !== "nfl" && sport !== "ncaaf") continue;
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
      wanted.push({ sport, teamId: id, teamName: p.name ? String(p.name) : null });
      if (wanted.length >= MAX_TEAMS) break;
    }
    if (wanted.length >= MAX_TEAMS) break;
  }

  for (let i = 0; i < wanted.length; i += CONCURRENCY) {
    const batch = wanted.slice(i, i + CONCURRENCY);
    const rows = await Promise.all(
      batch.map(async (w) => {
        try {
          const def: TeamDefense = await getTeamDefense(w.sport, w.teamId, opts.signal);
          const rd = def.rushDefense;
          if (!rd || rd.sampleSize < 1) return null;
          return {
            key: teamKey(w.sport, w.teamId),
            slice: {
              rushingYardsAllowedPerGame: rd.rushingYardsAllowedPerGame,
              yardsPerRushAllowed: rd.yardsPerRushAllowed,
              sampleSize: rd.sampleSize,
              stuffs: def.defensive?.stuffs?.value ?? null,
              teamName: def.teamName ?? w.teamName,
            } satisfies RushDefenseSlice,
          };
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
  const sport = String(opts.sport ?? "").toLowerCase();
  const id = opts.opponentTeamId != null ? String(opts.opponentTeamId) : "";
  if (!sport || !id || !opts.map) return null;
  return opts.map[teamKey(sport, id)] ?? null;
}

/**
 * Greenfield Coach board-context helpers — injuries + early player form.
 * Real ESPN/Odds feeds only; missing data stays absent (never invented).
 * Kept off selection logic: callers pass maps into the existing scan.
 */

import {
  getInjuries,
  getPlayerHistory,
  type EspnGame,
  type InjuryTeam,
  type PropPoolEntry,
} from "./api.ts";
import { buildGameInjuryReport, type GameInjuryReport } from "./injuries.ts";
import type { PlayerHistorySlice } from "./pickScoreContext.ts";

function gameLabel(away: string, home: string): string {
  return `${away} @ ${home}`;
}

/** Flatten per-sport injury teams for propInjuryScore fallback. */
export function flattenInjuryTeams(
  bySport: Record<string, InjuryTeam[]>,
): InjuryTeam[] {
  const out: InjuryTeam[] = [];
  for (const rows of Object.values(bySport)) {
    for (const t of rows) out.push(t);
  }
  return out;
}

/**
 * Build "Away @ Home" → GameInjuryReport for ESPN games on the board.
 * Only games with a real betting-relevant injury report are keyed.
 */
export function buildMatchupInjuriesForGames(
  espnGames: EspnGame[],
  injuriesBySport: Record<string, InjuryTeam[]>,
): Record<string, GameInjuryReport> {
  const out: Record<string, GameInjuryReport> = {};
  for (const g of espnGames) {
    const sport = String(g.sport ?? "").toLowerCase();
    const away = String(g.awayTeam ?? "").trim();
    const home = String(g.homeTeam ?? "").trim();
    if (!sport || !away || !home) continue;
    const teams = injuriesBySport[sport];
    if (!teams?.length) continue;
    const report = buildGameInjuryReport(sport, teams, away, home);
    if (report) out[gameLabel(away, home)] = report;
  }
  return out;
}

/** Fetch ESPN injury reports for the sports present on the board (parallel). */
export async function loadBoardInjuries(
  sports: readonly string[],
  signal?: AbortSignal,
): Promise<{
  injuriesBySport: Record<string, InjuryTeam[]>;
  matchupInjuries: Record<string, GameInjuryReport>;
  injuryTeams: InjuryTeam[];
}> {
  const unique = [...new Set(sports.map((s) => s.toLowerCase()).filter(Boolean))];
  const injuriesBySport: Record<string, InjuryTeam[]> = {};
  await Promise.all(
    unique.map(async (sport) => {
      try {
        injuriesBySport[sport] = await getInjuries(sport, signal);
      } catch {
        injuriesBySport[sport] = [];
      }
    }),
  );
  return {
    injuriesBySport,
    matchupInjuries: {},
    injuryTeams: flattenInjuryTeams(injuriesBySport),
  };
}

/** Attach matchup injury reports once ESPN games are known. */
export function attachMatchupInjuries(
  espnGames: EspnGame[],
  injuriesBySport: Record<string, InjuryTeam[]>,
): Record<string, GameInjuryReport> {
  return buildMatchupInjuriesForGames(espnGames, injuriesBySport);
}

/**
 * Prefetch recent game logs for prop candidates so Form can score before
 * the first MC enrich wave. Cap + concurrency keep this off the critical path.
 */
export async function prefetchPropPlayerHistory(
  entries: PropPoolEntry[],
  opts?: { signal?: AbortSignal; maxPlayers?: number; concurrency?: number },
): Promise<Record<string, PlayerHistorySlice>> {
  const maxPlayers = opts?.maxPlayers ?? 24;
  const concurrency = opts?.concurrency ?? 6;
  const signal = opts?.signal;
  const unique = new Map<string, PropPoolEntry>();
  for (const e of entries) {
    const id = e.athleteId ? String(e.athleteId) : "";
    if (!id || !e.player) continue;
    const key = `${e.player}#${id}`;
    if (!unique.has(key)) unique.set(key, e);
    if (unique.size >= maxPlayers) break;
  }
  const rows = [...unique.values()];
  const out: Record<string, PlayerHistorySlice> = {};
  for (let i = 0; i < rows.length; i += concurrency) {
    if (signal?.aborted) break;
    const batch = rows.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (e) => {
        const athleteId = String(e.athleteId);
        const sport = String(e.sport ?? "").toLowerCase();
        if (!sport) return;
        try {
          const h = await getPlayerHistory(
            { sport, athleteId, name: e.player },
            signal,
          );
          if (!h?.recent?.length) return;
          out[`${e.player}#${athleteId}`] = {
            player: e.player,
            recent: h.recent.slice(0, 10).map((g) => ({
              date: g.date,
              opp: g.opponentName,
              stats: g.stats,
            })),
            vsOpponent: (h.vsOpponent ?? []).slice(0, 5).map((g) => ({
              date: g.date,
              stats: g.stats,
            })),
          };
        } catch {
          /* honest — Form stays missing */
        }
      }),
    );
  }
  return out;
}

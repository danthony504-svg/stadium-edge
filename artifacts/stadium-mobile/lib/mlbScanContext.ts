/**
 * Load MLB platoon + ballpark maps for greenfield Coach board scans.
 * Real provider data only — missing splits/probables stay absent (never invented).
 */

import {
  getMlbBatterSplits,
  getMlbProbables,
  type EspnGame,
  type MlbPitcherTendency,
  type PropPoolEntry,
} from "./api.ts";
import { isBatterHomeRunMarket } from "./coachHrRank.ts";
import { teamNameMatches } from "./injuries.ts";

function normAbbr(s: string | null | undefined): string {
  return String(s ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function gameKey(away: string, home: string): string {
  return `${away} @ ${home}`;
}

/** Soft match prop game labels to ESPN (abbr or full name). */
function resolveGameIds(
  gameLabel: string,
  espnGames: EspnGame[],
): {
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeAbbr: string | null;
  awayAbbr: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
} | null {
  const parts = gameLabel.split(" @ ");
  if (parts.length !== 2) return null;
  const away = parts[0]!.trim();
  const home = parts[1]!.trim();
  const hit =
    espnGames.find(
      (g) =>
        String(g.awayTeam ?? "").trim() === away &&
        String(g.homeTeam ?? "").trim() === home,
    ) ??
    espnGames.find((g) => {
      const ga = String(g.awayTeam ?? "");
      const gh = String(g.homeTeam ?? "");
      const aa = String(g.awayAbbr ?? "");
      const ha = String(g.homeAbbr ?? "");
      const awayOk =
        teamNameMatches(ga, away) ||
        (aa.length > 0 && normAbbr(aa) === normAbbr(away)) ||
        (aa.length > 0 && teamNameMatches(aa, away));
      const homeOk =
        teamNameMatches(gh, home) ||
        (ha.length > 0 && normAbbr(ha) === normAbbr(home)) ||
        (ha.length > 0 && teamNameMatches(ha, home));
      return awayOk && homeOk;
    });
  if (!hit) return null;
  return {
    homeTeamId: hit.homeTeamId ? String(hit.homeTeamId) : null,
    awayTeamId: hit.awayTeamId ? String(hit.awayTeamId) : null,
    homeAbbr: hit.homeAbbr ?? null,
    awayAbbr: hit.awayAbbr ?? null,
    homeTeam: hit.homeTeam ?? null,
    awayTeam: hit.awayTeam ?? null,
  };
}

function playerIsHome(
  teamAbbr: string | null | undefined,
  ids: {
    homeAbbr: string | null;
    awayAbbr: string | null;
    homeTeam: string | null;
    awayTeam: string | null;
  },
): boolean | null {
  const t = String(teamAbbr ?? "").trim();
  if (!t) return null;
  const tn = normAbbr(t);
  if (ids.homeAbbr && normAbbr(ids.homeAbbr) === tn) return true;
  if (ids.awayAbbr && normAbbr(ids.awayAbbr) === tn) return false;
  if (ids.homeTeam && teamNameMatches(ids.homeTeam, t)) return true;
  if (ids.awayTeam && teamNameMatches(ids.awayTeam, t)) return false;
  return null;
}

export type MlbScanContext = {
  mlbPlatoon: Record<string, unknown>;
  mlbGameEnv: Record<string, unknown>;
};

/**
 * Build mlbPlatoon / mlbGameEnv for HR (and other MLB) prop candidates on the board.
 * Caps batter-split fetches to unique athleteIds in the pool.
 */
export async function loadMlbScanContext(
  opts: {
    propPool: PropPoolEntry[];
    espnGames: EspnGame[];
    /** When true, only load context for batter_home_runs rows. */
    hrOnly?: boolean;
    signal?: AbortSignal;
  },
): Promise<MlbScanContext> {
  const mlbPlatoon: Record<string, unknown> = {};
  const mlbGameEnv: Record<string, unknown> = {};

  const mlbRows = opts.propPool.filter((e) => String(e.sport ?? "").toLowerCase() === "mlb");
  const targets = opts.hrOnly
    ? mlbRows.filter((e) => isBatterHomeRunMarket(e.marketKey))
    : mlbRows;
  if (!targets.length) return { mlbPlatoon, mlbGameEnv };

  const espnMlb = opts.espnGames.filter((g) => String(g.sport ?? "").toLowerCase() === "mlb");

  let probables: Awaited<ReturnType<typeof getMlbProbables>>["probables"] = {};
  let probGames: NonNullable<Awaited<ReturnType<typeof getMlbProbables>>["games"]> = {};
  try {
    const pdata = await getMlbProbables(opts.signal);
    probables = pdata?.probables ?? {};
    probGames = pdata?.games ?? {};
  } catch {
    /* honest no-probables */
  }

  for (const g of espnMlb) {
    if (!g.homeTeamId || !g.homeTeam || !g.awayTeam) continue;
    const env = probGames[g.homeTeamId] ?? null;
    const home = probables[g.homeTeamId] ?? null;
    const away = g.awayTeamId ? (probables[g.awayTeamId] ?? null) : null;
    if (!env && !home && !away) continue;
    const dome = env?.park?.dome === true;
    const slice = {
      venue: env?.venue ?? g.venue ?? null,
      park: env?.park ?? null,
      weather: dome ? null : (env?.weather ?? null),
      ...(dome ? { climateControlled: true } : {}),
      homePitcher: home
        ? { name: home.name ?? null, throws: home.throws ?? null, tendency: home.tendency ?? null }
        : null,
      awayPitcher: away
        ? { name: away.name ?? null, throws: away.throws ?? null, tendency: away.tendency ?? null }
        : null,
    };
    mlbGameEnv[gameKey(g.awayTeam, g.homeTeam)] = slice;
    if (g.awayAbbr && g.homeAbbr) {
      mlbGameEnv[gameKey(g.awayAbbr, g.homeAbbr)] = slice;
    }
  }

  const unique = new Map<string, PropPoolEntry>();
  for (const row of targets) {
    const id = row.athleteId ? String(row.athleteId) : "";
    if (!id) continue;
    if (!unique.has(id)) unique.set(id, row);
  }

  const CONCURRENCY = 8;
  const ids = [...unique.values()];
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    if (opts.signal?.aborted) break;
    const batch = ids.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (t) => {
        const athleteId = String(t.athleteId);
        const idsResolved = resolveGameIds(t.game, espnMlb);
        const isHome = idsResolved
          ? playerIsHome(t.teamAbbr ?? null, idsResolved)
          : null;
        const oppTeamId =
          isHome === true
            ? idsResolved?.awayTeamId ?? null
            : isHome === false
              ? idsResolved?.homeTeamId ?? null
              : null;
        const oppPitcher = oppTeamId ? probables[oppTeamId] ?? null : null;
        const oppThrows = oppPitcher?.throws || null;
        const tendency = (oppPitcher?.tendency ?? null) as MlbPitcherTendency | null;

        let bats: string | null = null;
        let vsLeft: Awaited<ReturnType<typeof getMlbBatterSplits>>["vsLeft"] = null;
        let vsRight: Awaited<ReturnType<typeof getMlbBatterSplits>>["vsRight"] = null;
        try {
          const data = await getMlbBatterSplits(athleteId, opts.signal);
          bats = data?.bats || null;
          vsLeft = data?.vsLeft || null;
          vsRight = data?.vsRight || null;
        } catch {
          /* splits optional — still attach pitcher tendency below */
        }

        let platoon: string | null = null;
        if (bats === "Switch") platoon = "switch";
        else if (bats && oppThrows) platoon = bats !== oppThrows ? "advantage" : "disadvantage";
        const vsThatHand =
          oppThrows === "Left" ? vsLeft : oppThrows === "Right" ? vsRight : null;

        if (!bats && !oppThrows && !vsLeft && !vsRight && !tendency) return;

        const entry = {
          player: t.player,
          bats,
          opposingPitcherName: oppPitcher?.name || null,
          opposingPitcherThrows: oppThrows,
          opposingPitcherTendency: tendency,
          platoon,
          vsThatHand: vsThatHand || null,
          vsLeft: vsLeft || null,
          vsRight: vsRight || null,
        };
        mlbPlatoon[`${t.player}#${athleteId}`] = entry;
        if (t.player && !mlbPlatoon[`${t.player}#`]) {
          mlbPlatoon[`${t.player}#`] = entry;
        }
      }),
    );
  }

  return { mlbPlatoon, mlbGameEnv };
}

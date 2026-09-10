import type { PlayerSearchResult, RealPropEntry, TeamSearchResult } from "./api.ts";
import {
  buildPropPickContext,
  getGames,
  getInjuries,
  getMlbBatterSplits,
  getMlbProbables,
  getOdds,
  searchTeam,
  type EspnGame,
  type MlbGameEnv,
  type MlbProbable,
} from "./api.ts";
import { decimalToAmerican } from "./format.ts";
import type { PlayerScoutingEnrichment, TeamScoutingEnrichment } from "./scoutingReport.ts";

function norm(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function teamMatchesName(gameTeam: string | null | undefined, teamName: string, abbr?: string | null): boolean {
  const want = norm(teamName);
  const last = want.split(" ").pop() ?? want;
  const g = norm(gameTeam ?? "");
  if (!g) return false;
  if (g.includes(want) || g.endsWith(` ${last}`) || g.includes(` ${last}`)) return true;
  if (abbr && g.includes(norm(abbr))) return true;
  return false;
}

function findPlayerInjury(player: string, sport: string, signal?: AbortSignal): Promise<string | null> {
  return getInjuries(sport, signal)
    .then((teams) => {
      const want = norm(player);
      const last = want.split(" ").pop() ?? want;
      for (const t of teams) {
        for (const e of t.entries) {
          const pn = norm(e.player);
          if (pn === want || pn.endsWith(` ${last}`) || pn.includes(last)) {
            return `${e.status}${e.description ? ` — ${e.description}` : ""}`;
          }
        }
      }
      return null;
    })
    .catch(() => null);
}

function findTeamInjuries(teamName: string, sport: string, signal?: AbortSignal): Promise<string | null> {
  return getInjuries(sport, signal)
    .then((teams) => {
      const want = norm(teamName);
      const last = want.split(" ").pop() ?? want;
      for (const t of teams) {
        const tn = norm(t.team);
        if (tn.includes(want) || tn.endsWith(` ${last}`) || tn.includes(` ${last}`)) {
          const lines = t.entries.slice(0, 6).map((e) => `${e.player} (${e.status})`);
          return lines.length ? lines.join("; ") : null;
        }
      }
      return null;
    })
    .catch(() => null);
}

async function resolveTeamId(
  teamName: string | null | undefined,
  signal?: AbortSignal,
): Promise<{ teamId: string | null; abbr: string | null }> {
  if (!teamName?.trim()) return { teamId: null, abbr: null };
  try {
    const tr = await searchTeam(teamName, signal);
    const hit = tr.results?.[0];
    return { teamId: hit?.teamId ?? null, abbr: hit?.abbrev ?? null };
  } catch {
    return { teamId: null, abbr: null };
  }
}

function findMlbGameForTeam(games: EspnGame[], teamId: string | null, teamName: string, abbr?: string | null): EspnGame | null {
  for (const g of games) {
    if (teamId && (g.homeTeamId === teamId || g.awayTeamId === teamId)) return g;
    if (teamMatchesName(g.homeTeam, teamName, abbr) || teamMatchesName(g.awayTeam, teamName, abbr)) return g;
  }
  return null;
}

/** Pull MLB platoon, probables, injuries, and focal props for a player scouting card. */
export async function enrichPlayerScouting(
  resolved: PlayerSearchResult,
  signal?: AbortSignal,
): Promise<PlayerScoutingEnrichment> {
  const sport = (resolved.sport ?? "").toLowerCase();
  const injuryStatus = await findPlayerInjury(resolved.name, sport, signal);

  const propCtx = await buildPropPickContext(resolved.name, signal).catch(() => null);
  const allProps = propCtx?.context?.realProps ?? [];
  const playerProps = allProps.filter((p) =>
    norm(p.player).includes(norm(resolved.name).split(" ").pop() ?? norm(resolved.name)),
  );
  const props = playerProps.length ? playerProps : allProps;

  if (sport !== "mlb" || !resolved.athleteId) {
    return { props, injuryStatus };
  }

  const { teamId, abbr } = await resolveTeamId(resolved.team, signal);
  const [splits, probData, games] = await Promise.all([
    getMlbBatterSplits(resolved.athleteId, signal).catch(() => null),
    getMlbProbables(signal).catch(() => null),
    getGames("mlb", signal).catch(() => [] as EspnGame[]),
  ]);

  const game = findMlbGameForTeam(games, teamId, resolved.team ?? resolved.name, abbr);
  const homeTeamId = game?.homeTeamId ?? null;
  const opponentTeamId =
    game && teamId
      ? game.homeTeamId === teamId
        ? game.awayTeamId ?? null
        : game.homeTeamId ?? null
      : null;

  const pitcher: MlbProbable | null =
    (opponentTeamId ? probData?.probables?.[opponentTeamId] : null) ?? null;
  const gameEnv: MlbGameEnv | null = (homeTeamId ? probData?.games?.[homeTeamId] : null) ?? null;

  return {
    splits,
    probables: { pitcher, gameEnv },
    props,
    injuryStatus,
  };
}

/** Team injuries, posted ML, fair odds, and MLB starter / park when available. */
export async function enrichTeamScouting(
  resolved: TeamSearchResult,
  signal?: AbortSignal,
): Promise<TeamScoutingEnrichment> {
  const sport = (resolved.sport ?? "").toLowerCase();
  const injuries = await findTeamInjuries(resolved.name, sport, signal);

  let bookOdds: number | null = null;
  let fairOdds: number | null = null;
  let winProb: number | null = null;

  try {
    const oddsGames = await getOdds(sport, signal);
    const last = norm(resolved.name).split(" ").pop() ?? norm(resolved.name);
    for (const g of oddsGames) {
      const homeHit =
        teamMatchesName(g.homeTeam, resolved.name, resolved.abbrev) ||
        norm(g.homeTeam).includes(last);
      const awayHit =
        teamMatchesName(g.awayTeam, resolved.name, resolved.abbrev) ||
        norm(g.awayTeam).includes(last);
      if (!homeHit && !awayHit) continue;
      const teamLabel = homeHit ? g.homeTeam : g.awayTeam;
      const h2h = g.markets?.find((m) => m.key === "h2h");
      const outcome = h2h?.outcomes?.find(
        (o) => norm(o.name) === norm(teamLabel) || norm(o.name).includes(last),
      );
      if (outcome) {
        bookOdds = outcome.price;
        if (outcome.noVigFair != null && outcome.noVigFair > 0 && outcome.noVigFair < 1) {
          winProb = outcome.noVigFair;
          fairOdds = decimalToAmerican(1 / outcome.noVigFair);
        }
        break;
      }
    }
  } catch {
    /* honest no-odds fallback */
  }

  let startingPitcher: string | null = null;
  let gameEnv: MlbGameEnv | null = null;
  if (sport === "mlb") {
    try {
      const [probData, games] = await Promise.all([
        getMlbProbables(signal),
        getGames("mlb", signal),
      ]);
      const game = findMlbGameForTeam(games, resolved.teamId, resolved.name, resolved.abbrev);
      if (game?.homeTeamId) {
        gameEnv = probData?.games?.[game.homeTeamId] ?? null;
      }
      startingPitcher = probData?.probables?.[resolved.teamId]?.name ?? null;
    } catch {
      /* honest no-probables fallback */
    }
  }

  return { injuries, bookOdds, fairOdds, winProb, startingPitcher, gameEnv };
}

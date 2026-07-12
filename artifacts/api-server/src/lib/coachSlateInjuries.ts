import { pooled, slateLoopbackGet } from "./coachSlateLoopback.js";

type InjuryEntry = {
  player: string;
  position: string | null;
  status: string;
  description: string;
};

type InjuryTeam = {
  team: string;
  teamAbbr: string;
  entries: InjuryEntry[];
};

type EspnGameRef = {
  sport: string;
  awayTeam?: string;
  awayAbbr?: string | null;
  homeTeam?: string;
  homeAbbr?: string | null;
};

const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const words = (s: string): string[] => norm(s).split(" ").filter(Boolean);

function teamNameMatches(a: string, b: string): boolean {
  const aw = words(a);
  const bw = words(b);
  if (aw.length === 0 || bw.length === 0) return false;
  const [short, long] = aw.length <= bw.length ? [aw, bw] : [bw, aw];
  const longSet = new Set(long);
  return short.every((w) => longSet.has(w));
}

function injuriesForMatchup(teams: InjuryTeam[] | undefined, names: string[]): InjuryTeam[] {
  if (!teams) return [];
  const wanted = names.filter((n) => norm(n).length > 0);
  if (wanted.length === 0) return [];
  return teams.filter((t) => {
    const ta = norm(t.teamAbbr);
    return wanted.some(
      (n) => teamNameMatches(t.team, n) || (ta.length > 0 && ta === norm(n)),
    );
  });
}

function isKeyInjuryStatus(status: string): boolean {
  const s = status.toLowerCase();
  return /\bout\b|injured reserve|\bir\b|\bil\b|doubtful|questionable|suspend|inactive|10-day|15-day|60-day|season/.test(
    s,
  );
}

/** Compact injury digest for slate fingerprint — refreshes when lineups change. */
export function injuryDigestForTeams(teams: InjuryTeam[]): string {
  const parts: string[] = [];
  for (const t of teams) {
    const key = t.entries
      .filter((e) => isKeyInjuryStatus(e.status))
      .map((e) => `${e.player}:${e.status}`)
      .sort()
      .slice(0, 12);
    if (key.length) parts.push(`${t.teamAbbr || t.team}=[${key.join(",")}]`);
  }
  return parts.sort().join("|");
}

export async function fetchInjuriesBySport(
  sports: string[],
): Promise<Map<string, InjuryTeam[]>> {
  const out = new Map<string, InjuryTeam[]>();
  await pooled(sports, 3, async (sport) => {
    const rows = await slateLoopbackGet<InjuryTeam[]>(`/sports/injuries?sport=${sport}`);
    if (rows?.length) out.set(sport, rows);
  });
  return out;
}

/** Build per-game injury reports keyed by "Away @ Home" for Coach context. */
export function buildServerMatchupInjuries(
  games: EspnGameRef[],
  injuriesBySport: Map<string, InjuryTeam[]>,
): Record<string, { edge: string; sides: unknown[] }> {
  const out: Record<string, { edge: string; sides: unknown[] }> = {};
  for (const g of games) {
    const away = g.awayTeam || g.awayAbbr || "";
    const home = g.homeTeam || g.homeAbbr || "";
    if (!away || !home) continue;
    const teams = injuriesBySport.get(g.sport);
    const injTeams = injuriesForMatchup(teams, [away, home]);
    if (injTeams.length !== 2) continue;
    const sides = injTeams.map((t) => ({
      team: t.team,
      keyPlayers: t.entries
        .filter((e) => isKeyInjuryStatus(e.status))
        .slice(0, 6)
        .map((e) => ({
          player: e.player,
          position: e.position,
          status: e.status,
        })),
    }));
    if (!sides.some((s) => s.keyPlayers.length > 0)) continue;
    const awayOut = sides[0]?.keyPlayers.length ?? 0;
    const homeOut = sides[1]?.keyPlayers.length ?? 0;
    const edge =
      awayOut === homeOut
        ? "Even — neither side is meaningfully more banged up"
        : awayOut > homeOut
          ? `Edge: ${injTeams[1]?.team ?? home} (${injTeams[0]?.team ?? away} carries more injury impact)`
          : `Edge: ${injTeams[0]?.team ?? away} (${injTeams[1]?.team ?? home} carries more injury impact)`;
    out[`${away} @ ${home}`] = { edge, sides };
  }
  return out;
}

export function injuryDigestForSports(injuriesBySport: Map<string, InjuryTeam[]>): string {
  const parts: string[] = [];
  for (const [sport, teams] of injuriesBySport) {
    const digest = injuryDigestForTeams(teams);
    if (digest) parts.push(`${sport}:${digest}`);
  }
  return parts.sort().join(";");
}

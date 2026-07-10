/** ESPN team-sport competitor (NBA, MLB, …). */
export type EspnTeamCompetitor = {
  homeAway?: "home" | "away";
  order?: number;
  score?: string;
  id?: string;
  team?: {
    id?: string;
    displayName?: string;
    abbreviation?: string;
    logo?: string;
    logos?: Array<{ href?: string }>;
  };
  athlete?: {
    id?: string;
    displayName?: string;
    shortName?: string;
  };
};

export function resolveEspnCompetitorSides(
  competitors: EspnTeamCompetitor[] | undefined,
  mma: boolean,
): { home: EspnTeamCompetitor | undefined; away: EspnTeamCompetitor | undefined } {
  if (!competitors?.length) return { home: undefined, away: undefined };
  if (!mma) {
    return {
      home: competitors.find((c) => c.homeAway === "home"),
      away: competitors.find((c) => c.homeAway === "away"),
    };
  }
  // MMA scoreboards omit homeAway and use athlete (not team). ESPN order 1 is the
  // first-listed corner (home), order 2 is the opponent (away).
  const sorted = [...competitors].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return { home: sorted[0], away: sorted[1] };
}

export function espnCompetitorName(c: EspnTeamCompetitor | undefined): string | null {
  if (!c) return null;
  return c.team?.displayName ?? c.athlete?.displayName ?? null;
}

export function espnCompetitorId(c: EspnTeamCompetitor | undefined): string | null {
  if (!c) return null;
  const id = c.team?.id ?? c.athlete?.id ?? c.id;
  return id != null ? String(id) : null;
}

export function espnCompetitorAbbr(c: EspnTeamCompetitor | undefined): string | null {
  if (!c) return null;
  return c.team?.abbreviation ?? c.athlete?.shortName ?? null;
}

export function espnCompetitorLogo(c: EspnTeamCompetitor | undefined): string | null {
  if (!c) return null;
  return c.team?.logo ?? c.team?.logos?.[0]?.href ?? null;
}

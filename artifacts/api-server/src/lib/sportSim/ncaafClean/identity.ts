/**
 * Season-specific team identity via verified FBS/FCS ESPN IDs.
 */

import {
  classifyMatchupSubdivision,
  classifyTeamSubdivision,
  loadSubdivisionFixture,
  type SubdivisionFixture,
} from "../ncaafSubdivision.ts";
import type {
  CleanFixtureGameRow,
  MatchupScope,
  SeasonTeamIdentity,
} from "./types.ts";

export function buildSeasonTeamIdentity(
  teamId: string,
  season: number,
  displayName: string,
  fixture?: SubdivisionFixture,
): SeasonTeamIdentity {
  const subdivision = classifyTeamSubdivision(teamId, season, fixture);
  const fix = fixture ?? loadSubdivisionFixture();
  let transition: SeasonTeamIdentity["transition"] = null;
  for (const t of fix.transitions ?? []) {
    if (String(t.teamId) !== String(teamId)) continue;
    const path = t.path ?? {};
    const keys = Object.keys(path)
      .map(Number)
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    for (let i = 1; i < keys.length; i++) {
      if (keys[i] !== season) continue;
      const prev = path[String(keys[i - 1])];
      const cur = path[String(keys[i])];
      if (prev === "fcs" && cur === "fbs") transition = "fcs_to_fbs";
      if (prev === "fbs" && cur === "fcs") transition = "fbs_to_fcs";
    }
  }
  return {
    teamId: String(teamId),
    season,
    displayName,
    subdivision,
    conferenceId: null,
    transition,
  };
}

export function matchupScopeForIds(
  homeTeamId: string,
  awayTeamId: string,
  season: number,
  fixture?: SubdivisionFixture,
): MatchupScope {
  return classifyMatchupSubdivision(
    homeTeamId,
    awayTeamId,
    season,
    fixture,
  ) as MatchupScope;
}

export function identitiesFromFixtureRow(
  row: CleanFixtureGameRow,
  fixture?: SubdivisionFixture,
): {
  home: SeasonTeamIdentity;
  away: SeasonTeamIdentity;
  matchupScope: MatchupScope;
} {
  const home = buildSeasonTeamIdentity(
    row.homeTeamId,
    row.season,
    row.homeName ?? row.homeTeamId,
    fixture,
  );
  const away = buildSeasonTeamIdentity(
    row.awayTeamId,
    row.season,
    row.awayName ?? row.awayTeamId,
    fixture,
  );
  return {
    home,
    away,
    matchupScope: matchupScopeForIds(
      row.homeTeamId,
      row.awayTeamId,
      row.season,
      fixture,
    ),
  };
}

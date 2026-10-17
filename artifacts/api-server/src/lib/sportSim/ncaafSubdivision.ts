/**
 * Season-specific FBS/FCS classification for NCAAF research.
 *
 * Source: ESPN standings group 80 (FBS) / 81 (FCS) per season, cached in
 * `test/fixtures/ncaaf-subdivision-espn-ids.json`. Free ESPN API — not Odds.
 *
 * Unknown teams stay explicitly `unknown` (never inferred from name heuristics).
 * Subdivision transitions (e.g. Delaware FCS→FBS in 2025) are season-scoped.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type Subdivision = "fbs" | "fcs" | "unknown";

export type MatchupSubdivision =
  | "fbs_fbs"
  | "fbs_fcs"
  | "fcs_fcs"
  | "involves_unknown";

type SeasonMaps = {
  fbs: Record<string, string>;
  fcs: Record<string, string>;
};

type SubdivisionFixture = {
  source: string;
  fetchedAt?: string;
  transitions?: Array<{
    teamId: string;
    name: string;
    path: Record<string, string>;
  }>;
  seasons: Record<string, SeasonMaps>;
};

let cached: SubdivisionFixture | null = null;

function defaultFixturePath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/lib/sportSim → test/fixtures
  return join(here, "../../../test/fixtures/ncaaf-subdivision-espn-ids.json");
}

export function loadSubdivisionFixture(path = defaultFixturePath()): SubdivisionFixture {
  if (cached && path === defaultFixturePath()) return cached;
  const raw = JSON.parse(readFileSync(path, "utf8")) as SubdivisionFixture;
  if (!raw?.seasons || typeof raw.seasons !== "object") {
    throw new Error(`Invalid subdivision fixture at ${path}`);
  }
  // Validate no FBS∩FCS overlap per season
  for (const [season, maps] of Object.entries(raw.seasons)) {
    const fbs = new Set(Object.keys(maps.fbs ?? {}));
    const fcs = new Set(Object.keys(maps.fcs ?? {}));
    for (const id of fbs) {
      if (fcs.has(id)) {
        throw new Error(`Subdivision fixture overlap season=${season} teamId=${id}`);
      }
    }
  }
  if (path === defaultFixturePath()) cached = raw;
  return raw;
}

/** Test helper — clear memoized fixture. */
export function resetSubdivisionFixtureCache(): void {
  cached = null;
}

export function classifyTeamSubdivision(
  teamId: string,
  season: number,
  fixture?: SubdivisionFixture,
): Subdivision {
  const fix = fixture ?? loadSubdivisionFixture();
  const maps = fix.seasons[String(season)];
  if (!maps) return "unknown";
  const id = String(teamId);
  if (maps.fbs[id] != null) return "fbs";
  if (maps.fcs[id] != null) return "fcs";
  return "unknown";
}

export function classifyMatchupSubdivision(
  homeTeamId: string,
  awayTeamId: string,
  season: number,
  fixture?: SubdivisionFixture,
): MatchupSubdivision {
  const h = classifyTeamSubdivision(homeTeamId, season, fixture);
  const a = classifyTeamSubdivision(awayTeamId, season, fixture);
  if (h === "unknown" || a === "unknown") return "involves_unknown";
  if (h === "fbs" && a === "fbs") return "fbs_fbs";
  if (h === "fcs" && a === "fcs") return "fcs_fcs";
  return "fbs_fcs";
}

export function isFbsFbsGame(
  homeTeamId: string,
  awayTeamId: string,
  season: number,
  fixture?: SubdivisionFixture,
): boolean {
  return classifyMatchupSubdivision(homeTeamId, awayTeamId, season, fixture) === "fbs_fbs";
}

export function teamNameFromSubdivisionFixture(
  teamId: string,
  season: number,
  fixture?: SubdivisionFixture,
): string | undefined {
  const fix = fixture ?? loadSubdivisionFixture();
  const maps = fix.seasons[String(season)];
  if (!maps) return undefined;
  const id = String(teamId);
  return maps.fbs[id] ?? maps.fcs[id];
}

export function listTransitionTeams(fixture?: SubdivisionFixture): Array<{
  teamId: string;
  name: string;
  path: Record<string, string>;
}> {
  const fix = fixture ?? loadSubdivisionFixture();
  return fix.transitions ?? [];
}

/** Pure shared team-defense mapping; no fetching or synthetic positional splits. */
import type { TeamDefense } from "./api.ts";
import type { FootballOppDefenseSlice, RushDefenseSlice, PassDefenseSlice } from "./footballRushDefense.ts";
import { teamNameMatches } from "./injuries.ts";

export function teamDefensePack(def: TeamDefense, fallbackName: string | null = null): FootballOppDefenseSlice | null {
  const teamName = def.teamName ?? fallbackName;
  const rd = def.rushDefense;
  const pd = def.passDefense;
  const hasRush = !!(rd && rd.sampleSize >= 1);
  const hasPass = !!(pd && pd.sampleSize >= 1);
  const rush: RushDefenseSlice | null = hasRush
    ? {
        rushingYardsAllowedPerGame: rd!.rushingYardsAllowedPerGame,
        yardsPerRushAllowed: rd!.yardsPerRushAllowed,
        sampleSize: rd!.sampleSize,
        stuffs: def.defensive?.stuffs?.value ?? null,
        teamName,
      }
    : null;
  const pass: PassDefenseSlice | null = hasPass
    ? {
        passingYardsAllowedPerGame: pd!.passingYardsAllowedPerGame,
        yardsPerPassAllowed: pd!.yardsPerPassAllowed,
        sampleSize: pd!.sampleSize,
        teamName,
      }
    : null;
  // Non-football: keep the row when we at least have pointsAgainst.
  if (
    !hasRush &&
    !hasPass &&
    def.avgPointsAgainst == null &&
    !Object.keys(def.defensive ?? {}).length
  ) {
    return null;
}
return {
    opponentMarkets: def.opponentMarkets,
    rush,
    pass,
    teamName,
    pointsAgainst: def.avgPointsAgainst,
    pointsFor: def.avgPointsFor,
    sacks: def.defensive?.sacks?.value ?? null,
    interceptions: def.defensive?.interceptions?.value ?? null,
    passesDefended: def.defensive?.passesDefended?.value ?? null,
    stuffs: def.defensive?.stuffs?.value ?? null,
    gamesPlayed:
      def.defensive?.teamGamesPlayed?.value ??
      def.defensive?.gamesPlayed?.value ??
      def.offensive?.teamGamesPlayed?.value ??
      def.offensive?.gamesPlayed?.value ??
      null,
    totalTakeaways: def.defensive?.totalTakeaways?.value ?? null,
    // ESPN passing.sacks on the offensive allowlist = sacks allowed (O-line).
    sacksAllowed: def.offensive?.sacks?.value ?? null,
    sackYardsLost: def.offensive?.sackYardsLost?.value ?? null,
    interceptionPct: def.offensive?.interceptionPct?.value ?? null,
    intsThrown: def.offensive?.interceptions?.value ?? null,
    passingAttempts: def.offensive?.passingAttempts?.value ?? null,
    ownRushYpc: def.offensive?.yardsPerRushAttempt?.value ?? null,
    steals: def.defensive?.avgSteals?.value ?? null,
    blocks: def.defensive?.avgBlocks?.value ?? null,
    defRebounds: def.defensive?.avgDefensiveRebounds?.value ?? null,
    oppTurnovers: def.offensive?.avgTurnovers?.value ?? null,
    oppFgPct: def.offensive?.fieldGoalPct?.value ?? null,
    oppThreePct: def.offensive?.threePointFieldGoalPct?.value ?? null,
    goalsAgainstAvg: def.defensive?.goalsAgainstAverage?.value ?? null,
    savePct: def.defensive?.savePct?.value ?? null,
    shotsAgainst: def.sport === "nhl" && def.shotAllowance && def.shotAllowance.sampleSize >= 3 && Number.isFinite(def.shotAllowance.shotsAllowedPerGame) ? def.shotAllowance.shotsAllowedPerGame : null,
    shotsAgainstSample: def.shotAllowance?.sampleSize ?? null,
    blockedShots: def.defensive?.blockedShots?.value ?? null,
    takeaways: def.defensive?.takeaways?.value ?? null,
    goalsConceded: def.defensive?.goalsConceded?.value ?? null,
    cleanSheets: def.defensive?.cleanSheets?.value ?? null,
    tackles: def.defensive?.tackles?.value ?? null,
    era: def.defensive?.ERA?.value ?? null,
    whip: def.defensive?.WHIP?.value ?? null,
    battingAverageAgainst: def.defensive?.battingAverageAgainst?.value ?? null,
} satisfies FootballOppDefenseSlice;
}

/** Require exactly one matching side; unresolved/ambiguous identity stays unknown. */
export function defensePackForTeam(
  rows: readonly ({ name: string; def: TeamDefense } | null | undefined)[],
  teamName: string | null | undefined,
): FootballOppDefenseSlice | null {
  if (!teamName) return null;
  const matches = rows.filter(row => row && teamNameMatches(row.name, teamName));
  return matches.length === 1 ? teamDefensePack(matches[0]!.def, matches[0]!.name) : null;
}

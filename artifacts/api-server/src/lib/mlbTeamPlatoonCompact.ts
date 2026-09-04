// Pure upload compact helper — no StatMuse/network deps (safe for unit tests).

export type PitcherTendencySummary = {
  era: number | null;
  whip: number | null;
  kPer9: number | null;
  hrPer9: number | null;
  oppOPS: number | null;
  hardHitPctAllowed: number | null;
  barrelPctAllowed: number | null;
};

export type MlbHand = "Left" | "Right";

export type MlbTeamHandSplit = {
  hand: MlbHand;
  sourceLine: string | null;
  avg: number | null;
  obp: number | null;
  slg: number | null;
  ops: number | null;
  hits: number | null;
  homeRuns: number | null;
  walks: number | null;
  strikeouts: number | null;
  plateAppearances: number | null;
  games: number | null;
  kRate: number | null;
  bbRate: number | null;
  hitsPerGame: number | null;
  hrPerGame: number | null;
  iso: number | null;
  woba: null;
  wrcPlus: null;
  hardHitRate: null;
  groundBallRate: null;
  flyBallRate: null;
};

export type MlbStarterProfile = {
  name: string | null;
  throws: MlbHand | null;
  tendency: PitcherTendencySummary | null;
};

export type MlbTeamPlatoonSide = {
  team: string;
  opposingStarter: MlbStarterProfile;
  splitVsStarterHand: MlbTeamHandSplit | null;
};

export type MlbGamePlatoonCompare = {
  game: string;
  away: MlbTeamPlatoonSide;
  home: MlbTeamPlatoonSide;
  offenseLean: "away" | "home" | "even" | null;
  note: string | null;
};

/** Compact summary for upload — one line per team with key platoon stats. */
export function compactGamePlatoonForUpload(entry: MlbGamePlatoonCompare): Record<string, unknown> {
  const side = (s: MlbTeamPlatoonSide) => {
    const sp = s.splitVsStarterHand;
    const t = s.opposingStarter.tendency;
    return {
      team: s.team,
      vs: s.opposingStarter.throws,
      starter: s.opposingStarter.name,
      avg: sp?.avg ?? null,
      obp: sp?.obp ?? null,
      slg: sp?.slg ?? null,
      ops: sp?.ops ?? null,
      hrPerGame: sp?.hrPerGame ?? null,
      kRate: sp?.kRate ?? null,
      bbRate: sp?.bbRate ?? null,
      iso: sp?.iso ?? null,
      starterEra: t?.era ?? null,
      starterK9: t?.kPer9 ?? null,
      starterHr9: t?.hrPer9 ?? null,
      starterOppOps: t?.oppOPS ?? null,
      starterHardHitAllowed: t?.hardHitPctAllowed ?? null,
    };
  };
  return {
    game: entry.game,
    away: side(entry.away),
    home: side(entry.home),
    offenseLean: entry.offenseLean,
    note: entry.note,
  };
}

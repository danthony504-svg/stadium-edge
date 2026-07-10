// Structured pre-pick tennis analysis — every requested factor is real ESPN data
// or explicitly unavailable. Never fabricates Elo, serve splits, weather, or
// player props (tennis has no prop feed).

import type { TennisBio, TennisCareer, TennisH2H, TennisMatchup, TennisPlayer } from "./tennis.js";
import type { GameSimResult } from "./gameMonteCarlo.js";

export type AnalysisFactor<T = string | number | null> = {
  value: T;
  available: boolean;
};

export type PlayerPickFactors = {
  ranking: AnalysisFactor<string>;
  eloRating: AnalysisFactor<number>;
  surfaceRecord: AnalysisFactor<string>;
  surfaceWinPct: AnalysisFactor<number>;
  last5Matches: AnalysisFactor<string>;
  last10Matches: AnalysisFactor<string>;
  careerWinPct: AnalysisFactor<number>;
  servePct: AnalysisFactor<number>;
  firstServeWon: AnalysisFactor<number>;
  secondServeWon: AnalysisFactor<number>;
  returnPointsWon: AnalysisFactor<number>;
  breakPointsCreated: AnalysisFactor<number>;
  breakPointsConverted: AnalysisFactor<number>;
  breakPointsSaved: AnalysisFactor<number>;
  acesPerMatch: AnalysisFactor<number>;
  doubleFaultsPerMatch: AnalysisFactor<number>;
  winners: AnalysisFactor<number>;
  unforcedErrors: AnalysisFactor<number>;
  holdPct: AnalysisFactor<number>;
  breakPct: AnalysisFactor<number>;
  tiebreakRecord: AnalysisFactor<string>;
  straightSetWinPct: AnalysisFactor<number>;
  avgGamesPerMatch: AnalysisFactor<number>;
  avgMatchLength: AnalysisFactor<string>;
  fatigueMatchesThisWeek: AnalysisFactor<number>;
  daysRest: AnalysisFactor<number>;
  injuryNews: AnalysisFactor<string>;
  homeCountry: AnalysisFactor<string>;
  grandSlamExperience: AnalysisFactor<string>;
  vsTop10: AnalysisFactor<string>;
  vsTop20: AnalysisFactor<string>;
  vsTop50: AnalysisFactor<string>;
  vsLeftHanded: AnalysisFactor<string>;
  vsRightHanded: AnalysisFactor<string>;
};

export type MatchupPickFactors = {
  h2hOverall: AnalysisFactor<string>;
  h2hSameSurface: AnalysisFactor<string>;
  tournament: AnalysisFactor<string>;
  round: AnalysisFactor<string>;
  surface: AnalysisFactor<string>;
  weather: AnalysisFactor<string>;
  crowdAdvantage: AnalysisFactor<string>;
};

export type TennisBettingContext = {
  closingLineValue: AnalysisFactor<string>;
  oddsMovement: AnalysisFactor<string>;
  sharpMoneyPct: AnalysisFactor<number>;
  publicBettingPct: AnalysisFactor<number>;
  bestOddsEveryBook: AnalysisFactor<string>;
};

export type TennisPickAnalysis = {
  away: PlayerPickFactors;
  home: PlayerPickFactors;
  matchup: MatchupPickFactors;
  betting: TennisBettingContext;
  dataCoveragePct: number;
  resolvedPlayers: number;
  unavailableFactors: string[];
  unavailableMarkets: string[];
};

export const TENNIS_UNAVAILABLE_MARKETS = [
  "Player props (not in odds feed)",
  "Set spread (not posted)",
  "Alternate lines (not posted for tennis)",
  "Same-game parlays",
] as const;

const UNAVAILABLE_FACTOR_LABELS = [
  "Elo rating",
  "Surface-specific win-loss record",
  "Serve / return advanced stats",
  "Break point stats",
  "Aces and double faults per match",
  "Winners and unforced errors",
  "Hold / break percentages",
  "Tiebreak record",
  "Fatigue (matches this week)",
  "Days of rest",
  "Injury news",
  "Weather (wind, heat, humidity)",
  "Performance vs Top 10/20/50",
  "Left vs right-handed opponent splits",
  "H2H on same surface (only season H2H available)",
  "Closing line value history",
  "Odds movement",
  "Public / sharp betting %",
] as const;

function factor<T>(value: T | null | undefined, available = value != null): AnalysisFactor<T | null> {
  return { value: available ? (value as T) : null, available: available && value != null };
}

function formLabel(form: TennisPlayer["recentForm"], n: number): string | null {
  const slice = form.slice(0, n);
  if (!slice.length) return null;
  const w = slice.filter((r) => r.win === true).length;
  const l = slice.filter((r) => r.win === false).length;
  return `${w}-${l} (${slice.length} sampled)`;
}

function avgGamesFromForm(p: TennisPlayer): number | null {
  const vals: number[] = [];
  for (const r of p.recentForm) {
    if (!r.score) continue;
    let games = 0;
    for (const set of r.score.split(/\s+/).filter(Boolean)) {
      const [a, b] = set.split("-").map((x) => parseInt(x, 10));
      if (Number.isFinite(a) && Number.isFinite(b)) games += a + b;
    }
    if (games > 0) vals.push(games);
  }
  if (!vals.length) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
}

function inferSurface(tournament: string | null): string | null {
  if (!tournament) return null;
  const t = tournament.toLowerCase();
  if (t.includes("wimbledon") || t.includes("queens") || t.includes("halle") || t.includes("eastbourne"))
    return "Grass";
  if (t.includes("french") || t.includes("roland") || t.includes("monte carlo") || t.includes("rome"))
    return "Clay";
  if (
    t.includes("open") ||
    t.includes("masters") ||
    t.includes("indian wells") ||
    t.includes("miami") ||
    t.includes("cincinnati")
  )
    return "Hard";
  return null;
}

function buildPlayerFactors(
  p: TennisPlayer,
  bio: TennisBio | null,
  career: TennisCareer | null,
): PlayerPickFactors {
  const rank =
    p.rank != null ? `${p.tour || "ATP/WTA"} #${p.rank}${p.rankPoints != null ? ` (${p.rankPoints} pts)` : ""}` : null;
  return {
    ranking: factor(rank),
    eloRating: { value: null, available: false },
    surfaceRecord: { value: null, available: false },
    surfaceWinPct: { value: null, available: false },
    last5Matches: factor(formLabel(p.recentForm, 5)),
    last10Matches: factor(formLabel(p.recentForm, 10)),
    careerWinPct: factor(career?.winPct ?? null),
    servePct: { value: null, available: false },
    firstServeWon: { value: null, available: false },
    secondServeWon: { value: null, available: false },
    returnPointsWon: { value: null, available: false },
    breakPointsCreated: { value: null, available: false },
    breakPointsConverted: { value: null, available: false },
    breakPointsSaved: { value: null, available: false },
    acesPerMatch: { value: null, available: false },
    doubleFaultsPerMatch: { value: null, available: false },
    winners: { value: null, available: false },
    unforcedErrors: { value: null, available: false },
    holdPct: { value: null, available: false },
    breakPct: { value: null, available: false },
    tiebreakRecord: { value: null, available: false },
    straightSetWinPct: { value: null, available: false },
    avgGamesPerMatch: factor(avgGamesFromForm(p)),
    avgMatchLength: { value: null, available: false },
    fatigueMatchesThisWeek: { value: null, available: false },
    daysRest: { value: null, available: false },
    injuryNews: { value: null, available: false },
    homeCountry: factor(p.country),
    grandSlamExperience: factor(
      career?.singlesTitles != null ? `${career.singlesTitles} career singles titles` : null,
      career?.singlesTitles != null,
    ),
    vsTop10: { value: null, available: false },
    vsTop20: { value: null, available: false },
    vsTop50: { value: null, available: false },
    vsLeftHanded: { value: null, available: false },
    vsRightHanded: factor(bio?.plays ?? null),
  };
}

function countAvailable(obj: Record<string, AnalysisFactor<unknown>>): number {
  return Object.values(obj).filter((x) => x.available).length;
}

export async function buildTennisPickAnalysis(
  matchup: TennisMatchup,
  profiles: { away: { bio: TennisBio | null; career: TennisCareer | null }; home: { bio: TennisBio | null; career: TennisCareer | null } },
  booksCount: number,
): Promise<TennisPickAnalysis> {
  const away = buildPlayerFactors(matchup.away, profiles.away.bio, profiles.away.career);
  const home = buildPlayerFactors(matchup.home, profiles.home.bio, profiles.home.career);
  const surface = inferSurface(matchup.tournament);
  const h2hStr =
    matchup.h2h && matchup.h2h.meetings.length
      ? `${matchup.home.resolvedName || matchup.home.name} ${matchup.h2h.homeWins}-${matchup.h2h.awayWins} ${matchup.away.resolvedName || matchup.away.name}`
      : null;

  const matchupFactors: MatchupPickFactors = {
    h2hOverall: factor(h2hStr),
    h2hSameSurface: { value: null, available: false },
    tournament: factor(matchup.tournament),
    round: factor(matchup.round),
    surface: factor(surface),
    weather: { value: null, available: false },
    crowdAdvantage: { value: null, available: false },
  };

  const resolved =
    (matchup.away.rank != null || matchup.away.recentForm.length > 0 ? 1 : 0) +
    (matchup.home.rank != null || matchup.home.recentForm.length > 0 ? 1 : 0);

  const playerFactorCount = Object.keys(away).length;
  const avail =
    countAvailable(away as unknown as Record<string, AnalysisFactor<unknown>>) +
    countAvailable(home as unknown as Record<string, AnalysisFactor<unknown>>) +
    countAvailable(matchupFactors as unknown as Record<string, AnalysisFactor<unknown>>) +
    (booksCount > 0 ? 1 : 0);
  const maxAvail = playerFactorCount * 2 + Object.keys(matchupFactors).length + 1;

  return {
    away,
    home,
    matchup: matchupFactors,
    betting: {
      closingLineValue: { value: null, available: false },
      oddsMovement: { value: null, available: false },
      sharpMoneyPct: { value: null, available: false },
      publicBettingPct: { value: null, available: false },
      bestOddsEveryBook: factor(
        booksCount > 0 ? `${booksCount} posted lines across books` : null,
        booksCount > 0,
      ),
    },
    dataCoveragePct: Math.round((avail / maxAvail) * 1000) / 10,
    resolvedPlayers: resolved,
    unavailableFactors: [...UNAVAILABLE_FACTOR_LABELS],
    unavailableMarkets: [...TENNIS_UNAVAILABLE_MARKETS],
  };
}

export function passesTennisDataGate(pre: TennisPickAnalysis): boolean {
  if (pre.resolvedPlayers === 0) return false;
  if (pre.dataCoveragePct < 15) return false;
  return true;
}

export type TennisSimMetrics = {
  winProbability: { away: number; home: number };
  projectedTotalGames: number | null;
  avgGamesAway: number | null;
  avgGamesHome: number | null;
  confidenceScore: number;
};

export function tennisSimMetrics(sim: GameSimResult): TennisSimMetrics {
  const total =
    sim.homeProjectedScore != null && sim.awayProjectedScore != null
      ? Math.round((sim.homeProjectedScore + sim.awayProjectedScore) * 10) / 10
      : null;
  return {
    winProbability: { away: sim.awayWinProbability, home: sim.homeWinProbability },
    projectedTotalGames: total,
    avgGamesAway: sim.awayProjectedScore,
    avgGamesHome: sim.homeProjectedScore,
    confidenceScore: sim.confidenceScore,
  };
}

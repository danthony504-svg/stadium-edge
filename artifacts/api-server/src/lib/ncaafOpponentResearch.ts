/** Offline expected-score experiment. No market probabilities or production registration. */
import type { CfbdGame } from "./cfbdHistory.js";
import { priorTeamSample } from "./ncaafBacktest.js";
import {
  compareMarketLines,
  type BaselineQuote,
  type ScorePrediction,
} from "./ncaafMarketBaseline.js";
export const OPPONENT_RESEARCH_VERSION = "ncaaf-opponent-ridge-dev-v1";
const RIDGE = 4,
  ITERATIONS = 100;
/** Fit score = earlier league mean + offense(team) + defense(opponent), with ridge shrinkage. */
export function opponentScoreMeans(
  games: CfbdGame[],
  target: Pick<
    CfbdGame,
    "season" | "eventId" | "homeId" | "awayId" | "kickoff"
  >,
) {
  const prior = games
    .filter(
      (g) =>
        g.season === target.season &&
        g.eventId !== target.eventId &&
        g.overtime === false &&
        Date.parse(g.kickoff) + 86400000 < Date.parse(target.kickoff),
    )
    .sort((a, b) => a.eventId.localeCompare(b.eventId));
  const sample = (id: string) =>
    prior.filter((g) => g.homeId === id || g.awayId === id).length;
  if (sample(target.homeId) < 3 || sample(target.awayId) < 3) return null;
  const rows = prior.flatMap((g) => [
    { team: g.homeId, opp: g.awayId, points: g.homePoints },
    { team: g.awayId, opp: g.homeId, points: g.awayPoints },
  ]);
  const base = rows.reduce((n, r) => n + r.points, 0) / rows.length;
  const teams = [...new Set(rows.flatMap((r) => [r.team, r.opp]))].sort();
  const attack = new Map(teams.map((t) => [t, 0])),
    defense = new Map(teams.map((t) => [t, 0]));
  const offenseRows = new Map(
    teams.map((t) => [t, rows.filter((r) => r.team === t)]),
  );
  const defenseRows = new Map(
    teams.map((t) => [t, rows.filter((r) => r.opp === t)]),
  );
  for (let i = 0; i < ITERATIONS; i++) {
    for (const t of teams) {
      const r = offenseRows.get(t)!;
      attack.set(
        t,
        r.reduce((n, r) => n + r.points - base - defense.get(r.opp)!, 0) /
          (r.length + RIDGE),
      );
    }
    for (const t of teams) {
      const r = defenseRows.get(t)!;
      defense.set(
        t,
        r.reduce((n, r) => n + r.points - base - attack.get(r.team)!, 0) /
          (r.length + RIDGE),
      );
    }
  }
  const home = base + attack.get(target.homeId)! + defense.get(target.awayId)!;
  const away = base + attack.get(target.awayId)! + defense.get(target.homeId)!;
  if (![home, away].every((x) => Number.isFinite(x) && x >= 0 && x <= 84))
    return null;
  return { home, away, priorGames: prior.length };
}
export function runOpponentDevelopment(
  games: CfbdGame[],
  quotes: BaselineQuote[],
) {
  // Hard 2024 boundary: neither fitting nor evaluation consumes 2025.
  const development = games.filter((g) => g.season === 2024);
  const original: ScorePrediction[] = [],
    adjusted: ScorePrediction[] = [];
  const excluded = {
    overtime: 0,
    unknownOvertime: 0,
    thinHistory: 0,
    invalidOriginal: 0,
    invalidAdjusted: 0,
  };
  for (const g of development) {
    if (g.overtime === null) {
      excluded.unknownOvertime++;
      continue;
    }
    if (g.overtime) {
      excluded.overtime++;
      continue;
    }
    const h = priorTeamSample(development, g, g.homeId),
      a = priorTeamSample(development, g, g.awayId);
    if (!h || !a) {
      excluded.thinHistory++;
      continue;
    }
    if (
      ![h.ptsFor, h.ptsAgainst, a.ptsFor, a.ptsAgainst].every(
        (x) => x >= 0 && x <= 84,
      )
    ) {
      excluded.invalidOriginal++;
      continue;
    }
    const p = opponentScoreMeans(development, g);
    if (!p) {
      excluded.invalidAdjusted++;
      continue;
    }
    const home = (h.ptsFor + a.ptsAgainst) / 2,
      away = (a.ptsFor + h.ptsAgainst) / 2;
    original.push({ game: g, total: home + away, margin: home - away });
    adjusted.push({ game: g, total: p.home + p.away, margin: p.home - p.away });
  }
  const metrics = (rows: ScorePrediction[]) => {
    const avg = (f: (p: ScorePrediction) => number) =>
      rows.length
        ? Number((rows.reduce((n, p) => n + f(p), 0) / rows.length).toFixed(4))
        : null;
    return {
      totalMAE: avg((p) =>
        Math.abs(p.total - p.game.homePoints - p.game.awayPoints),
      ),
      marginMAE: avg((p) =>
        Math.abs(p.margin - p.game.homePoints + p.game.awayPoints),
      ),
      bookmakerComparison: compareMarketLines(rows, quotes, 2024),
    };
  };
  return {
    version: OPPONENT_RESEARCH_VERSION,
    season: 2024,
    role: "development_only",
    parameters: {
      ridge: RIDGE,
      iterations: ITERATIONS,
      minimumTeamGames: 3,
      kickoffLagHours: 24,
    },
    games: development.length,
    pairedGames: adjusted.length,
    excluded,
    original: metrics(original),
    opponentAdjusted: metrics(adjusted),
    productionReady: false,
    validationReady: false,
    limitations: [
      "expected_scores_only_no_simulation_or_probability_validation",
      "fixed_experimental_parameters_not_validated",
      "no_neutral_site_metadata_venue_adjustments_deferred",
      "completion_and_historical_revision_availability_unverified",
      "known_non_ot_selection_bias",
      "book_lines_not_verified_pregame_or_closing",
      "no_injury_adjustments",
      "no_roi_or_production_acceptance",
      "2025_not_evaluated_by_this_command",
    ],
  };
}

/** Authenticate an ESPN mens-college-basketball final for research settlement. */
import { createHash } from "node:crypto";

const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const iso = (v) => typeof v === "string" && Number.isFinite(Date.parse(v));

function periodPoints(entry, expectedPeriod) {
  const value =
    typeof entry?.value === "number"
      ? entry.value
      : typeof entry?.displayValue === "string" && /^\d+$/.test(entry.displayValue)
        ? Number(entry.displayValue)
        : NaN;
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    (entry?.period != null && entry.period !== expectedPeriod)
  )
    throw Error("ncaab_summary_invalid_period");
  return value;
}

/**
 * Bind one completed ESPN summary to a single authenticated research game.
 * Basketball requires at least two regulation halves; extra periods are OT.
 */
export function ncaabSummaryFinal(
  raw,
  eventId,
  season,
  requestStartedAt,
  receivedAt,
) {
  if (
    typeof raw !== "string" ||
    !/^\d+$/.test(eventId) ||
    !Number.isSafeInteger(season) ||
    season < 2021 ||
    !iso(requestStartedAt) ||
    !iso(receivedAt) ||
    Date.parse(receivedAt) < Date.parse(requestStartedAt)
  )
    throw Error("ncaab_summary_request_identity");

  const payload = JSON.parse(raw);
  const header = payload.header;
  if (
    header?.id !== eventId ||
    header.season?.year !== season ||
    header.league?.slug !== "mens-college-basketball" ||
    !Array.isArray(header.competitions) ||
    header.competitions.length !== 1
  )
    throw Error("ncaab_summary_identity");

  const competition = header.competitions[0];
  const status = competition.status ?? header.status;
  if (status?.type?.completed !== true || status?.type?.state !== "post")
    throw Error("ncaab_summary_not_final");
  if (!iso(competition.date)) throw Error("ncaab_summary_kickoff");
  if (Date.parse(competition.date) >= Date.parse(receivedAt))
    throw Error("ncaab_summary_future_kickoff");

  const competitors = competition.competitors;
  if (!Array.isArray(competitors) || competitors.length !== 2)
    throw Error("ncaab_summary_sides");

  const bySide = Object.fromEntries(
    competitors.map((side) => [side.homeAway, side]),
  );
  if (!bySide.home || !bySide.away) throw Error("ncaab_summary_home_away");

  const parseSide = (side) => {
    const teamId = String(side.team?.id ?? "");
    if (!/^\d+$/.test(teamId)) throw Error("ncaab_summary_team_id");
    if (!Array.isArray(side.linescores) || side.linescores.length < 2)
      throw Error("ncaab_summary_periods_missing");
    const periods = side.linescores.map((entry, index) =>
      periodPoints(entry, index + 1),
    );
    const homePoints = Number(side.score);
    if (!Number.isSafeInteger(homePoints) || homePoints < 0)
      throw Error("ncaab_summary_score");
    const periodSum = periods.reduce((a, b) => a + b, 0);
    if (periodSum !== homePoints) throw Error("ncaab_summary_score_mismatch");
    const regulationPoints = periods[0] + periods[1];
    return {
      teamId,
      points: homePoints,
      regulationPoints,
      periods,
      overtime: periods.length > 2,
    };
  };

  const home = parseSide(bySide.home);
  const away = parseSide(bySide.away);
  if (home.teamId === away.teamId) throw Error("ncaab_summary_duplicate_teams");
  if (home.periods.length !== away.periods.length)
    throw Error("ncaab_summary_period_length");
  if (home.overtime !== away.overtime) throw Error("ncaab_summary_ot_mismatch");

  const game = {
    sport: "ncaab",
    season,
    eventId,
    homeId: home.teamId,
    awayId: away.teamId,
    kickoff: competition.date,
    homePoints: home.points,
    awayPoints: away.points,
    regulationHomePoints: home.regulationPoints,
    regulationAwayPoints: away.regulationPoints,
    overtime: home.overtime,
    ruleset: "full_game_including_overtime",
    settlement: "full_game_including_overtime",
    source: "espn_mens_college_basketball_summary",
    sourceSha256: sha(raw),
    periodEvidence: "ordered_summary_linescores",
    periodOrderingIndependentlyVerified: false,
    periodCount: home.periods.length,
    completedAt: receivedAt,
    observedAt: receivedAt,
    requestStartedAt,
    receivedAt,
  };

  return {
    version: 1,
    sport: "ncaab",
    researchOnly: true,
    releaseEligible: false,
    source: "espn_mens_college_basketball_summary",
    sha256: sha(raw),
    rawResponse: raw,
    requestStartedAt,
    receivedAt,
    games: [game],
  };
}

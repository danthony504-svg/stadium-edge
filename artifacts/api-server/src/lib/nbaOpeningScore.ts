// Settlement evidence from finalized NBA play-by-play. Team first points and
// player first made field goal are separate events.
type Play = {
  id?: string;
  sequenceNumber?: string;
  period?: { number?: number };
  clock?: { displayValue?: string };
  scoringPlay?: boolean;
  scoreValue?: number;
  homeScore?: number;
  awayScore?: number;
  team?: { id?: string };
  participants?: { athlete?: { id?: string } }[];
};

export type NbaOpeningSummary = {
  header?: {
    id?: string;
    competitions?: {
      id?: string;
      status?: { type?: { completed?: boolean; name?: string } };
      competitors?: { id?: string; homeAway?: string }[];
    }[];
  };
  plays?: Play[];
};

type ScoringEvent = { playId: string; teamId: string; points: number; clock: string | null };

export function resolveNbaOpeningScore(summary: NbaOpeningSummary, eventId: string) {
  const header = summary?.header;
  const competition = header?.competitions?.find((item) => item.id === eventId);
  if (header?.id !== eventId || competition?.status?.type?.completed !== true ||
      competition.status.type.name !== "STATUS_FINAL") return null;

  const competitors = competition.competitors ?? [];
  const homeId = competitors.find((team) => team.homeAway === "home")?.id;
  const awayId = competitors.find((team) => team.homeAway === "away")?.id;
  if (competitors.length !== 2 || !homeId || !awayId || homeId === awayId) return null;

  const plays = (summary.plays ?? []).filter((play) => play.period?.number === 1);
  if (!plays.length || plays.some((play) => !/^\d+$/.test(play.sequenceNumber ?? ""))) return null;
  plays.sort((a, b) => Number(a.sequenceNumber) - Number(b.sequenceNumber));
  const opening = plays[0]!;
  const openingClock = opening.clock?.displayValue;
  // ESPN can omit the opening jump ball and begin with a 0–0 event at 11:59.
  if (openingClock !== "12:00" &&
      (openingClock !== "11:59" || opening.homeScore !== 0 || opening.awayScore !== 0)) return null;

  let previousSequence = -1;
  let homeScore = 0;
  let awayScore = 0;
  let firstPoints: ScoringEvent | undefined;
  for (const play of plays) {
    const sequence = Number(play.sequenceNumber);
    if (sequence <= previousSequence || !Number.isInteger(play.homeScore) || !Number.isInteger(play.awayScore)) return null;
    previousSequence = sequence;
    const homeDelta = play.homeScore! - homeScore;
    const awayDelta = play.awayScore! - awayScore;
    homeScore = play.homeScore!;
    awayScore = play.awayScore!;
    if (homeDelta === 0 && awayDelta === 0 && play.scoringPlay !== true) continue;

    const teamId = play.team?.id;
    const points = play.scoreValue;
    if (play.scoringPlay !== true || !play.id ||
        (teamId !== homeId && teamId !== awayId) ||
        (points !== 1 && points !== 2 && points !== 3) ||
        homeDelta !== (teamId === homeId ? points : 0) ||
        awayDelta !== (teamId === awayId ? points : 0)) return null;

    const event = { playId: play.id, teamId, points, clock: play.clock?.displayValue ?? null };
    firstPoints ??= event;
    if (points === 1) continue;
    const playerId = play.participants?.[0]?.athlete?.id;
    if (!playerId) return null;
    return { eventId, firstPoints, firstMadeFieldGoal: { ...event, playerId } };
  }
  return null;
}

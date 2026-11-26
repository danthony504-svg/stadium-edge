import { supportedProjectedCarries } from "./comparablePropMatchup.js";

export type PreparedExpectedCarries = {
  eventId: string;
  athleteId: string;
  teamId: string;
  carries: number;
  source: string;
  capturedAt: string;
};

export function selectPreparedExpectedCarries(input: {
  sport: string;
  market: string;
  position?: string | null;
  athleteId?: string | null;
  teamId?: string | null;
  context?: {
    sport: string;
    eventId: string;
    startsAt: string;
    homeTeamId: string;
    awayTeamId: string;
    expectedCarries?: readonly PreparedExpectedCarries[];
  } | null;
  nowMs?: number;
}): PreparedExpectedCarries | null {
  const { context, athleteId, teamId } = input;
  if (!context || context.sport !== input.sport || !athleteId || !teamId ||
      ![context.homeTeamId, context.awayTeamId].includes(teamId) ||
      !["RB", "HB"].includes(input.position?.toUpperCase() ?? "")) return null;
  const startsAt = Date.parse(context.startsAt);
  const now = input.nowMs ?? Date.now();
  if (!(startsAt > now)) return null;
  const estimates = (context.expectedCarries ?? []).filter(row =>
    row.eventId === context.eventId && row.athleteId === athleteId && row.teamId === teamId &&
    typeof row.source === "string" && row.source.trim().length > 0 && Date.parse(row.capturedAt) <= now &&
    supportedProjectedCarries(input.sport, input.market, row.carries) != null,
  );
  return estimates.length === 1 ? estimates[0]! : null;
}

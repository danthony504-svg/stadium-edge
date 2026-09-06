import type { HistoricalFantasyAnalysis } from "./fantasyNflAnalysis.ts";
import type { FantasyRoster, FantasyRosterPlayer } from "./fantasyRoster.ts";

export type FantasyTradeVerdict = "LEAN ACCEPT" | "LEAN DECLINE" | "CLOSE TRADE" | "INSUFFICIENT DATA";
export type FantasyTradeAnalysis = {
  id: string; createdAt: number; give: FantasyRosterPlayer[]; receive: FantasyRosterPlayer[];
  verdict: FantasyTradeVerdict; basis: "recent_performance_injuries_roster_fit";
  giveRecentPoints: number | null; receiveRecentPoints: number | null;
  injuredPlayers: string[]; positionalImpact: string; rosterNeed: string; explanation: string;
};

function average(players: FantasyRosterPlayer[], analysis: Record<string, HistoricalFantasyAnalysis>): number | null {
  const values = players.map((p) => analysis[p.athleteId]?.recentAverage).filter((v): v is number => v != null && Number.isFinite(v));
  return values.length === players.length && values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export function analyzeFantasyTrade(opts: {
  give: FantasyRosterPlayer[]; receive: FantasyRosterPlayer[]; roster: FantasyRoster;
  analysis: Record<string, HistoricalFantasyAnalysis>; injuries: Record<string, string>;
}): FantasyTradeAnalysis {
  const giveRecentPoints = average(opts.give, opts.analysis);
  const receiveRecentPoints = average(opts.receive, opts.analysis);
  const injuredPlayers = [...opts.give, ...opts.receive].filter((p) => opts.injuries[p.name.toLowerCase()] && !/active|healthy/i.test(opts.injuries[p.name.toLowerCase()]!)).map((p) => p.name);
  const incomingPositions = opts.receive.map((p) => p.position ?? "unknown");
  const rosterCounts = opts.roster.players.reduce<Record<string, number>>((out, p) => ({ ...out, [p.position ?? "unknown"]: (out[p.position ?? "unknown"] ?? 0) + 1 }), {});
  const rosterNeed = incomingPositions.some((p) => (rosterCounts[p] ?? 0) < 2) ? "Incoming players improve a thinner roster position." : "Incoming players do not fill a clearly thin roster position.";
  let verdict: FantasyTradeVerdict = "INSUFFICIENT DATA";
  if (giveRecentPoints != null && receiveRecentPoints != null) {
    if (injuredPlayers.length) verdict = "CLOSE TRADE";
    else if (receiveRecentPoints > giveRecentPoints + 1) verdict = "LEAN ACCEPT";
    else if (giveRecentPoints > receiveRecentPoints + 1) verdict = "LEAN DECLINE";
    else verdict = "CLOSE TRADE";
  }
  return {
    id: `trade-${Date.now()}`, createdAt: Date.now(), give: opts.give, receive: opts.receive, verdict,
    basis: "recent_performance_injuries_roster_fit", giveRecentPoints, receiveRecentPoints, injuredPlayers,
    positionalImpact: incomingPositions.join(", "), rosterNeed,
    explanation: verdict === "INSUFFICIENT DATA" ? "Insufficient recorded game-log data for one or more players." : "Based on recent performance, injuries, and roster fit.",
  };
}

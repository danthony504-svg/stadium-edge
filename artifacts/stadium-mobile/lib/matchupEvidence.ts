/** Descriptive evidence only. Never changes model probabilities or Coach. */
import type { PropSimPlayerHistoryPayload, TeamDefense } from "./api.ts";
import { computeAmbiguous, gameValueForMarket } from "./propStats.ts";
export type MatchupEvidence = {
  observations: string[];
  opportunity: string[];
  positionContext: string | null;
  cautions: string[];
  missing: string[];
  source: string;
};
export function marketDefenseContext(
  sport: string,
  market: string,
  name: string,
  d?: TeamDefense | null,
  cutoffMs = Date.now(),
): string | null {
  if (!d || d.sport !== sport) return null;
  if (sport === "nhl" && /^player_shots_on_goal(?:_alternate)?$/.test(market)) {
    const a = d.shotAllowance;
    if (a && a.sampleSize >= 3 && Number.isFinite(a.shotsAllowedPerGame) && a.shotsAllowedPerGame >= 0 && Number.isFinite(Date.parse(a.firstGame)) && Date.parse(a.firstGame) <= Date.parse(a.lastGame) && Date.parse(a.lastGame) < cutoffMs)
      return `${name} allows ${a.shotsAllowedPerGame.toFixed(1)} shots on goal/game (n=${a.sampleSize}; ${a.firstGame.slice(0,10)}–${a.lastGame.slice(0,10)}; ${a.source}). Team-wide, not a player or position allowance; ice time and role still matter.`;
    return null;
  }
  if (["nfl", "ncaaf", "cfb"].includes(sport)) {
    if (
      /^player_rush_yds(?:_alternate)?$/.test(market) &&
      d.rushDefense &&
      d.rushDefense.sampleSize > 0 &&
      Number.isFinite(d.rushDefense.rushingYardsAllowedPerGame)
    )
      return `${name} allows ${d.rushDefense.rushingYardsAllowedPerGame!.toFixed(1)} rush yards/game (n=${d.rushDefense.sampleSize} completed boxes; ESPN; team-wide). Position-specific opportunity is unverified.`;
    if (
      /^player_(?:pass|reception)_yds(?:_alternate)?$/.test(market) &&
      d.passDefense &&
      d.passDefense.sampleSize > 0 &&
      Number.isFinite(d.passDefense.passingYardsAllowedPerGame)
    )
      return `${name} allows ${d.passDefense.passingYardsAllowedPerGame!.toFixed(1)} pass yards/game (n=${d.passDefense.sampleSize} completed boxes; ESPN; team-wide). Broader passing context, not receiver-specific allowance.`;
  }
  if (
    ["nba", "wnba", "ncaab", "cbb"].includes(sport) &&
    /^player_points(?:_alternate)?$/.test(market) &&
    Number.isFinite(d.avgPointsAgainst)
  )
    return `${name} allows ${d.avgPointsAgainst!.toFixed(1)} PPG (ESPN; season; team-wide; sample size unavailable). Position-specific allowances, pace and defensive efficiency are unavailable; this alone cannot establish an advantage.`;
  return null;
}
export function explainMatchup(o: {
  sport: string;
  athleteId: string | null;
  market: string;
  line: number;
  side: "Over" | "Under";
  history?: PropSimPlayerHistoryPayload | null;
  startsAt: string;
  opponentId?: string | null;
  position?: string | null;
  isHome?: boolean;
  nowMs?: number;
  opponentName: string;
  opponentDefense?: TeamDefense | null;
  simProbability?: number;
  simSample?: number;
}): MatchupEvidence {
  const opportunity: string[] = [];
  const observations: string[] = [],
    cautions: string[] = [],
    missing: string[] = [];
  const h = o.history,
    cutoff = Math.min(o.nowMs ?? Date.now(), Date.parse(o.startsAt));
  const bound =
    !!h &&
    !!o.athleteId &&
    h.athleteId === o.athleteId &&
    h.sport === o.sport &&
    Number.isFinite(cutoff);
  const ambiguous = computeAmbiguous(bound ? h!.labels : []),
    seen = new Set<string>();
  const games = (bound ? h!.recent : [])
    .flatMap((g) => {
      const date = Date.parse(g.date ?? "");
      if (!Number.isFinite(date) || date >= cutoff || seen.has(g.date!))
        return [];
      seen.add(g.date!);
      const value = gameValueForMarket(o.market, g.stats ?? {}, ambiguous);
      return value != null && Number.isFinite(value)
        ? [{ ...g, value, dateMs: date }]
        : [];
    })
    .sort((a, b) => b.dateMs - a.dateMs)
    .slice(0, 10);
  const avg = (rows: typeof games) =>
    rows.reduce((n, g) => n + g.value, 0) / rows.length;
  if (games.length) {
    const mean = avg(games),
      hits = games.filter((g) =>
        o.side === "Over" ? g.value > o.line : g.value < o.line,
      ).length;
    observations.push(
      `Exact-market history: ${mean.toFixed(1)} average; ${hits}/${games.length} hit ${o.side} ${o.line} (last ${games.length} dated games; pushes are not hits).`,
    );
    if (
      (o.side === "Over" && mean < o.line) ||
      (o.side === "Under" && mean > o.line)
    )
      cautions.push(
        "Historical average is on the opposite side of the selection; history and simulation disagree.",
      );
    if (games.length === 10) {
      const recent = avg(games.slice(0, 5)),
        previous = avg(games.slice(5));
      observations.push(
        `Recent trend: last 5 average ${recent.toFixed(1)} versus preceding 5 ${previous.toFixed(1)}. Descriptive change, not a forecast or established cause.`,
      );
    }
    const split = games.filter(
      (g) => typeof o.isHome === "boolean" && typeof g.isHome === "boolean" && g.isHome === o.isHome,
    );
    if (split.length >= 3)
      observations.push(
        `${o.isHome ? "Home" : "Away"} average ${avg(split).toFixed(1)} (n=${split.length}; within this window).`,
      );
    else missing.push("Home/away sample: fewer than 3 verified games.");
    const vs = o.opponentId
      ? games.filter((g) => g.opponentId === o.opponentId)
      : [];
    if (vs.length >= 3)
      observations.push(
        `Against this opponent: ${avg(vs).toFixed(1)} average (n=${vs.length}; within this window).`,
      );
    else missing.push("Opponent-specific sample: fewer than 3 verified games.");
    if (["nba", "wnba", "ncaab", "cbb"].includes(o.sport)) {
      const minutes = games.flatMap((g) => {
        const raw = g.stats?.MIN;
        if (typeof raw !== "string" || !/^\d+(?:\.\d+|:\d{2})?$/.test(raw))
          return [];
        const parts = raw.split(":"),
          n =
            parts.length === 2
              ? Number(parts[0]) + Number(parts[1]) / 60
              : Number(raw);
        return n >= 0 &&
          n <= 80 &&
          (parts.length === 1 || Number(parts[1]) < 60)
          ? [n]
          : [];
      });
      if (minutes.length >= 3)
        observations.push(
          `Playing time: ${(minutes.reduce((a, b) => a + b, 0) / minutes.length).toFixed(1)} minutes/game (n=${minutes.length}; logged MIN). Future minutes unconfirmed.`,
        );
      else missing.push("Verified playing-time sample unavailable.");
    }
  } else
    missing.push(
      "Dated, athlete-bound history for this exact market unavailable.",
    );
  // Unique machine fields or unambiguous display labels only. Missing is not zero.
  const opportunityFields: Array<[string, string[]]> =
    ["nba", "wnba", "ncaab", "cbb"].includes(o.sport)
      ? [["Field-goal attempts", ["fieldGoalsAttempted", "FGA"]], ["Three-point attempts", ["threePointFieldGoalsAttempted", "3PA"]]]
      : ["nfl", "ncaaf", "cfb"].includes(o.sport)
        ? [["Pass attempts", ["passingAttempts"]], ["Carries", ["rushingAttempts"]], ["Targets", ["receivingTargets"]]]
        : o.sport === "mlb"
          ? [["Plate appearances", ["plateAppearances", "PA"]], ["At-bats", ["atBats", "AB"]]]
          : o.sport === "nhl"
            ? [["Shots on goal", ["shotsOnGoal", "S"]]]
            : o.sport === "soccer"
              ? [["Minutes played", ["minutesPlayed", "MIN"]]] : [];
  for (const [label, keys] of opportunityFields) {
    const values = games.flatMap(g => {
      // Conflicting aliases fail closed rather than silently choosing one.
      const vals = keys.filter(k => !ambiguous.has(k)).flatMap(k => {
        const raw = g.stats?.[k];
        if (typeof raw !== "string" || !/^\d+(?:\.\d+)?$/.test(raw.trim())) return [];
        const v = Number(raw);
        return Number.isFinite(v) && v >= 0 ? [v] : [];
      });
      const unique = [...new Set(vals)];
      return unique.length === 1 ? unique : [];
    });
    if (values.length >= 3) opportunity.push(`${label}: ${(values.reduce((a,b) => a+b,0)/values.length).toFixed(1)}/game (n=${values.length}; logged history).`);
  }
  // Logged playing time is genuine opportunity evidence, even without usage%.
  opportunity.push(...observations.filter(t => t.startsWith("Playing time:")));
  observations.push(...opportunity.filter(t => !observations.includes(t)));
  if (!opportunity.length) missing.push("Logged opportunity sample unavailable or fewer than 3 verified games.");
  const boundDefense =
    o.opponentId && o.opponentDefense?.teamId === o.opponentId
      ? o.opponentDefense
      : null;
  const positionRows = boundDefense?.positionAllowances;
  const position = o.position?.toUpperCase();
  const positional = positionRows?.rows.find(r => r.position === position && r.market === o.market && r.games >= 3 && r.minutes > 0 && Number.isFinite(r.per36) && r.per36 >= 0 && Date.parse(r.lastGame) < cutoff && Date.parse(r.firstGame) <= Date.parse(r.lastGame));
  const positionContext = positional ? `${o.opponentName}: opposing ${position} players produced ${positional.per36.toFixed(1)} ${o.market.replace(/^player_/, "").replace(/_/g," ")} per 36 pooled minutes (n=${positional.games} games; ${positional.appearances} player appearances; ${positional.minutes} minutes; ${positional.firstGame.slice(0,10)}–${positional.lastGame.slice(0,10)}). Observed primary-position production, not a league rank or individual-player forecast. Source: ${positionRows!.source}.` : null;
  if (positionContext) observations.push(positionContext);
  else missing.push("Verified primary-position opponent allowance unavailable or fewer than 3 completed games.");
  const defense = marketDefenseContext(
    o.sport,
    o.market,
    o.opponentName,
    boundDefense,
    cutoff,
  );
  if (defense && !positional) observations.push(defense);
  else if (!positional && !defense)
    missing.push(
      "Market-specific opponent allowance unavailable; overall points allowed is not a substitute.",
    );
  missing.push(
    "Current injury impact, confirmed lineup/role changes and future opportunity are not supplied to this analysis. Logged activity does not establish future usage.",
  );
  if (o.simSample != null) cautions.push(
    `Simulation history n=${o.simSample}; Monte Carlo draws are not independent historical games. Calibration for this matchup is unverified.`,
  );
  else cautions.push("Historical observations are descriptive; they do not establish a calibrated forecast or a cause.");
  if (o.simProbability != null && (o.simProbability >= 0.95 || o.simProbability <= 0.05))
    cautions.push(
      "Extreme model estimate: verify identity, stat mapping, opportunity and calibration. This is not near certainty.",
    );
  return {
    observations,
    opportunity,
    positionContext,
    cautions,
    missing,
    source: games.length
      ? `Simulation-shared player history; ${new Date(games[games.length - 1]!.dateMs).toISOString().slice(0, 10)}–${new Date(games[0]!.dateMs).toISOString().slice(0, 10)}. Feed refresh time unavailable.`
      : "Shared history unavailable or unverified; no extra data requests.",
  };
}

/** Descriptive evidence only. Never changes model probabilities or Coach. */
import type { PropSimPlayerHistoryPayload, TeamDefense } from "./api.ts";
import { computeAmbiguous, gameValueForMarket } from "./propStats.ts";
export type MatchupEvidence = {
  observations: string[];
  cautions: string[];
  missing: string[];
  source: string;
};
export function marketDefenseContext(
  sport: string,
  market: string,
  name: string,
  d?: TeamDefense | null,
): string | null {
  if (!d || d.sport !== sport) return null;
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
  isHome?: boolean;
  nowMs?: number;
  opponentName: string;
  opponentDefense?: TeamDefense | null;
  simProbability?: number;
  simSample?: number;
}): MatchupEvidence {
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
  const boundDefense =
    o.opponentId && o.opponentDefense?.teamId === o.opponentId
      ? o.opponentDefense
      : null;
  const defense = marketDefenseContext(
    o.sport,
    o.market,
    o.opponentName,
    boundDefense,
  );
  if (defense) observations.push(defense);
  else
    missing.push(
      "Market-specific opponent allowance unavailable; overall points allowed is not a substitute.",
    );
  missing.push(
    "Current injury impact, lineup/role changes and detailed opportunity metrics are not supplied to this analysis.",
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
    cautions,
    missing,
    source: games.length
      ? `Simulation-shared player history; ${new Date(games[games.length - 1]!.dateMs).toISOString().slice(0, 10)}–${new Date(games[0]!.dateMs).toISOString().slice(0, 10)}. Feed refresh time unavailable.`
      : "Shared history unavailable or unverified; no extra data requests.",
  };
}

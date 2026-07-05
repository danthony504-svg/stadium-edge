// Sport-specific Matchup Score factors — every sport uses the same 0..100
// weighted rubric, but the factors differ. Only real, grounded signals are
// scored; missing data is omitted and weights renormalize.

import type { MatchupHistoryEntry } from "./api.ts";
import type { RealPropSignals } from "./propFactors.ts";
import { computeHrScore, type HrScoreInput } from "./hrScore.ts";

export type MatchupScoreFactor = {
  key: string;
  label: string;
  weight: number;
  sub: number | null;
  display: string | null;
};

export type SportMatchupContext = {
  sport: string;
  marketKey: string;
  side?: string;
  mlb?: RealPropSignals["mlb"] | null;
  oppDefense?: RealPropSignals["oppDefense"] | null;
  matchup?: MatchupHistoryEntry | null;
  homeAway?: RealPropSignals["homeAway"] | null;
  /** Whether the player's team is home or away tonight. */
  playerSide?: "home" | "away" | null;
  usageMinutes?: number | null;
  mlLeanAligned?: 1 | 0 | -1 | null;
  mlLeanEdge?: number | null;
  opponentKeyInjuries?: number | null;
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const lin = (x: number, lo: number, hi: number) => clamp01((x - lo) / (hi - lo));

type RestInfo = { restDays: number; backToBack: boolean };
type VenueForm = { avgMargin?: number | null; ptsAgainst?: number | null; ptsFor?: number | null };

function parseRest(v: unknown): RestInfo | null {
  if (!v || typeof v !== "object") return null;
  const r = v as { restDays?: number; backToBack?: boolean };
  if (typeof r.restDays !== "number" || !Number.isFinite(r.restDays)) return null;
  return { restDays: r.restDays, backToBack: !!r.backToBack };
}

function parseVenueForm(v: unknown): VenueForm | null {
  if (!v || typeof v !== "object") return null;
  const s = v as VenueForm;
  if (s.avgMargin == null && s.ptsAgainst == null && s.ptsFor == null) return null;
  return s;
}

function parseH2H(v: unknown): { homeWins?: number; awayWins?: number } | null {
  if (!v || typeof v !== "object") return null;
  const h = v as { homeWins?: number; awayWins?: number };
  if (h.homeWins == null && h.awayWins == null) return null;
  return h;
}

function isHrMarket(sport: string, marketKey: string): boolean {
  return sport === "mlb" && (/home_?run/i.test(marketKey) || /batter_home_runs/.test(marketKey));
}

function addSharedFactors(ctx: SportMatchupContext, factors: MatchupScoreFactor[]): void {
  const { matchup, homeAway, playerSide, mlLeanAligned, mlLeanEdge, opponentKeyInjuries, side } = ctx;

  if (playerSide && matchup) {
    const venue = playerSide === "home" ? parseVenueForm(matchup.homeVenueForm) : parseVenueForm(matchup.awayVenueForm);
    if (venue?.avgMargin != null) {
      factors.push({
        key: "venue",
        label: playerSide === "home" ? "Home venue form" : "Road venue form",
        weight: 12,
        sub: lin(venue.avgMargin, -8, 10),
        display: `${venue.avgMargin > 0 ? "+" : ""}${venue.avgMargin.toFixed(1)} margin`,
      });
    }
    const rest = playerSide === "home" ? parseRest(matchup.homeRest) : parseRest(matchup.awayRest);
    const oppRest = playerSide === "home" ? parseRest(matchup.awayRest) : parseRest(matchup.homeRest);
    if (rest) {
      const sub = rest.backToBack ? 0.2 : lin(rest.restDays, 0, 3);
      factors.push({
        key: "rest",
        label: "Rest",
        weight: 10,
        sub,
        display: rest.backToBack ? "Back-to-back" : `${rest.restDays}d rest`,
      });
    }
    if (oppRest?.backToBack) {
      factors.push({
        key: "opp_rest",
        label: "Opp fatigue",
        weight: 8,
        sub: lin(3 - oppRest.restDays, 0, 3),
        display: `Opp ${oppRest.restDays}d rest`,
      });
    }
  }

  if (homeAway && playerSide) {
    const fav = playerSide === "home" ? homeAway.homeAvg : homeAway.awayAvg;
    const other = playerSide === "home" ? homeAway.awayAvg : homeAway.homeAvg;
    if (Number.isFinite(fav) && Number.isFinite(other)) {
      factors.push({
        key: "home_away",
        label: "Home/Away split",
        weight: 10,
        sub: lin(fav - other, -3, 3),
        display: `${fav.toFixed(1)} vs ${other.toFixed(1)} avg`,
      });
    }
  }

  const h2h = parseH2H(matchup?.h2h);
  if (h2h && playerSide) {
    const playerWins = playerSide === "home" ? (h2h.homeWins ?? 0) : (h2h.awayWins ?? 0);
    const oppWins = playerSide === "home" ? (h2h.awayWins ?? 0) : (h2h.homeWins ?? 0);
    const total = playerWins + oppWins;
    if (total > 0) {
      factors.push({
        key: "h2h",
        label: "Head-to-head",
        weight: 10,
        sub: lin(playerWins / total, 0.25, 0.75),
        display: `${playerWins}-${oppWins} recent`,
      });
    }
  }

  if (mlLeanAligned != null && mlLeanEdge != null && mlLeanEdge > 0) {
    const sub =
      mlLeanAligned === 1
        ? lin(mlLeanEdge, 0, 4)
        : mlLeanAligned === -1
          ? lin(4 - mlLeanEdge, 0, 4)
          : 0.5;
    factors.push({
      key: "lean",
      label: "Game script / lean",
      weight: 12,
      sub,
      display: mlLeanAligned === 1 ? "on your side" : mlLeanAligned === -1 ? "against" : "neutral",
    });
  }

  if (opponentKeyInjuries != null && opponentKeyInjuries > 0) {
    const helpsOver = String(side ?? "over").toLowerCase() !== "under";
    factors.push({
      key: "opp_inj",
      label: "Opp injuries",
      weight: 10,
      sub: helpsOver ? lin(opponentKeyInjuries, 0, 4) : lin(4 - opponentKeyInjuries, 0, 4),
      display: `${opponentKeyInjuries} key out`,
    });
  }
}

function mlbFactors(ctx: SportMatchupContext): MatchupScoreFactor[] {
  const factors: MatchupScoreFactor[] = [];
  const { sport, marketKey, mlb } = ctx;
  if (!mlb) return factors;

  if (isHrMarket(sport, marketKey)) {
    const hrInput: HrScoreInput = {
      hrPer9: mlb.pitcher?.hrPer9 ?? null,
      barrelPctAllowed: mlb.pitcher?.barrelPctAllowed ?? null,
      hardHitPctAllowed: mlb.pitcher?.hardHitPctAllowed ?? null,
      battedBallEvents: mlb.pitcher?.battedBallEvents ?? null,
      flyBallPct: mlb.pitcher?.flyBallPct ?? null,
      hrIndex: mlb.ballpark?.hrIndex ?? null,
      tempF: mlb.ballpark?.tempF ?? null,
      dome: mlb.ballpark?.dome ?? null,
      platoonOps: mlb.platoon?.ops ?? null,
    };
    const hr = computeHrScore(hrInput);
    for (const f of hr.factors) {
      if (f.sub == null) continue;
      factors.push({ key: f.key, label: f.label, weight: f.weight, sub: f.sub, display: f.display });
    }
  } else {
    const p = mlb.pitcher;
    if (p?.hrPer9 != null) {
      factors.push({
        key: "pitcher_hr9",
        label: "Pitcher matchup",
        weight: 18,
        sub: lin(p.hrPer9, 0.6, 1.8),
        display: `${p.hrPer9.toFixed(2)} HR/9`,
      });
    }
    if (p?.oppOPS != null) {
      factors.push({
        key: "pitcher_ops",
        label: "Pitcher opp OPS",
        weight: 16,
        sub: lin(p.oppOPS, 0.65, 0.85),
        display: `${p.oppOPS.toFixed(3)} OPS`,
      });
    }
    if (p?.kPer9 != null && /strikeout|pitcher_strikeout/i.test(marketKey)) {
      factors.push({
        key: "pitcher_k9",
        label: "Pitcher K/9",
        weight: 20,
        sub: lin(11 - p.kPer9, 0, 4),
        display: `${p.kPer9.toFixed(1)} K/9`,
      });
    }
    if (mlb.platoon?.ops != null) {
      factors.push({
        key: "platoon",
        label: "L/R split",
        weight: 14,
        sub: lin(mlb.platoon.ops, 0.65, 0.95),
        display: `${mlb.platoon.ops.toFixed(3)} vs ${mlb.platoon.hand}`,
      });
    }
    if (mlb.ballpark?.hrIndex != null) {
      factors.push({
        key: "park",
        label: "Park factor",
        weight: 12,
        sub: lin(mlb.ballpark.hrIndex, 90, 115),
        display: `${Math.round(mlb.ballpark.hrIndex)} index`,
      });
    }
    if (mlb.ballpark?.tempF != null || mlb.ballpark?.dome) {
      factors.push({
        key: "weather",
        label: "Weather",
        weight: 10,
        sub: mlb.ballpark.dome ? 0.5 : lin(mlb.ballpark.tempF ?? 50, 50, 90),
        display: mlb.ballpark.dome ? "Dome" : `${mlb.ballpark.tempF}°F`,
      });
    }
    if (p?.name) {
      factors.push({
        key: "starter",
        label: "Probable starter",
        weight: 6,
        sub: p.kPer9 != null ? lin(9 - p.kPer9, 0, 5) : 0.55,
        display: p.name,
      });
    }
  }
  return factors;
}

function basketballFactors(ctx: SportMatchupContext): MatchupScoreFactor[] {
  const factors: MatchupScoreFactor[] = [];
  const d = ctx.oppDefense;
  if (d?.pointsAgainst != null) {
    factors.push({
      key: "defense",
      label: "Defensive matchup",
      weight: 22,
      sub: lin(d.pointsAgainst, 100, 118),
      display: `${d.pointsAgainst.toFixed(1)} pts allowed`,
    });
  }
  if (d?.blocks != null && /rebound|block/i.test(ctx.marketKey)) {
    factors.push({
      key: "blocks",
      label: "Opp rim protection",
      weight: 12,
      sub: lin(6 - d.blocks, 0, 3),
      display: `${d.blocks.toFixed(1)} blk/g`,
    });
  }
  const pace =
    ctx.playerSide === "home"
      ? ctx.matchup?.homePace
      : ctx.playerSide === "away"
        ? ctx.matchup?.awayPace
        : ctx.matchup?.homePace != null && ctx.matchup?.awayPace != null
          ? (ctx.matchup.homePace + ctx.matchup.awayPace) / 2
          : null;
  if (pace != null) {
    factors.push({
      key: "pace",
      label: "Pace",
      weight: 18,
      sub: lin(pace, 95, 105),
      display: `${pace.toFixed(1)} poss`,
    });
  }
  if (ctx.usageMinutes != null) {
    factors.push({
      key: "minutes",
      label: "Minutes / role",
      weight: 14,
      sub: lin(ctx.usageMinutes, 22, 36),
      display: `${ctx.usageMinutes.toFixed(1)} min avg`,
    });
  }
  return factors;
}

function footballFactors(ctx: SportMatchupContext): MatchupScoreFactor[] {
  const factors: MatchupScoreFactor[] = [];
  const d = ctx.oppDefense;
  if (d?.pointsAgainst != null) {
    factors.push({
      key: "defense",
      label: "Defensive matchup",
      weight: 22,
      sub: lin(d.pointsAgainst, 18, 28),
      display: `${d.pointsAgainst.toFixed(1)} pts/g`,
    });
  }
  if (d?.sacks != null) {
    factors.push({
      key: "pressure",
      label: "Pass rush / O-line",
      weight: 14,
      sub: lin(50 - (d.sacks ?? 0), 20, 45),
      display: `${d.sacks} sacks`,
    });
  }
  if (d?.interceptions != null || d?.passesDefended != null) {
    const cov = (d.interceptions ?? 0) + (d.passesDefended ?? 0) * 0.3;
    factors.push({
      key: "coverage",
      label: "Coverage matchup",
      weight: 14,
      sub: lin(20 - cov, 5, 18),
      display: `${d.interceptions ?? 0} INT`,
    });
  }
  if (ctx.matchup && ctx.playerSide) {
    const team =
      ctx.playerSide === "home" ? (ctx.matchup.home as { avgMargin?: number } | null) : (ctx.matchup.away as { avgMargin?: number } | null);
    if (team?.avgMargin != null) {
      factors.push({
        key: "script",
        label: "Expected game script",
        weight: 12,
        sub: lin(team.avgMargin, -7, 7),
        display: `${team.avgMargin > 0 ? "+" : ""}${team.avgMargin.toFixed(1)} L10`,
      });
    }
  }
  return factors;
}

function hockeyFactors(ctx: SportMatchupContext): MatchupScoreFactor[] {
  const factors: MatchupScoreFactor[] = [];
  const d = ctx.oppDefense;
  if (d?.savePct != null) {
    factors.push({
      key: "goalie",
      label: "Goalie matchup",
      weight: 24,
      sub: lin(0.92 - d.savePct, 0, 0.04),
      display: `${(d.savePct * 100).toFixed(1)}% SV`,
    });
  }
  if (d?.goalsAgainstAvg != null) {
    factors.push({
      key: "gaa",
      label: "Goals against",
      weight: 16,
      sub: lin(d.goalsAgainstAvg, 2.5, 3.5),
      display: `${d.goalsAgainstAvg.toFixed(2)} GAA`,
    });
  }
  if (ctx.usageMinutes != null) {
    factors.push({
      key: "ice_time",
      label: "Ice time",
      weight: 14,
      sub: lin(ctx.usageMinutes, 14, 22),
      display: `${ctx.usageMinutes.toFixed(1)} min avg`,
    });
  }
  return factors;
}

function soccerFactors(ctx: SportMatchupContext): MatchupScoreFactor[] {
  const factors: MatchupScoreFactor[] = [];
  const d = ctx.oppDefense;
  if (d?.pointsAgainst != null) {
    factors.push({
      key: "xg",
      label: "Opp goals allowed (xG proxy)",
      weight: 22,
      sub: lin(d.pointsAgainst, 0.8, 2.0),
      display: `${d.pointsAgainst.toFixed(2)}/game`,
    });
  }
  if (d?.cleanSheets != null) {
    factors.push({
      key: "defense",
      label: "Opponent defense",
      weight: 18,
      sub: lin(15 - d.cleanSheets, 0, 12),
      display: `${d.cleanSheets} clean sheets`,
    });
  }
  return factors;
}

function combatFactors(ctx: SportMatchupContext): MatchupScoreFactor[] {
  const factors: MatchupScoreFactor[] = [];
  const h2h = parseH2H(ctx.matchup?.h2h);
  if (h2h) {
    factors.push({
      key: "h2h",
      label: "Head-to-head",
      weight: 20,
      sub: 0.55,
      display: "prior meetings on file",
    });
  }
  if (ctx.matchup?.mlLean) {
    factors.push({
      key: "styling",
      label: "Fight lean",
      weight: 18,
      sub: ctx.mlLeanAligned === 1 ? lin(ctx.mlLeanEdge ?? 0, 0, 4) : 0.45,
      display: ctx.matchup.mlLean.reasons?.[0] ?? "model lean",
    });
  }
  return factors;
}

function tennisFactors(ctx: SportMatchupContext): MatchupScoreFactor[] {
  const factors: MatchupScoreFactor[] = [];
  const h2h = parseH2H(ctx.matchup?.h2h);
  if (h2h) {
    factors.push({
      key: "h2h",
      label: "Head-to-head",
      weight: 22,
      sub: 0.55,
      display: "H2H history",
    });
  }
  if (ctx.homeAway) {
    const spread = ctx.homeAway.homeAvg - ctx.homeAway.awayAvg;
    factors.push({
      key: "surface_form",
      label: "Surface / venue form",
      weight: 18,
      sub: lin(spread, -2, 2),
      display: `home ${ctx.homeAway.homeAvg.toFixed(1)} / away ${ctx.homeAway.awayAvg.toFixed(1)}`,
    });
  }
  return factors;
}

function genericDefenseFactors(ctx: SportMatchupContext): MatchupScoreFactor[] {
  const factors: MatchupScoreFactor[] = [];
  const d = ctx.oppDefense;
  if (d?.pointsAgainst != null) {
    factors.push({
      key: "defense",
      label: "Opponent defense",
      weight: 20,
      sub: lin(d.pointsAgainst, 90, 120),
      display: `${d.pointsAgainst.toFixed(1)}/game`,
    });
  }
  return factors;
}

export function buildSportMatchupFactors(ctx: SportMatchupContext): MatchupScoreFactor[] {
  const sport = String(ctx.sport || "").toLowerCase();
  const factors: MatchupScoreFactor[] = [];

  if (sport === "mlb") factors.push(...mlbFactors(ctx));
  else if (sport === "nba" || sport === "wnba" || sport === "ncaab") factors.push(...basketballFactors(ctx));
  else if (sport === "nfl" || sport === "ncaaf") factors.push(...footballFactors(ctx));
  else if (sport === "nhl") factors.push(...hockeyFactors(ctx));
  else if (sport === "soccer") factors.push(...soccerFactors(ctx));
  else if (sport === "ufc" || sport === "mma") factors.push(...combatFactors(ctx));
  else if (sport === "tennis") factors.push(...tennisFactors(ctx));
  else factors.push(...genericDefenseFactors(ctx));

  addSharedFactors(ctx, factors);
  return factors;
}

export function weightedMatchupScore(factors: MatchupScoreFactor[]): number | null {
  let wSum = 0;
  let acc = 0;
  for (const f of factors) {
    if (f.sub == null) continue;
    wSum += f.weight;
    acc += f.weight * f.sub;
  }
  if (wSum <= 0) return null;
  return Math.round((acc / wSum) * 100);
}

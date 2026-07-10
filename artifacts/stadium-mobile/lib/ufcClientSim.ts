// Client-side UFC 10k fight sim when the API server is stale (no simulation block).
// Mirrors api-server ufcMonteCarlo.ts + fightPickAnalysis.simMetricsFromResult.

import type {
  FightAnalysis,
  FightComparison,
  FightFighter,
  FightLean,
  FightSimMetrics,
  FightSimResult,
} from "./api";

export type { FightLean };

const SIM_COUNT = 10_000;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round3 = (n: number) => Math.round(n * 1000) / 1000;

function normFighter(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

type MethodRates = { ko: number; tko: number; sub: number; decision: number };

function methodDistribution(
  methods: FightFighter["methods"],
  wins: number,
): MethodRates | null {
  const ko = methods.koWins ?? 0;
  const tko = methods.tkoWins ?? 0;
  const sub = methods.subWins ?? 0;
  const dec = methods.decisionWins;
  const known = ko + tko + sub + (dec ?? 0);
  if (wins <= 0 || known <= 0) return null;
  const total = dec != null ? known : ko + tko + sub;
  if (total <= 0) return null;
  const dShare = dec != null ? dec / total : Math.max(0, 1 - (ko + tko + sub) / total);
  return { ko: ko / total, tko: tko / total, sub: sub / total, decision: dShare };
}

function sampleMethod(dist: MethodRates): keyof MethodRates {
  const r = Math.random();
  let acc = dist.ko;
  if (r < acc) return "ko";
  acc += dist.tko;
  if (r < acc) return "tko";
  acc += dist.sub;
  if (r < acc) return "sub";
  return "decision";
}

function sampleFinishRound(method: keyof MethodRates): number {
  const r = Math.random();
  if (method === "decision") return 3;
  if (method === "sub") return r < 0.35 ? 1 : r < 0.7 ? 2 : 3;
  return r < 0.42 ? 1 : r < 0.75 ? 2 : 3;
}

function assignRoundWins(
  awayWon: boolean,
  isFinish: boolean,
  finishRound: number,
  awayRounds: { r1: number; r2: number; r3: number },
  homeRounds: { r1: number; r2: number; r3: number },
) {
  if (!isFinish) {
    if (awayWon) {
      awayRounds.r1 += 1;
      awayRounds.r2 += 1;
      awayRounds.r3 += 1;
    } else {
      homeRounds.r1 += 1;
      homeRounds.r2 += 1;
      homeRounds.r3 += 1;
    }
    return;
  }
  const winnerRounds = awayWon ? awayRounds : homeRounds;
  const loserRounds = awayWon ? homeRounds : awayRounds;
  if (finishRound >= 1) {
    if (finishRound === 1) {
      loserRounds.r1 += 0.15;
      winnerRounds.r1 += 1;
    } else if (finishRound === 2) {
      loserRounds.r1 += 0.55;
      winnerRounds.r1 += 0.45;
      winnerRounds.r2 += 1;
    } else {
      loserRounds.r1 += 0.45;
      loserRounds.r2 += 0.45;
      winnerRounds.r1 += 0.55;
      winnerRounds.r2 += 0.55;
      winnerRounds.r3 += 1;
    }
  }
}

function awayWinProbFromFight(input: {
  away: FightFighter;
  home: FightFighter;
  lean: FightLean | null;
}): number {
  const { away, home, lean } = input;
  let awayScore = 0;
  let homeScore = 0;
  let weight = 0;

  if (away.record && home.record) {
    awayScore += away.record.winPct * 0.04;
    homeScore += home.record.winPct * 0.04;
    weight += 4;
  }

  if (lean?.side && lean.edge >= 0.3) {
    const favAway = normFighter(lean.side) === normFighter(away.resolvedName || away.name);
    const bump = clamp(lean.edge * 0.035, 0.04, 0.22);
    if (favAway) {
      awayScore += 0.5 + bump;
      homeScore += 0.5 - bump;
    } else {
      homeScore += 0.5 + bump;
      awayScore += 0.5 - bump;
    }
    weight += 1;
  }

  if (away.profile.reachIn != null && home.profile.reachIn != null) {
    const reachDiff = away.profile.reachIn - home.profile.reachIn;
    if (Math.abs(reachDiff) >= 2) {
      const bump = clamp(Math.abs(reachDiff) * 0.008, 0.02, 0.08);
      if (reachDiff > 0) {
        awayScore += bump;
        homeScore -= bump * 0.5;
      } else {
        homeScore += bump;
        awayScore -= bump * 0.5;
      }
      weight += 0.5;
    }
  }

  if (away.profile.age != null && home.profile.age != null) {
    const diff = home.profile.age - away.profile.age;
    if (Math.abs(diff) >= 3) {
      const bump = clamp(Math.abs(diff) * 0.004, 0.01, 0.06);
      if (diff > 0) awayScore += bump;
      else homeScore += bump;
      weight += 0.35;
    }
  }

  const pairs: Array<[number | null, number | null, number]> = [
    [away.stats.strikeLPM, home.stats.strikeLPM, 0.18],
    [away.stats.strikeAccuracy, home.stats.strikeAccuracy, 0.14],
    [away.stats.takedownAvg, home.stats.takedownAvg, 0.12],
    [away.stats.finishPct, home.stats.finishPct, 0.1],
  ];
  for (const [a, h, w] of pairs) {
    if (a == null || h == null) continue;
    awayScore += a * w;
    homeScore += h * w;
    weight += w;
  }

  if (weight <= 0) return 0.5;
  const raw = awayScore / (awayScore + homeScore);
  return clamp(raw, 0.12, 0.88);
}

export function runClientFightMonteCarlo(input: {
  away: FightFighter;
  home: FightFighter;
  lean: FightLean | null;
  simulations?: number;
}): FightSimResult {
  const n = input.simulations && input.simulations > 0 ? input.simulations : SIM_COUNT;
  const { away, home } = input;
  const awayProb = awayWinProbFromFight(input);
  const awayDist = away.record ? methodDistribution(away.methods, away.record.wins) : null;
  const homeDist = home.record ? methodDistribution(home.methods, home.record.wins) : null;
  const trackMethods = awayDist != null || homeDist != null;

  let awayWins = 0;
  let homeWins = 0;
  const awayMethods: MethodRates = { ko: 0, tko: 0, sub: 0, decision: 0 };
  const homeMethods: MethodRates = { ko: 0, tko: 0, sub: 0, decision: 0 };
  const awayRounds = { r1: 0, r2: 0, r3: 0 };
  const homeRounds = { r1: 0, r2: 0, r3: 0 };

  for (let i = 0; i < n; i++) {
    const awayWinsFight = Math.random() < awayProb;
    let finishRound = 3;
    let isFinish = false;

    if (awayWinsFight) {
      awayWins += 1;
      if (trackMethods && awayDist) {
        const m = sampleMethod(awayDist);
        awayMethods[m] += 1;
        isFinish = m !== "decision";
        finishRound = isFinish ? sampleFinishRound(m) : 3;
      }
      assignRoundWins(true, isFinish, finishRound, awayRounds, homeRounds);
    } else {
      homeWins += 1;
      if (trackMethods && homeDist) {
        const m = sampleMethod(homeDist);
        homeMethods[m] += 1;
        isFinish = m !== "decision";
        finishRound = isFinish ? sampleFinishRound(m) : 3;
      }
      assignRoundWins(false, isFinish, finishRound, awayRounds, homeRounds);
    }
  }

  const winner = awayWins >= homeWins ? "away" : "home";
  const winnerPct = (winner === "away" ? awayWins : homeWins) / n;

  let confidence = 45;
  if (input.lean) confidence += clamp(input.lean.edge * 8, 0, 18);
  confidence += Math.abs(awayWins / n - 0.5) * 55;
  if (away.record && home.record) confidence += 8;
  if (away.stats.strikeLPM != null && home.stats.strikeLPM != null) confidence += 6;

  const normMethods = (m: MethodRates, wins: number): MethodRates => ({
    ko: wins > 0 ? round3(m.ko / wins) : 0,
    tko: wins > 0 ? round3(m.tko / wins) : 0,
    sub: wins > 0 ? round3(m.sub / wins) : 0,
    decision: wins > 0 ? round3(m.decision / wins) : 0,
  });

  const normRounds = (r: { r1: number; r2: number; r3: number }, total: number) => ({
    r1: total > 0 ? round3(r.r1 / total) : 0,
    r2: total > 0 ? round3(r.r2 / total) : 0,
    r3: total > 0 ? round3(r.r3 / total) : 0,
  });

  return {
    simulations: n,
    awayWinProbability: round3(awayWins / n),
    homeWinProbability: round3(homeWins / n),
    mostLikelyWinner: winner,
    mostLikelyWinnerPct: round3(winnerPct),
    confidenceScore: clamp(Math.round(confidence), 5, 95),
    methodRates: trackMethods
      ? {
          away: normMethods(awayMethods, awayWins),
          home: normMethods(homeMethods, homeWins),
        }
      : null,
    roundWinPct: trackMethods
      ? {
          away: normRounds(awayRounds, n),
          home: normRounds(homeRounds, n),
        }
      : null,
  };
}

export function simMetricsFromFightResult(sim: FightSimResult): FightSimMetrics {
  const mr = sim.methodRates;
  const awayFinish = mr ? mr.away.ko + mr.away.tko + mr.away.sub : 0;
  const homeFinish = mr ? mr.home.ko + mr.home.tko + mr.home.sub : 0;
  return {
    winProbability: { away: sim.awayWinProbability, home: sim.homeWinProbability },
    finishProbability: { away: awayFinish, home: homeFinish },
    koProbability: {
      away: (mr?.away.ko ?? 0) + (mr?.away.tko ?? 0),
      home: (mr?.home.ko ?? 0) + (mr?.home.tko ?? 0),
    },
    submissionProbability: { away: mr?.away.sub ?? 0, home: mr?.home.sub ?? 0 },
    decisionProbability: { away: mr?.away.decision ?? 0, home: mr?.home.decision ?? 0 },
    roundWinPct: sim.roundWinPct ?? null,
  };
}

const styleLabel = (s: NonNullable<FightFighter["style"]>): string => {
  if (s === "striker") return "Striker";
  if (s === "wrestler") return "Wrestler";
  if (s === "grappler") return "Grappler";
  return "Mixed";
};

export function classifyFighterStyle(f: FightFighter): FightFighter["style"] {
  let strike = 0;
  let wrestle = 0;
  let grapple = 0;
  if (f.stats.strikeLPM != null && f.stats.strikeLPM >= 4) strike += 1;
  if (f.stats.strikeAccuracy != null && f.stats.strikeAccuracy >= 52) strike += 0.5;
  if (f.stats.takedownAvg != null && f.stats.takedownAvg >= 1.5) wrestle += 1;
  if (f.stats.takedownAccuracy != null && f.stats.takedownAccuracy >= 38) wrestle += 0.5;
  if (f.stats.submissionAvg != null && f.stats.submissionAvg >= 0.35) grapple += 1;
  const w = f.record?.wins ?? 0;
  if (w > 0) {
    const subs = f.methods.subWins ?? 0;
    const kos = (f.methods.koWins ?? 0) + (f.methods.tkoWins ?? 0);
    const finishes = kos + subs;
    if (subs / w >= 0.25) grapple += 1;
    if (kos / w >= 0.35) strike += 1;
    else if (finishes / w >= 0.55) strike += 0.5;
    if ((f.methods.decisionWins ?? 0) / w >= 0.5 && finishes / w < 0.35) return "mixed";
  }
  const top = Math.max(strike, wrestle, grapple);
  if (top < 0.75) return null;
  if (strike >= wrestle && strike >= grapple && strike >= 1 && wrestle < 0.75) return "striker";
  if (wrestle >= grapple && wrestle >= 1 && strike < 0.75) return "wrestler";
  if (grapple >= 1 && strike < 0.75 && wrestle < 0.75) return "grappler";
  return "mixed";
}

/** Grounded lean from merged Sherdog/ESPN fields when API omitted lean. */
export function computeClientFightLean(away: FightFighter, home: FightFighter): FightLean | null {
  let signed = 0;
  let used = 0;
  const awayReasons: string[] = [];
  const homeReasons: string[] = [];

  const factor = (
    a: number | null,
    h: number | null,
    weight: number,
    cap: number,
    label: (favName: string, fav: number, dog: number) => string,
  ) => {
    if (a == null || h == null) return;
    const contrib = clamp((a - h) * weight, -cap, cap);
    if (Math.abs(contrib) < 0.15) return;
    used++;
    signed += contrib;
    if (contrib > 0) awayReasons.push(label(away.resolvedName || away.name, a, h));
    else homeReasons.push(label(home.resolvedName || home.name, h, a));
  };

  if (away.record && home.record) {
    factor(away.record.winPct, home.record.winPct, 0.05, 2.0, (fav, _f, _d) => {
      const r = fav === (away.resolvedName || away.name) ? away.record! : home.record!;
      const or = fav === (away.resolvedName || away.name) ? home.record! : away.record!;
      return `${fav} ${r.wins}-${r.losses}-${r.draws} (${r.winPct}% wins) vs ${or.wins}-${or.losses}-${or.draws} (${or.winPct}%)`;
    });
  }

  if (away.profile.age != null && home.profile.age != null) {
    factor(home.profile.age, away.profile.age, 0.03, 0.6, (fav, f, d) =>
      `${fav} younger (${d} vs ${f} years)`,
    );
  }

  if (away.profile.reachIn != null && home.profile.reachIn != null && away.profile.reachIn > 0 && home.profile.reachIn > 0) {
    factor(away.profile.reachIn, home.profile.reachIn, 0.04, 0.8, (fav, f, d) =>
      `${fav} longer reach (${f}" vs ${d}")`,
    );
  }

  factor(away.stats.strikeAccuracy, home.stats.strikeAccuracy, 0.06, 1.2, (fav, f, d) =>
    `${fav} lands ${f}% of significant strikes vs ${d}%`,
  );
  factor(away.stats.strikeLPM, home.stats.strikeLPM, 0.5, 1.0, (fav, f, d) =>
    `${fav} higher striking output (${f} sig strikes/min vs ${d})`,
  );
  factor(away.stats.finishPct, home.stats.finishPct, 0.04, 1.2, (fav, f, d) =>
    `${fav} finishes more often (${f}% KO/TKO vs ${d}%)`,
  );
  factor(away.stats.decisionPct, home.stats.decisionPct, -0.03, 0.8, (fav, f, d) =>
    `${fav} goes to decision less (${f}% vs ${d}%)`,
  );
  factor(away.stats.takedownAvg, home.stats.takedownAvg, 0.35, 1.0, (fav, f, d) =>
    `${fav} stronger grappling (${f} takedowns/15min vs ${d})`,
  );
  factor(away.stats.takedownAccuracy, home.stats.takedownAccuracy, 0.04, 0.8, (fav, f, d) =>
    `${fav} better takedown accuracy (${f}% vs ${d}%)`,
  );
  factor(away.stats.submissionAvg, home.stats.submissionAvg, 0.45, 0.8, (fav, f, d) =>
    `${fav} more submission threat (${f} att/15min vs ${d})`,
  );

  if (used === 0) return null;
  const edge = Math.round(Math.abs(signed) * 10) / 10;
  if (edge < 0.3) return null;
  const awayFav = signed > 0;
  const side = awayFav ? away.resolvedName || away.name : home.resolvedName || home.name;
  return { side, edge, reasons: awayFav ? awayReasons : homeReasons };
}

export function buildClientFightComparison(away: FightFighter, home: FightFighter): FightComparison {
  const reachAdvantageIn =
    away.profile.reachIn != null && home.profile.reachIn != null
      ? Math.round((away.profile.reachIn - home.profile.reachIn) * 10) / 10
      : null;
  let reachAdvantageFighter: string | null = null;
  if (reachAdvantageIn != null && Math.abs(reachAdvantageIn) >= 1) {
    reachAdvantageFighter =
      reachAdvantageIn > 0
        ? away.resolvedName || away.name
        : home.resolvedName || home.name;
  }
  const aStyle = away.style;
  const hStyle = home.style;
  let styleMatchup: string | null = null;
  if (aStyle && hStyle) {
    styleMatchup = `${styleLabel(aStyle)} vs ${styleLabel(hStyle)}`;
  } else if (aStyle) {
    styleMatchup = `${styleLabel(aStyle)} vs Unknown`;
  } else if (hStyle) {
    styleMatchup = `Unknown vs ${styleLabel(hStyle)}`;
  }
  return {
    reachAdvantageIn,
    reachAdvantageFighter,
    styleMatchup,
    unavailable: [],
  };
}

function withClassifiedStyles(away: FightFighter, home: FightFighter) {
  return {
    away: { ...away, style: away.style ?? classifyFighterStyle(away) },
    home: { ...home, style: home.style ?? classifyFighterStyle(home) },
  };
}

/** Style, lean, comparison, and 10k sim when API response is thin. */
export function finalizeClientFightAnalysis(analysis: FightAnalysis): FightAnalysis {
  const { away, home } = withClassifiedStyles(analysis.away, analysis.home);
  const lean = analysis.lean ?? computeClientFightLean(away, home);
  const comparison =
    analysis.comparison?.styleMatchup || analysis.comparison?.reachAdvantageFighter
      ? { ...analysis.comparison, styleMatchup: analysis.comparison.styleMatchup ?? buildClientFightComparison(away, home).styleMatchup }
      : buildClientFightComparison(away, home);

  const hasSim = (analysis.simulation?.simulations ?? 0) > 0;
  if (hasSim) {
    return { ...analysis, away, home, lean, comparison };
  }
  if (!away.record && !home.record) {
    return { ...analysis, away, home, lean, comparison };
  }

  const simulation = runClientFightMonteCarlo({ away, home, lean });
  const simMetrics = simMetricsFromFightResult(simulation);
  return { ...analysis, away, home, lean, comparison, simulation, simMetrics };
}

/** @deprecated use finalizeClientFightAnalysis */
export function enrichFightAnalysisWithClientSim(analysis: FightAnalysis): FightAnalysis {
  return finalizeClientFightAnalysis(analysis);
}

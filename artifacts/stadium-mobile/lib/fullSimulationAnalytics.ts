// Deep metrics derived from the saved 10k game-outcome draw.

import type { GameSimulationResult, RealOddsEntry } from "./api.ts";
import { gameSimHitForPick } from "./gameSimScoring.ts";

export type ScoreBucket = { label: string; away: number; home: number; pct: number };

export type CoverFrequency = { pick: string; market: string; hitPct: number };

export type FullSimulationAnalytics = {
  topScores: ScoreBucket[];
  runDistribution: { totalRuns: number; pct: number }[];
  coverFrequencies: CoverFrequency[];
  totalOverProb: number | null;
  totalLine: number | null;
  teamTotalProbs: { team: string; pick: string; hitPct: number }[];
  tieProb: number;
  oneRunGameProb: number;
  underdogWinProb: number | null;
};

function roundPct(n: number): number {
  return Math.round(n * 1000) / 10;
}

export function analyzeFullSimulation(input: {
  result: GameSimulationResult;
  evalLines: RealOddsEntry[];
  gameLabel: string;
  awayTeam: string;
  homeTeam: string;
}): FullSimulationAnalytics | null {
  const { result, evalLines, gameLabel, awayTeam, homeTeam } = input;
  const homeScores = result.outcomes?.homeScores;
  const awayScores = result.outcomes?.awayScores;
  if (!homeScores?.length || !awayScores?.length || homeScores.length !== awayScores.length) {
    return null;
  }

  const n = homeScores.length;
  const scoreCounts = new Map<string, { away: number; home: number; count: number }>();
  const totalRunCounts = new Map<number, number>();
  let oneRunGames = 0;
  let underdogWins = 0;
  const favIsHome = (result.homeWinProbability ?? 0.5) >= (result.awayWinProbability ?? 0.5);

  for (let i = 0; i < n; i++) {
    const h = homeScores[i]!;
    const a = awayScores[i]!;
    const key = `${a}-${h}`;
    const prev = scoreCounts.get(key) ?? { away: a, home: h, count: 0 };
    prev.count += 1;
    scoreCounts.set(key, prev);

    const total = Math.round((h + a) * 2) / 2;
    totalRunCounts.set(total, (totalRunCounts.get(total) ?? 0) + 1);

    if (Math.abs(h - a) <= 1.01) oneRunGames += 1;
    const homeWon = h > a;
    const awayWon = a > h;
    if (favIsHome && awayWon) underdogWins += 1;
    if (!favIsHome && homeWon) underdogWins += 1;
  }

  const topScores = [...scoreCounts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
    .map((row) => ({
      label: `${row.away}-${row.home}`,
      away: row.away,
      home: row.home,
      pct: roundPct(row.count / n),
    }));

  const runDistribution = [...totalRunCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([totalRuns, count]) => ({ totalRuns, pct: roundPct(count / n) }));

  const spreadLines = evalLines.filter((l) => l && /spread/i.test(l.market ?? ""));
  const coverFrequencies: CoverFrequency[] = spreadLines
    .map((line) => {
      const hit = gameSimHitForPick(
        { game: gameLabel, market: line.market, pick: line.pick, odds: line.odds, isProp: false },
        result,
      );
      if (hit == null) return null;
      return { pick: line.pick, market: line.market, hitPct: roundPct(hit) };
    })
    .filter((x): x is CoverFrequency => x != null)
    .sort((a, b) => b.hitPct - a.hitPct);

  const mainTotal = evalLines.find(
    (l) => l && /^total$/i.test((l.market ?? "").trim()) && /\bover\b/i.test(l.pick ?? ""),
  );
  let totalOverProb: number | null = null;
  let totalLine: number | null = null;
  if (mainTotal) {
    const m = mainTotal.pick.match(/(\d+(?:\.\d+)?)/);
    totalLine = m ? Number(m[1]) : null;
    const hit = gameSimHitForPick(
      {
        game: gameLabel,
        market: mainTotal.market,
        pick: mainTotal.pick,
        odds: mainTotal.odds,
        isProp: false,
      },
      result,
    );
    totalOverProb = hit != null ? roundPct(hit) : null;
  }

  const teamTotalProbs = evalLines
    .filter((l) => l && /team total/i.test(l.market ?? ""))
    .map((line) => {
      const hit = gameSimHitForPick(
        { game: gameLabel, market: line.market, pick: line.pick, odds: line.odds, isProp: false },
        result,
      );
      if (hit == null) return null;
      const team = line.pick.split(/\s+(?:Over|Under)/i)[0] ?? line.pick;
      return { team, pick: line.pick, hitPct: roundPct(hit) };
    })
    .filter((x): x is NonNullable<typeof x> => x != null)
    .slice(0, 12);

  const tie =
    result.tieProbability ??
    Math.max(0, 1 - result.homeWinProbability - result.awayWinProbability);

  return {
    topScores,
    runDistribution,
    coverFrequencies,
    totalOverProb,
    totalLine,
    teamTotalProbs,
    tieProb: roundPct(tie),
    oneRunGameProb: roundPct(oneRunGames / n),
    underdogWinProb: roundPct(underdogWins / n),
  };
}

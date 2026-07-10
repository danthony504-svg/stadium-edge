// UFC prop recommendations — only when Cito returns real sportsbook odds.
// Grades method/round/distance props against the 10k fight sim.

import type { FightSimResult } from "./ufcMonteCarlo.js";
import type { FightRecommendation } from "./fightRecommendations.js";
import type { FightPickAnalysis } from "./fightPickAnalysis.js";
import { passesDataCoverageGate } from "./fightPickAnalysis.js";
import type { UfcFightPropMarket } from "./citoUfcOdds.js";
import { normFighter } from "./ufc.js";

const MIN_EDGE_PCT = 2.0;
const MIN_COMPOSITE = 6.5;
const MIN_SIM_HIT = 0.03;

function americanToProb(american: number): number {
  return american > 0 ? 100 / (american + 100) : -american / (-american + 100);
}

function gradeFromComposite(c: number): string {
  if (c >= 9) return "A+";
  if (c >= 8.5) return "A";
  if (c >= 8) return "A-";
  if (c >= 7.5) return "B+";
  if (c >= 7) return "B";
  if (c >= 6.5) return "B-";
  if (c >= 6) return "C+";
  if (c >= 5.5) return "C";
  if (c >= 5) return "C-";
  if (c >= 4) return "D";
  return "F";
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function nameMatch(a: string, b: string): boolean {
  const na = normFighter(a);
  const nb = normFighter(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

function bestPricePerOutcome(
  outcomes: { name: string; price: number; book: string | null }[],
): Map<string, { price: number; book: string | null }> {
  const best = new Map<string, { price: number; book: string | null }>();
  for (const o of outcomes) {
    if (!Number.isFinite(o.price)) continue;
    const cur = best.get(o.name);
    if (!cur || americanToProb(o.price) < americanToProb(cur.price)) {
      best.set(o.name, { price: o.price, book: o.book });
    }
  }
  return best;
}

function simHitForOutcome(
  marketKey: string,
  outcomeName: string,
  awayName: string,
  homeName: string,
  sim: FightSimResult,
): number | null {
  const mr = sim.methodRates;
  if (!mr) return null;
  const n = normFighter(outcomeName);
  const awayWin = sim.awayWinProbability;
  const homeWin = sim.homeWinProbability;

  const awayKo = mr.away.ko + mr.away.tko;
  const homeKo = mr.home.ko + mr.home.tko;
  const awaySub = mr.away.sub;
  const homeSub = mr.home.sub;
  const awayDec = mr.away.decision;
  const homeDec = mr.home.decision;

  const fighterIsAway = nameMatch(outcomeName, awayName);
  const fighterIsHome = nameMatch(outcomeName, homeName);

  if (marketKey === "goes_distance") {
    const yes = n.includes("yes") || (n.includes("distance") && !n.includes("no"));
    const no = n.includes("no") && !n.includes("yes");
    const distProb = awayWin * awayDec + homeWin * homeDec;
    if (yes) return distProb;
    if (no) return 1 - distProb;
    if (n.includes("under")) return distProb;
    if (n.includes("over")) return 1 - distProb;
    return null;
  }

  if (marketKey === "exact_round" || marketKey === "round_method") {
    const m = /round\s*(\d)|\br(\d)\b|(\d)(?:st|nd|rd|th)\s*round/.exec(n);
    const round = m ? Number(m[1] ?? m[2] ?? m[3]) : null;
    if (round == null || !sim.roundWinPct) return null;
    const rw = sim.roundWinPct;
    const finishR1 = (awayKo + awaySub) * awayWin * 0.42 + (homeKo + homeSub) * homeWin * 0.42;
    const finishR2 = (awayKo + awaySub) * awayWin * 0.33 + (homeKo + homeSub) * homeWin * 0.33;
    const finishR3 = (awayKo + awaySub) * awayWin * 0.25 + (homeKo + homeSub) * homeWin * 0.25;
    const decR3 = awayWin * awayDec + homeWin * homeDec;
    if (round === 1) return finishR1;
    if (round === 2) return finishR2;
    if (round === 3) return finishR3 + decR3;
    return null;
  }

  if (marketKey === "ko_tko" || (marketKey === "method_of_victory" && (n.includes("ko") || n.includes("tko")))) {
    if (fighterIsAway) return awayWin * awayKo;
    if (fighterIsHome) return homeWin * homeKo;
    if (n.includes("ko") || n.includes("tko")) return awayWin * awayKo + homeWin * homeKo;
    return null;
  }

  if (marketKey === "submission" || (marketKey === "method_of_victory" && n.includes("sub"))) {
    if (fighterIsAway) return awayWin * awaySub;
    if (fighterIsHome) return homeWin * homeSub;
    if (n.includes("sub")) return awayWin * awaySub + homeWin * homeSub;
    return null;
  }

  if (marketKey === "decision" || (marketKey === "method_of_victory" && n.includes("decision"))) {
    if (fighterIsAway) return awayWin * awayDec;
    if (fighterIsHome) return homeWin * homeDec;
    if (n.includes("decision")) return awayWin * awayDec + homeWin * homeDec;
    return null;
  }

  if (marketKey === "method_of_victory") {
    if (fighterIsAway) {
      if (n.includes("ko") || n.includes("tko")) return awayWin * awayKo;
      if (n.includes("sub")) return awayWin * awaySub;
      if (n.includes("decision")) return awayWin * awayDec;
    }
    if (fighterIsHome) {
      if (n.includes("ko") || n.includes("tko")) return homeWin * homeKo;
      if (n.includes("sub")) return homeWin * homeSub;
      if (n.includes("decision")) return homeWin * homeDec;
    }
  }

  return null;
}

export function buildUfcPropRecommendations(
  markets: UfcFightPropMarket[],
  awayName: string,
  homeName: string,
  sim: FightSimResult | null,
  prePick: FightPickAnalysis,
): FightRecommendation[] {
  const coverageOk = passesDataCoverageGate(prePick);
  const recommendations: FightRecommendation[] = [];

  for (const market of markets) {
    const best = bestPricePerOutcome(market.outcomes);
    for (const [pick, { price, book }] of best.entries()) {
      const implied = americanToProb(price);
      const simHit = sim ? simHitForOutcome(market.key, pick, awayName, homeName, sim) : null;
      const edge =
        simHit != null
          ? Math.round((simHit - implied) * 1000) / 10
          : null;

      let composite: number | null = null;
      let confidence: number | null = null;
      if (edge != null) {
        const lv = clamp(5 + edge / 1.5, 1, 10);
        const sm = simHit != null ? clamp(5 + (simHit - implied) * 25, 1, 10) : 5;
        composite = Math.round(((lv * 0.45 + sm * 0.55) / 1) * 10) / 10;
        confidence = clamp(Math.round(50 + (composite - 5.5) * 12), 5, 95);
      }

      let skipped = false;
      const reasons: string[] = [];
      if (!coverageOk) {
        skipped = true;
        reasons.push("insufficient grounded fighter data");
      }
      if (simHit == null) {
        skipped = true;
        reasons.push("sim cannot model this prop");
      }
      if (edge == null || edge < MIN_EDGE_PCT) {
        skipped = true;
        reasons.push("insufficient line value");
      }
      if (composite == null || composite < MIN_COMPOSITE) {
        skipped = true;
        reasons.push("grade below threshold");
      }
      if (simHit != null && simHit - implied < MIN_SIM_HIT && (edge ?? 0) < 4) {
        skipped = true;
        reasons.push("sim does not support price");
      }

      recommendations.push({
        market: market.label,
        pick,
        odds: price,
        book,
        grade: composite != null ? gradeFromComposite(composite) : null,
        confidencePct: confidence,
        edgePct: edge,
        simHitPct: simHit != null ? Math.round(simHit * 1000) / 10 : null,
        evPct: edge,
        skipped,
        reason: skipped
          ? `Skipped: ${reasons.join(", ")}`
          : edge != null
            ? `Sim supports ${market.label} (+${edge}% edge)`
            : `Posted ${market.label}`,
        quality: {
          winProbability: simHit != null ? Math.round(simHit * 1000) / 10 : null,
          finishProbability: null,
          koProbability: null,
          submissionProbability: null,
          decisionProbability: null,
          dataCoveragePct: prePick.dataCoveragePct,
        },
      });
    }
  }

  recommendations.sort((a, b) => {
    if (a.skipped !== b.skipped) return a.skipped ? 1 : -1;
    return (b.edgePct ?? -99) - (a.edgePct ?? -99);
  });

  return recommendations;
}

// UFC moneyline recommendations — only after full pre-pick analysis + quality filters.

import type { FightAnalysis, FightSimResult } from "./ufc.js";
import {
  passesDataCoverageGate,
  simMetricsFromResult,
  type FightPickAnalysis,
  type FightSimMetrics,
} from "./fightPickAnalysis.js";

function normFighter(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const MIN_EDGE_PCT = 1.5;
const MIN_COMPOSITE = 6.5;
const MIN_SIM_GAP = 0.04;

export type H2hPostedOutcome = {
  name: string;
  price: number;
  book?: string | null;
};

export type FightBookLine = {
  fighter: string;
  book: string;
  price: number;
};

export type FightRecommendation = {
  market: string;
  pick: string;
  odds: number;
  book: string | null;
  grade: string | null;
  confidencePct: number | null;
  edgePct: number | null;
  simHitPct: number | null;
  evPct: number | null;
  skipped: boolean;
  reason: string;
  quality: {
    winProbability: number | null;
    finishProbability: number | null;
    koProbability: number | null;
    submissionProbability: number | null;
    decisionProbability: number | null;
    dataCoveragePct: number;
  } | null;
};

function americanToProb(american: number): number {
  return american > 0 ? 100 / (american + 100) : -american / (-american + 100);
}

function median(vals: number[]): number {
  const s = [...vals].sort((a, b) => a - b);
  const mid = s.length / 2;
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[Math.floor(mid)];
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

function nameMatch(a: string, b: string): boolean {
  const na = normFighter(a);
  const nb = normFighter(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

function bestByFighter(
  awayName: string,
  homeName: string,
  outcomes: H2hPostedOutcome[],
): Map<string, { price: number; book: string | null }> {
  const best = new Map<string, { price: number; book: string | null }>();
  for (const o of outcomes) {
    if (!Number.isFinite(o.price)) continue;
    let side: string | null = null;
    if (nameMatch(o.name, awayName)) side = awayName;
    else if (nameMatch(o.name, homeName)) side = homeName;
    if (!side) continue;
    const cur = best.get(side);
    if (!cur || americanToProb(o.price) < americanToProb(cur.price)) {
      best.set(side, { price: o.price, book: o.book ?? null });
    }
  }
  return best;
}

function allBookLines(
  awayName: string,
  homeName: string,
  outcomes: H2hPostedOutcome[],
): FightBookLine[] {
  const rows: FightBookLine[] = [];
  for (const o of outcomes) {
    if (!Number.isFinite(o.price)) continue;
    if (nameMatch(o.name, awayName)) {
      rows.push({ fighter: awayName, book: o.book ?? "Unknown", price: o.price });
    } else if (nameMatch(o.name, homeName)) {
      rows.push({ fighter: homeName, book: o.book ?? "Unknown", price: o.price });
    }
  }
  return rows.sort((a, b) => americanToProb(a.price) - americanToProb(b.price));
}

function devigEdge(
  fighter: string,
  awayName: string,
  homeName: string,
  outcomes: H2hPostedOutcome[],
  bestPrice: number,
): { edge: number | null; fair: number | null } {
  const byBook = new Map<string, Map<string, number>>();
  for (const o of outcomes) {
    if (!Number.isFinite(o.price) || !o.book) continue;
    const book = o.book;
    if (!byBook.has(book)) byBook.set(book, new Map());
    const side = nameMatch(o.name, awayName)
      ? "away"
      : nameMatch(o.name, homeName)
        ? "home"
        : null;
    if (side) byBook.get(book)!.set(side, o.price);
  }
  const isAway = nameMatch(fighter, awayName);
  const fairs: number[] = [];
  for (const sides of byBook.values()) {
    const a = sides.get("away");
    const h = sides.get("home");
    if (a == null || h == null) continue;
    const ai = americanToProb(a);
    const hi = americanToProb(h);
    const tot = ai + hi;
    if (tot <= 0) continue;
    fairs.push((isAway ? ai : hi) / tot);
  }
  if (fairs.length < 2) return { edge: null, fair: null };
  const fair = median(fairs);
  const edge = Math.round((fair - americanToProb(bestPrice)) * 1000) / 10;
  return { edge, fair: Math.round(fair * 1000) / 1000 };
}

function scorePick(
  fighter: string,
  analysis: FightAnalysis,
  sim: FightSimResult | null,
  edge: number | null,
  fair: number | null,
  isAway: boolean,
): { composite: number | null; confidence: number | null } {
  let pts = 0;
  let w = 0;

  if (edge != null) {
    const lv = Math.min(10, Math.max(1, 5 + edge / 1.2));
    pts += lv * 0.3;
    w += 0.3;
  }

  const lean = analysis.lean;
  if (lean?.side) {
    const aligned = nameMatch(lean.side, fighter);
    const m = aligned ? 6 + clamp(lean.edge * 2, 0, 4) : 4 - clamp(lean.edge, 0, 2);
    pts += m * 0.28;
    w += 0.28;
  }

  if (sim) {
    const hit = isAway ? sim.awayWinProbability : sim.homeWinProbability;
    const implied = fair ?? 0.5;
    const gap = hit - implied;
    const sm = 5 + clamp(gap * 20, -2, 4);
    pts += sm * 0.22;
    w += 0.22;
  }

  if (w <= 0) return { composite: null, confidence: null };
  const composite = pts / w;
  const confidence = clamp(Math.round(50 + (composite - 5.5) * 12), 5, 95);
  return { composite: Math.round(composite * 10) / 10, confidence };
}

function pickQuality(
  isAway: boolean,
  metrics: FightSimMetrics | null,
  coveragePct: number,
): FightRecommendation["quality"] {
  if (!metrics) {
    return {
      winProbability: null,
      finishProbability: null,
      koProbability: null,
      submissionProbability: null,
      decisionProbability: null,
      dataCoveragePct: coveragePct,
    };
  }
  const side = isAway ? "away" : "home";
  return {
    winProbability: Math.round(metrics.winProbability[side] * 1000) / 10,
    finishProbability: Math.round(metrics.finishProbability[side] * 1000) / 10,
    koProbability: Math.round(metrics.koProbability[side] * 1000) / 10,
    submissionProbability: Math.round(metrics.submissionProbability[side] * 1000) / 10,
    decisionProbability: Math.round(metrics.decisionProbability[side] * 1000) / 10,
    dataCoveragePct: coveragePct,
  };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function buildFightRecommendations(
  analysis: FightAnalysis,
  awayName: string,
  homeName: string,
  outcomes: H2hPostedOutcome[],
  sim: FightSimResult | null,
  prePick: FightPickAnalysis,
): { recommendations: FightRecommendation[]; books: FightBookLine[] } {
  const best = bestByFighter(awayName, homeName, outcomes);
  const books = allBookLines(awayName, homeName, outcomes);
  const recommendations: FightRecommendation[] = [];
  const metrics = sim ? simMetricsFromResult(sim) : null;
  const coverageOk = passesDataCoverageGate(prePick);

  for (const [fighter, { price, book }] of best.entries()) {
    const isAway = nameMatch(fighter, awayName);
    const { edge, fair } = devigEdge(fighter, awayName, homeName, outcomes, price);
    const { composite, confidence } = scorePick(fighter, analysis, sim, edge, fair, isAway);
    const simHit = sim
      ? Math.round((isAway ? sim.awayWinProbability : sim.homeWinProbability) * 1000) / 10
      : null;

    let skipped = false;
    const reasons: string[] = [];
    if (!coverageOk) {
      skipped = true;
      reasons.push("insufficient grounded fighter data for pre-pick analysis");
    }
    if (prePick.resolvedFighters < 2 && (edge ?? 0) < 3.5) {
      skipped = true;
      reasons.push("opponent profile unresolved — need stronger edge");
    }
    if (edge == null || edge < MIN_EDGE_PCT) {
      skipped = true;
      reasons.push("insufficient line value");
    }
    if (composite == null || composite < MIN_COMPOSITE) {
      skipped = true;
      reasons.push("grade below threshold");
    }
    if (sim && fair != null) {
      const hit = isAway ? sim.awayWinProbability : sim.homeWinProbability;
      if (hit - fair < MIN_SIM_GAP && (edge ?? 0) < 3) {
        skipped = true;
        reasons.push("sim does not support price");
      }
    }
    if (analysis.lean?.side && !nameMatch(analysis.lean.side, fighter) && (edge ?? 0) < 4) {
      skipped = true;
      reasons.push("against data lean");
    }

    const posReason =
      analysis.lean?.side && nameMatch(analysis.lean.side, fighter)
        ? `Pre-pick analysis + ${prePick.dataCoveragePct}% data coverage favor ${fighter}${edge != null ? ` (+${edge}% EV)` : ""}`
        : edge != null
          ? `Passes quality filters with +${edge}% edge`
          : "Best available moneyline";

    recommendations.push({
      market: "Moneyline",
      pick: fighter,
      odds: price,
      book,
      grade: composite != null ? gradeFromComposite(composite) : null,
      confidencePct: confidence,
      edgePct: edge,
      simHitPct: simHit,
      evPct: edge,
      skipped,
      reason: skipped ? `Skipped: ${reasons.join(", ")}` : posReason,
      quality: pickQuality(isAway, metrics, prePick.dataCoveragePct),
    });
  }

  recommendations.sort((a, b) => {
    if (a.skipped !== b.skipped) return a.skipped ? 1 : -1;
    return (b.edgePct ?? -99) - (a.edgePct ?? -99);
  });

  return { recommendations, books };
}

// Tennis recommendations — moneyline, game spread, and total games only.
// Quality-filtered after full pre-pick analysis + 10k sim. Props / set spread /
// alt lines are not in the feed.

import type { GameSimResult } from "./gameMonteCarlo.js";
import type { TennisAnalysis, TennisLean } from "./tennis.js";
import {
  passesTennisDataGate,
  tennisSimMetrics,
  type TennisPickAnalysis,
  type TennisSimMetrics,
} from "./tennisPickAnalysis.js";

function normName(s: unknown): string {
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
const MIN_SPREAD_TOTAL_SIM = 0.54;

export type H2hPostedOutcome = {
  name: string;
  price: number;
  book?: string | null;
};

export type SpreadPostedOutcome = {
  name: string;
  price: number;
  point: number;
  book?: string | null;
};

export type TotalPostedOutcome = {
  name: string;
  price: number;
  point: number;
  book?: string | null;
};

export type TennisBookLine = {
  market: "h2h" | "spread" | "total";
  label: string;
  book: string;
  price: number;
  point?: number;
};

export type TennisRecommendation = {
  market: string;
  pick: string;
  odds: number;
  line?: number | null;
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
    projectedTotalGames: number | null;
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

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function nameMatch(a: string, b: string): boolean {
  const na = normName(a);
  const nb = normName(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

function bestH2hByPlayer(
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

function devigH2hEdge(
  fighter: string,
  awayName: string,
  homeName: string,
  outcomes: H2hPostedOutcome[],
  bestPrice: number,
): { edge: number | null; fair: number | null } {
  const byBook = new Map<string, Map<string, number>>();
  for (const o of outcomes) {
    if (!Number.isFinite(o.price) || !o.book) continue;
    const side = nameMatch(o.name, awayName)
      ? "away"
      : nameMatch(o.name, homeName)
        ? "home"
        : null;
    if (!side) continue;
    if (!byBook.has(o.book)) byBook.set(o.book, new Map());
    byBook.get(o.book)!.set(side, o.price);
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

function devigTwoWayEdge(
  impliedPick: number,
  outcomes: { price: number; book?: string | null; key: string }[],
  pickKey: string,
  oppositeKey: (k: string) => string | null,
): { edge: number | null; fair: number | null } {
  const byBook = new Map<string, Map<string, number>>();
  for (const o of outcomes) {
    if (!Number.isFinite(o.price) || !o.book) continue;
    if (!byBook.has(o.book)) byBook.set(o.book, new Map());
    byBook.get(o.book)!.set(o.key, o.price);
  }
  const fairs: number[] = [];
  for (const sides of byBook.values()) {
    const pick = sides.get(pickKey);
    const opp = oppositeKey(pickKey);
    const other = opp ? sides.get(opp) : undefined;
    if (pick == null || other == null) continue;
    const pi = americanToProb(pick);
    const oi = americanToProb(other);
    const tot = pi + oi;
    if (tot <= 0) continue;
    fairs.push(pi / tot);
  }
  if (fairs.length < 2) return { edge: null, fair: null };
  const fair = median(fairs);
  const edge = Math.round((fair - americanToProb(impliedPick)) * 1000) / 10;
  return { edge, fair: Math.round(fair * 1000) / 1000 };
}

function scoreMlPick(
  player: string,
  lean: TennisLean | null,
  sim: GameSimResult | null,
  edge: number | null,
  fair: number | null,
  isAway: boolean,
): { composite: number | null; confidence: number | null } {
  let pts = 0;
  let w = 0;
  if (edge != null) {
    pts += clamp(5 + edge / 1.2, 1, 10) * 0.3;
    w += 0.3;
  }
  if (lean?.side) {
    const aligned = nameMatch(lean.side, player);
    const m = aligned ? 6 + clamp(lean.edge * 2, 0, 4) : 4 - clamp(lean.edge, 0, 2);
    pts += m * 0.28;
    w += 0.28;
  }
  if (sim) {
    const hit = isAway ? sim.awayWinProbability : sim.homeWinProbability;
    const implied = fair ?? 0.5;
    pts += clamp(5 + (hit - implied) * 20, 3, 9) * 0.22;
    w += 0.22;
  }
  if (w <= 0) return { composite: null, confidence: null };
  const composite = pts / w;
  return { composite: Math.round(composite * 10) / 10, confidence: clamp(Math.round(50 + (composite - 5.5) * 12), 5, 95) };
}

function scoreLinePick(
  lean: TennisLean | null,
  leanAligned: boolean,
  simHit: number | null,
  edge: number | null,
): { composite: number | null; confidence: number | null } {
  let pts = 0;
  let w = 0;
  if (edge != null) {
    pts += clamp(5 + edge / 1.2, 1, 10) * 0.35;
    w += 0.35;
  }
  if (simHit != null) {
    pts += clamp(4 + (simHit - 0.5) * 12, 2, 9) * 0.35;
    w += 0.35;
  }
  if (lean?.side) {
    pts += (leanAligned ? 6.5 + clamp(lean.edge, 0, 2) : 4.5) * 0.2;
    w += 0.2;
  }
  if (w <= 0) return { composite: null, confidence: null };
  const composite = pts / w;
  return { composite: Math.round(composite * 10) / 10, confidence: clamp(Math.round(50 + (composite - 5.5) * 12), 5, 95) };
}

function spreadQueryId(side: "away" | "home", point: number): string {
  return `spread:${side}:${point}`;
}

function totalQueryId(side: "over" | "under", point: number): string {
  return `total:${side}:${point}`;
}

function pickQuality(
  isAway: boolean,
  metrics: TennisSimMetrics | null,
  coveragePct: number,
): TennisRecommendation["quality"] {
  if (!metrics) {
    return { winProbability: null, projectedTotalGames: null, dataCoveragePct: coveragePct };
  }
  const side = isAway ? "away" : "home";
  return {
    winProbability: Math.round(metrics.winProbability[side] * 1000) / 10,
    projectedTotalGames: metrics.projectedTotalGames,
    dataCoveragePct: coveragePct,
  };
}

function allBookLines(
  awayName: string,
  homeName: string,
  h2h: H2hPostedOutcome[],
  spreads: SpreadPostedOutcome[],
  totals: TotalPostedOutcome[],
): TennisBookLine[] {
  const rows: TennisBookLine[] = [];
  for (const o of h2h) {
    if (!Number.isFinite(o.price)) continue;
    rows.push({ market: "h2h", label: o.name, book: o.book ?? "Unknown", price: o.price });
  }
  for (const o of spreads) {
    if (!Number.isFinite(o.price) || !Number.isFinite(o.point)) continue;
    rows.push({
      market: "spread",
      label: `${o.name} ${o.point > 0 ? "+" : ""}${o.point}`,
      book: o.book ?? "Unknown",
      price: o.price,
      point: o.point,
    });
  }
  for (const o of totals) {
    if (!Number.isFinite(o.price) || !Number.isFinite(o.point)) continue;
    rows.push({
      market: "total",
      label: `${o.name} ${o.point}`,
      book: o.book ?? "Unknown",
      price: o.price,
      point: o.point,
    });
  }
  return rows.sort((a, b) => americanToProb(a.price) - americanToProb(b.price));
}

export function buildTennisRecommendations(
  analysis: TennisAnalysis,
  awayName: string,
  homeName: string,
  h2hOutcomes: H2hPostedOutcome[],
  spreadOutcomes: SpreadPostedOutcome[],
  totalOutcomes: TotalPostedOutcome[],
  sim: GameSimResult | null,
  prePick: TennisPickAnalysis,
): { recommendations: TennisRecommendation[]; books: TennisBookLine[] } {
  const recommendations: TennisRecommendation[] = [];
  const books = allBookLines(awayName, homeName, h2hOutcomes, spreadOutcomes, totalOutcomes);
  const metrics = sim ? tennisSimMetrics(sim) : null;
  const coverageOk = passesTennisDataGate(prePick);
  const marketOnly = prePick.dataTier === "market_only";
  const lean = analysis.lean;

  // --- Moneyline ---
  const bestMl = bestH2hByPlayer(awayName, homeName, h2hOutcomes);
  for (const [player, { price, book }] of bestMl.entries()) {
    const isAway = nameMatch(player, awayName);
    const { edge, fair } = devigH2hEdge(player, awayName, homeName, h2hOutcomes, price);
    const { composite, confidence } = scoreMlPick(player, lean, sim, edge, fair, isAway);
    const simHit = sim
      ? Math.round((isAway ? sim.awayWinProbability : sim.homeWinProbability) * 1000) / 10
      : null;

    let skipped = false;
    const reasons: string[] = [];
    if (!coverageOk) {
      skipped = true;
      reasons.push("insufficient grounded player data for pre-pick analysis");
    }
    if (!marketOnly && prePick.resolvedPlayers < 2 && (edge ?? 0) < 3.5) {
      skipped = true;
      reasons.push("opponent profile unresolved — need stronger edge");
    }
    const marketOnlyMinEdge = 2.5;
    if (edge == null || edge < (marketOnly ? marketOnlyMinEdge : MIN_EDGE_PCT)) {
      skipped = true;
      reasons.push("insufficient line value");
    }
    if (composite == null || composite < MIN_COMPOSITE) {
      skipped = true;
      reasons.push("grade below threshold");
    }
    if (!marketOnly && sim && fair != null) {
      const hit = isAway ? sim.awayWinProbability : sim.homeWinProbability;
      if (hit - fair < MIN_SIM_GAP && (edge ?? 0) < 3) {
        skipped = true;
        reasons.push("sim does not support price");
      }
    }
    if (lean?.side && !nameMatch(lean.side, player) && (edge ?? 0) < 4) {
      skipped = true;
      reasons.push("against data lean");
    }

    const posReason =
      lean?.side && nameMatch(lean.side, player)
        ? `Pre-pick analysis + ${prePick.dataCoveragePct}% data coverage favor ${player}${edge != null ? ` (+${edge}% EV)` : ""}`
        : edge != null
          ? `Passes quality filters with +${edge}% edge`
          : "Best available moneyline";

    recommendations.push({
      market: "Moneyline",
      pick: player,
      odds: price,
      book,
      grade: composite != null ? gradeFromComposite(composite) : null,
      confidencePct: marketOnly && confidence != null ? Math.min(confidence, 55) : confidence,
      edgePct: edge,
      simHitPct: simHit,
      evPct: edge,
      skipped,
      reason: skipped
        ? `Skipped (${prePick.dataTier}): ${reasons.join(", ")}`
        : marketOnly
          ? `Market-only price evaluation · limited data · confidence capped`
          : posReason,
      quality: pickQuality(isAway, metrics, prePick.dataCoveragePct),
    });
  }

  // --- Game spread (best price per player+point) ---
  const spreadBest = new Map<string, SpreadPostedOutcome>();
  for (const o of spreadOutcomes) {
    if (!Number.isFinite(o.price) || !Number.isFinite(o.point)) continue;
    const key = `${normName(o.name)}|${o.point}`;
    const cur = spreadBest.get(key);
    if (!cur || americanToProb(o.price) < americanToProb(cur.price)) spreadBest.set(key, o);
  }

  const spreadKeys = [...spreadBest.values()].map((o) => {
    const isAway = nameMatch(o.name, awayName);
    const side: "away" | "home" = isAway ? "away" : "home";
    return { o, side, id: spreadQueryId(side, o.point) };
  });

  const spreadDevigPool = spreadKeys.map(({ o, side }) => ({
    price: o.price,
    book: o.book,
    key: `${side}|${o.point}`,
  }));

  for (const { o, side, id } of spreadKeys) {
    const simHit = sim?.coverHitRates?.[id] != null ? Math.round(sim.coverHitRates[id]! * 1000) / 10 : null;
    const implied = americanToProb(o.price);
    const rawEdge = simHit != null ? Math.round((simHit / 100 - implied) * 1000) / 10 : null;
    const { edge: devigEdge } = devigTwoWayEdge(
      o.price,
      spreadDevigPool,
      `${side}|${o.point}`,
      (k) => {
        const [s, pt] = k.split("|");
        const otherSide = s === "away" ? "home" : "away";
        const oppPt = -Number(pt);
        const hasOpp = spreadKeys.some((x) => x.side === otherSide && x.o.point === oppPt);
        return hasOpp ? `${otherSide}|${oppPt}` : null;
      },
    );
    const edge = devigEdge ?? rawEdge;
    const leanAligned = lean?.side ? nameMatch(lean.side, o.name) : false;
    const { composite, confidence } = scoreLinePick(lean, leanAligned, simHit != null ? simHit / 100 : null, edge);

    let skipped = false;
    const reasons: string[] = [];
    if (!coverageOk) {
      skipped = true;
      reasons.push("insufficient pre-pick data");
    }
    if (!marketOnly && (simHit == null || simHit / 100 < MIN_SPREAD_TOTAL_SIM)) {
      skipped = true;
      reasons.push("sim hit rate below threshold");
    }
    if (edge == null || edge < (marketOnly ? 2.5 : MIN_EDGE_PCT)) {
      skipped = true;
      reasons.push("insufficient line value");
    }
    if (composite == null || composite < MIN_COMPOSITE) {
      skipped = true;
      reasons.push("grade below threshold");
    }
    if (lean?.side && !leanAligned && (edge ?? 0) < 4) {
      skipped = true;
      reasons.push("against data lean");
    }

    const label = `${o.name} ${o.point > 0 ? "+" : ""}${o.point}`;
    recommendations.push({
      market: "Game Spread",
      pick: label,
      odds: o.price,
      line: o.point,
      book: o.book ?? null,
      grade: composite != null ? gradeFromComposite(composite) : null,
      confidencePct: marketOnly && confidence != null ? Math.min(confidence, 55) : confidence,
      edgePct: edge,
      simHitPct: simHit,
      evPct: edge,
      skipped,
      reason: skipped
        ? `Skipped: ${reasons.join(", ")}`
        : marketOnly
          ? "Market-only price evaluation · limited data · confidence capped"
          : `Sim covers ${simHit}% · +${edge}% edge vs posted line`,
      quality: {
        winProbability: side === "away" ? metrics?.winProbability.away ?? null : metrics?.winProbability.home ?? null,
        projectedTotalGames: metrics?.projectedTotalGames ?? null,
        dataCoveragePct: prePick.dataCoveragePct,
      },
    });
  }

  // --- Total games ---
  const totalBest = new Map<string, TotalPostedOutcome>();
  for (const o of totalOutcomes) {
    if (!Number.isFinite(o.price) || !Number.isFinite(o.point)) continue;
    const side = /^over/i.test(o.name) ? "over" : /^under/i.test(o.name) ? "under" : null;
    if (!side) continue;
    const key = `${side}|${o.point}`;
    const cur = totalBest.get(key);
    if (!cur || americanToProb(o.price) < americanToProb(cur.price)) totalBest.set(key, o);
  }

  const totalKeys = [...totalBest.values()].map((o) => {
    const side = /^over/i.test(o.name) ? ("over" as const) : ("under" as const);
    return { o, side, id: totalQueryId(side, o.point) };
  });

  const totalDevigPool = totalKeys.map(({ o, side }) => ({
    price: o.price,
    book: o.book,
    key: `${side}|${o.point}`,
  }));

  for (const { o, side, id } of totalKeys) {
    const simHit = sim?.coverHitRates?.[id] != null ? Math.round(sim.coverHitRates[id]! * 1000) / 10 : null;
    const implied = americanToProb(o.price);
    const rawEdge = simHit != null ? Math.round((simHit / 100 - implied) * 1000) / 10 : null;
    const { edge: devigEdge } = devigTwoWayEdge(
      o.price,
      totalDevigPool,
      `${side}|${o.point}`,
      (k) => {
        const [s, pt] = k.split("|");
        const opp = s === "over" ? "under" : "over";
        return totalKeys.some((x) => x.side === opp && x.o.point === Number(pt)) ? `${opp}|${pt}` : null;
      },
    );
    const edge = devigEdge ?? rawEdge;
    const { composite, confidence } = scoreLinePick(lean, true, simHit != null ? simHit / 100 : null, edge);

    let skipped = false;
    const reasons: string[] = [];
    if (!coverageOk) {
      skipped = true;
      reasons.push("insufficient pre-pick data");
    }
    if (!marketOnly && (simHit == null || simHit / 100 < MIN_SPREAD_TOTAL_SIM)) {
      skipped = true;
      reasons.push("sim hit rate below threshold");
    }
    if (edge == null || edge < (marketOnly ? 2.5 : MIN_EDGE_PCT)) {
      skipped = true;
      reasons.push("insufficient line value");
    }
    if (composite == null || composite < MIN_COMPOSITE) {
      skipped = true;
      reasons.push("grade below threshold");
    }

    const label = `${side === "over" ? "Over" : "Under"} ${o.point}`;
    recommendations.push({
      market: "Total Games",
      pick: label,
      odds: o.price,
      line: o.point,
      book: o.book ?? null,
      grade: composite != null ? gradeFromComposite(composite) : null,
      confidencePct: marketOnly && confidence != null ? Math.min(confidence, 55) : confidence,
      edgePct: edge,
      simHitPct: simHit,
      evPct: edge,
      skipped,
      reason: skipped
        ? `Skipped: ${reasons.join(", ")}`
        : marketOnly
          ? "Market-only price evaluation · limited data · confidence capped"
          : `Sim hits ${simHit}% · +${edge}% edge vs posted total`,
      quality: {
        winProbability: null,
        projectedTotalGames: metrics?.projectedTotalGames ?? null,
        dataCoveragePct: prePick.dataCoveragePct,
      },
    });
  }

  recommendations.sort((a, b) => {
    if (a.skipped !== b.skipped) return a.skipped ? 1 : -1;
    return (b.edgePct ?? -99) - (a.edgePct ?? -99);
  });

  return { recommendations, books };
}

export function buildCoverQueriesFromOutcomes(
  awayName: string,
  homeName: string,
  spreadOutcomes: SpreadPostedOutcome[],
  totalOutcomes: TotalPostedOutcome[],
): import("./gameMonteCarlo.js").GameCoverQuery[] {
  const queries: import("./gameMonteCarlo.js").GameCoverQuery[] = [];
  const spreadPts = new Set<string>();
  for (const o of spreadOutcomes) {
    if (!Number.isFinite(o.point)) continue;
    const side = nameMatch(o.name, awayName) ? "away" : nameMatch(o.name, homeName) ? "home" : null;
    if (!side) continue;
    const key = `${side}|${o.point}`;
    if (spreadPts.has(key)) continue;
    spreadPts.add(key);
    queries.push({ id: spreadQueryId(side, o.point), kind: "spread", teamSide: side, line: o.point });
  }
  const totalPts = new Set<string>();
  for (const o of totalOutcomes) {
    if (!Number.isFinite(o.point)) continue;
    const side = /^over/i.test(o.name) ? "over" : /^under/i.test(o.name) ? "under" : null;
    if (!side) continue;
    const key = `${side}|${o.point}`;
    if (totalPts.has(key)) continue;
    totalPts.add(key);
    queries.push({ id: totalQueryId(side, o.point), kind: "total", totalSide: side, line: o.point });
  }
  return queries;
}

// Single source of truth for the 5-component pick rubric and the combined AI
// Grade / Confidence / Edge it rolls up into. Every sub-score is derived from
// REAL feed data (matchup history, recent form, no-vig fair value, ESPN
// injuries, cross-book prices) — and is NULLABLE. When a surface cannot ground a
// signal we return null and the renderer shows "no data" instead of inventing a
// number. The composite combines ONLY the scores that are present (weights are
// renormalized over what we have), so a card with 3 real signals is graded on
// those 3, never padded with fabricated ones.
//
// The five signals:
//   1. Matchup      — does the matchup (mlLean: L10 margin/pace/H2H/form) favor
//                     the side we picked?
//   2. Trend        — recent momentum toward the pick (team streak + margin, or a
//                     player's recent hit-rate vs the prop line).
//   3. Line Value   — the real no-vig edge (fair win prob minus the price's
//                     implied prob), signed toward the picked side.
//   4. Injury       — does the ESPN injury picture favor the pick (opponent more
//                     banged up) or work against it (our side more depleted)?
//   5. Line-Shopping— how much better the BEST available price for the pick is vs
//                     the cross-book consensus (median) — pure shopping value.
//
// Edge% surfaced by the combine is the REAL line-value edge, not a re-derivation
// of the composite — combining five 1-10 scores into a fake "edge %" would
// manufacture a precision we do not have. Grade + Confidence% are honest rollups
// of the composite; Edge% stays the genuine betting edge or null.

export type SubScore = number | null; // 1-10, or null when not groundable

export type PickSubScores = {
  matchup: SubScore;
  trend: SubScore;
  lineValue: SubScore;
  injury: SubScore;
  lineShopping: SubScore;
};

export type CombinedPickScore = {
  scores: PickSubScores;
  // 1-10 weighted average of the PRESENT scores (null if none are present).
  composite: number | null;
  grade: string | null; // A+ .. F
  confidencePct: number | null; // 0-100
  // The genuine betting edge in pct points (signed toward the pick), or null. Not
  // derived from the composite — it IS the line-value input, surfaced honestly.
  edgePct: number | null;
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round1 = (n: number) => Math.round(n * 10) / 10;
// Trim float noise on the -1..1 momentum/favor reads (e.g. (0.8-0.5)*2).
const round3 = (n: number) => Math.round(n * 1000) / 1000;

// American odds -> implied probability (with vig). Used for line-shopping and to
// sanity-bound any price-derived math. Returns null on a non-finite input.
export function americanToImplied(american: number | null | undefined): number | null {
  if (american == null || !Number.isFinite(american) || american === 0) return null;
  return american > 0 ? 100 / (american + 100) : -american / (-american + 100);
}

// ---------- Primitive scorers (normalized input -> 1-10 | null) ----------

// Line Value: the no-vig edge in pct points, SIGNED toward the picked side
// (positive = the pick is underpriced). Centered at 5.5 with ~0.45 pt of score
// per point of edge — the same slope the Confidence badge already uses, so the
// rubric stays consistent with the existing readout. Null edge -> null score.
export function scoreLineValue(edgePct: number | null | undefined): SubScore {
  if (edgePct == null || !Number.isFinite(edgePct)) return null;
  return round1(clamp(5.5 + edgePct * 0.45, 1, 9.9));
}

// Line-Shopping: how many pct points cheaper (in implied prob) the BEST price for
// the pick is vs the cross-book median. 0 = the best book is the market — fair,
// not special (5.0). Every point of shopping advantage is worth ~1.2 score. A
// negative advantage cannot happen for a true "best" price, but we clamp anyway.
export function scoreLineShopping(advantagePct: number | null | undefined): SubScore {
  if (advantagePct == null || !Number.isFinite(advantagePct)) return null;
  return round1(clamp(5 + advantagePct * 1.2, 1, 10));
}

// Matchup: `aligned` is +1 when the pick is ON the model's stronger side, -1 when
// it is AGAINST it, 0 when the matchup is a coin flip; null when we have no lean
// (e.g. a game total, where mlLean does not apply). `leanEdge` is the lean's
// magnitude, capped so one lopsided number cannot peg the score.
export function scoreMatchup(
  aligned: 1 | 0 | -1 | null,
  leanEdge: number,
): SubScore {
  if (aligned == null) return null;
  const mag = clamp(Number.isFinite(leanEdge) ? leanEdge : 0, 0, 5);
  return round1(clamp(5.5 + aligned * mag * 0.7, 1, 10));
}

// Trend: `momentum` is a -1..1 read of recent form pointing TOWARD the pick (W
// streak + positive recent margin for a team; recent over-rate vs the line for a
// player prop). Null when we have no recent sample.
export function scoreTrend(momentum: number | null | undefined): SubScore {
  if (momentum == null || !Number.isFinite(momentum)) return null;
  return round1(clamp(5.5 + clamp(momentum, -1, 1) * 3.5, 1, 10));
}

// Injury: `favor` is a -1..1 read of how the injury picture leans toward the pick
// (positive = the matchup's injuries help our side). Null when no injury data is
// resolvable for the pick.
export function scoreInjury(favor: number | null | undefined): SubScore {
  if (favor == null || !Number.isFinite(favor)) return null;
  return round1(clamp(5.5 + clamp(favor, -1, 1) * 3, 1, 10));
}

// ---------- Builders: real feed shapes -> normalized inputs ----------

// Matchup alignment from an mlLean ({ side, edge }) and the team the pick is on.
// Returns aligned (+1 on the lean side, -1 against, 0 when no clear lean) and the
// lean magnitude. Returns aligned=null when there is no lean or no resolvable
// pick side (totals) — the matchup signal is then honestly omitted.
export function matchupAlignment(
  mlLean: { side?: string | null; edge?: number | null } | null | undefined,
  pickTeam: string | null | undefined,
): { aligned: 1 | 0 | -1 | null; leanEdge: number } {
  if (!mlLean || !mlLean.side || !pickTeam) return { aligned: null, leanEdge: 0 };
  const edge = Number.isFinite(mlLean.edge as number) ? (mlLean.edge as number) : 0;
  const lean = String(mlLean.side).toLowerCase();
  const pick = String(pickTeam).toLowerCase();
  const onSide = lean.includes(pick) || pick.includes(lean);
  if (edge <= 0) return { aligned: 0, leanEdge: 0 };
  return { aligned: onSide ? 1 : -1, leanEdge: edge };
}

// Team trend momentum from a recent streak and recent average margin. Streak
// supplies direction + persistence (capped at 5), margin supplies magnitude. Both
// are read FROM the picked team's perspective, so a team on a 4-game win streak
// outscoring opponents reads strongly positive. Returns null with no inputs.
export function teamTrendMomentum(
  streak: { type?: "W" | "L" | string; count?: number } | null | undefined,
  avgMargin: number | null | undefined,
): number | null {
  let streakPart: number | null = null;
  if (streak && (streak.type === "W" || streak.type === "L")) {
    const c = clamp(Number(streak.count) || 0, 0, 5) / 5;
    streakPart = (streak.type === "W" ? 1 : -1) * c * 0.6;
  }
  let marginPart: number | null = null;
  if (avgMargin != null && Number.isFinite(avgMargin)) {
    marginPart = clamp(avgMargin / 15, -1, 1) * 0.4;
  }
  if (streakPart == null && marginPart == null) return null;
  return round3(clamp((streakPart ?? 0) + (marginPart ?? 0), -1, 1));
}

// Player trend momentum: the recent hit-rate vs the prop line for the PICKED
// side. Given the player's recent stat values for this market and the line, count
// how many cleared (Over) or stayed under (Under) and center on 0.5. e.g. 4 of 5
// over a 24.5 line for an Over pick -> 0.8 hit rate -> +0.6 momentum. Returns
// null when there is no usable sample or no line.
export function playerTrendMomentum(
  recentValues: Array<number | null | undefined>,
  line: number | null | undefined,
  side: "Over" | "Under" | string | null | undefined,
): number | null {
  if (line == null || !Number.isFinite(line)) return null;
  const vals = recentValues.filter(
    (v): v is number => v != null && Number.isFinite(v),
  );
  if (vals.length === 0) return null;
  const overs = vals.filter((v) => v > line).length;
  const rate = overs / vals.length;
  const hitRate = String(side).toLowerCase() === "under" ? 1 - rate : rate;
  return round3(clamp((hitRate - 0.5) * 2, -1, 1));
}

// Injury favor for a GAME pick: an injury edge label ({ side: 'home'|'away'|
// 'neutral', magnitude }) read relative to whether the pick is the home side. A
// matchup whose injuries favor our side reads positive; favoring the opponent
// reads negative; neutral -> 0. Magnitude is capped at 3 (e.g. "Home +3").
export function injuryFavorGame(
  edge: { side?: string | null; magnitude?: number | null } | null | undefined,
  pickIsHome: boolean | null | undefined,
): number | null {
  if (!edge || !edge.side || pickIsHome == null) return null;
  const side = String(edge.side).toLowerCase();
  if (side === "neutral") return 0;
  const mag = clamp(Number(edge.magnitude) || 0, 0, 3) / 3;
  const favorsHome = side === "home";
  const favorsPick = favorsHome === !!pickIsHome;
  return round3(favorsPick ? mag : -mag);
}

// Injury favor for a PROP pick: the opponent being more banged up modestly helps
// an Over (and hurts an Under). Deliberately gentle (half weight) — it is the
// weakest of the five signals for a prop and must never dominate. Returns null
// when we have no opponent key-injury count or a non-directional side ("Yes").
export function injuryFavorProp(
  opponentKeyInjuries: number | null | undefined,
  side: "Over" | "Under" | string | null | undefined,
): number | null {
  if (opponentKeyInjuries == null || !Number.isFinite(opponentKeyInjuries)) return null;
  const s = String(side).toLowerCase();
  if (s !== "over" && s !== "under") return null;
  const mag = round3(clamp(opponentKeyInjuries, 0, 4) / 4 * 0.5);
  return s === "over" ? mag : -mag;
}

// Line-shopping advantage in pct points: how much cheaper (lower implied prob)
// the BEST price for the picked side is vs the median across all books offering
// it. Needs at least 2 books to mean anything. Returns null otherwise.
export function lineShoppingAdvantage(
  pricesForSide: Array<number | null | undefined>,
): number | null {
  const implied = pricesForSide
    .map((p) => americanToImplied(p))
    .filter((p): p is number => p != null);
  if (implied.length < 2) return null;
  const best = Math.min(...implied); // lowest implied = best payout for the bettor
  const sorted = [...implied].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  const median =
    sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[Math.floor(mid)];
  return clamp((median - best) * 100, 0, 25);
}

// ---------- Combine ----------

// Weights express each signal's relative importance. They are renormalized over
// whatever scores are PRESENT, so omitting a signal reweights the rest rather
// than dragging the composite toward a phantom 0.
const WEIGHTS: Record<keyof PickSubScores, number> = {
  lineValue: 0.3,
  matchup: 0.25,
  trend: 0.2,
  injury: 0.15,
  lineShopping: 0.1,
};

// Letter grade from the 1-10 composite — same thresholds the existing card uses,
// so a "B+" still means the same thing. Null composite -> null grade.
export function gradeFromComposite(composite: number | null): string | null {
  if (composite == null) return null;
  if (composite >= 9.0) return "A+";
  if (composite >= 8.5) return "A";
  if (composite >= 8.0) return "A-";
  if (composite >= 7.5) return "B+";
  if (composite >= 7.0) return "B";
  if (composite >= 6.5) return "B-";
  if (composite >= 6.0) return "C+";
  if (composite >= 5.5) return "C";
  if (composite >= 5.0) return "C-";
  if (composite >= 4.0) return "D";
  return "F";
}

// Roll the present sub-scores into a composite + grade + confidence%. edgePct is
// passed through from the real line-value edge — NOT manufactured from the
// composite. confidencePct maps the 1-10 composite onto a 0-100 scale, capped at
// 95 so nothing ever reads as false certainty.
export function combinePickScore(
  scores: PickSubScores,
  edgePct: number | null,
): CombinedPickScore {
  let wSum = 0;
  let acc = 0;
  (Object.keys(WEIGHTS) as Array<keyof PickSubScores>).forEach((k) => {
    const s = scores[k];
    if (s != null && Number.isFinite(s)) {
      wSum += WEIGHTS[k];
      acc += WEIGHTS[k] * s;
    }
  });
  const composite = wSum > 0 ? round1(acc / wSum) : null;
  const confidencePct =
    composite == null ? null : clamp(Math.round(composite * 9), 5, 95);
  return {
    scores,
    composite,
    grade: gradeFromComposite(composite),
    confidencePct,
    edgePct: edgePct != null && Number.isFinite(edgePct) ? round1(edgePct) : null,
  };
}

// Pure qualification gate — no API / React imports (testable in Node).

import type { ParsedPick } from "../components/PickCard.tsx";
import type { PropPoolEntry, RealOddsEntry } from "./api.ts";
import { expectedValuePct } from "./altLineEvSelect.ts";
import { computePickFinalScore } from "./gameLineFinalScore.ts";
import { gradeRank } from "./finalAiScore.ts";
import type { FinalAiScore } from "./finalAiScore.ts";
import { GAME_SIM_MIN_HIT, isGameLinePick } from "./gameSimScoring.ts";
import type { ParlayLegReject } from "./parlayReachCore.ts";
import {
  assertGameLineFinalizeMetrics,
  gameLineFrozenMetricsComplete,
  gameLineSimEdgeQualifies,
  GameLineFinalizeRejected,
} from "./gameLineFrozenQual.ts";

export const MIN_MAIN_PICK_GRADE = "C+";
/** Prop main-ticket confidence floor. */
export const MIN_MAIN_PICK_CONFIDENCE = 52;
/** Game-line main-ticket confidence floor (prefer {@link GAME_LINE_PREFERRED_CONFIDENCE}). */
export const GAME_LINE_MIN_CONFIDENCE = 50;
export const GAME_LINE_PREFERRED_CONFIDENCE = 55;
/** Game-line sim floor — 50%+ standard; exactly 50% needs strong +EV or best EV on the board. */
export const GAME_LINE_SIM_MIN_HIT = 0.5;
/** @deprecated Sub-50% coin-flip band removed — alt-line search runs before reject. */
export const GAME_LINE_COIN_FLIP_LOW = 0.48;
/** Strong +EV (pct pts) required when sim is exactly 50%. */
export const GAME_LINE_STRONG_EV_PCT = 3;
/** Sub-52% game lines need edge/EV at or above this to qualify as exceptional value. */
export const GAME_LINE_EXCEPTIONAL_EV_PCT = 4.5;
/** Cross-book shopping advantage (pct pts) that counts as sharp agreement. */
export const GAME_LINE_SHARP_BOOK_SPREAD_MIN = 2;
/** Rubric factor score (1–10) for sharp money / line movement / shopping agreement. */
export const GAME_LINE_STRONG_FACTOR_MIN = 7;
/** Longshot prop floor — props keep the relaxed longshot bar; game lines do not. */
export const LONGSHOT_SIM_MIN_HIT = 0.49;

function gradeMeetsMinimum(grade: string | null | undefined, minGrade: string): boolean {
  return gradeRank(grade) >= gradeRank(minGrade);
}

export type PickEdgeResolveOpts = {
  realOdds?: RealOddsEntry[];
  propPool?: PropPoolEntry[];
};

function backingEdgePct(
  pick: ParsedPick,
  realOdds: RealOddsEntry[],
  propPool: PropPoolEntry[],
): number | null {
  if (pick.isProp) {
    const same = (e: PropPoolEntry) =>
      e.game === pick.game && e.player === pick.player && e.side === pick.propSide;
    const entry =
      propPool.find((e) => same(e) && e.line === pick.propLine) ?? propPool.find(same);
    const edge = entry?.edge ?? null;
    return edge != null && Number.isFinite(edge) ? edge : null;
  }
  const row = realOdds.find(
    (r) => r.game === pick.game && r.market === pick.market && r.pick === pick.pick,
  );
  const edge = row?.edge ?? null;
  return edge != null && Number.isFinite(edge) ? edge : null;
}

/**
 * Conservative edge read for gating — uses every grounded source on the pick and
 * the backing odds/prop pool row. When sources disagree, the lowest edge wins so
 * a negative card readout cannot slip through on stale Final AI metadata.
 */
export function resolvePickEdgePct(
  pick: ParsedPick,
  opts?: PickEdgeResolveOpts,
): number | null {
  const edges: number[] = [];
  for (const e of [pick.finalAiScore?.edgePct, pick.scores?.edgePct]) {
    if (e != null && Number.isFinite(e)) edges.push(e);
  }
  if (opts?.realOdds?.length || opts?.propPool?.length) {
    const edge = backingEdgePct(pick, opts.realOdds ?? [], opts.propPool ?? []);
    if (edge != null) edges.push(edge);
  }
  if (!edges.length) return null;
  return Math.min(...edges);
}

function backingFairProb(
  pick: ParsedPick,
  realOdds: RealOddsEntry[],
): number | null {
  const row = realOdds.find(
    (r) => r.game === pick.game && r.market === pick.market && r.pick === pick.pick,
  );
  const fair = row?.noVigFair ?? null;
  return fair != null && Number.isFinite(fair) ? fair : null;
}

/** Expected value in pct points per $1 staked for a scored pick. */
export function resolvePickExpectedValue(
  pick: ParsedPick,
  opts?: PickEdgeResolveOpts,
): number | null {
  const edge = resolvePickEdgePct(pick, opts);
  const simHit = pick.finalAiScore?.simHit ?? null;
  const odds = pick.odds ?? null;
  const fairProb =
    opts?.realOdds?.length && !pick.isProp
      ? backingFairProb(pick, opts.realOdds)
      : null;
  return expectedValuePct(simHit, odds, fairProb, edge);
}

function sharedMainTicketChecks(
  score: FinalAiScore,
  odds: number | null | undefined,
  edge: number | null,
  minConfidence: number = MIN_MAIN_PICK_CONFIDENCE,
): boolean {
  if (!score.grade || !gradeMeetsMinimum(score.grade, MIN_MAIN_PICK_GRADE)) return false;
  if (edge == null || !Number.isFinite(edge) || edge <= 0) return false;
  if (score.confidencePct == null || score.confidencePct < minConfidence) return false;
  if (score.composite == null || !Number.isFinite(score.composite) || score.composite <= 0) {
    return false;
  }
  if (odds == null || !Number.isFinite(odds)) return false;
  return true;
}

/** Rounded sim hit % for game-line bar checks (e.g. 0.504 → 50). */
export function simHitPctRounded(simHit: number | null | undefined): number | null {
  if (simHit == null || !Number.isFinite(simHit)) return null;
  return Math.round(simHit * 100);
}

export function isSimExactlyFifty(simHit: number | null | undefined): boolean {
  return simHitPctRounded(simHit) === 50;
}

export function isSimAboveFifty(simHit: number | null | undefined): boolean {
  const pct = simHitPctRounded(simHit);
  return pct != null && pct > 50;
}

export type GameLineSimBarCtx = {
  evPct?: number | null;
  bookSpread?: number | null;
  finalAiScore?: FinalAiScore | null;
  /** True when this rung carries the highest +EV among every posted line for the game. */
  isBestEvLine?: boolean;
};

function factorScore(
  factors: FinalAiScore["factors"] | undefined,
  key: string,
): number | null {
  const f = factors?.find((x) => x.key === key);
  return f?.score != null && Number.isFinite(f.score) ? f.score : null;
}

function rubricSubScore(
  score: FinalAiScore | null | undefined,
  key: keyof import("./pickScore.ts").PickSubScores,
): number | null {
  const v = score?.rubric?.scores?.[key];
  return v != null && Number.isFinite(v) ? v : null;
}

function backingBookSpread(
  pick: ParsedPick,
  realOdds: RealOddsEntry[],
): number | null {
  const row = realOdds.find(
    (r) => r.game === pick.game && r.market === pick.market && r.pick === pick.pick,
  );
  const spread = row?.bookSpread ?? null;
  return spread != null && Number.isFinite(spread) ? spread : null;
}

/** Sharp money or cross-book agreement on the picked side. */
export function gameLineHasSharpAgreement(
  pick: ParsedPick,
  opts?: PickEdgeResolveOpts,
  ctx?: GameLineSimBarCtx,
): boolean {
  const spread =
    ctx?.bookSpread ??
    backingBookSpread(pick, opts?.realOdds ?? []) ??
    null;
  if (spread != null && spread >= GAME_LINE_SHARP_BOOK_SPREAD_MIN) return true;
  const score = ctx?.finalAiScore ?? pick.finalAiScore;
  const shopping = rubricSubScore(score, "lineShopping");
  if (shopping != null && shopping >= GAME_LINE_STRONG_FACTOR_MIN) return true;
  const sharp = factorScore(score?.factors, "sharpMoney");
  return sharp != null && sharp >= GAME_LINE_STRONG_FACTOR_MIN;
}

/** Favorable line movement or strong shopping edge in our direction. */
export function gameLineHasFavorableMovement(
  pick: ParsedPick,
  opts?: PickEdgeResolveOpts,
  ctx?: GameLineSimBarCtx,
): boolean {
  const spread =
    ctx?.bookSpread ??
    backingBookSpread(pick, opts?.realOdds ?? []) ??
    null;
  if (spread != null && spread >= GAME_LINE_SHARP_BOOK_SPREAD_MIN + 1) return true;
  const score = ctx?.finalAiScore ?? pick.finalAiScore;
  const movement = factorScore(score?.factors, "lineMovement");
  if (movement != null && movement >= GAME_LINE_STRONG_FACTOR_MIN) return true;
  const shopping = rubricSubScore(score, "lineShopping");
  return shopping != null && shopping >= GAME_LINE_STRONG_FACTOR_MIN;
}

/** 48–52% sim legs need strong +EV, sharp agreement, or favorable line movement. */
export function gameLineMeetsExceptionalCoinFlip(
  simHit: number,
  edge: number | null | undefined,
  evPct: number | null | undefined,
  pick: ParsedPick,
  opts?: PickEdgeResolveOpts,
  ctx?: GameLineSimBarCtx,
): boolean {
  if (simHit < GAME_LINE_COIN_FLIP_LOW || simHit >= GAME_LINE_SIM_MIN_HIT) return false;
  if (evPct != null && evPct >= GAME_LINE_EXCEPTIONAL_EV_PCT) return true;
  if (edge != null && edge >= GAME_LINE_EXCEPTIONAL_EV_PCT) return true;
  if (gameLineHasSharpAgreement(pick, opts, ctx)) return true;
  return gameLineHasFavorableMovement(pick, opts, ctx);
}

/**
 * Game-line sim bar — sim > 50% passes; exactly 50% needs strong +EV / best EV /
 * edge ≥ 3%; below 50% needs edge ≥ 4.5%.
 */
export function gameLineMeetsSimBar(
  simHit: number | null | undefined,
  edge: number | null | undefined,
  ctx?: GameLineSimBarCtx & { pick?: ParsedPick; opts?: PickEdgeResolveOpts },
): boolean {
  void ctx?.pick;
  void ctx?.opts;
  if (simHit == null || !Number.isFinite(simHit)) return false;
  if (edge == null || !Number.isFinite(edge) || edge <= 0) return false;
  return gameLineSimEdgeQualifies(simHit, edge, {
    evPct: ctx?.evPct,
    isBestEvLine: ctx?.isBestEvLine,
  });
}

/** Rubric attached for card rendering — scores field or Final AI rubric fallback. */
export function pickRubricForDisplay(pick: ParsedPick): import("./pickScore.ts").CombinedPickScore | null {
  const rubric = pick.scores ?? pick.finalAiScore?.rubric ?? null;
  if (rubric?.composite == null || !Number.isFinite(rubric.composite)) return null;
  return rubric;
}

/** True when every metric tile on a Coach pick card can be filled (no dashes). */
export function pickHasCoachCardMetrics(
  pick: ParsedPick,
  opts?: PickEdgeResolveOpts,
): boolean {
  const s = pick.finalAiScore;
  if (!s?.grade || !gradeMeetsMinimum(s.grade, MIN_MAIN_PICK_GRADE)) return false;
  if (s.confidencePct == null || !Number.isFinite(s.confidencePct)) return false;
  const minConf = isGameLinePickForGate(pick)
    ? GAME_LINE_MIN_CONFIDENCE
    : MIN_MAIN_PICK_CONFIDENCE;
  if (s.confidencePct < minConf) return false;
  if (s.composite == null || !Number.isFinite(s.composite) || s.composite <= 0) return false;
  if (s.simHit == null || !Number.isFinite(s.simHit)) return false;
  const edge = resolvePickEdgePct(pick, opts);
  if (edge == null || !Number.isFinite(edge) || edge <= 0) return false;
  const ev = resolvePickExpectedValue(pick, opts);
  if (ev == null || !Number.isFinite(ev) || ev <= 0) return false;
  if (pick.odds == null || !Number.isFinite(pick.odds)) return false;
  if (!pick.scores?.composite || !Number.isFinite(pick.scores.composite)) return false;
  if (isGameLinePickForGate(pick)) {
    if (!pick.gameLineFinal) return false;
    if (pick.gameLineFinal.finalScore == null || !Number.isFinite(pick.gameLineFinal.finalScore)) {
      return false;
    }
  }
  return true;
}

/** Every field the pick card must render for a game line (grade, conf, edge, sim, best line). */
export function gameLineHasCompleteDisplay(
  pick: ParsedPick,
  opts?: PickEdgeResolveOpts,
): boolean {
  return pickHasCoachCardMetrics(pick, opts);
}

/**
 * Prop main-ticket bar — 52% sim, sim-aligned, C+, strictly positive edge.
 * Unchanged from prior prop standards.
 */
export function isPropMainTicketQualified(
  score: FinalAiScore | null | undefined,
  odds: number | null | undefined,
  edgePct?: number | null,
): boolean {
  if (!score) return false;
  const edge = edgePct !== undefined ? edgePct : score.edgePct;
  if (!sharedMainTicketChecks(score, odds, edge)) return false;
  if (score.simHit == null || !Number.isFinite(score.simHit) || score.simHit < GAME_SIM_MIN_HIT) {
    return false;
  }
  if (!score.simAligned) return false;
  return true;
}

/**
 * Game-line main-ticket bar — positive EV, positive edge, C+, confidence 50+.
 * Sim under 50% is allowed only when edge is exceptional (≥ 4.5%); otherwise
 * the caller should search alternate lines or skip the game.
 */
export function isGameLineMainTicketQualified(
  score: FinalAiScore | null | undefined,
  odds: number | null | undefined,
  edgePct?: number | null,
  evPct?: number | null,
  ctx?: GameLineSimBarCtx,
): boolean {
  if (!score) return false;
  const edge = edgePct !== undefined ? edgePct : score.edgePct;
  if (!sharedMainTicketChecks(score, odds, edge, GAME_LINE_MIN_CONFIDENCE)) return false;
  if (evPct == null || evPct <= 0) return false;
  return gameLineMeetsSimBar(score.simHit, edge, { ...ctx, evPct, finalAiScore: score });
}

/**
 * Main-ticket quality bar for props (legacy alias).
 */
export function isMainTicketQualified(
  score: FinalAiScore | null | undefined,
  odds: number | null | undefined,
  edgePct?: number | null,
): boolean {
  return isPropMainTicketQualified(score, odds, edgePct);
}

/**
 * Relaxed main-ticket bar for explicit longshot **prop** asks only.
 */
export function isLongshotMainTicketQualified(
  score: FinalAiScore | null | undefined,
  odds: number | null | undefined,
  edgePct?: number | null,
): boolean {
  if (!score) return false;
  const edge = edgePct !== undefined ? edgePct : score.edgePct;
  if (!sharedMainTicketChecks(score, odds, edge)) return false;
  if (
    score.simHit == null ||
    !Number.isFinite(score.simHit) ||
    score.simHit < LONGSHOT_SIM_MIN_HIT
  ) {
    return false;
  }
  return true;
}

/** @deprecated Alias for isPropMainTicketQualified */
export function isFullyQualifiedPropFinalAi(
  score: FinalAiScore | null | undefined,
  odds: number | null | undefined,
): boolean {
  return isPropMainTicketQualified(score, odds);
}

/** @deprecated Alias for isGameLineMainTicketQualified */
export function isFullyQualifiedGameLineFinalAi(
  score: FinalAiScore | null | undefined,
  odds: number | null | undefined,
): boolean {
  return isGameLineMainTicketQualified(score, odds);
}

/** @deprecated Use isPropMainTicketQualified or isGameLineMainTicketQualified */
export function isFullyQualifiedFinalAi(
  score: FinalAiScore | null | undefined,
  odds: number | null | undefined,
): boolean {
  return isPropMainTicketQualified(score, odds);
}

function isGameLinePickForGate(pick: ParsedPick): boolean {
  return !pick.isProp && isGameLinePick(pick);
}

/**
 * Optimizer gate before freeze — same qualification bar as the main ticket but
 * reads live Final AI scores instead of requiring a frozen display snapshot.
 */
export function isGameLineQualifiedForFinalize(
  pick: ParsedPick,
  opts?: PickEdgeResolveOpts,
): boolean {
  if (!pickHasCoachCardMetrics(pick, opts)) return false;
  const edge = resolvePickEdgePct(pick, opts);
  if (edge == null || edge <= 0) return false;
  const score = pick.finalAiScore;
  const odds = pick.odds ?? null;
  const ev = resolvePickExpectedValue(pick, opts);
  if (
    !isGameLineMainTicketQualified(score, odds, edge, ev, {
      bookSpread: backingBookSpread(pick, opts?.realOdds ?? []),
      finalAiScore: score,
      evPct: ev,
      isBestEvLine: pick.gameLineFinal?.isBestEv,
    })
  ) {
    return false;
  }
  try {
    assertGameLineFinalizeMetrics(pick, {
      grade: score?.grade,
      confidencePct: score?.confidencePct,
      simHit: score?.simHit,
      edgePct: edge,
      evPct: ev,
      market: pick.market,
      odds: pick.odds,
      isBestEvLine: pick.gameLineFinal?.isBestEv,
    });
    return true;
  } catch {
    return false;
  }
}

export function isFullyQualifiedPick(
  pick: ParsedPick,
  opts?: PickEdgeResolveOpts & { longshotAsk?: boolean },
): boolean {
  if (!pickHasCoachCardMetrics(pick, opts)) return false;
  const edge = resolvePickEdgePct(pick, opts);
  if (edge == null || edge <= 0) return false;
  const score = pick.finalAiScore;
  const odds = pick.odds ?? null;
  if (isGameLinePickForGate(pick)) {
    if (!gameLineFrozenMetricsComplete(pick)) return false;
    const ev = resolvePickExpectedValue(pick, opts);
    return (
      isGameLineMainTicketQualified(score, odds, edge, ev, {
        bookSpread: backingBookSpread(pick, opts?.realOdds ?? []),
        finalAiScore: score,
        evPct: ev,
        isBestEvLine: pick.gameLineFinal?.isBestEv,
      }) && gameLineHasCompleteDisplay(pick, opts)
    );
  }
  if (opts?.longshotAsk) {
    return isLongshotMainTicketQualified(score, odds, edge);
  }
  return isPropMainTicketQualified(score, odds, edge);
}

/** Last-chance filter before rendering a main-ticket parlay. Never pads. */
export function filterMainTicketPicks(
  picks: ParsedPick[],
  opts?: PickEdgeResolveOpts & { rejectsOut?: ParlayLegReject[]; longshotAsk?: boolean },
): ParsedPick[] {
  const out: ParsedPick[] = [];
  for (const p of picks) {
    if (isFullyQualifiedPick(p, opts)) {
      out.push(p);
      continue;
    }
    opts?.rejectsOut?.push({
      pick: p,
      reason: reasonPickNotQualified(p, opts),
      nearScore: nearScoreFromPick(p),
    });
  }
  return out;
}

export class MainTicketQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MainTicketQualificationError";
  }
}

/** Throw when any leg on a main ticket fails the qualification gate. */
export function assertMainTicketPicksQualified(
  picks: ParsedPick[],
  opts?: PickEdgeResolveOpts & { longshotAsk?: boolean },
): void {
  for (const pick of picks) {
    if (!isFullyQualifiedPick(pick, opts)) {
      const detail = reasonPickNotQualified(pick, opts);
      const label = pick.isProp ? pick.player ?? pick.pick : pick.pick;
      throw new MainTicketQualificationError(
        `${label} (${pick.game}) — ${detail}`,
      );
    }
  }
}

/** Negative-edge or sim-opposed legs for the optional longshot section only. */
export function isLongshotSectionPick(pick: ParsedPick): boolean {
  const s = pick.finalAiScore;
  if (!s?.grade || pick.odds == null || !Number.isFinite(pick.odds)) return false;
  const edge = resolvePickEdgePct(pick);
  const negativeEdge = edge == null || edge <= 0;
  const simUnsupported = !s.simAligned || s.simHit == null || s.simHit < GAME_SIM_MIN_HIT;
  if (!negativeEdge && !simUnsupported) return false;
  return s.simHit != null || edge != null;
}

export function reasonPickNotQualified(
  pick: ParsedPick,
  opts?: PickEdgeResolveOpts & { longshotAsk?: boolean },
): string {
  const s = pick.finalAiScore;
  if (!s) return "missing Final AI Score";
  if (!s.grade) return "missing AI Grade";
  if (!gradeMeetsMinimum(s.grade, MIN_MAIN_PICK_GRADE)) {
    return `AI Grade ${s.grade} — main picks need ${MIN_MAIN_PICK_GRADE} or better`;
  }
  const edge = resolvePickEdgePct(pick, opts);
  if (edge == null) return "missing Edge %";
  if (edge <= 0) return `${edge}% edge — non-positive EV, rejected`;
  const ev = isGameLinePickForGate(pick) ? resolvePickExpectedValue(pick, opts) : null;
  if (isGameLinePickForGate(pick)) {
    if (ev == null || ev <= 0) return `${ev ?? "—"}% expected value — non-positive EV, rejected`;
  }
  if (s.confidencePct == null) return "missing Confidence";
  const minConf = isGameLinePickForGate(pick)
    ? GAME_LINE_MIN_CONFIDENCE
    : MIN_MAIN_PICK_CONFIDENCE;
  if (s.confidencePct < minConf) {
    return `Confidence ${s.confidencePct}% — needs ≥${minConf}%`;
  }
  if (s.simHit == null) return "missing Simulation Hit %";
  if (!pickHasCoachCardMetrics(pick, opts)) {
    return "incomplete pick score — grade, confidence, edge, sim, or best line missing";
  }
  if (isGameLinePickForGate(pick)) {
    if (!pick.gameLineFrozen || !pick.gameLineFinal?.display) {
      return "game line not frozen — refusing incomplete display";
    }
    if (!gameLineFrozenMetricsComplete(pick)) {
      return "game line missing Final AI Grade, Confidence, Sim %, or Edge % on frozen display";
    }
    if (
      !gameLineMeetsSimBar(s.simHit, edge, {
        pick,
        opts,
        evPct: ev,
        finalAiScore: s,
        isBestEvLine: pick.gameLineFinal?.isBestEv,
      })
    ) {
      const pct = Math.round(s.simHit * 100);
      if (pct === 50) {
        return `10k sim 50% — needs strong +EV (≥${GAME_LINE_STRONG_EV_PCT}%) or best EV among all posted lines`;
      }
      if (pct < 50) {
        return `10k sim ${pct}% — needs edge ≥ ${GAME_LINE_EXCEPTIONAL_EV_PCT}% to qualify`;
      }
      return `10k sim ${pct}% — game line needs sim >50%, or exactly 50% with strong +EV / best EV after alt-line search`;
    }
  } else if (opts?.longshotAsk) {
    if (s.simHit < LONGSHOT_SIM_MIN_HIT) {
      const pct = Math.round(s.simHit * 100);
      return `10k sim ${pct}% — simulator does not support this pick (needs ≥${Math.round(LONGSHOT_SIM_MIN_HIT * 100)}%)`;
    }
  } else {
    if (s.simHit < GAME_SIM_MIN_HIT) {
      const pct = Math.round(s.simHit * 100);
      return `10k sim ${pct}% — simulator does not support this pick (needs ≥${Math.round(GAME_SIM_MIN_HIT * 100)}%)`;
    }
    if (!s.simAligned) {
      const pct = Math.round(s.simHit * 100);
      return `Game simulator (${pct}% cover) disagrees with AI Coach`;
    }
  }
  if (s.composite == null || s.composite <= 0) return "non-positive Final AI Score / EV";
  if (pick.odds == null || !Number.isFinite(pick.odds)) return "no real sportsbook odds";
  return "quality bar not met";
}

/**
 * Ranking priority for main-ticket selection.
 * Game lines: EV first, then edge, sim, confidence, grade, payout.
 * Props: edge, sim, confidence, grade, payout.
 */
export function comparePickStrength(a: ParsedPick, b: ParsedPick): number {
  const sa = a.finalAiScore;
  const sb = b.finalAiScore;
  const fsA = isGameLinePickForGate(a) ? computePickFinalScore(a) : null;
  const fsB = isGameLinePickForGate(b) ? computePickFinalScore(b) : null;
  if (fsA != null && fsB != null && fsB !== fsA) return fsB - fsA;
  if (fsA != null && fsB == null) return -1;
  if (fsA == null && fsB != null) return 1;
  const edgeA = resolvePickEdgePct(a) ?? -999;
  const edgeB = resolvePickEdgePct(b) ?? -999;
  if (edgeB !== edgeA) return edgeB - edgeA;

  const simA = sa?.simHit ?? 0;
  const simB = sb?.simHit ?? 0;
  if (simB !== simA) return simB - simA;

  const confA = sa?.confidencePct ?? 0;
  const confB = sb?.confidencePct ?? 0;
  if (confB !== confA) return confB - confA;

  const gradeA = gradeRank(sa?.grade);
  const gradeB = gradeRank(sb?.grade);
  if (gradeB !== gradeA) return gradeB - gradeA;

  const oddsA = a.odds ?? -9999;
  const oddsB = b.odds ?? -9999;
  return oddsB - oddsA;
}

export function nearScoreFromPick(pick: ParsedPick): number {
  const s = pick.finalAiScore;
  if (isGameLinePickForGate(pick)) {
    const fs = computePickFinalScore(pick);
    if (fs != null) return fs * 10;
  }
  const edge = Math.max(0, resolvePickEdgePct(pick) ?? 0);
  const sim = s?.simHit ?? 0;
  const conf = s?.confidencePct ?? 0;
  const grade = gradeRank(s?.grade);
  const odds = pick.odds ?? -999;
  return edge * 1000 + sim * 500 + conf * 2 + grade * 10 + odds * 0.01;
}

export function partitionQualifiedPicks(
  picks: ParsedPick[],
  opts?: PickEdgeResolveOpts,
): {
  qualified: ParsedPick[];
  unqualified: ParsedPick[];
} {
  const qualified: ParsedPick[] = [];
  const unqualified: ParsedPick[] = [];
  for (const p of picks) {
    if (isFullyQualifiedPick(p, opts)) qualified.push(p);
    else unqualified.push(p);
  }
  return { qualified, unqualified };
}

export { GameLineFinalizeRejected } from "./gameLineFrozenQual.ts";

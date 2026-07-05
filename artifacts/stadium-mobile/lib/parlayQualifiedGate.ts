// Pure qualification gate — no API / React imports (testable in Node).

import type { ParsedPick } from "../components/PickCard.tsx";
import type { PropPoolEntry, RealOddsEntry } from "./api.ts";
import { expectedValuePct } from "./altLineEvSelect.ts";
import { computePickFinalScore } from "./gameLineFinalScore.ts";
import { gradeRank } from "./finalAiScore.ts";
import type { FinalAiScore } from "./finalAiScore.ts";
import { GAME_SIM_MIN_HIT, isGameLinePick } from "./gameSimScoring.ts";
import type { ParlayLegReject } from "./parlayReachCore.ts";

export const MIN_MAIN_PICK_GRADE = "C+";
export const MIN_MAIN_PICK_CONFIDENCE = 50;
/** Game-line sim floor — same bar as props; coin-flip band needs exceptional signals. */
export const GAME_LINE_SIM_MIN_HIT = 0.52;
/** 48–52% sim band — only exceptional value / market signals may qualify. */
export const GAME_LINE_COIN_FLIP_LOW = 0.48;
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
): boolean {
  if (!score.grade || !gradeMeetsMinimum(score.grade, MIN_MAIN_PICK_GRADE)) return false;
  if (edge == null || !Number.isFinite(edge) || edge <= 0) return false;
  if (score.confidencePct == null || score.confidencePct < MIN_MAIN_PICK_CONFIDENCE) return false;
  if (score.composite == null || !Number.isFinite(score.composite) || score.composite <= 0) {
    return false;
  }
  if (odds == null || !Number.isFinite(odds)) return false;
  return true;
}

export type GameLineSimBarCtx = {
  evPct?: number | null;
  bookSpread?: number | null;
  finalAiScore?: FinalAiScore | null;
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
 * True when a game-line sim hit clears 52%, or carries exceptional value /
 * market signals in the coin-flip band (48–52%).
 */
export function gameLineMeetsSimBar(
  simHit: number | null | undefined,
  edge: number | null | undefined,
  ctx?: GameLineSimBarCtx & { pick?: ParsedPick; opts?: PickEdgeResolveOpts },
): boolean {
  if (simHit == null || !Number.isFinite(simHit)) return false;
  if (simHit >= GAME_LINE_SIM_MIN_HIT) return true;
  if (ctx?.pick && simHit >= GAME_LINE_COIN_FLIP_LOW) {
    return gameLineMeetsExceptionalCoinFlip(
      simHit,
      edge,
      ctx.evPct,
      ctx.pick,
      ctx.opts,
      ctx,
    );
  }
  return edge != null && Number.isFinite(edge) && edge >= GAME_LINE_EXCEPTIONAL_EV_PCT;
}

/** Every field the pick card must render for a game line (grade, conf, edge, sim, best line). */
export function gameLineHasCompleteDisplay(
  pick: ParsedPick,
  opts?: PickEdgeResolveOpts,
): boolean {
  const s = pick.finalAiScore;
  if (!s?.grade || !gradeMeetsMinimum(s.grade, MIN_MAIN_PICK_GRADE)) return false;
  if (s.confidencePct == null || !Number.isFinite(s.confidencePct)) return false;
  if (s.simHit == null || !Number.isFinite(s.simHit)) return false;
  const edge = resolvePickEdgePct(pick, opts);
  if (edge == null || !Number.isFinite(edge) || edge <= 0) return false;
  if (pick.odds == null || !Number.isFinite(pick.odds)) return false;
  if (!pick.gameLineFinal) return false;
  return true;
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
  if (!sharedMainTicketChecks(score, odds, edge)) return false;
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

export function isFullyQualifiedPick(
  pick: ParsedPick,
  opts?: PickEdgeResolveOpts & { longshotAsk?: boolean },
): boolean {
  const edge = resolvePickEdgePct(pick, opts);
  if (edge == null || edge <= 0) return false;
  const score = pick.finalAiScore;
  const odds = pick.odds ?? null;
  if (isGameLinePickForGate(pick)) {
    const ev = resolvePickExpectedValue(pick, opts);
    return (
      isGameLineMainTicketQualified(score, odds, edge, ev, {
        bookSpread: backingBookSpread(pick, opts?.realOdds ?? []),
        finalAiScore: score,
        evPct: ev,
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
  if (s.confidencePct < MIN_MAIN_PICK_CONFIDENCE) {
    return `Confidence ${s.confidencePct}% — needs ≥${MIN_MAIN_PICK_CONFIDENCE}%`;
  }
  if (s.simHit == null) return "missing Simulation Hit %";
  if (isGameLinePickForGate(pick)) {
    if (!pick.gameLineFinal) return "game line not finalized after 10k sim";
    if (!gameLineHasCompleteDisplay(pick, opts)) return "incomplete game-line score (grade, confidence, edge, sim, or best line)";
    if (!gameLineMeetsSimBar(s.simHit, edge, { pick, opts, evPct: ev, finalAiScore: s })) {
      const pct = Math.round(s.simHit * 100);
      return `10k sim ${pct}% — game line needs >${Math.round(GAME_LINE_SIM_MIN_HIT * 100)}% sim, or exceptional +EV / sharp money / line movement in the coin-flip band`;
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
  if (isGameLinePickForGate(a) && isGameLinePickForGate(b)) {
    const fsA = computePickFinalScore(a) ?? -999;
    const fsB = computePickFinalScore(b) ?? -999;
    if (fsB !== fsA) return fsB - fsA;
  }
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

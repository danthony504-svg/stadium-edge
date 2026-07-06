// Line-market validation for Coach recommendations.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { PropPoolEntry, RealOddsEntry } from "./api.ts";
import {
  LINE_SIGNAL_MIN_BOOK_SPREAD,
  LINE_SIGNAL_MIN_SHOPPING_SCORE,
  LINE_SIGNAL_STRONG_EDGE_PCT,
} from "./coachUniversalRules.ts";
import { resolvePickEdgePct, type PickEdgeResolveOpts } from "./parlayQualifiedGate.ts";

function rubricLineShopping(pick: ParsedPick): number | null {
  const v =
    pick.scores?.scores?.lineShopping ?? pick.finalAiScore?.rubric?.scores?.lineShopping ?? null;
  return v != null && Number.isFinite(v) ? v : null;
}

function lineMovementFactorScore(pick: ParsedPick): number | null {
  const f = pick.finalAiScore?.factors?.find((x) => x.key === "lineMovement");
  return f?.score != null && Number.isFinite(f.score) ? f.score : null;
}

function backingBookSpread(
  pick: ParsedPick,
  realOdds: RealOddsEntry[],
  propPool: PropPoolEntry[],
): number | null {
  if (pick.isProp) {
    const same = (e: PropPoolEntry) =>
      e.game === pick.game && e.player === pick.player && e.side === pick.propSide;
    const entry =
      propPool.find((e) => same(e) && e.line === pick.propLine) ?? propPool.find(same);
    const spread = entry?.bookSpread ?? null;
    return spread != null && Number.isFinite(spread) ? spread : null;
  }
  const row = realOdds.find(
    (r) => r.game === pick.game && r.market === pick.market && r.pick === pick.pick,
  );
  const spread = row?.bookSpread ?? null;
  return spread != null && Number.isFinite(spread) ? spread : null;
}

/**
 * Line-market validation — cross-book spread, line-shopping rubric, movement feed,
 * or a clearly strong edge when history feeds are absent.
 */
export function pickHasLineMarketSignal(
  pick: ParsedPick,
  opts?: PickEdgeResolveOpts,
): boolean {
  const movement = lineMovementFactorScore(pick);
  if (movement != null && movement >= LINE_SIGNAL_MIN_SHOPPING_SCORE) return true;

  const shopping = rubricLineShopping(pick);
  if (shopping != null && shopping >= LINE_SIGNAL_MIN_SHOPPING_SCORE) return true;

  const spread = backingBookSpread(pick, opts?.realOdds ?? [], opts?.propPool ?? []);
  if (spread != null && spread >= LINE_SIGNAL_MIN_BOOK_SPREAD) return true;

  const edge = resolvePickEdgePct(pick, opts);
  return edge != null && edge >= LINE_SIGNAL_STRONG_EDGE_PCT;
}

export function lineMarketSignalReason(): string {
  return `no cross-book line signal — needs shopping score ≥${LINE_SIGNAL_MIN_SHOPPING_SCORE}, book spread ≥${LINE_SIGNAL_MIN_BOOK_SPREAD}%, or edge ≥${LINE_SIGNAL_STRONG_EDGE_PCT}%`;
}

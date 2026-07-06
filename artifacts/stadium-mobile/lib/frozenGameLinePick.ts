// Freeze one final game-line pick per matchup — every UI surface reads the same object.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { GameInjuryReport, MatchupHistoryEntry, RealOddsEntry } from "./api.ts";
import {
  finalizeGameLinePickForGame,
  mergeOddsEntries,
} from "./gameLineOptimizer.ts";
import {
  resolvePickEdgePct,
  resolvePickExpectedValue,
  comparePickStrength,
} from "./parlayQualifiedGate.ts";
import { isGameLinePick, type CoachGameSimEntry } from "./gameSimScoring.ts";
import {
  type FrozenGameLineDisplay,
  frozenGameLineHeader,
  isGameLineFrozen,
  normGameLabel,
  assertFrozenGameLineMetricsComplete,
  canonicalizeFrozenTicket,
} from "./frozenGameLineConsistency.ts";

export type { FrozenGameLineDisplay } from "./frozenGameLineConsistency.ts";
export {
  isGameLineFrozen,
  frozenGameLineHeader,
  buildFrozenGameLineSummaryNote,
  assertFrozenTicketConsistency,
  assertFrozenGameLineMetricsComplete,
  assertAllFrozenGameLineMetrics,
  assertFrozenGameLineSummaryClean,
  composeFrozenGameLineLegNote,
  stripModelGameLineListings,
  mergeTicketPreservingFrozenGameLines,
  parseAllGameLineMentionsFromNote,
  canonicalizeFrozenGameLinePick,
  canonicalizeFrozenTicket,
  validateFrozenTicketForRender,
  FrozenGameLineConsistencyError,
} from "./frozenGameLineConsistency.ts";

export type FrozenGameLineMeta = NonNullable<ParsedPick["gameLineFinal"]> & {
  frozenAt: number;
  display: FrozenGameLineDisplay;
};

/** Snapshot every metric the summary, card, and breakdown must show identically. */
export function snapshotFrozenGameLineDisplay(
  pick: ParsedPick,
  realOdds: RealOddsEntry[],
): FrozenGameLineDisplay {
  const merged = mergeOddsEntries(realOdds, []);
  const edge = resolvePickEdgePct(pick, { realOdds: merged });
  const ev = resolvePickExpectedValue(pick, { realOdds: merged });
  const s = pick.finalAiScore;
  const rubric = pick.scores ?? s?.rubric ?? null;
  const display: FrozenGameLineDisplay = {
    pick: pick.pick,
    market: pick.market,
    odds: pick.odds,
    game: pick.game,
    grade: s?.grade ?? rubric?.grade ?? null,
    confidencePct: s?.confidencePct ?? rubric?.confidencePct ?? null,
    edgePct: edge ?? s?.edgePct ?? rubric?.edgePct ?? null,
    evPct: ev,
    simHit: s?.simHit ?? null,
    simPct: s?.simHit != null && Number.isFinite(s.simHit) ? Math.round(s.simHit * 100) : null,
  };
  const probe: ParsedPick = {
    ...pick,
    gameLineFinal: {
      ...pick.gameLineFinal!,
      display,
    },
  };
  assertFrozenGameLineMetricsComplete(probe, merged);
  return display;
}

/** Lock display fields + alt ladder on a finalized game-line pick. */
export function freezeGameLinePick(
  pick: ParsedPick,
  realOdds: RealOddsEntry[],
  buildAltOptions?: FreezeAllGameLinesOpts["buildAltOptions"],
): ParsedPick {
  if (!pick.gameLineFinal) return pick;
  const merged = mergeOddsEntries(realOdds, []);
  const display = snapshotFrozenGameLineDisplay(pick, merged);
  const altOptions = buildAltOptions?.(
    { game: display.game, market: display.market, pick: display.pick, odds: display.odds },
    merged,
  );
  const frozenAt = Date.now();
  const gameLineFinal: FrozenGameLineMeta = {
    ...pick.gameLineFinal,
    frozenAt,
    display,
  };
  return {
    ...pick,
    game: display.game,
    market: display.market,
    pick: display.pick,
    odds: display.odds,
    altOptions,
    gameLineFrozen: true,
    gameLineFinal,
  };
}

export type FreezeAllGameLinesOpts = {
  evalLinesByGame: Map<string, RealOddsEntry[]>;
  gameSimulations: Map<string, CoachGameSimEntry>;
  realOdds: RealOddsEntry[];
  matchupHistory?: Record<string, MatchupHistoryEntry>;
  matchupInjuries?: Record<string, GameInjuryReport>;
  excludeMoneyline?: boolean;
  longshotAsk?: boolean;
  /** Refreshes Safe/Value ladder chips from the same pool as the frozen Best line. */
  buildAltOptions?: (
    best: { game: string; market: string; pick: string; odds: number },
    pool: RealOddsEntry[],
  ) => ParsedPick["altOptions"] | undefined;
};

/**
 * One finalized + frozen game-line object per matchup. Props pass through unchanged.
 * Finalizes once when not yet frozen; already-frozen legs are never re-selected.
 */
export function freezeAllGameLinesInTicket(
  picks: ParsedPick[],
  opts: FreezeAllGameLinesOpts,
): ParsedPick[] {
  const props = picks.filter((p) => p.isProp || !isGameLinePick(p));
  const templatesByGame = new Map<string, ParsedPick>();

  for (const p of picks) {
    if (!isGameLinePick(p) || p.isProp) continue;
    const key = normGameLabel(p.game);
    const prev = templatesByGame.get(key);
    if (!prev || comparePickStrength(p, prev) > 0) {
      templatesByGame.set(key, p);
    }
  }

  const frozen: ParsedPick[] = [];
  for (const [, template] of templatesByGame) {
    if (isGameLineFrozen(template) && template.gameLineFinal?.display) {
      frozen.push(
        freezeGameLinePick(template, opts.realOdds, opts.buildAltOptions),
      );
      continue;
    }
    const candidate = finalizeGameLinePickForGame(
      template.game,
      template,
      opts.gameSimulations,
      {
        evalLinesByGame: opts.evalLinesByGame,
        realOdds: opts.realOdds,
        matchupHistory: opts.matchupHistory,
        matchupInjuries: opts.matchupInjuries,
        excludeMoneyline: opts.excludeMoneyline,
        longshotAsk: opts.longshotAsk,
      },
    );
    if (!candidate?.gameLineFinal) continue;
    frozen.push(freezeGameLinePick(candidate, opts.realOdds, opts.buildAltOptions));
  }

  frozen.sort((a, b) => comparePickStrength(b, a));
  return canonicalizeFrozenTicket([...props, ...frozen]);
}

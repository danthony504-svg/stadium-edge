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

const normGameLabel = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export type FrozenGameLineDisplay = {
  pick: string;
  market: string;
  odds: number;
  game: string;
  grade: string | null;
  confidencePct: number | null;
  edgePct: number | null;
  evPct: number | null;
  simHit: number | null;
  simPct: number | null;
};

export type FrozenGameLineMeta = NonNullable<ParsedPick["gameLineFinal"]> & {
  frozenAt: number;
  display: FrozenGameLineDisplay;
};

export function isGameLineFrozen(pick: ParsedPick): boolean {
  return (
    !pick.isProp &&
    isGameLinePick(pick) &&
    pick.gameLineFrozen === true &&
    pick.gameLineFinal?.frozenAt != null &&
    pick.gameLineFinal.display != null
  );
}

/** Snapshot every metric the summary, card, and breakdown must show identically. */
export function snapshotFrozenGameLineDisplay(
  pick: ParsedPick,
  realOdds: RealOddsEntry[],
): FrozenGameLineDisplay {
  const edge = resolvePickEdgePct(pick, { realOdds });
  const ev = resolvePickExpectedValue(pick, { realOdds });
  const s = pick.finalAiScore;
  return {
    pick: pick.pick,
    market: pick.market,
    odds: pick.odds,
    game: pick.game,
    grade: s?.grade ?? null,
    confidencePct: s?.confidencePct ?? null,
    edgePct: edge,
    evPct: ev,
    simHit: s?.simHit ?? null,
    simPct: s?.simHit != null && Number.isFinite(s.simHit) ? Math.round(s.simHit * 100) : null,
  };
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
 * Re-selects from the eval ladder when not yet frozen so summary and cards cannot diverge.
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
    let candidate: ParsedPick | null = template;
    if (!isGameLineFrozen(template) || !template.gameLineFinal) {
      candidate = finalizeGameLinePickForGame(template.game, template, opts.gameSimulations, {
        evalLinesByGame: opts.evalLinesByGame,
        realOdds: opts.realOdds,
        matchupHistory: opts.matchupHistory,
        matchupInjuries: opts.matchupInjuries,
        excludeMoneyline: opts.excludeMoneyline,
        longshotAsk: opts.longshotAsk,
      });
    }
    if (!candidate?.gameLineFinal) continue;
    frozen.push(freezeGameLinePick(candidate, opts.realOdds, opts.buildAltOptions));
  }

  frozen.sort((a, b) => comparePickStrength(b, a));
  return [...props, ...frozen];
}

/** Read frozen header fields — falls back to live pick when not frozen. */
export function frozenGameLineHeader(pick: ParsedPick): {
  game: string;
  market: string;
  pick: string;
  odds: number;
} {
  const d = pick.gameLineFinal?.display;
  if (isGameLineFrozen(pick) && d) {
    return { game: d.game, market: d.market, pick: d.pick, odds: d.odds };
  }
  return { game: pick.game, market: pick.market, pick: pick.pick, odds: pick.odds };
}

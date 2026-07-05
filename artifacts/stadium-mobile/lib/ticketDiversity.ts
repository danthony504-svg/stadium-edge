// Keep multi-leg Coach tickets from repeating the same chalk game lines when
// thousands of props and alt rungs are on the board.

import type { ParsedPick } from "../components/PickCard.tsx";
import {
  ALT_BACKFILL_ORDER,
  GENERIC_BACKFILL_ORDER,
  backfillPicks,
  backfillProps,
} from "../components/PickCard.tsx";
import type { GameMeta, PropPoolEntry, RealOddsEntry } from "./api.ts";
import type { PropSelectionOpts } from "./propSelection.ts";
import { gameLineLegBucket, isGameLinePick } from "./gameSimScoring.ts";

const norm = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function countDuplicateTeamLegs(picks: ParsedPick[]): number {
  const seen = new Set<string>();
  let dupes = 0;
  for (const p of picks) {
    if (!isGameLinePick(p) || p.isProp) continue;
    const bucket = gameLineLegBucket(p.game, p.market, p.pick);
    if (seen.has(bucket)) dupes += 1;
    else seen.add(bucket);
  }
  return dupes;
}

/** One game-side leg per team — drops duplicate Braves ML + Braves -1.5 style stacks. */
export function dedupeSameTeamGameLegs(picks: ParsedPick[]): {
  picks: ParsedPick[];
  dropped: number;
} {
  const seen = new Set<string>();
  const out: ParsedPick[] = [];
  let dropped = 0;
  for (const p of picks) {
    if (!isGameLinePick(p) || p.isProp) {
      out.push(p);
      continue;
    }
    const bucket = gameLineLegBucket(p.game, p.market, p.pick);
    if (seen.has(bucket)) {
      dropped += 1;
      continue;
    }
    seen.add(bucket);
    out.push(p);
  }
  return { picks: out, dropped };
}

/** Trim excess game legs so deep parlays leave room for props + alt rungs. */
export function trimGameLegsForPropMix(
  picks: ParsedPick[],
  opts: { legTarget: number; maxGameLegs?: number },
): { picks: ParsedPick[]; trimmed: number } {
  const maxGame =
    opts.maxGameLegs ??
    (opts.legTarget >= 12
      ? Math.max(3, Math.floor(opts.legTarget * 0.25))
      : opts.legTarget >= 6
        ? 3
        : 99);
  const gameIdx: number[] = [];
  const props: ParsedPick[] = [];
  picks.forEach((p, i) => {
    if (p.isProp || !isGameLinePick(p)) props.push(p);
    else gameIdx.push(i);
  });
  if (gameIdx.length <= maxGame) return { picks, trimmed: 0 };
  const keep = new Set(gameIdx.slice(0, maxGame));
  const out: ParsedPick[] = [];
  let trimmed = 0;
  picks.forEach((p, i) => {
    if (!p.isProp && isGameLinePick(p) && !keep.has(i)) {
      trimmed += 1;
      return;
    }
    out.push(p);
  });
  return { picks: out, trimmed };
}

export function propShare(picks: ParsedPick[]): number {
  if (!picks.length) return 0;
  return picks.filter((p) => p.isProp).length / picks.length;
}

/** When the model front-loads ML/spread legs, make room before prop backfill runs. */
export function rebalanceDeepParlayTicket(
  picks: ParsedPick[],
  opts: {
    legTarget: number;
    minPropFraction?: number;
    maxGameLegs?: number;
  },
): { picks: ParsedPick[]; note: string } {
  const minPropFraction = opts.minPropFraction ?? (opts.legTarget >= 12 ? 0.55 : opts.legTarget >= 6 ? 0.4 : 0);
  if (minPropFraction <= 0) return { picks, note: "" };

  const deduped = dedupeSameTeamGameLegs(picks);
  let out = deduped.picks;
  const notes: string[] = [];
  if (deduped.dropped > 0) {
    notes.push(
      `_Dropped ${deduped.dropped} duplicate game-side leg${deduped.dropped === 1 ? "" : "s"} on the same team (one best line per club after the sim)._`,
    );
  }

  const minProps = Math.max(1, Math.floor(opts.legTarget * minPropFraction));
  const currentProps = out.filter((p) => p.isProp).length;
  if (currentProps >= minProps) return { picks: out, note: notes.join("\n") };

  const maxGameLegs =
    opts.maxGameLegs ?? Math.max(2, opts.legTarget - minProps);
  const trimmed = trimGameLegsForPropMix(out, { legTarget: opts.legTarget, maxGameLegs });
  out = trimmed.picks;
  if (trimmed.trimmed > 0) {
    notes.push(
      `_Opened ${trimmed.trimmed} slot${trimmed.trimmed === 1 ? "" : "s"} for player props and alt rungs — deep parlays pull from the full board, not only moneylines._`,
    );
  }

  return { picks: out, note: notes.join("\n\n") };
}

/** Stable shuffle so backfill doesn't always walk the same first games. */
export function rotatePool<T>(items: T[], seed: string): T[] {
  if (items.length <= 1) return items;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const offset = h % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}

/** Strip model chalk so reach-backfill must run for deep parlays (6+ legs). */
export function prepareDeepParlaySeed(
  picks: ParsedPick[],
  legTarget: number,
  opts: { longshotAsk?: boolean } = {},
): { picks: ParsedPick[]; stripped: number } {
  const minPropFraction = opts.longshotAsk ? 0.65 : 0.5;
  const minProps = Math.max(1, Math.ceil(legTarget * minPropFraction));
  const maxGameLegs = Math.max(
    0,
    Math.min(opts.longshotAsk ? 2 : 3, legTarget - minProps),
  );
  const props = picks.filter((p) => p.isProp);
  const gameLegs = dedupeSameTeamGameLegs(
    picks.filter((p) => !p.isProp && isGameLinePick(p)),
  ).picks.slice(0, maxGameLegs);
  const stripped = picks.length - props.length - gameLegs.length;
  return { picks: [...props, ...gameLegs], stripped };
}

/** @deprecated Use prepareDeepParlaySeed — kept for tests. */
export const prepareLongshotParlaySeed = prepareDeepParlaySeed;

export function needsParlayBackfill(
  picks: ParsedPick[],
  legTarget: number,
  opts: { longshotAsk?: boolean; deepParlay?: boolean } = {},
): boolean {
  const deep = opts.deepParlay ?? legTarget >= 6;
  if (legTarget > picks.length) return true;
  if (!deep) return false;
  if (countDuplicateTeamLegs(picks) > 0) return true;
  const minPropShare = opts.longshotAsk ? 0.55 : 0.35;
  if (propShare(picks) < minPropShare) return true;
  const maxGameLegs = opts.longshotAsk
    ? 3
    : Math.max(3, Math.floor(legTarget * 0.35));
  const gameLegs = picks.filter((p) => !p.isProp && isGameLinePick(p)).length;
  if (gameLegs > maxGameLegs) return true;
  return false;
}

/** Model scaffold is all/nearly-all chalk game lines — rebuild from the live board. */
export function isChalkHeavyParlay(picks: ParsedPick[], legTarget: number): boolean {
  if (legTarget < 6 || picks.length === 0) return false;
  if (propShare(picks) < 0.35) return true;
  if (countDuplicateTeamLegs(picks) > 0) return true;
  const gameLegs = picks.filter((p) => !p.isProp && isGameLinePick(p)).length;
  return gameLegs >= legTarget && propShare(picks) === 0;
}

function deepParlayMix(legTarget: number, longshotAsk?: boolean) {
  const minPropFraction = longshotAsk ? 0.65 : 0.5;
  const minProps = Math.max(1, Math.ceil(legTarget * minPropFraction));
  const maxGameLegs = Math.max(1, Math.min(longshotAsk ? 2 : 3, legTarget - minProps));
  return { minProps, maxGameLegs };
}

/**
 * Build a deep parlay from the real board: props first, then capped alt/game rungs.
 * Ignores model chalk scaffolding.
 */
export function assembleDeepParlayFromBoard(
  legTarget: number,
  propPool: PropPoolEntry[],
  realOdds: RealOddsEntry[],
  gameMeta: GameMeta[],
  opts: {
    longshotAsk?: boolean;
    plusMoneyBias?: boolean;
    diversify?: boolean;
    selectionOpts?: PropSelectionOpts;
  } = {},
): ParsedPick[] {
  const { minProps, maxGameLegs } = deepParlayMix(legTarget, opts.longshotAsk);
  const propOpts = {
    plusMoneyBias: opts.plusMoneyBias ?? !!opts.longshotAsk,
    diversify: opts.diversify ?? true,
    selectionOpts: opts.selectionOpts,
  };
  const gameOrder = opts.longshotAsk
    ? [...ALT_BACKFILL_ORDER, /^Team Total$/i, ...GENERIC_BACKFILL_ORDER]
    : [...ALT_BACKFILL_ORDER, ...GENERIC_BACKFILL_ORDER];

  let picks: ParsedPick[] = [];
  picks = backfillProps(picks, propPool, realOdds, gameMeta, {
    target: minProps,
    ...propOpts,
  });
  const gameCap = Math.min(legTarget, picks.length + maxGameLegs);
  picks = backfillPicks(picks, realOdds, gameMeta, { target: gameCap, order: gameOrder });
  if (picks.length < legTarget) {
    picks = backfillProps(picks, propPool, realOdds, gameMeta, {
      target: legTarget,
      ...propOpts,
    });
  }
  return dedupeSameTeamGameLegs(picks).picks;
}

export type { PropPoolEntry };

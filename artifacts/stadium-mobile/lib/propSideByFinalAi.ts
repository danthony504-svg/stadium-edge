// Pick Over vs Under by highest Final AI Score — shared by Coach backfill and context.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { PropPoolEntry } from "./api.ts";
import { attachPickScores, type PropSimAttachOpts } from "./pickScoreContext.ts";

export type PropSidePickOpts = PropSimAttachOpts & {
  propSimulations?: Map<string, { hitProbability: number | null }>;
};

const normPropKey = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .trim();

function parsedPickFromPoolEntry(e: PropPoolEntry): ParsedPick {
  const pick =
    e.line != null
      ? `${e.player} ${e.side} ${e.line} ${e.marketLabel}`
      : `${e.player} ${e.marketLabel}`;
  return {
    game: e.game,
    market: e.marketLabel,
    pick,
    odds: e.odds,
    sport: e.sport,
    isProp: true,
    startsAt: e.startsAt,
    headshot: e.headshot,
    teamAbbr: e.teamAbbr,
    player: e.player,
    athleteId: e.athleteId,
    propMarketKey: e.marketKey,
    propLine: e.line,
    propSide: e.side,
  };
}

/** Final AI composite for one posted prop row (null when ungradeable). */
export function finalAiCompositeForEntry(
  entry: PropPoolEntry,
  propPool: PropPoolEntry[],
  opts: PropSidePickOpts,
): number | null {
  const scored = attachPickScores([parsedPickFromPoolEntry(entry)], {
    ...opts,
    propPool,
  })[0];
  return scored?.finalAiScore?.composite ?? scored?.scores?.composite ?? null;
}

/**
 * Among Over/Under rows on the same player+market+line, keep the side with the
 * highest Final AI Score. Stable tie-break: Over when composites match.
 */
export function pickBestSideEntry(
  entries: PropPoolEntry[],
  opts: PropSidePickOpts,
): PropPoolEntry {
  if (entries.length <= 1) return entries[0]!;
  const pool = opts.propPool.length ? opts.propPool : entries;
  const scoredOpts = { ...opts, propPool: pool };
  let best = entries[0]!;
  let bestScore = -Infinity;
  for (const e of entries) {
    const composite = finalAiCompositeForEntry(e, pool, scoredOpts);
    const score =
      composite ??
      (e.edge != null ? e.edge : e.side === "Over" ? 0 : -0.01);
    if (
      score > bestScore ||
      (score === bestScore && e.side === "Over" && best.side === "Under")
    ) {
      best = e;
      bestScore = score;
    }
  }
  return best;
}

/**
 * One row per (game, player, market, line): the Over/Under side with the
 * highest Final AI Score. Never picks by which price is closest to even money.
 */
export function collapsePropPoolByFinalAiSide(
  entries: PropPoolEntry[],
  opts: PropSidePickOpts,
): PropPoolEntry[] {
  const groups = new Map<string, PropPoolEntry[]>();
  for (const e of entries) {
    const lineKey = e.line == null ? "yn" : String(e.line);
    const key = `${normPropKey(e.game)}|${normPropKey(e.player)}|${normPropKey(e.marketLabel)}|${lineKey}`;
    const arr = groups.get(key) ?? [];
    arr.push(e);
    groups.set(key, arr);
  }
  const pool = opts.propPool.length ? opts.propPool : entries;
  const scoredOpts = { ...opts, propPool: pool };
  return [...groups.values()].map((group) => pickBestSideEntry(group, scoredOpts));
}

// Keep multi-leg Coach tickets from repeating the same chalk game lines when
// thousands of props and alt rungs are on the board.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { PropPoolEntry } from "./api.ts";
import { isGameLinePick } from "./gameSimScoring.ts";

const norm = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function pickTeamName(pick: string): string | null {
  const p = String(pick ?? "");
  if (/\b(over|under)\b/i.test(p)) return null;
  return (
    p
      .replace(/\s*(ml|moneyline)\s*$/i, "")
      .replace(/\s*[+-]?\d+(?:\.\d+)?\s*$/, "")
      .trim() || null
  );
}

function legKey(p: ParsedPick): string {
  return `${p.game}|${p.market}|${p.pick}`.toLowerCase();
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
    if (!isGameLinePick(p) || p.isProp || /\b(over|under)\b/i.test(p.pick)) {
      out.push(p);
      continue;
    }
    const team = pickTeamName(p.pick);
    const bucket = team ? `${norm(p.game)}|${norm(team)}` : `${norm(p.game)}|side`;
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
    (opts.legTarget >= 12 ? Math.max(3, Math.floor(opts.legTarget * 0.25)) : opts.legTarget >= 6 ? 5 : 99);
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

export function existingLegKeys(picks: ParsedPick[]): Set<string> {
  return new Set(picks.map(legKey));
}

export type { PropPoolEntry };

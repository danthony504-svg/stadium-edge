// One committed Over/Under (or Yes/No) side per player prop — prevents Colin Rea
// Over 3.5 K and Colin Rea Under 3.5 K on the same ticket or back-to-back asks.

import type { ParsedPick } from "./parsedPick.ts";
import { canonicalGameKey } from "./gameSimScoring.ts";
import { parsePropLeg } from "./propLegParse.ts";
import type { TrackedPick } from "./pickTracker.ts";

const norm = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function normPlayer(name: string): string {
  const parts = norm(name).split(" ").filter(Boolean);
  return parts.length ? parts[parts.length - 1]! : norm(name);
}

export type PropCommitSide = "over" | "under" | "yes" | "no";

export function propCommitSide(p: {
  market: string;
  pick: string;
  propSide?: string | null;
}): PropCommitSide | null {
  const fromField = String(p.propSide ?? "")
    .trim()
    .toLowerCase();
  if (fromField === "over" || fromField === "under") return fromField;
  if (fromField === "yes" || fromField === "no") return fromField;

  const parsed = parsePropLeg({ market: p.market, pick: p.pick });
  if (!parsed) return null;
  const side = parsed.side.toLowerCase();
  if (side === "over" || side === "under") return side;
  if (side === "yes") return "yes";
  if (side === "no") return "no";
  return null;
}

function oppositePropSide(a: PropCommitSide, b: PropCommitSide): boolean {
  return (
    (a === "over" && b === "under") ||
    (a === "under" && b === "over") ||
    (a === "yes" && b === "no") ||
    (a === "no" && b === "yes")
  );
}

/** Stable identity for a player prop leg (game + player + market + line). */
export function propIdentityKey(p: {
  game: string;
  market: string;
  pick: string;
  isProp?: boolean;
  player?: string | null;
  propLine?: number | null;
}): string | null {
  if (p.isProp === false) return null;
  const parsed = parsePropLeg({ market: p.market, pick: p.pick });
  const player = p.player?.trim() || parsed?.player || null;
  if (!player) return null;
  const line =
    p.propLine != null && Number.isFinite(p.propLine)
      ? p.propLine
      : parsed?.line != null
        ? parsed.line
        : "yn";
  return `${canonicalGameKey(p.game)}|${normPlayer(player)}|${norm(p.market)}|${line}`;
}

function pickRank(p: ParsedPick): number {
  return p.finalAiScore?.composite ?? p.scores?.composite ?? 0;
}

export type PropSideConsistencyResult = {
  picks: ParsedPick[];
  dropped: number;
  note: string;
};

/**
 * For each player prop, allow only one committed side (Over OR Under on the same
 * line). When both appear, keep the higher-scored leg.
 */
export function enforceConsistentPropSides(picks: ParsedPick[]): PropSideConsistencyResult {
  const bestByIdentity = new Map<string, { idx: number; side: PropCommitSide }>();
  const dropIdx = new Set<number>();
  let dropped = 0;

  for (let i = 0; i < picks.length; i++) {
    const p = picks[i]!;
    if (!p.isProp) continue;
    const id = propIdentityKey(p);
    const side = propCommitSide(p);
    if (!id || !side) continue;

    const prev = bestByIdentity.get(id);
    if (!prev) {
      bestByIdentity.set(id, { idx: i, side });
      continue;
    }
    if (!oppositePropSide(prev.side, side)) continue;

    dropped += 1;
    if (pickRank(p) > pickRank(picks[prev.idx]!)) {
      dropIdx.add(prev.idx);
      bestByIdentity.set(id, { idx: i, side });
    } else {
      dropIdx.add(i);
    }
  }

  if (!dropped) return { picks, dropped: 0, note: "" };

  const kept = picks.filter((_, i) => !dropIdx.has(i));
  return {
    picks: kept,
    dropped,
    note: `_Dropped ${dropped} prop leg${dropped === 1 ? "" : "s"} that flipped Over/Under on the same player line — one side per prop._`,
  };
}

function trackedToPropPick(t: TrackedPick): ParsedPick {
  return {
    game: t.game,
    market: t.market,
    pick: t.pick,
    odds: t.odds,
    sport: t.sport,
    isProp: t.isProp,
    player: t.player ?? undefined,
    propLine: t.line,
    propSide: t.side,
    startsAt: t.startsAt,
    propMarketKey: t.propMarketKey,
  };
}

/** Drop new props that contradict a pending Coach recommendation on the same line. */
export function dropPropsOpposingTrackedPicks(
  picks: ParsedPick[],
  tracked: TrackedPick[],
  now = Date.now(),
): PropSideConsistencyResult {
  const pending = tracked.filter((t) => {
    if (t.status !== "pending" || t.source !== "coach" || !t.isProp) return false;
    if (t.startsAt) {
      const kick = Date.parse(t.startsAt);
      if (Number.isFinite(kick) && kick < now - 5 * 60_000) return false;
    }
    return now - t.capturedAt < 24 * 60 * 60_000;
  });
  if (!pending.length) return { picks, dropped: 0, note: "" };

  const committed = new Map<string, PropCommitSide>();
  for (const t of pending) {
    const pseudo = trackedToPropPick(t);
    const id = propIdentityKey(pseudo);
    const side = propCommitSide(pseudo);
    if (!id || !side) continue;
    committed.set(id, side);
  }
  if (!committed.size) return { picks, dropped: 0, note: "" };

  const kept: ParsedPick[] = [];
  let dropped = 0;
  for (const p of picks) {
    if (!p.isProp) {
      kept.push(p);
      continue;
    }
    const id = propIdentityKey(p);
    const side = propCommitSide(p);
    const prev = id ? committed.get(id) : null;
    if (prev && side && oppositePropSide(prev, side)) {
      dropped += 1;
      continue;
    }
    kept.push(p);
  }

  if (!dropped) return { picks, dropped: 0, note: "" };
  return {
    picks: kept,
    dropped,
    note: `_Skipped ${dropped} prop leg${dropped === 1 ? "" : "s"} that contradicted a recent Coach pick on the same player line._`,
  };
}

/**
 * Cross-ask pick usage signatures — market shape without player/team/game.
 * Detects repetitive alt patterns reused across different sports/players/teams
 * (O(1) Map lookups — no Coach scan latency).
 */

import { marketFamily } from "./altLinePool.ts";
import { parsePickLineNumber } from "./pickLineParse.ts";

const norm = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Over / under / plus / minus / ml — strips team and player names. */
export function pickSideShape(
  pick: string,
  propSide?: string | null,
): "over" | "under" | "plus" | "minus" | "ml" {
  if (propSide) {
    const s = norm(propSide);
    if (s === "over") return "over";
    if (s === "under") return "under";
  }
  const p = norm(pick);
  if (/\bover\b/.test(p)) return "over";
  if (/\bunder\b/.test(p)) return "under";
  const line = parsePickLineNumber(pick);
  if (line == null) return "ml";
  if (line > 0) return "plus";
  if (line < 0) return "minus";
  return "ml";
}

/**
 * Coarse line buckets so near-identical alts (+0.5 / +1.5 dog run lines)
 * share pressure without treating every rung as unique.
 */
export function pickLineBucket(line: number | null): string {
  if (line == null) return "x";
  const abs = Math.abs(line);
  if (abs <= 1.5) return String(Math.round(line * 2) / 2);
  if (abs <= 3.5) return line > 0 ? "2-3.5" : "-2--3.5";
  if (abs <= 7.5) return line > 0 ? "4-7.5" : "-4--7.5";
  if (abs <= 14.5) return line > 0 ? "8-14.5" : "-8--14.5";
  return line > 0 ? "15+" : "-15-";
}

/**
 * Line number for signatures — trailing parse first, then Over/Under N.N mid-string
 * (props like "Doyle Over 0.5 Hits+Runs+RBIs").
 */
export function signatureLineNumber(pick: string): number | null {
  const trailing = parsePickLineNumber(pick);
  if (trailing != null) return trailing;
  const m = String(pick ?? "").match(
    /\b(?:over|under)\s+([+-]?\d+(?:\.\d+)?)\b/i,
  );
  if (!m) return null;
  const v = parseFloat(m[1]!);
  return Number.isFinite(v) ? v : null;
}

/**
 * Stable usage key: same market family + side shape + line bucket.
 * Yankees +0.5 F5 run line and Padres +0.5 F5 run line → same signature.
 * Doyle Over 0.5 H+R+RBI and Judge Over 0.5 H+R+RBI → same signature.
 */
export function pickUsageSignature(pick: {
  market: string;
  pick: string;
  isProp?: boolean;
  player?: string | null;
  propSide?: string | null;
}): string {
  const side = pickSideShape(pick.pick, pick.propSide);
  const bucket = pickLineBucket(signatureLineNumber(pick.pick));
  if (pick.isProp || pick.player) {
    return `prop|${norm(pick.market)}|${side}|${bucket}`;
  }
  return `game|${marketFamily(pick.market)}|${side}|${bucket}`;
}

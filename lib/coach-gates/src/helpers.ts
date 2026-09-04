import type { CoachGateId, CoachGateReasonCode, CoachGateResult } from "@workspace/coach-types";

export function passGate(
  gateId: CoachGateId,
  message: string,
  metadata?: Record<string, unknown>,
): CoachGateResult {
  return { gateId, pass: true, reasonCode: "passed", message, metadata };
}

export function failGate(
  gateId: CoachGateId,
  reasonCode: CoachGateReasonCode,
  message: string,
  metadata?: Record<string, unknown>,
): CoachGateResult {
  return { gateId, pass: false, reasonCode, message, metadata };
}

const GENERIC = new Set([
  "fc", "sc", "the", "of", "and", "los", "san", "new", "city", "club", "cf",
  "afc", "ac", "real",
]);

function tokens(s: string | null | undefined): string[] {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !GENERIC.has(t));
}

/** Whether a game pick names Over/Under (no team side). */
export function isTotalPick(pick: string): boolean {
  return /\b(over|under)\b/i.test(pick);
}

/** Extract team name from a moneyline/spread pick string. */
export function gamePickTeam(pick: string): string | null {
  if (isTotalPick(pick)) return null;
  const team = pick
    .replace(/\s*(ml|moneyline)\s*$/i, "")
    .replace(/\s*[+-]?\d+(?:\.\d+)?\s*$/, "")
    .trim();
  return team || null;
}

/**
 * Matchup alignment from mlLean and the team the pick is on.
 * +1 on lean side, -1 against, 0 coin-flip, null when no lean or no team.
 */
export function matchupAlignment(
  mlLean: { side?: string | null; edge?: number | null } | null | undefined,
  pickTeam: string | null | undefined,
): { aligned: 1 | 0 | -1 | null; leanEdge: number } {
  if (!mlLean?.side || !pickTeam) return { aligned: null, leanEdge: 0 };
  const edge = Number.isFinite(mlLean.edge as number) ? (mlLean.edge as number) : 0;
  const lean = String(mlLean.side).toLowerCase();
  const pick = String(pickTeam).toLowerCase();
  const onSide = lean.includes(pick) || pick.includes(lean);
  if (edge <= 0) return { aligned: 0, leanEdge: 0 };
  return { aligned: onSide ? 1 : -1, leanEdge: edge };
}

/** Loose team token overlap for prop player-team resolution. */
export function teamsLooseMatch(a: string, b: string): boolean {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return false;
  if (ta.some((t) => tb.includes(t)) || tb.some((t) => ta.includes(t))) return true;
  return ta[ta.length - 1] === tb[tb.length - 1];
}

/**
 * Team Total Points matchup lean from real offense vs opponent points-allowed.
 * Pure module — safe for node --test (no React / PickCard imports).
 */
import type { MatchupHistoryEntry } from "./api.ts";

/**
 * Selected team's scoring offense vs opponent points allowed (L10 / venue when
 * present). Never fabricates — null when real ptsFor / ptsAgainst are missing.
 */
export function teamTotalOffenseDefenseLean(
  entry: MatchupHistoryEntry,
  pickSide: "home" | "away",
  pickText: string,
  away: string,
  home: string,
): { side: string; edge: number } | null {
  const over = /\bover\b/i.test(pickText);
  const under = /\bunder\b/i.test(pickText);
  if (!over && !under) return null;
  const lineMatch = String(pickText).match(/([+-]?\d+(?:\.\d+)?)\s*$/);
  const line = lineMatch ? Number(lineMatch[1]) : NaN;
  if (!Number.isFinite(line)) return null;

  const pts = (side: unknown): { for: number | null; against: number | null } => {
    const s = side as {
      ptsFor?: number | null;
      ptsAgainst?: number | null;
      last10?: { ptsFor?: number | null; ptsAgainst?: number | null };
    } | null;
    if (!s) return { for: null, against: null };
    return {
      for: s.ptsFor ?? s.last10?.ptsFor ?? null,
      against: s.ptsAgainst ?? s.last10?.ptsAgainst ?? null,
    };
  };
  const venuePts = (side: unknown): { for: number | null; against: number | null } => {
    const s = side as { ptsFor?: number | null; ptsAgainst?: number | null } | null;
    if (!s) return { for: null, against: null };
    return { for: s.ptsFor ?? null, against: s.ptsAgainst ?? null };
  };

  const own = pts(pickSide === "home" ? entry.home : entry.away);
  const opp = pts(pickSide === "home" ? entry.away : entry.home);
  const ownVenue = venuePts(pickSide === "home" ? entry.homeVenueForm : entry.awayVenueForm);
  const oppVenue = venuePts(pickSide === "home" ? entry.awayVenueForm : entry.homeVenueForm);

  const ptsFor = own.for ?? ownVenue.for;
  const ptsAgainst = opp.against ?? oppVenue.against;
  if (ptsFor == null || ptsAgainst == null) return null;
  if (!Number.isFinite(ptsFor) || !Number.isFinite(ptsAgainst)) return null;

  // Blend own scoring rate with opponent points allowed (same spirit as drive sim).
  const expected = (ptsFor + ptsAgainst) / 2;
  const delta = expected - line;
  // Need ~1.5 pts of separation before calling a lean (noise floor).
  if (Math.abs(delta) < 1.5) return null;
  const favorsOver = delta > 0;
  const teamName = pickSide === "home" ? home : away;
  if ((over && favorsOver) || (under && !favorsOver)) {
    return { side: teamName, edge: Math.min(8, Math.abs(delta)) };
  }
  const otherTeam = pickSide === "home" ? away : home;
  return { side: otherTeam, edge: Math.min(8, Math.abs(delta)) };
}

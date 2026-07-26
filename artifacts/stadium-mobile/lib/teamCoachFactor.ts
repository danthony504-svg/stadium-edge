import type { ParsedPick } from "../components/PickCard.tsx";
import type { MatchupHistoryEntry } from "./api.ts";

export type TeamCoachFactor = {
  score: number | null;
  display?: string;
};

const norm = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

const teamFromPick = (pick: ParsedPick) =>
  pick.pick
    .replace(/\s*(ml|moneyline)\s*$/i, "")
    .replace(/\s*[+-]?\d+(?:\.\d+)?\s*$/, "")
    .trim();

/**
 * Grounded Team Coach signal from the established matchup-history feed. It is
 * deliberately fail-closed: unavailable team context contributes no score.
 */
export function buildTeamCoachFactor(
  pick: ParsedPick,
  matchup: MatchupHistoryEntry | null | undefined,
  playerTeam?: string | null,
): TeamCoachFactor {
  const lean = matchup?.mlLean;
  if (!lean?.side || !Number.isFinite(lean.edge)) return { score: null };
  const team = playerTeam ?? (pick.isProp ? null : teamFromPick(pick));
  if (!team) return { score: null };
  const aligned = norm(team).includes(norm(lean.side)) || norm(lean.side).includes(norm(team));
  const strength = Math.min(2.5, Math.abs(lean.edge) / 5);
  const score = Math.max(2, Math.min(9.5, 5.5 + (aligned ? strength : -strength)));
  const drivers = lean.reasons?.slice(0, 3).join(" · ");
  return {
    score: Math.round(score * 10) / 10,
    display: drivers ? `${aligned ? "Aided" : "Opposed"} · ${drivers}` : aligned ? "Team edge aligned" : "Team edge opposed",
  };
}

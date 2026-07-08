// Shared helpers for deciding when a saved pick's game is finished enough to grade.
// Mirrors slip.tsx so coach-tracked picks grade on the same honest rules.

import type { EspnGame } from "./api.ts";

export const GAME_OVER_BUFFER_MS = 6 * 3600_000;
export const FORCE_ARCHIVE_MS = 40 * 3600_000;
export const STALE_PICK_MS = 24 * 3600_000;

const teamNick = (s: string) =>
  (s || "").trim().split(/\s+/).filter(Boolean).pop()?.toLowerCase() || "";

function gameTeamNicks(label: string): [string, string] | null {
  const parts = (label || "").split(/\s+@\s+|\s+vs\.?\s+|\s+at\s+/i);
  if (parts.length !== 2) return null;
  return [teamNick(parts[0]), teamNick(parts[1])];
}

export function legGameMatch(
  games: EspnGame[],
  label: string,
  sport?: string,
): EspnGame | null {
  const teams = gameTeamNicks(label);
  if (!teams) return null;
  const [a, b] = teams;
  if (!a || !b || a === b) return null;
  const candidates = games.filter((g) => {
    if (sport && g.sport && g.sport !== sport) return false;
    const ga = teamNick(g.awayTeam || "");
    const gh = teamNick(g.homeTeam || "");
    return (ga === a && gh === b) || (ga === b && gh === a);
  });
  return candidates.length === 1 ? candidates[0] : null;
}

export function legGameStatus(games: EspnGame[]) {
  return (
    label: string,
    sport?: string,
    capturedAt?: number,
  ): "over" | "live" | "unknown" => {
    const match = legGameMatch(games, label, sport);
    if (!match) {
      if (capturedAt !== undefined && Date.now() - capturedAt > STALE_PICK_MS) return "over";
      return "unknown";
    }
    const finished = match.state === "post" || /final/i.test(match.status || "");
    if (finished) return "over";
    const t = Date.parse(match.startsAt);
    if (Number.isFinite(t) && Date.now() > t + GAME_OVER_BUFFER_MS) return "over";
    return "live";
  };
}

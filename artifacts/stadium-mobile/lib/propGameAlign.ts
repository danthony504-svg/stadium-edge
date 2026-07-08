// Correct prop card game labels against the authoritative prop pool.

import type { ParsedPick } from "../components/PickCard.tsx";

type PropPoolRow = {
  game: string;
  marketLabel: string;
  player: string;
  line: number | null;
  side: "Over" | "Under";
  marketKey?: string;
  teamAbbr?: string | null;
  startsAt?: string | null;
  headshot?: string | null;
  athleteId?: string | null;
};

const norm = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function teamsMatch(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  const nick = (s: string) => {
    const t = norm(s).split(" ").filter(Boolean);
    return t[t.length - 1] ?? "";
  };
  const na = nick(a);
  const nb = nick(b);
  if (na.length > 2 && na === nb) return true;
  const ta = new Set(x.split(" ").filter((w) => w.length > 2));
  return y
    .split(" ")
    .filter((w) => w.length > 2)
    .some((w) => ta.has(w));
}

function gameLabelsMatch(a: string, b: string): boolean {
  const pa = String(a ?? "").split(" @ ");
  const pb = String(b ?? "").split(" @ ");
  if (pa.length !== 2 || pb.length !== 2) {
    return norm(a) === norm(b);
  }
  return teamsMatch(pa[0]!, pb[0]!) && teamsMatch(pa[1]!, pb[1]!);
}

function teamAbbrInGame(abbr: string | null | undefined, game: string): boolean {
  if (!abbr) return true;
  const parts = String(game ?? "").split(/\s+@\s+/);
  if (parts.length !== 2) return true;
  const a = abbr.toUpperCase();
  const away = parts[0]!.toUpperCase();
  const home = parts[1]!.toUpperCase();
  return away.includes(a) || home.includes(a);
}

/** Fix prop cards whose game label doesn't match the player's real posted game. */
export function alignPropPickGames(
  picks: ParsedPick[],
  propPool: PropPoolRow[],
): ParsedPick[] {
  return picks.map((p) => {
    if (!p.isProp || !p.player) return p;
    const side =
      p.propSide ??
      (/\bover\b/i.test(p.pick) ? "Over" : /\bunder\b/i.test(p.pick) ? "Under" : null);
    const marketKey = p.propMarketKey ?? p.market;
    const matches = propPool.filter(
      (e) =>
        e.player === p.player &&
        (e.marketKey === marketKey || norm(e.marketLabel) === norm(p.market)) &&
        (p.propLine == null || e.line === p.propLine) &&
        (!side || e.side === side),
    );
    if (!matches.length) return p;
    const aligned =
      matches.find((e) => gameLabelsMatch(e.game, p.game)) ??
      matches.find((e) => teamAbbrInGame(e.teamAbbr, e.game)) ??
      matches[0]!;
    if (gameLabelsMatch(aligned.game, p.game) && teamAbbrInGame(p.teamAbbr, p.game)) {
      return p;
    }
    return {
      ...p,
      game: aligned.game,
      startsAt: aligned.startsAt ?? p.startsAt ?? null,
      teamAbbr: aligned.teamAbbr ?? p.teamAbbr ?? null,
      headshot: aligned.headshot ?? p.headshot ?? null,
      athleteId: aligned.athleteId ?? p.athleteId ?? null,
    };
  });
}

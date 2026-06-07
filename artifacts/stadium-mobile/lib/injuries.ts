import type { InjuryEntry, InjuryTeam } from "./api";

// Normalize a free-text name for matching: lowercase, strip accents, drop
// generational suffixes and punctuation, collapse whitespace. Used to line up
// the odds feed's player/team strings with ESPN's injury report names.
const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const words = (s: string): string[] => norm(s).split(" ").filter(Boolean);

// Word-boundary subset match between two team names. True when every word of
// the shorter name appears as a WHOLE word in the longer one — so "Lakers"
// matches "Los Angeles Lakers" but "ny" never matches inside "brooklyn", and
// "Los Angeles Clippers" never matches "Los Angeles Lakers". Avoids the
// over-matching a raw substring check would cause.
export function teamNameMatches(a: string, b: string): boolean {
  const aw = words(a);
  const bw = words(b);
  if (aw.length === 0 || bw.length === 0) return false;
  const [short, long] = aw.length <= bw.length ? [aw, bw] : [bw, aw];
  const longSet = new Set(long);
  return short.every((w) => longSet.has(w));
}

// Result of a single-player injury lookup. We distinguish "ambiguous" (more
// than one player in the league shares this name) from "none" so the UI never
// claims a player is healthy when we simply couldn't be sure which one it is.
export type InjuryLookup =
  | { status: "found"; entry: InjuryEntry }
  | { status: "none" }
  | { status: "ambiguous" };

// Find one player's REAL injury designation in the league-wide report. Exact
// normalized-name match only — never a fuzzy/substring guess. Fail-closed: a
// match is only accepted when EXACTLY ONE player in the league carries that
// name; duplicate names return "ambiguous" so we don't attach a real status to
// the wrong person.
export function findPlayerInjury(
  teams: InjuryTeam[] | undefined,
  player: string,
): InjuryLookup {
  if (!teams || !player) return { status: "none" };
  const target = norm(player);
  if (!target) return { status: "none" };
  const matches: InjuryEntry[] = [];
  for (const t of teams) {
    for (const e of t.entries) {
      if (norm(e.player) === target) matches.push(e);
    }
  }
  if (matches.length === 0) return { status: "none" };
  if (matches.length > 1) return { status: "ambiguous" };
  return { status: "found", entry: matches[0] };
}

// The injury groups for BOTH sides of a matchup. Matches each ESPN team by a
// word-boundary name match (or exact abbreviation) against the two free-text
// names from the odds feed — no loose substring matching that could pull in a
// third, unrelated team.
export function injuriesForMatchup(
  teams: InjuryTeam[] | undefined,
  names: string[],
): InjuryTeam[] {
  if (!teams) return [];
  const wanted = names.filter((n) => norm(n).length > 0);
  if (wanted.length === 0) return [];
  return teams.filter((t) => {
    const ta = norm(t.teamAbbr);
    return wanted.some(
      (n) => teamNameMatches(t.team, n) || (ta.length > 0 && ta === norm(n)),
    );
  });
}

// Severity bucket for an ESPN status string → drives the badge colour. Default
// is "doubt" (amber) for anything on the report we don't recognise as either
// fully out or fully cleared.
export type InjuryTone = "out" | "doubt" | "ok";
export function injuryTone(status: string): InjuryTone {
  const s = status.toLowerCase();
  if (/probable|active|available/.test(s)) return "ok";
  if (
    /\bout\b|injured reserve|\bir\b|\bil\b|suspend|inactive|doubtful|10-day|15-day|60-day|season/.test(
      s,
    )
  )
    return "out";
  return "doubt";
}

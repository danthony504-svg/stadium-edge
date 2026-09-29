/**
 * Resolve which side of Away @ Home a prop player is on (and the opponent).
 * Prefer explicit team identity (abbr / full name); fall back to game-log
 * opponents. Never guess — ambiguous cases return undefined sides.
 */

import { teamNameMatches } from "./injuries.ts";

function normAbbr(s: string | null | undefined): string {
  return String(s ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** Common ESPN MLB abbreviations → nickname tokens for soft matching. */
const MLB_ABBR_NICKS: Record<string, string[]> = {
  ARI: ["diamondbacks", "dbacks"],
  ATL: ["braves"],
  BAL: ["orioles"],
  BOS: ["redsox", "sox"],
  CHC: ["cubs"],
  CHW: ["whitesox", "sox"],
  CWS: ["whitesox", "sox"],
  CIN: ["reds"],
  CLE: ["guardians", "indians"],
  COL: ["rockies"],
  DET: ["tigers"],
  HOU: ["astros"],
  KC: ["royals"],
  LAA: ["angels"],
  LAD: ["dodgers"],
  MIA: ["marlins"],
  MIL: ["brewers"],
  MIN: ["twins"],
  NYM: ["mets"],
  NYY: ["yankees"],
  OAK: ["athletics", "as"],
  ATH: ["athletics", "as"],
  PHI: ["phillies"],
  PIT: ["pirates"],
  SD: ["padres"],
  SEA: ["mariners"],
  SF: ["giants"],
  STL: ["cardinals"],
  TB: ["rays"],
  TEX: ["rangers"],
  TOR: ["bluejays", "jays"],
  WSH: ["nationals", "nats"],
  WAS: ["nationals", "nats"],
};

function teamWords(name: string): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function abbrMatchesTeam(abbr: string, teamName: string): boolean {
  const a = normAbbr(abbr);
  if (!a || !teamName) return false;
  const compact = teamWords(teamName);
  if (compact.includes(a.toLowerCase())) return true;
  // "CHI" alone is ambiguous (Cubs vs White Sox) — require CHW/CWS/CHC.
  if (a === "CHI") return false;
  const nicks = MLB_ABBR_NICKS[a];
  if (!nicks?.length) return false;
  // Prefer the longest nick so "whitesox" wins over "sox" when both teams
  // could match a short token (Red Sox vs White Sox).
  const ranked = [...nicks].sort((x, y) => y.length - x.length);
  for (const nick of ranked) {
    if (nick.length >= 5 && compact.includes(nick)) return true;
  }
  // Short nicks ("sox", "as") only count when exactly one side could claim them —
  // callers must disambiguate across away/home.
  return ranked.some((nick) => compact.includes(nick));
}

export type PropSideResolve = {
  teamName: string | undefined;
  oppName: string | undefined;
};

/**
 * Resolve player's team vs opponent for a prop on an Away @ Home slate.
 */
export function resolvePropPlayerSides(opts: {
  awayName: string;
  homeName: string;
  /** Props-feed team abbreviation (e.g. CHW, HOU). */
  teamAbbr?: string | null;
  /** Full team name from ESPN player search / roster. */
  playerTeam?: string | null;
  /** Recent game-log opponent display names. */
  recentOpponents?: Array<string | null | undefined>;
}): PropSideResolve {
  const away = String(opts.awayName ?? "").trim();
  const home = String(opts.homeName ?? "").trim();
  if (!away || !home) return { teamName: undefined, oppName: undefined };

  const fromTeam = (playerSide: string): PropSideResolve => {
    if (teamNameMatches(playerSide, away) && !teamNameMatches(playerSide, home)) {
      return { teamName: away, oppName: home };
    }
    if (teamNameMatches(playerSide, home) && !teamNameMatches(playerSide, away)) {
      return { teamName: home, oppName: away };
    }
    return { teamName: undefined, oppName: undefined };
  };

  // 1) Explicit full team name (search / roster) — strongest.
  const pt = String(opts.playerTeam ?? "").trim();
  if (pt) {
    const hit = fromTeam(pt);
    if (hit.teamName) return hit;
  }

  // 2) Props-feed abbreviation.
  const ab = String(opts.teamAbbr ?? "").trim();
  if (ab) {
    const awayHit = abbrMatchesTeam(ab, away);
    const homeHit = abbrMatchesTeam(ab, home);
    if (awayHit && !homeHit) return { teamName: away, oppName: home };
    if (homeHit && !awayHit) return { teamName: home, oppName: away };
    // Ambiguous short nick (sox) — try longer White Sox / Red Sox disambiguation
    // via the abbr itself.
    const a = normAbbr(ab);
    if (a === "CHW" || a === "CWS") {
      const awayWs = teamWords(away).includes("white");
      const homeWs = teamWords(home).includes("white");
      if (awayWs && !homeWs) return { teamName: away, oppName: home };
      if (homeWs && !awayWs) return { teamName: home, oppName: away };
    }
    if (a === "BOS") {
      const awayRs = teamWords(away).includes("red") && teamWords(away).includes("sox");
      const homeRs = teamWords(home).includes("red") && teamWords(home).includes("sox");
      if (awayRs && !homeRs) return { teamName: away, oppName: home };
      if (homeRs && !awayRs) return { teamName: home, oppName: away };
    }
  }

  // 3) Game-log opponents: the side that never appears as opp is ours.
  const opps = (opts.recentOpponents ?? [])
    .map((o) => String(o ?? "").trim())
    .filter(Boolean);
  if (opps.length > 0) {
    const seen = (n: string) => opps.some((o) => teamNameMatches(o, n));
    const awayIsOpp = seen(away);
    const homeIsOpp = seen(home);
    if (awayIsOpp && !homeIsOpp) return { teamName: home, oppName: away };
    if (homeIsOpp && !awayIsOpp) return { teamName: away, oppName: home };
  }

  return { teamName: undefined, oppName: undefined };
}

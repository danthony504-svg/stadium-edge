/**
 * Current-roster grounding for Coach Q&A.
 *
 * Live ESPN player-search (same provider the prop identity path uses) overrides
 * the LLM's pretrained roster knowledge. Never invents assignments — only
 * reports what the provider returns for the requested/current season.
 */

import { cachedJson } from "./sports.js";

const LEAGUE_TO_SPORT: Record<string, string> = {
  nba: "nba",
  wnba: "wnba",
  mlb: "mlb",
  nfl: "nfl",
  "college-football": "ncaaf",
  "mens-college-basketball": "ncaab",
  nhl: "nhl",
};

const SPORT_HINT: Array<{ re: RegExp; sport: string }> = [
  { re: /\b(nfl|national football)\b/i, sport: "nfl" },
  { re: /\b(ncaaf|college football|cfb)\b/i, sport: "ncaaf" },
  { re: /\b(nba|national basketball)\b/i, sport: "nba" },
  { re: /\b(wnba)\b/i, sport: "wnba" },
  { re: /\b(mlb|baseball)\b/i, sport: "mlb" },
  { re: /\b(nhl|hockey)\b/i, sport: "nhl" },
  { re: /\b(ncaab|college basketball|cbb)\b/i, sport: "ncaab" },
];

/** NFL-style season year: Aug–Dec → that calendar year; Jan–Jul → prior year. */
export function resolveCurrentSeasonYear(
  sport: string,
  now: Date = new Date(),
): number {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-indexed
  if (sport === "mlb" || sport === "wnba") {
    return y;
  }
  // NBA/NHL/NFL/NCAAF/NCAAB: season labeled by start year (fall → following spring).
  if (m <= 6) return y - 1;
  return y;
}

export function extractMentionedSeasonYear(text: string): number | null {
  const m = String(text || "").match(/\b(20[2-9]\d)\b/);
  if (!m) return null;
  const y = Number(m[1]);
  return Number.isFinite(y) ? y : null;
}

export function detectSportHint(text: string): string | null {
  for (const { re, sport } of SPORT_HINT) {
    if (re.test(text)) return sport;
  }
  return null;
}

/**
 * True when the ask needs live provider roster/identity data before answering —
 * players, teams, rosters, injuries, schedules, depth charts, transactions, etc.
 */
export function wantsRosterGrounding(text: string): boolean {
  const t = String(text || "").trim();
  if (t.length < 8) return false;
  if (
    /\b(roster|depth chart|transaction|waiv(?:e|ed|er)|sign(?:ed|ing)?|trad(?:e|ed|ing)|injur(?:y|ies|ed)|questionable|doubtful|out for|who (?:plays|is) (?:for|on)|plays? for|on the .{2,30} roster|current team|what team|which team)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  // Explicit "Player plays for Team" / "Player is on the Team" claims.
  if (/\bplays?\s+for\b/i.test(t) || /\bis\s+on\s+the\b/i.test(t)) return true;
  // Season-year + team + player-shaped claim (e.g. 2026 NFL roster questions).
  if (/\b20[2-9]\d\b/.test(t) && detectSportHint(t) && extractPlayerTeamClaims(t).length > 0) {
    return true;
  }
  return extractPlayerTeamClaims(t).length > 0;
}

export type PlayerTeamClaim = {
  player: string;
  claimedTeam: string | null;
};

/**
 * Pull "Name … plays for … Team" style claims from free text.
 * Conservative: requires a capitalized multi-token player name.
 */
export function extractPlayerTeamClaims(text: string): PlayerTeamClaim[] {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return [];
  const out: PlayerTeamClaim[] = [];
  const seen = new Set<string>();

  const claimRes: RegExp[] = [
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z.]+){1,3})\s+plays?\s+for\s+(?:the\s+)?([A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]+){0,3})/g,
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z.]+){1,3})\s+is\s+on\s+the\s+([A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]+){0,3})/g,
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z.]+){1,3})\s+\((?:the\s+)?([A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]+){0,3})\)/g,
  ];

  const skipLead =
    /^(?:does|did|is|are|was|were|can|could|will|would|should|yes|no)$/i;

  for (const re of claimRes) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t)) != null) {
      const player = cleanPersonName(m[1]);
      const claimedTeam = cleanTeamName(m[2]);
      if (!player || player.split(/\s+/).length < 2) continue;
      const firstTok = player.split(/\s+/)[0] || "";
      if (skipLead.test(firstTok)) continue;
      const key = player.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ player, claimedTeam: claimedTeam || null });
      if (out.length >= 6) return out;
    }
  }

  // Fallback: "First Last" tokens near a known team nickname when "plays for" was
  // mangled (e.g. "Isaiah likely plays" with lowercase likely).
  const soft =
    /\b([A-Z][a-z]+)\s+([a-z]{3,}|[A-Z][a-z]+)\s+plays?\s+for\s+(?:the\s+)?([A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]+){0,3})/g;
  let sm: RegExpExecArray | null;
  while ((sm = soft.exec(t)) != null) {
    if (skipLead.test(sm[1])) continue;
    const player = cleanPersonName(`${sm[1]} ${sm[2]}`);
    const claimedTeam = cleanTeamName(sm[3]);
    if (!player || player.split(/\s+/).length < 2) continue;
    const key = player.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ player, claimedTeam: claimedTeam || null });
    if (out.length >= 6) break;
  }

  return out;
}

function cleanPersonName(raw: string): string {
  return String(raw || "")
    .replace(/^(?:does|did|is|are|was|were|can|could|will|would|should)\s+/i, "")
    .replace(/\b(plays?|for|the|and|in|on|with)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((tok) => !/^(?:does|did|is|are|was|were|can|could|will|would|should)$/i.test(tok))
    .map((tok) => tok.charAt(0).toUpperCase() + tok.slice(1).toLowerCase())
    .join(" ");
}

function cleanTeamName(raw: string): string {
  return String(raw || "")
    .replace(/\b(in|during|for)\b.*$/i, "")
    .replace(/\b(202\d|season|seasons|nfl|nba|mlb|nhl|wnba)\b/gi, "")
    .replace(/[.,;:!?].*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type RosterGroundingEntry = {
  query: string;
  athleteId: string | null;
  name: string | null;
  team: string | null;
  sport: string;
  seasonYear: number;
  claimedTeam: string | null;
  claimMatchesProvider: boolean | null;
  verified: boolean;
  source: "espn_player_search";
};

export type RosterGroundingPayload = {
  seasonYear: number;
  sport: string | null;
  retrievedAt: string;
  entries: RosterGroundingEntry[];
  /** Plain facts the model may quote — provider-only, never invented. */
  facts: string[];
};

type SearchItem = {
  id?: string;
  displayName?: string;
  league?: string;
  defaultLeagueSlug?: string;
  isActive?: boolean;
  isRetired?: boolean;
  teamRelationships?: Array<{ displayName?: string }>;
};

async function searchEspnPlayer(
  query: string,
  preferSport: string | null,
): Promise<{
  athleteId: string;
  name: string;
  team: string | null;
  sport: string;
  seasonYearFromLeague: number | null;
} | null> {
  const q = query.trim();
  if (q.length < 2) return null;
  const key = `roster-ground:v1:${q.toLowerCase()}`;
  const data = await cachedJson<{ items?: SearchItem[]; seasonYear?: number | null }>(
    key,
    30 * 60 * 1000,
    async () => {
      const url =
        `https://site.web.api.espn.com/apis/common/v3/search?region=us&lang=en&limit=12&type=player&query=` +
        encodeURIComponent(q);
      const r = await fetch(url);
      if (!r.ok) throw new Error(`ESPN search ${r.status}`);
      const json = (await r.json()) as {
        items?: Array<
          SearchItem & {
            leagueRelationships?: Array<{
              core?: { season?: { year?: number } };
            }>;
          }
        >;
      };
      // Preserve season year from the first matching item's league payload.
      let seasonYear: number | null = null;
      const items: SearchItem[] = [];
      for (const it of json.items ?? []) {
        if (!seasonYear) {
          const y = it.leagueRelationships?.[0]?.core?.season?.year;
          if (typeof y === "number") seasonYear = y;
        }
        items.push(it);
      }
      return { items, seasonYear };
    },
  );

  const ranked = [...(data.items ?? [])].sort((a, b) => {
    const sportA = LEAGUE_TO_SPORT[String(a.league || a.defaultLeagueSlug || "").toLowerCase()] || "";
    const sportB = LEAGUE_TO_SPORT[String(b.league || b.defaultLeagueSlug || "").toLowerCase()] || "";
    const score = (sport: string, it: SearchItem) => {
      let s = 0;
      if (preferSport && sport === preferSport) s += 10;
      if (it.isActive !== false && it.isRetired !== true) s += 3;
      if (it.teamRelationships?.[0]?.displayName) s += 1;
      return s;
    };
    return score(sportB, b) - score(sportA, a);
  });

  for (const it of ranked) {
    const leagueSlug = String(it.league || it.defaultLeagueSlug || "").toLowerCase();
    const sport = LEAGUE_TO_SPORT[leagueSlug];
    if (!sport || !it.id || !it.displayName) continue;
    if (preferSport && sport !== preferSport) continue;
    return {
      athleteId: String(it.id),
      name: it.displayName,
      team: it.teamRelationships?.[0]?.displayName ?? null,
      sport,
      seasonYearFromLeague:
        typeof data.seasonYear === "number" ? data.seasonYear : null,
    };
  }
  // Prefer-sport miss: accept best overall active hit rather than inventing.
  for (const it of ranked) {
    const leagueSlug = String(it.league || it.defaultLeagueSlug || "").toLowerCase();
    const sport = LEAGUE_TO_SPORT[leagueSlug];
    if (!sport || !it.id || !it.displayName) continue;
    return {
      athleteId: String(it.id),
      name: it.displayName,
      team: it.teamRelationships?.[0]?.displayName ?? null,
      sport,
      seasonYearFromLeague:
        typeof data.seasonYear === "number" ? data.seasonYear : null,
    };
  }
  return null;
}

function teamNamesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const nick = (s: string) => s.split(/\s+/).filter(Boolean).pop() || "";
  return nick(na).length >= 3 && nick(na) === nick(nb);
}

/**
 * Resolve named player↔team claims against live ESPN search for the
 * mentioned or current season. Returns structured context for the chat model.
 */
export async function buildRosterGrounding(
  userText: string,
  opts?: { now?: Date; fetchPlayer?: typeof searchEspnPlayer },
): Promise<RosterGroundingPayload | null> {
  if (!wantsRosterGrounding(userText)) return null;
  const claims = extractPlayerTeamClaims(userText);
  if (!claims.length) return null;

  const sportHint = detectSportHint(userText);
  const mentionedYear = extractMentionedSeasonYear(userText);
  const defaultYear = resolveCurrentSeasonYear(sportHint || "nfl", opts?.now ?? new Date());
  const seasonYear = mentionedYear ?? defaultYear;
  const fetchPlayer = opts?.fetchPlayer ?? searchEspnPlayer;

  const entries: RosterGroundingEntry[] = [];
  for (const claim of claims.slice(0, 6)) {
    try {
      const hit = await fetchPlayer(claim.player, sportHint);
      if (!hit) {
        entries.push({
          query: claim.player,
          athleteId: null,
          name: null,
          team: null,
          sport: sportHint || "unknown",
          seasonYear,
          claimedTeam: claim.claimedTeam,
          claimMatchesProvider: null,
          verified: false,
          source: "espn_player_search",
        });
        continue;
      }
      const year = hit.seasonYearFromLeague ?? seasonYear;
      const match =
        claim.claimedTeam && hit.team
          ? teamNamesMatch(claim.claimedTeam, hit.team)
          : null;
      entries.push({
        query: claim.player,
        athleteId: hit.athleteId,
        name: hit.name,
        team: hit.team,
        sport: hit.sport,
        seasonYear: year,
        claimedTeam: claim.claimedTeam,
        claimMatchesProvider: match,
        verified: !!hit.team,
        source: "espn_player_search",
      });
    } catch {
      entries.push({
        query: claim.player,
        athleteId: null,
        name: null,
        team: null,
        sport: sportHint || "unknown",
        seasonYear,
        claimedTeam: claim.claimedTeam,
        claimMatchesProvider: null,
        verified: false,
        source: "espn_player_search",
      });
    }
  }

  if (!entries.length) return null;

  const facts: string[] = [];
  facts.push(
    `Roster grounding seasonYear=${seasonYear}` +
      (sportHint ? ` sport=${sportHint}` : "") +
      ` (live ESPN player search — overrides any pretrained cutoff).`,
  );
  for (const e of entries) {
    if (e.verified && e.name && e.team) {
      let line = `${e.name} is currently listed on the ${e.team} roster for the ${e.seasonYear} ${e.sport.toUpperCase()} season (ESPN).`;
      if (e.claimedTeam) {
        line +=
          e.claimMatchesProvider === true
            ? ` User claim (${e.claimedTeam}) MATCHES provider.`
            : e.claimMatchesProvider === false
              ? ` User claim (${e.claimedTeam}) does NOT match provider team.`
              : "";
      }
      facts.push(line);
    } else {
      facts.push(
        `Could not currently verify roster assignment for "${e.query}"` +
          (e.claimedTeam ? ` (user claimed ${e.claimedTeam})` : "") +
          ` via live ESPN search for ${e.seasonYear}. Do NOT substitute pretrained/old roster knowledge.`,
      );
    }
  }

  return {
    seasonYear,
    sport: sportHint,
    retrievedAt: (opts?.now ?? new Date()).toISOString(),
    entries,
    facts,
  };
}

/** System-prompt addendum when roster grounding is attached (or should be). */
export const ROSTER_GROUNDING_SYSTEM_RULE = `
*** CURRENT ROSTER / IDENTITY GROUNDING (CRITICAL) ***
For questions about current players, teams, rosters, injuries, schedules, games, stats, depth charts, transactions, odds, or props:
1. Use ONLY live Stadium Edge / provider data in the Current app context (rosterGrounding, realProps, realOdds, realGames, matchupInjuries, statmuseFacts, etc.). That data OVERRIDES any pretrained training knowledge.
2. NEVER cite a model knowledge-cutoff date (e.g. "as of my latest data cutoff", "June 2024", "my training data") as evidence that a current roster claim is false or true.
3. When context.rosterGrounding is present, treat its facts as authoritative for player↔team identity for the stated seasonYear. If a user claim MATCHES an entry, confirm it from that data. If it CONTRADICTS, correct using the provider team — never the old training roster.
4. If current provider data cannot verify a player/team assignment, say you cannot currently verify it. Do NOT fill the gap with an old roster from memory and present it as current.
5. Include the season year from rosterGrounding.seasonYear (or the year the user asked about) in your reasoning. A 2026 question must be answered against 2026 provider data, not 2024 memory.
6. Still never invent a prop, line, price, roster assignment, injury, or game that is not in the provided context.
`.trim();

/**
 * Current-roster grounding for Coach Q&A and prop-identity asks.
 *
 * Live ESPN player-search (same provider the prop identity path uses) overrides
 * the LLM's pretrained roster knowledge. Never invents assignments — only
 * reports what the provider returns for the requested/current season.
 *
 * Critical: bare identity asks ("Is Ashton Jeanty an NFL player?") must still
 * extract the player name and look him up — not only "plays for Team" claims.
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

/** Words that look capitalized but are not person-name tokens. */
const NAME_STOP = new Set(
  [
    "the", "and", "for", "with", "from", "into", "over", "under", "yes", "no",
    "new", "york", "los", "angeles", "las", "vegas", "san", "francisco", "kansas",
    "city", "green", "bay", "tampa", "bay", "new", "england", "bay",
    "chicago", "bears", "giants", "ravens", "commanders", "washington", "atlanta",
    "falcons", "raiders", "nfl", "nba", "mlb", "nhl", "wnba", "ncaaf", "ncaab",
    "props", "prop", "parlay", "ticket", "legs", "leg", "build", "tonight",
    "today", "tomorrow", "season", "seasons", "football", "basketball", "baseball",
    "hockey", "active", "roster", "player", "players", "team", "teams", "game",
    "games", "market", "markets", "odds", "line", "lines", "rushing", "yards",
    "receiving", "passing", "touchdowns", "points", "rebounds", "assists",
    "does", "did", "is", "are", "was", "were", "can", "could", "will", "would",
    "should", "still", "currently", "official", "record", "verified",
  ].map((s) => s.toLowerCase()),
);

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

/** Identity / roster / current-season cues that require live provider lookup. */
export function hasRosterIdentityCue(text: string): boolean {
  const t = String(text || "");
  return (
    /\b(roster|depth chart|transaction|waiv(?:e|ed|er)|sign(?:ed|ing)?|trad(?:e|ed|ing)|injur(?:y|ies|ed)|questionable|doubtful|out for|who (?:plays|is) (?:for|on)|plays? for|on the .{2,40} roster|current team|what team|which team|still (?:play|with|on)|active (?:nfl |nba |mlb |nhl )?roster|(?:an?|the)\s+nfl\s+player|not an nfl player|official record|current(?:ly)? (?:on|with|listed))\b/i.test(
      t,
    ) ||
    /\bis\s+[A-Z][a-z]+(?:\s+[A-Z][a-z.]+){1,3}\s+(?:an?|on|with|still)\b/i.test(t) ||
    /\b(?:does|did|is)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z.]+){0,3}\s+(?:play|plays|playing|on|still)\b/i.test(
      t,
    )
  );
}

/**
 * True when the ask needs live provider roster/identity data before answering.
 */
export function wantsRosterGrounding(text: string): boolean {
  const t = String(text || "").trim();
  if (t.length < 6) return false;
  if (hasRosterIdentityCue(t)) return true;
  if (/\bplays?\s+for\b/i.test(t) || /\bis\s+on\s+the\b/i.test(t)) return true;
  const names = extractNamedPlayers(t);
  if (!names.length) return extractPlayerTeamClaims(t).length > 0;
  // Named athlete + sport / season / prop / stat / slate cue → ground identity
  // before the model answers (covers "Jeanty rushing yards" and "is X an NFL player").
  if (
    detectSportHint(t) ||
    /\b20[2-9]\d\b/.test(t) ||
    /\b(props?|odds|lines?|parlay|ticket|legs?|matchup|vs\.?|against|over|under|rushing|receiving|passing|yards?|touchdowns?|tds?|points?|rebounds?|assists?|strikeouts?|tonight|today|tomorrow|slate|board)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  return extractPlayerTeamClaims(t).length > 0;
}

export type PlayerTeamClaim = {
  player: string;
  claimedTeam: string | null;
};

/**
 * Extract person-like "First Last" / "First Middle Last Jr." names from free text.
 * Conservative stop-list avoids team cities/nicknames becoming "players".
 */
export function extractNamedPlayers(text: string): string[] {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  // First Last (optional Jr/Sr/II/III) — allows lowercase second token for
  // mangled names like "Isaiah likely".
  const re =
    /\b([A-Z][a-z]+)\s+([A-Z][a-z]+|[a-z]{3,})(?:\s+(Jr\.?|Sr\.?|II|III|IV))?\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) != null) {
    const first = m[1];
    const second = m[2];
    const suffix = m[3] ? ` ${m[3].replace(/\.$/, "")}` : "";
    // "Is Ashton Jeanty" matches "Is Ashton" first — rewind so Ashton is reused.
    if (NAME_STOP.has(first.toLowerCase())) {
      re.lastIndex = m.index + first.length;
      continue;
    }
    if (NAME_STOP.has(second.toLowerCase())) {
      continue;
    }
    // Skip obvious team nicknames as "Last".
    if (
      /^(giants|bears|ravens|falcons|raiders|commanders|cowboys|eagles|chiefs|packers|patriots|jets|bills|dolphins|steelers|bengals|browns|titans|colts|jaguars|texans|broncos|chargers|rams|49ers|seahawks|cardinals|vikings|lions|saints|buccaneers|panthers)$/i.test(
        second,
      )
    ) {
      continue;
    }
    const player = cleanPersonName(`${first} ${second}${suffix}`);
    if (!player || player.split(/\s+/).length < 2) continue;
    const key = player.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(player);
    if (out.length >= 6) break;
  }
  return out;
}

/**
 * Pull "Name … plays for … Team" style claims from free text.
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
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z.]+){1,3})\s+still\s+plays?\s+for\s+(?:the\s+)?([A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]+){0,3})/g,
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
    .map((tok, i, arr) => {
      if (/^(jr|sr|ii|iii|iv)$/i.test(tok)) {
        return tok.toUpperCase() === "JR" || tok.toUpperCase() === "SR"
          ? `${tok[0].toUpperCase()}${tok.slice(1).toLowerCase()}.`.replace("..", ".")
          : tok.toUpperCase();
      }
      // Keep last token title-case even when source was lowercase ("likely").
      if (i === arr.length - 1 || i === 0) {
        return tok.charAt(0).toUpperCase() + tok.slice(1).toLowerCase();
      }
      return tok.charAt(0).toUpperCase() + tok.slice(1).toLowerCase();
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
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
  isActive: boolean | null;
  source: "espn_player_search" | "stadium_edge_realProps";
};

/** Structured current-season fact row for the final LLM prompt. */
export type VerifiedCurrentFact = {
  season: number;
  player: string;
  team: string | null;
  opponent: string | null;
  game: string | null;
  market: string | null;
  line: number | string | null;
  odds: number | string | null;
  provider: string;
  dataTimestamp: string;
  athleteId: string | null;
  sport: string | null;
  verified: boolean;
};

export type RosterGroundingPayload = {
  seasonYear: number;
  sport: string | null;
  retrievedAt: string;
  entries: RosterGroundingEntry[];
  /** Plain facts the model may quote — provider-only, never invented. */
  facts: string[];
  /** Structured rows: season/player/team/opponent/game/market/line/odds/provider/timestamp. */
  verifiedCurrentFacts: VerifiedCurrentFact[];
  authority:
    "For current sports facts, the supplied live context is authoritative and overrides pretrained model knowledge.";
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
  isActive: boolean | null;
} | null> {
  const q = query.trim();
  if (q.length < 2) return null;
  const key = `roster-ground:v2:${q.toLowerCase()}`;
  const data = await cachedJson<{
    items?: SearchItem[];
    seasonYear?: number | null;
  }>(key, 30 * 60 * 1000, async () => {
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
  });

  const ranked = [...(data.items ?? [])].sort((a, b) => {
    const sportA =
      LEAGUE_TO_SPORT[String(a.league || a.defaultLeagueSlug || "").toLowerCase()] ||
      "";
    const sportB =
      LEAGUE_TO_SPORT[String(b.league || b.defaultLeagueSlug || "").toLowerCase()] ||
      "";
    const score = (sport: string, it: SearchItem) => {
      let s = 0;
      if (preferSport && sport === preferSport) s += 10;
      if (it.isActive !== false && it.isRetired !== true) s += 3;
      if (it.teamRelationships?.[0]?.displayName) s += 1;
      return s;
    };
    return score(sportB, b) - score(sportA, a);
  });

  const pick = (it: SearchItem) => {
    const leagueSlug = String(it.league || it.defaultLeagueSlug || "").toLowerCase();
    const sport = LEAGUE_TO_SPORT[leagueSlug];
    if (!sport || !it.id || !it.displayName) return null;
    return {
      athleteId: String(it.id),
      name: it.displayName,
      team: it.teamRelationships?.[0]?.displayName ?? null,
      sport,
      seasonYearFromLeague:
        typeof data.seasonYear === "number" ? data.seasonYear : null,
      isActive:
        it.isActive === undefined && it.isRetired === undefined
          ? null
          : it.isActive !== false && it.isRetired !== true,
    };
  };

  for (const it of ranked) {
    const leagueSlug = String(it.league || it.defaultLeagueSlug || "").toLowerCase();
    const sport = LEAGUE_TO_SPORT[leagueSlug];
    if (preferSport && sport !== preferSport) continue;
    const hit = pick(it);
    if (hit) return hit;
  }
  for (const it of ranked) {
    const hit = pick(it);
    if (hit) return hit;
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

function namesLooselyMatch(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
      .replace(/[^a-z\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = na.split(" ");
  const tb = nb.split(" ");
  return ta[0] === tb[0] && ta[ta.length - 1] === tb[tb.length - 1];
}

type PropLike = {
  player?: unknown;
  athleteId?: unknown;
  sport?: unknown;
  game?: unknown;
  market?: unknown;
  line?: unknown;
  overOdds?: unknown;
  underOdds?: unknown;
  odds?: unknown;
  opponentTeamId?: unknown;
  playerTeamId?: unknown;
  team?: unknown;
  teamName?: unknown;
};

function propTeamLabel(p: PropLike): string | null {
  if (typeof p.team === "string" && p.team.trim()) return p.team.trim();
  if (typeof p.teamName === "string" && p.teamName.trim()) return p.teamName.trim();
  return null;
}

function opponentFromGame(game: string | null | undefined, team: string | null): string | null {
  if (!game || !team || !game.includes(" @ ")) return null;
  const [away, home] = game.split(" @ ").map((s) => s.trim());
  if (!away || !home) return null;
  if (teamNamesMatch(team, away)) return home;
  if (teamNamesMatch(team, home)) return away;
  // Nickname fallback
  const nick = (s: string) => s.split(/\s+/).pop()?.toLowerCase() || "";
  if (nick(team) && nick(team) === nick(away)) return home;
  if (nick(team) && nick(team) === nick(home)) return away;
  return null;
}

/**
 * Resolve named players / claims against live ESPN (and optional realProps rows)
 * for the mentioned or current season.
 */
export async function buildRosterGrounding(
  userText: string,
  opts?: {
    now?: Date;
    fetchPlayer?: typeof searchEspnPlayer;
    /** Optional live prop pool — used to attach game/market/line/odds rows. */
    realProps?: PropLike[];
  },
): Promise<RosterGroundingPayload | null> {
  if (!wantsRosterGrounding(userText)) return null;

  const claims = extractPlayerTeamClaims(userText);
  const bareNames = extractNamedPlayers(userText);
  const byKey = new Map<string, PlayerTeamClaim>();
  for (const c of claims) byKey.set(c.player.toLowerCase(), c);
  for (const n of bareNames) {
    const k = n.toLowerCase();
    if (!byKey.has(k)) byKey.set(k, { player: n, claimedTeam: null });
  }
  // Also ground players present in realProps that the user named (or all if
  // identity cue + few props) — never invent; only surface supplied rows.
  const props = Array.isArray(opts?.realProps) ? opts!.realProps! : [];
  if (bareNames.length && props.length) {
    for (const p of props) {
      const pname = typeof p.player === "string" ? p.player : "";
      if (!pname) continue;
      if (!bareNames.some((n) => namesLooselyMatch(n, pname))) continue;
      const k = pname.toLowerCase();
      if (!byKey.has(k)) byKey.set(k, { player: pname, claimedTeam: propTeamLabel(p) });
    }
  }

  const targets = [...byKey.values()];
  if (!targets.length) return null;

  const sportHint = detectSportHint(userText);
  const mentionedYear = extractMentionedSeasonYear(userText);
  const now = opts?.now ?? new Date();
  const defaultYear = resolveCurrentSeasonYear(sportHint || "nfl", now);
  const seasonYear = mentionedYear ?? defaultYear;
  const fetchPlayer = opts?.fetchPlayer ?? searchEspnPlayer;
  const retrievedAt = now.toISOString();

  const entries: RosterGroundingEntry[] = [];
  for (const claim of targets.slice(0, 6)) {
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
          isActive: null,
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
        isActive: hit.isActive,
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
        isActive: null,
        source: "espn_player_search",
      });
    }
  }

  if (!entries.length) return null;

  const verifiedCurrentFacts: VerifiedCurrentFact[] = [];
  for (const e of entries) {
    const matchingProps = props.filter((p) => {
      const pname = typeof p.player === "string" ? p.player : "";
      if (!pname) return false;
      if (e.name && namesLooselyMatch(e.name, pname)) return true;
      return namesLooselyMatch(e.query, pname);
    });
    if (matchingProps.length) {
      for (const p of matchingProps.slice(0, 3)) {
        const game = typeof p.game === "string" ? p.game : null;
        const team = e.team || propTeamLabel(p);
        const odds =
          p.overOdds ?? p.underOdds ?? p.odds ?? null;
        verifiedCurrentFacts.push({
          season: e.seasonYear,
          player: e.name || e.query,
          team,
          opponent: opponentFromGame(game, team),
          game,
          market: typeof p.market === "string" ? p.market : null,
          line: (p.line as number | string | null | undefined) ?? null,
          odds: odds as number | string | null,
          provider: "stadium_edge_realProps+espn_player_search",
          dataTimestamp: retrievedAt,
          athleteId: e.athleteId || (p.athleteId != null ? String(p.athleteId) : null),
          sport: e.sport || (typeof p.sport === "string" ? p.sport : null),
          verified: e.verified,
        });
      }
    } else {
      verifiedCurrentFacts.push({
        season: e.seasonYear,
        player: e.name || e.query,
        team: e.team,
        opponent: null,
        game: null,
        market: null,
        line: null,
        odds: null,
        provider: "espn_player_search",
        dataTimestamp: retrievedAt,
        athleteId: e.athleteId,
        sport: e.sport,
        verified: e.verified,
      });
    }
  }

  const facts: string[] = [];
  facts.push(
    `Roster grounding seasonYear=${seasonYear}` +
      (sportHint ? ` sport=${sportHint}` : "") +
      ` retrievedAt=${retrievedAt} (live ESPN player search — AUTHORITATIVE; overrides any pretrained cutoff).`,
  );
  for (const e of entries) {
    if (e.verified && e.name && e.team) {
      let line =
        `${e.name} is currently listed on the ${e.team} roster for the ${e.seasonYear} ${e.sport.toUpperCase()} season (ESPN` +
        (e.isActive === true ? ", active" : e.isActive === false ? ", inactive/retired flag" : "") +
        `).`;
      if (e.claimedTeam) {
        line +=
          e.claimMatchesProvider === true
            ? ` User claim (${e.claimedTeam}) MATCHES provider.`
            : e.claimMatchesProvider === false
              ? ` User claim (${e.claimedTeam}) does NOT match provider team — use provider team ${e.team}, not training memory.`
              : "";
      }
      facts.push(line);
    } else {
      facts.push(
        `Could not currently verify roster assignment for "${e.query}"` +
          (e.claimedTeam ? ` (user claimed ${e.claimedTeam})` : "") +
          ` via live ESPN search for ${e.seasonYear}. Say you cannot currently verify it — do NOT substitute pretrained/old roster knowledge.`,
      );
    }
  }

  return {
    seasonYear,
    sport: sportHint,
    retrievedAt,
    entries,
    facts,
    verifiedCurrentFacts,
    authority:
      "For current sports facts, the supplied live context is authoritative and overrides pretrained model knowledge.",
  };
}

/** System-prompt addendum when roster grounding is needed or attached. */
export const ROSTER_GROUNDING_SYSTEM_RULE = `
*** CURRENT ROSTER / IDENTITY GROUNDING (CRITICAL — OVERRIDES TRAINING DATA) ***
For current sports facts, the supplied live context is authoritative and overrides pretrained model knowledge. Never reject a player, team, roster assignment, schedule, injury status, market, or matchup because it conflicts with your training data.

HARD RULES:
1. Use ONLY live Stadium Edge / provider data in the Current app context (rosterGrounding.verifiedCurrentFacts, rosterGrounding.facts, realProps, realOdds, realGames, matchupInjuries, statmuseFacts, etc.). That data OVERRIDES any pretrained training knowledge.
2. NEVER cite a model knowledge-cutoff date (e.g. "as of my latest data cutoff", "June 2024", "my training data", "latest data", "current verified roster" from memory, "official record" from memory, "as of 2024") as evidence that a current roster claim is false or true.
3. NEVER say a player is "not an NFL player" or "not on an active NFL roster" based on training memory when rosterGrounding / realProps lists them. If the live context says they are on a team for seasonYear, that is authoritative.
4. When Stadium Edge supplies a candidate such as player + current team + opponent + market + line/price (in verifiedCurrentFacts or realProps), you MUST NOT re-check that player's current team using pretrained knowledge and contradict the supplied data.
5. When context.rosterGrounding is present, treat its verifiedCurrentFacts / facts as authoritative for player↔team identity for the stated seasonYear. If a user claim MATCHES, confirm from that data. If it CONTRADICTS, correct using the provider team — never the old training roster (e.g. do not keep a player on Washington when the provider lists Atlanta).
6. If current provider data cannot verify a player/team assignment, say you cannot currently verify it. Do NOT fill the gap with an old roster from memory and present it as current.
7. Include the season year from rosterGrounding.seasonYear (or the year the user asked about) in your reasoning. A 2026 question must be answered against 2026 provider data, not 2024 memory.
8. Still never invent a prop, line, price, roster assignment, injury, or game that is not in the provided context.
`.trim();

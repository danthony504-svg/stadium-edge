/**
 * Shared current-fact authority for Coach — ALL sports.
 *
 * The LLM must never override Stadium Edge / provider structured data with
 * pretrained knowledge. This module is sport-agnostic: no player-specific or
 * NFL-only patches.
 */

/** Always attached to the final Coach system message (every /chat turn). */
export const CURRENT_FACT_AUTHORITY_RULE = `
*** CURRENT SPORTS FACT AUTHORITY (ALL SPORTS — CRITICAL) ***
For current sports facts, supplied live Stadium Edge/provider context is authoritative and overrides pretrained model knowledge. Never reject or alter a player, team, roster assignment, transfer, matchup, schedule, event, market, line, or odds because it conflicts with your training data. If current data cannot be verified, state that it cannot be verified rather than substituting historical information.

This applies to EVERY supported sport (NFL, NCAAF, NBA, WNBA, NCAAB, MLB, NHL, Soccer, Tennis, UFC/MMA, Table Tennis, Cricket, and any other sport in the live context):
player→team, team→league, active/inactive roster, trades/transfers/signings, rookies, injuries/availability, starters/lineups, opponent, schedule/date/time, season/year, game status, tournament/event, market availability, prop type, line, odds, venue, probable pitchers, goalkeepers, starting QBs, UFC fighters/cards, tennis opponents/tournaments, soccer clubs/transfers.

When context.currentFactGrounding or context.rosterGrounding (verifiedCurrentFacts / facts) or realProps / realOdds / realGames / fightAnalysis / tennisAnalysis / matchupInjuries supplies a fact, USE IT. Do not re-litigate identity from training memory.
Never cite a knowledge-cutoff date ("as of 2024", "as of 2025", "June 2024", "my latest data", "official record" from memory) as evidence against live context.
If a field is missing or unverified, say "Current data could not be verified." — do NOT silently use an old season and present it as current.
`.trim();

/** ESPN / Odds API league slug → app sport id (shared across all sports). */
export const PROVIDER_LEAGUE_TO_SPORT: Record<string, string> = {
  nba: "nba",
  wnba: "wnba",
  mlb: "mlb",
  nfl: "nfl",
  nhl: "nhl",
  "college-football": "ncaaf",
  "mens-college-basketball": "ncaab",
  "womens-college-basketball": "ncaab",
  // Soccer — ESPN uses competition slugs; map common ones + generic "soccer".
  soccer: "soccer",
  "uefa.champions": "soccer",
  "uefa.europa": "soccer",
  "uefa.europa.conf": "soccer",
  "fifa.world": "soccer",
  "eng.1": "soccer",
  "eng.2": "soccer",
  "eng.fa": "soccer",
  "esp.1": "soccer",
  "ita.1": "soccer",
  "ger.1": "soccer",
  "fra.1": "soccer",
  "usa.1": "soccer",
  "ned.1": "soccer",
  "por.1": "soccer",
  "mex.1": "soccer",
  "bra.1": "soccer",
  "arg.1": "soccer",
  // Combat / racket
  ufc: "ufc",
  mma: "ufc",
  tennis: "tennis",
  atp: "tennis",
  wta: "tennis",
  cricket: "cricket",
  tabletennis: "tabletennis",
};

/**
 * Resolve ESPN / provider league slug → Coach sport id.
 * Handles unlisted soccer competition slugs (e.g. "sco.1", "uefa.*") without
 * hardcoding every competition.
 */
export function resolveProviderLeagueSport(leagueSlug: string | null | undefined): string | null {
  const slug = String(leagueSlug || "").toLowerCase().trim();
  if (!slug) return null;
  const mapped = PROVIDER_LEAGUE_TO_SPORT[slug];
  if (mapped) return mapped;
  if (
    /^(eng|esp|ita|ger|fra|usa|ned|por|mex|bra|arg|sco|bel|tur|gre|aut|sui|den|swe|nor|pol|ukr|rus|jpn|kor|aus|chi|col|uru|par|ecu|per|bol|ven|can|ksa|uae|qat|egy|mar|rsa|nga|gha|civ|sen|cmr|alg|tun)\./i.test(
      slug,
    ) ||
    /^(uefa|fifa|concacaf|conmebol|caf|afc|ofc)\./i.test(slug) ||
    /soccer|mls|epl|liga|premier/i.test(slug)
  ) {
    return "soccer";
  }
  if (/tennis|atp|wta/i.test(slug)) return "tennis";
  if (/ufc|mma|bellator|pfl/i.test(slug)) return "ufc";
  if (/cricket|ipl|t20/i.test(slug)) return "cricket";
  if (/table.?tennis|ping.?pong/i.test(slug)) return "tabletennis";
  return null;
}

export const ALL_COACH_SPORTS = [
  "nfl",
  "ncaaf",
  "nba",
  "wnba",
  "ncaab",
  "mlb",
  "nhl",
  "soccer",
  "tennis",
  "ufc",
  "tabletennis",
  "cricket",
] as const;

export type CoachSportId = (typeof ALL_COACH_SPORTS)[number];

/** Full provenance row for the final Coach prompt (all sports). */
export type AuthoritativeCurrentFact = {
  sport: string | null;
  league: string | null;
  season: number | null;
  eventId: string | null;
  eventDate: string | null;
  playerId: string | null;
  playerName: string;
  currentTeam: string | null;
  opponent: string | null;
  rosterStatus: string | null;
  market: string | null;
  line: number | string | null;
  odds: number | string | null;
  provider: string;
  providerTimestamp: string;
  lastVerifiedAt: string;
  game: string | null;
  verified: boolean;
};

type LiveCtx = {
  realProps?: Array<Record<string, unknown>>;
  realOdds?: Array<Record<string, unknown>>;
  realGames?: Array<Record<string, unknown>>;
  fightAnalysis?: Record<string, unknown>;
  tennisAnalysis?: Record<string, unknown>;
  matchupInjuries?: unknown;
  rosterGrounding?: {
    seasonYear?: number;
    retrievedAt?: string;
    verifiedCurrentFacts?: Array<Record<string, unknown>>;
    entries?: Array<Record<string, unknown>>;
  };
};

function asStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function asNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
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

function opponentFromGame(game: string | null, team: string | null): string | null {
  if (!game || !team || !game.includes(" @ ")) return null;
  const [away, home] = game.split(" @ ").map((s) => s.trim());
  if (!away || !home) return null;
  const nick = (s: string) => s.split(/\s+/).pop()?.toLowerCase() || "";
  const t = team.toLowerCase();
  if (away.toLowerCase().includes(t) || t.includes(nick(away))) return home;
  if (home.toLowerCase().includes(t) || t.includes(nick(home))) return away;
  if (nick(team) && nick(team) === nick(away)) return home;
  if (nick(team) && nick(team) === nick(home)) return away;
  return null;
}

/**
 * Project live Coach context into authoritative fact rows for named entities
 * (or a bounded sample of UFC/tennis cards). Sport-agnostic — no hardcoding
 * of individual athletes.
 */
export function projectLiveContextFacts(
  ctx: LiveCtx | null | undefined,
  opts?: {
    namedPlayers?: string[];
    now?: Date;
    maxFacts?: number;
  },
): AuthoritativeCurrentFact[] {
  if (!ctx || typeof ctx !== "object") return [];
  const nowIso = (opts?.now ?? new Date()).toISOString();
  const max = opts?.maxFacts ?? 24;
  const named = (opts?.namedPlayers ?? []).filter(Boolean);
  const out: AuthoritativeCurrentFact[] = [];

  const push = (row: AuthoritativeCurrentFact) => {
    if (out.length >= max) return;
    out.push(row);
  };

  // 1) Already-resolved rosterGrounding rows (ESPN identity).
  const rgFacts = ctx.rosterGrounding?.verifiedCurrentFacts;
  if (Array.isArray(rgFacts)) {
    for (const f of rgFacts) {
      push({
        sport: asStr(f.sport),
        league: asStr(f.sport),
        season: asNum(f.season) ?? ctx.rosterGrounding?.seasonYear ?? null,
        eventId: null,
        eventDate: null,
        playerId: asStr(f.athleteId) ?? asStr(f.playerId),
        playerName: asStr(f.player) ?? asStr(f.playerName) ?? "unknown",
        currentTeam: asStr(f.team) ?? asStr(f.currentTeam),
        opponent: asStr(f.opponent),
        rosterStatus: f.verified === false ? "unverified" : "active_or_listed",
        market: asStr(f.market),
        line: (f.line as number | string | null | undefined) ?? null,
        odds: (f.odds as number | string | null | undefined) ?? null,
        provider: asStr(f.provider) ?? "espn_player_search",
        providerTimestamp: asStr(f.dataTimestamp) ?? ctx.rosterGrounding?.retrievedAt ?? nowIso,
        lastVerifiedAt: asStr(f.dataTimestamp) ?? ctx.rosterGrounding?.retrievedAt ?? nowIso,
        game: asStr(f.game),
        verified: f.verified !== false && !!(asStr(f.team) ?? asStr(f.currentTeam)),
      });
    }
  }

  // 2) realProps — player + team + market + line + odds (all sports with props).
  const props = Array.isArray(ctx.realProps) ? ctx.realProps : [];
  for (const p of props) {
    const playerName = asStr(p.player);
    if (!playerName) continue;
    if (named.length && !named.some((n) => namesLooselyMatch(n, playerName))) continue;
    const game = asStr(p.game);
    const team = asStr(p.team) ?? asStr(p.teamName) ?? asStr(p.playerTeam);
    const odds = p.overOdds ?? p.underOdds ?? p.odds ?? null;
    push({
      sport: asStr(p.sport),
      league: asStr(p.sport),
      season: ctx.rosterGrounding?.seasonYear ?? null,
      eventId: asStr(p.eventId) ?? asStr(p.gameId),
      eventDate: asStr(p.startsAt) ?? asStr(p.commence_time),
      playerId: p.athleteId != null ? String(p.athleteId) : null,
      playerName,
      currentTeam: team,
      opponent: opponentFromGame(game, team) ?? asStr(p.opponent),
      rosterStatus: "listed_on_prop_board",
      market: asStr(p.market),
      line: (p.line as number | string | null | undefined) ?? null,
      odds: odds as number | string | null,
      provider: "stadium_edge_realProps",
      providerTimestamp: nowIso,
      lastVerifiedAt: nowIso,
      game,
      verified: true,
    });
    if (out.length >= max) break;
  }

  // 3) UFC fightAnalysis — fighter cards (moneyline-only sport).
  const fights = ctx.fightAnalysis;
  if (fights && typeof fights === "object") {
    for (const [label, raw] of Object.entries(fights)) {
      if (out.length >= max) break;
      const entry = raw as Record<string, unknown>;
      const fighters = [
        entry.awayFighter ?? entry.fighterA ?? entry.red,
        entry.homeFighter ?? entry.fighterB ?? entry.blue,
      ];
      for (const fRaw of fighters) {
        if (!fRaw || typeof fRaw !== "object") continue;
        const f = fRaw as Record<string, unknown>;
        const name = asStr(f.name) ?? asStr(f.displayName);
        if (!name) continue;
        if (named.length && !named.some((n) => namesLooselyMatch(n, name))) continue;
        push({
          sport: "ufc",
          league: "ufc",
          season: null,
          eventId: asStr(entry.eventId),
          eventDate: asStr(entry.date) ?? asStr(entry.startsAt),
          playerId: f.athleteId != null ? String(f.athleteId) : null,
          playerName: name,
          currentTeam: null,
          opponent: (() => {
            const parts = label.split(" @ ").map((s) => s.trim());
            if (parts.length !== 2) return null;
            return namesLooselyMatch(name, parts[0]) ? parts[1] : parts[0];
          })(),
          rosterStatus: asStr(f.record) ? "carded" : "listed",
          market: "moneyline",
          line: null,
          odds: null,
          provider: "stadium_edge_fightAnalysis",
          providerTimestamp: nowIso,
          lastVerifiedAt: nowIso,
          game: label,
          verified: true,
        });
      }
    }
  }

  // 4) Tennis analysis — tournament matchups.
  const tennis = ctx.tennisAnalysis;
  if (tennis && typeof tennis === "object") {
    for (const [label, raw] of Object.entries(tennis)) {
      if (out.length >= max) break;
      const entry = raw as Record<string, unknown>;
      for (const key of ["awayPlayer", "homePlayer", "playerA", "playerB"] as const) {
        const pRaw = entry[key];
        if (!pRaw || typeof pRaw !== "object") continue;
        const p = pRaw as Record<string, unknown>;
        const name = asStr(p.name) ?? asStr(p.displayName);
        if (!name) continue;
        if (named.length && !named.some((n) => namesLooselyMatch(n, name))) continue;
        push({
          sport: "tennis",
          league: asStr(entry.tour) ?? "tennis",
          season: null,
          eventId: asStr(entry.eventId),
          eventDate: asStr(entry.date) ?? asStr(entry.startsAt),
          playerId: p.athleteId != null ? String(p.athleteId) : null,
          playerName: name,
          currentTeam: null,
          opponent: (() => {
            const parts = label.split(" @ ").map((s) => s.trim());
            if (parts.length !== 2) return null;
            return namesLooselyMatch(name, parts[0]) ? parts[1] : parts[0];
          })(),
          rosterStatus: "draw",
          market: "moneyline",
          line: null,
          odds: null,
          provider: "stadium_edge_tennisAnalysis",
          providerTimestamp: nowIso,
          lastVerifiedAt: nowIso,
          game: label,
          verified: true,
        });
      }
    }
  }

  // 5) realGames — schedule/event identity (team sports + labels).
  const games = Array.isArray(ctx.realGames) ? ctx.realGames : [];
  if (!named.length) {
    for (const g of games.slice(0, 8)) {
      if (out.length >= max) break;
      const label = asStr(g.game) ?? (
        asStr(g.awayTeam) && asStr(g.homeTeam)
          ? `${asStr(g.awayTeam)} @ ${asStr(g.homeTeam)}`
          : null
      );
      if (!label) continue;
      push({
        sport: asStr(g.sport),
        league: asStr(g.sport),
        season: null,
        eventId: asStr(g.eventId) ?? asStr(g.id),
        eventDate: asStr(g.startsAt) ?? asStr(g.commence_time),
        playerId: null,
        playerName: label,
        currentTeam: null,
        opponent: null,
        rosterStatus: asStr(g.status) ?? "scheduled",
        market: null,
        line: null,
        odds: null,
        provider: "stadium_edge_realGames",
        providerTimestamp: nowIso,
        lastVerifiedAt: nowIso,
        game: label,
        verified: true,
      });
    }
  }

  return out;
}

/**
 * Merge ESPN roster grounding + live context projection into one payload
 * for the final Coach prompt.
 */
export function buildCurrentFactGroundingPayload(args: {
  rosterGrounding: Record<string, unknown> | null;
  liveContext: LiveCtx | null | undefined;
  namedPlayers: string[];
  now?: Date;
}): {
  seasonYear: number | null;
  retrievedAt: string;
  authority: string;
  verifiedCurrentFacts: AuthoritativeCurrentFact[];
  facts: string[];
  sportCoverage: string;
} {
  const now = args.now ?? new Date();
  const retrievedAt =
    (args.rosterGrounding?.retrievedAt as string | undefined) ?? now.toISOString();
  const seasonYear =
    (args.rosterGrounding?.seasonYear as number | undefined) ??
    null;

  const fromRoster = projectLiveContextFacts(
    { rosterGrounding: args.rosterGrounding as LiveCtx["rosterGrounding"] },
    { namedPlayers: args.namedPlayers, now, maxFacts: 16 },
  );
  const fromLive = projectLiveContextFacts(args.liveContext, {
    namedPlayers: args.namedPlayers,
    now,
    maxFacts: 24,
  });

  // Dedupe by playerName (+ game when present). Merge non-null fields so an
  // ESPN identity row + a realProps row become one provenance-rich fact
  // (eventDate/market/line/odds from the board, team from ESPN when needed).
  const byKey = new Map<string, AuthoritativeCurrentFact>();
  const mergeFact = (
    a: AuthoritativeCurrentFact,
    b: AuthoritativeCurrentFact,
  ): AuthoritativeCurrentFact => ({
    sport: a.sport || b.sport,
    league: a.league || b.league,
    season: a.season ?? b.season,
    eventId: a.eventId || b.eventId,
    eventDate: a.eventDate || b.eventDate,
    playerId: a.playerId || b.playerId,
    playerName: a.playerName || b.playerName,
    currentTeam: a.currentTeam || b.currentTeam,
    opponent: a.opponent || b.opponent,
    rosterStatus: a.rosterStatus || b.rosterStatus,
    market: a.market || b.market,
    line: a.line ?? b.line,
    odds: a.odds ?? b.odds,
    provider:
      a.provider.includes("realProps") || a.provider.includes("fight") || a.provider.includes("tennis")
        ? a.provider
        : b.provider.includes("realProps") || b.provider.includes("fight") || b.provider.includes("tennis")
          ? b.provider
          : `${a.provider}+${b.provider}`,
    providerTimestamp: a.providerTimestamp || b.providerTimestamp,
    lastVerifiedAt: a.lastVerifiedAt || b.lastVerifiedAt,
    game: a.game || b.game,
    verified: a.verified || b.verified,
  });
  for (const row of [...fromRoster, ...fromLive]) {
    const key = [
      row.playerName.toLowerCase(),
      row.game ?? "",
      row.market ?? "",
    ].join("|");
    const prev = byKey.get(key);
    byKey.set(key, prev ? mergeFact(prev, row) : row);
  }
  const verifiedCurrentFacts = [...byKey.values()];

  const facts: string[] = [];
  if (Array.isArray(args.rosterGrounding?.facts)) {
    for (const f of args.rosterGrounding!.facts as string[]) facts.push(f);
  }
  facts.push(
    `currentFactGrounding: ${verifiedCurrentFacts.length} authoritative row(s) ` +
      `from live Stadium Edge/provider context (all sports). ` +
      `retrievedAt=${retrievedAt}. These override pretrained knowledge.`,
  );

  return {
    seasonYear,
    retrievedAt,
    authority:
      "For current sports facts, supplied live Stadium Edge/provider context is authoritative and overrides pretrained model knowledge.",
    verifiedCurrentFacts,
    facts,
    sportCoverage: ALL_COACH_SPORTS.join(","),
  };
}

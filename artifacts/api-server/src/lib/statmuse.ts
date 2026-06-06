// StatMuse natural-language stat source.
//
// StatMuse (https://www.statmuse.com) answers plain-English sports questions
// ("LeBron James points per game this season", "Dodgers record this season")
// and renders the answer sentence into the page's <meta name="description">
// tag. There is no official JSON API, but that meta sentence is stable and is
// exactly the human-readable fact we want to surface — so we fetch the league
// "ask" page and pull that one line out.
//
// HARD RULE for this app: we never fabricate stats. StatMuse returns REAL
// numbers; when it does NOT understand a question it falls back to a generic
// marketing blurb ("Instant answers to your NBA, NFL, ... questions"). We
// detect that blurb and return a null answer rather than passing noise on as
// if it were a fact.

import { cachedJson } from "./sports";

// Map our internal sportIds to StatMuse's league path segment. Sports StatMuse
// does not cover (UFC, tennis) are intentionally absent — callers skip them.
export const STATMUSE_LEAGUE: Record<string, string> = {
  nfl: "nfl",
  nba: "nba",
  wnba: "wnba",
  mlb: "mlb",
  nhl: "nhl",
  soccer: "fc",
  ncaaf: "cfb",
  ncaab: "cbb",
};

export type StatMuseAnswer = {
  query: string;
  league: string | null;
  answer: string | null;
  url: string;
};

// StatMuse falls back to marketing boilerplate when it can't answer a
// question. We discard any description containing one of these markers so a
// non-answer can never be passed on as if it were a real stat.
const GENERIC_MARKERS = [
  "instant answers to your",
  "stats, scores, betting and more",
  "muse on",
  "ask statmuse",
];

const decodeEntities = (s: string): string =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

const isGeneric = (text: string): boolean => {
  const low = text.toLowerCase();
  return GENERIC_MARKERS.some((m) => low.includes(m));
};

// Resolve a usable StatMuse league slug from either an explicit StatMuse slug
// or one of our internal sportIds. Returns null when unsupported.
export function resolveStatMuseLeague(input?: string | null): string | null {
  if (!input) return null;
  const v = input.toLowerCase().trim();
  if (Object.values(STATMUSE_LEAGUE).includes(v)) return v;
  return STATMUSE_LEAGUE[v] ?? null;
}

// ── Game-by-game period breakdowns ──────────────────────────────────────────
// ESPN game logs only carry FULL-GAME totals, and StatMuse's one-line meta
// answer collapses a multi-game period question down to a single game. But the
// StatMuse results PAGE renders the real per-game grid (DATE | STAT | TM | OPP
// | …). So for "first quarter points game by game" style questions we scrape
// that table and return the real per-game rows. Never fabricated: every value
// is parsed off the page, and we return null on any miss.

export type StatMuseGameRow = {
  date: string;
  value: string;
  team: string;
  loc: string; // "@" | "vs" | ""
  opp: string;
};

export type StatMuseGameLog = {
  query: string;
  league: string | null;
  player: string | null;
  period: string | null; // friendly period phrase ("first quarter")
  stat: string; // friendly stat word ("points")
  statLabel: string | null; // raw table column header ("PTS")
  count: number;
  answer: string | null; // StatMuse's headline sentence
  rows: StatMuseGameRow[];
  url: string;
};

const stripTags = (s: string): string =>
  decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

// Map a free-text period mention to StatMuse's canonical phrasing.
const PERIOD_PHRASES: Array<[RegExp, string]> = [
  [/\b(q1|1q|1st quarter|first quarter)\b/i, "first quarter"],
  [/\b(q2|2q|2nd quarter|second quarter)\b/i, "second quarter"],
  [/\b(q3|3q|3rd quarter|third quarter)\b/i, "third quarter"],
  [/\b(q4|4q|4th quarter|fourth quarter)\b/i, "fourth quarter"],
  [/\b(h1|1h|1st half|first half)\b/i, "first half"],
  [/\b(h2|2h|2nd half|second half)\b/i, "second half"],
  [/\b(1st period|first period)\b/i, "first period"],
  [/\b(2nd period|second period)\b/i, "second period"],
  [/\b(3rd period|third period)\b/i, "third period"],
];

function detectPeriodPhrase(q: string): string | null {
  for (const [re, label] of PERIOD_PHRASES) if (re.test(q)) return label;
  if (/\bhalf\b/i.test(q)) return "first half";
  if (/\bquarter\b/i.test(q)) return "first quarter";
  if (/\bperiod\b/i.test(q)) return "first period";
  return null;
}

const STAT_WORDS: Array<[RegExp, string]> = [
  [/\b(rebounds?|reb|boards?)\b/i, "rebounds"],
  [/\b(assists?|ast|dimes?)\b/i, "assists"],
  [/\b(steals?|stl)\b/i, "steals"],
  [/\b(blocks?|blk)\b/i, "blocks"],
  [/\b(3[- ]?pointers?|threes?|3pm|3pt|treys?)\b/i, "3-pointers"],
  [/\b(turnovers?|tov)\b/i, "turnovers"],
  [/\b(points?|pts|score[ds]?|scoring)\b/i, "points"],
];

export function detectStatWord(q: string): string {
  for (const [re, w] of STAT_WORDS) if (re.test(q)) return w;
  return "points";
}

// Pull the leading player name out of a StatMuse headline sentence
// ("Victor Wembanyama posted 5 points in Game 7 …" -> "Victor Wembanyama").
function playerFromAnswer(answer: string | null): string | null {
  if (!answer) return null;
  const m = answer.match(
    /^([A-Z][\w.'-]+(?:\s+[A-Z][\w.'-]+){0,3}?)\s+(?:had|has|scored|posted|put up|recorded|averaged|notched|tallied|dished|grabbed|made|hit|went|is|was|posts|scores)\b/,
  );
  return m ? m[1].trim() : null;
}

// Fetch a StatMuse "ask" page and parse its primary stat grid into per-game
// rows. Returns null unless the table is a real game log (has a DATE column and
// at least one dated row). Cached 10 min.
async function fetchStatMuseTable(
  q: string,
  slug: string | null,
): Promise<StatMuseGameLog | null> {
  const base = slug ? `https://www.statmuse.com/${slug}/ask` : "https://www.statmuse.com/ask";
  const url = `${base}?q=${encodeURIComponent(q)}`;
  return cachedJson<StatMuseGameLog | null>(
    `statmuse-table:${slug ?? "all"}:${q.toLowerCase()}`,
    10 * 60 * 1000,
    async () => {
      let html = "";
      try {
        const r = await fetch(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            Accept: "text/html",
          },
          signal: AbortSignal.timeout(12_000),
        });
        if (!r.ok) return null;
        html = await r.text();
      } catch {
        return null;
      }

      const am =
        html.match(/<meta name="description" content="([^"]*)"/i) ||
        html.match(/<meta property="og:description" content="([^"]*)"/i);
      const answer = am ? decodeEntities(am[1]).trim() : null;
      if (!answer || isGeneric(answer)) return null;

      const tbl = (html.match(/<table[\s\S]*?<\/table>/i) || [])[0];
      if (!tbl) return null;
      const trs = tbl.match(/<tr[\s\S]*?<\/tr>/gi) || [];
      if (trs.length < 2) return null;
      const cellsOf = (tr: string): string[] =>
        (tr.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) || []).map(stripTags);

      const header = cellsOf(trs[0] ?? "").map((h) => h.toUpperCase());
      const dateIdx = header.indexOf("DATE");
      if (dateIdx < 0) return null; // not a game log (e.g. a season aggregate)
      const statLabel = header[dateIdx + 1] || null;

      const dateRe = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;
      const locRe = /^(@|vs\.?|v)$/i;
      const rows: StatMuseGameRow[] = [];
      for (let i = 1; i < trs.length; i++) {
        const cells = cellsOf(trs[i]).filter((c) => c.length > 0);
        const di = cells.findIndex((c) => dateRe.test(c));
        if (di < 0) continue;
        const date = cells[di];
        // The asked stat sits immediately after DATE; team/opponent codes are
        // non-numeric and come after it. Take the first numeric cell after the
        // date so a label can never be misread as the value.
        let value = "";
        for (let k = di + 1; k < cells.length; k++) {
          const cell = cells[k] ?? "";
          if (/^[-+]?\d[\d.]*$/.test(cell)) {
            value = cell;
            break;
          }
        }
        if (!value) continue;
        const li = cells.findIndex((c) => locRe.test(c));
        let team = "";
        let loc = "";
        let opp = "";
        if (li > 0) {
          team = cells[li - 1] || "";
          loc = cells[li].replace(/\.$/, "");
          opp = cells[li + 1] || "";
        }
        rows.push({ date, value, team, loc, opp });
      }
      if (!rows.length) return null;
      return {
        query: q,
        league: slug,
        player: playerFromAnswer(answer),
        period: null,
        stat: "points",
        statLabel,
        count: rows.length,
        answer,
        rows,
        url,
      };
    },
  );
}

// Resolve a real game-by-game period breakdown for a natural-language question.
// Two-step: (1) ask the raw question to resolve the canonical player name from
// StatMuse's headline; (2) re-ask with a canonical "<player> <period> <stat>
// last N games game by game" phrasing that reliably returns the per-game grid
// (the raw phrasing often collapses to a single game). Returns null on a miss.
export async function askStatMuseGameLog(
  rawQuery: string,
  league?: string | null,
): Promise<StatMuseGameLog | null> {
  const q = (rawQuery || "").trim();
  if (!q) return null;
  const slug = resolveStatMuseLeague(league);
  const period = detectPeriodPhrase(q);
  const stat = detectStatWord(q);
  const count = Math.min(
    25,
    Math.max(2, Number((q.match(/last\s+(\d+)\s+games?/i) || [])[1]) || 5),
  );

  const r1 = await fetchStatMuseTable(q, slug);
  // The raw question already returned a multi-game log — use it directly.
  if (r1 && r1.rows.length >= 2) {
    return { ...r1, period, stat, count: r1.rows.length };
  }
  // Resolve the canonical player name for the step-2 re-query. fetchStatMuseTable
  // only returns when it finds a game-log table, so fall back to StatMuse's
  // headline answer (which always leads with the player name) when the raw
  // question produced no parseable table.
  let player = r1?.player ?? null;
  if (!player) {
    const headline = await askStatMuse(q, slug);
    player = playerFromAnswer(headline.answer);
  }
  if (!player) return null;

  // Preserve an explicit opponent ("vs the Knicks") in the canonical re-query so
  // the fallback grid stays filtered to those matchups instead of silently
  // widening to the last N games regardless of opponent.
  const oppClause = extractOpponentClause(q);
  const canonical = `${player} ${period ? `${period} ` : ""}${stat}${oppClause} last ${count} games game by game`;
  const r2 = await fetchStatMuseTable(canonical, slug);
  if (r2 && r2.rows.length >= 2) {
    return { ...r2, player, period, stat, count: r2.rows.length };
  }
  return null;
}

// Pull a " vs the <opponent>" clause out of a raw question so it can be carried
// into the canonical re-query. Returns "" when no opponent is mentioned.
function extractOpponentClause(q: string): string {
  const m =
    q.match(/\b(?:vs\.?|versus|against)\s+(?:the\s+)?(.+?)\s+(?:last|in|over|during|this|game|games|season)\b/i) ||
    q.match(/\b(?:vs\.?|versus|against)\s+(?:the\s+)?(.+?)$/i);
  if (!m) return "";
  const opp = m[1].replace(/[?.!,]/g, " ").replace(/\s+/g, " ").trim();
  return opp.length >= 2 ? ` vs the ${opp}` : "";
}

// Faster, single-fetch variant for when the caller ALREADY has a clean player
// name (e.g. from the live prop pool). It skips the player-resolution step of
// askStatMuseGameLog and goes straight to the canonical grid query, so it fits
// inside a tight enrichment budget. Returns null on any miss (never fabricates).
export async function playerPeriodGameLog(
  player: string,
  periodPhrase: string,
  statWord: string,
  league?: string | null,
  count = 5,
): Promise<StatMuseGameLog | null> {
  const name = (player || "").trim();
  const period = (periodPhrase || "").trim();
  const stat = (statWord || "points").trim();
  if (!name) return null;
  const slug = resolveStatMuseLeague(league);
  const n = Math.min(25, Math.max(2, count));
  const canonical = `${name} ${period ? `${period} ` : ""}${stat} last ${n} games game by game`;
  const r = await fetchStatMuseTable(canonical, slug);
  if (r && r.rows.length >= 2) {
    // Keep StatMuse's OWN resolved player (from the headline) as authoritative
    // so the rows are never misattributed to a name StatMuse didn't return; only
    // fall back to the requested name when StatMuse didn't surface one.
    return { ...r, player: r.player || name, period: period || null, stat, count: r.rows.length };
  }
  return null;
}

// ── Soccer player game-by-game log ──────────────────────────────────────────
// ESPN exposes no usable soccer game-log endpoint (its v3 gamelog/stats routes
// error out for soccer athletes), so soccer player recent form comes from
// StatMuse's "fc" per-game grid. A single query returns every column we surface
// as a real player prop: G (goals), SH (shots), SOT (shots on target), plus A
// (assists) and MIN (minutes). Every value is parsed off the page; we return
// null on any miss and never fabricate.

export type SoccerGameRow = {
  date: string;
  opponentName: string | null;
  isHome: boolean | null;
  stats: Record<string, string>;
};

// Columns kept from the StatMuse fc grid — restricted to clean counting stats so
// a season "total" read stays meaningful (Rating/xG are rate/advanced and would
// be nonsense when summed).
const SOCCER_STAT_COLS = new Set(["G", "SH", "SOT", "A", "MIN"]);

export async function soccerPlayerGameLog(
  player: string,
): Promise<SoccerGameRow[] | null> {
  const name = (player || "").trim();
  if (!name) return null;
  const q = `${name} goals and shots and shots on target this season game by game`;
  return cachedJson<SoccerGameRow[] | null>(
    `statmuse-soccer-log:${name.toLowerCase()}`,
    10 * 60 * 1000,
    async () => {
      const url = `https://www.statmuse.com/fc/ask?q=${encodeURIComponent(q)}`;
      let html = "";
      try {
        const r = await fetch(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            Accept: "text/html",
          },
          signal: AbortSignal.timeout(12_000),
        });
        if (!r.ok) return null;
        html = await r.text();
      } catch {
        return null;
      }
      const am =
        html.match(/<meta name="description" content="([^"]*)"/i) ||
        html.match(/<meta property="og:description" content="([^"]*)"/i);
      const answer = am ? decodeEntities(am[1]).trim() : null;
      if (!answer || isGeneric(answer)) return null;

      const tbl = (html.match(/<table[\s\S]*?<\/table>/i) || [])[0];
      if (!tbl) return null;
      const trs = tbl.match(/<tr[\s\S]*?<\/tr>/gi) || [];
      if (trs.length < 2) return null;
      // IMPORTANT: do NOT drop empty cells. The fc grid aligns its header row
      // and data rows positionally (the home/away column has an EMPTY header),
      // so index alignment is what lets us read each column correctly.
      const cellsOf = (tr: string): string[] =>
        (tr.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) || []).map(stripTags);

      const header = cellsOf(trs[0] ?? "").map((h) => h.toUpperCase());
      const dateIdx = header.indexOf("DATE");
      if (dateIdx < 0) return null;
      const colIdx = new Map<string, number>();
      header.forEach((h, i) => {
        if (SOCCER_STAT_COLS.has(h)) colIdx.set(h, i);
      });
      if (colIdx.size === 0) return null;

      const dateRe = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;
      const locRe = /^(@|vs\.?|v)$/i;
      const rows: SoccerGameRow[] = [];
      for (let i = 1; i < trs.length; i++) {
        const cells = cellsOf(trs[i]);
        const date = cells[dateIdx];
        if (!date || !dateRe.test(date)) continue;
        // Home/away marker ("@"/"vs") sits in a column with an empty header,
        // between CLUB and OPP — locate it per-row, then OPP is the next cell.
        const li = cells.findIndex((c) => locRe.test(c));
        let isHome: boolean | null = null;
        let opponentName: string | null = null;
        if (li >= 0) {
          const loc = cells[li].replace(/\.$/, "").toLowerCase();
          isHome = loc === "vs" || loc === "v" ? true : loc === "@" ? false : null;
          opponentName = cells[li + 1] || null;
        }
        const stats: Record<string, string> = {};
        for (const [label, idx] of colIdx) {
          const v = cells[idx];
          if (v != null && /^[-+]?\d[\d.]*$/.test(v)) stats[label] = v;
        }
        if (Object.keys(stats).length === 0) continue;
        rows.push({ date, opponentName, isHome, stats });
      }
      return rows.length ? rows : null;
    },
  );
}

export async function askStatMuse(
  query: string,
  league?: string | null,
): Promise<StatMuseAnswer> {
  const q = (query || "").trim();
  const slug = resolveStatMuseLeague(league);
  const base = slug ? `https://www.statmuse.com/${slug}/ask` : "https://www.statmuse.com/ask";
  const url = `${base}?q=${encodeURIComponent(q)}`;
  const empty: StatMuseAnswer = { query: q, league: slug, answer: null, url };
  if (!q) return empty;

  return cachedJson<StatMuseAnswer>(
    `statmuse:${slug ?? "all"}:${q.toLowerCase()}`,
    10 * 60 * 1000,
    async () => {
      let html = "";
      try {
        const r = await fetch(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            Accept: "text/html",
          },
          signal: AbortSignal.timeout(12_000),
        });
        if (!r.ok) return empty;
        html = await r.text();
      } catch {
        return empty;
      }
      const m =
        html.match(/<meta name="description" content="([^"]*)"/i) ||
        html.match(/<meta property="og:description" content="([^"]*)"/i);
      if (!m) return empty;
      const answer = decodeEntities(m[1]).trim();
      if (!answer || isGeneric(answer)) return empty;
      return { query: q, league: slug, answer, url };
    },
  );
}

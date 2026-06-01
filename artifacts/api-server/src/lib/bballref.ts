// Basketball-Reference structured stat source (NBA only).
//
// Basketball-Reference (https://www.basketball-reference.com) publishes
// authoritative NBA per-game tables as plain HTML. Unlike StatMuse there is no
// natural-language summary, so we resolve the player's page (their search
// endpoint 302-redirects straight to it for an unambiguous name) and parse the
// "Per Game" table, returning the most recent season's real averages.
//
// HARD RULE for this app: never fabricate stats. We only ever return numbers we
// actually parsed out of the page; on any miss (no player, no table, no season
// row) we return null so the caller shows nothing rather than inventing data.
//
// Scope: NBA only. nba.com/stats was evaluated too but its stats API blocks
// cloud/datacenter IPs, so it is not usable as a live source here.

import { cachedJson } from "./sports";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export type BBRefSeason = {
  player: string;
  season: string; // e.g. "2025-26"
  team: string | null;
  url: string;
  averages: {
    games: number | null;
    mpg: number | null;
    pts: number | null;
    reb: number | null;
    ast: number | null;
    stl: number | null;
    blk: number | null;
    fg3: number | null;
    fgPct: number | null;
    fg3Pct: number | null;
    ftPct: number | null;
  };
};

const num = (s: string | undefined): number | null => {
  if (s == null) return null;
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const stripTags = (s: string): string => s.replace(/<[^>]+>/g, "").trim();

// Pull every data-stat cell out of a single <tr>…</tr> chunk.
function rowCells(row: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /data-stat="([^"]+)"[^>]*?>(.*?)<\/t[hd]>/gis;
  let m: RegExpExecArray | null;
  while ((m = re.exec(row)) !== null) out[m[1]] = stripTags(m[2]);
  return out;
}

// Resolve a player's Basketball-Reference page URL from a free-text name.
async function resolvePlayerUrl(name: string): Promise<string | null> {
  const searchUrl = `https://www.basketball-reference.com/search/search.fcgi?search=${encodeURIComponent(
    name,
  )}`;
  try {
    const r = await fetch(searchUrl, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    // Unambiguous name: 302 straight to the player page.
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location") || "";
      if (/^\/players\/[a-z]\/[a-z0-9.]+\.html/i.test(loc)) {
        return `https://www.basketball-reference.com${loc.split("?")[0]}`;
      }
    }
    // Ambiguous (or no) match: a search-results page (HTTP 200). Take the first
    // ACTUAL result — a /players/ link inside a "search-item-name" block. We do
    // NOT fall back to any /players/ link on the page: a zero-result page still
    // lists "popular players" in the sidebar, and returning one of those would
    // surface the wrong player's real stats (a fabrication). No result → null.
    if (r.ok) {
      const html = await r.text();
      // Active players are wrapped in <strong>; allow that (or any single
      // inline wrapper) and whitespace between the result label and its anchor.
      const m = html.match(
        /search-item-name"[^>]*>\s*(?:<strong[^>]*>\s*)?<a href="(\/players\/[a-z]\/[a-z0-9.]+\.html)"/i,
      );
      if (m) return `https://www.basketball-reference.com${m[1]}`;
    }
  } catch {
    /* best-effort */
  }
  return null;
}

// Fetch + parse the most recent NBA season averages for a player.
export async function getBBRefSeason(name: string): Promise<BBRefSeason | null> {
  const q = (name || "").trim();
  if (!q) return null;

  return cachedJson<BBRefSeason | null>(
    `bbref:${q.toLowerCase()}`,
    6 * 60 * 60 * 1000, // 6h — bbref updates slowly; be gentle on their servers.
    async () => {
      const url = await resolvePlayerUrl(q);
      if (!url) return null;

      let html = "";
      try {
        const r = await fetch(url, {
          headers: { "User-Agent": UA, Accept: "text/html" },
          signal: AbortSignal.timeout(12_000),
        });
        if (!r.ok) return null;
        html = await r.text();
      } catch {
        return null;
      }

      const player =
        stripTags((html.match(/<h1[^>]*>(.*?)<\/h1>/is) || [])[1] || "") || q;

      const tbl = html.match(
        /<table[^>]*id="per_game_stats"[^>]*>([\s\S]*?)<\/table>/i,
      );
      if (!tbl) return null;
      const body = (tbl[1].match(/<tbody>([\s\S]*?)<\/tbody>/i) || [])[1] || tbl[1];
      const rows = body.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];

      // Walk newest-last; keep the last row that is a real "YYYY-YY" season.
      let best: Record<string, string> | null = null;
      for (const row of rows) {
        const c = rowCells(row);
        const season = c["year_id"] || c["season"] || "";
        if (/^\d{4}-\d{2}$/.test(season)) best = c;
      }
      if (!best) return null;

      return {
        player,
        season: best["year_id"] || best["season"] || "",
        team: best["team_name_abbr"] || best["team_id"] || null,
        url,
        averages: {
          games: num(best["games"] ?? best["g"]),
          mpg: num(best["mp_per_g"]),
          pts: num(best["pts_per_g"]),
          reb: num(best["trb_per_g"]),
          ast: num(best["ast_per_g"]),
          stl: num(best["stl_per_g"]),
          blk: num(best["blk_per_g"]),
          fg3: num(best["fg3_per_g"]),
          fgPct: num(best["fg_pct"]),
          fg3Pct: num(best["fg3_pct"]),
          ftPct: num(best["ft_pct"]),
        },
      };
    },
  );
}

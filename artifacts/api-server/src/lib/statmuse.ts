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

import { cachedJson } from "./sports.js";

// ---------------------------------------------------------------------------
// Tennis matchup data from ESPN's public ATP/WTA APIs. The app's Tennis tab
// only has moneyline (h2h) odds — there are NO player props for tennis. This
// module adds the ONE real analytics layer we can build: each player's REAL
// ATP/WTA ranking, country, season recent form (last results with set scores),
// and any recent head-to-head meetings. HARD never-fabricate: every value is
// parsed straight from ESPN; anything missing is returned as null/empty (the
// client honest-nulls it), never guessed. NOTE: table tennis has no comparable
// real data source, so it is intentionally NOT covered here.
// ---------------------------------------------------------------------------

export type TennisRecentResult = {
  date: string;
  opponent: string | null;
  win: boolean | null;
  score: string | null; // this player's set scores vs opponent, e.g. "6-4 7-6"
  round: string | null;
};

export type TennisPlayer = {
  name: string; // echo of the query
  resolvedName: string | null; // ESPN's canonical display name (null if unresolved)
  athleteId: string | null;
  country: string | null;
  rank: number | null; // ATP/WTA singles rank (null if outside the ranked list)
  rankPoints: number | null;
  tour: "ATP" | "WTA" | null;
  recentForm: TennisRecentResult[]; // most-recent first, up to 5
  formSummary: { wins: number; losses: number } | null;
};

export type TennisH2H = {
  homeWins: number;
  awayWins: number;
  meetings: TennisRecentResult[]; // from the home player's perspective
} | null;

export type TennisMatchup = {
  away: TennisPlayer;
  home: TennisPlayer;
  h2h: TennisH2H;
  tournament: string | null;
  round: string | null;
};

const RANK_TTL = 6 * 60 * 60 * 1000; // rankings update ~weekly
const SCORE_TTL = 5 * 60 * 1000; // active tournaments / draws
const FORM_TTL = 60 * 60 * 1000; // a player's results within a season
const MATCHUP_TTL = 10 * 60 * 1000;

const TOURS = ["atp", "wta"] as const;

async function fetchJson(url: string): Promise<any> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`ESPN ${r.status} ${url}`);
  return r.json();
}

// Diacritic-/punctuation-insensitive player-name key for matching ESPN display
// names against the odds-feed names. Lowercased, accents stripped, non-alnum
// collapsed to single spaces.
export function normName(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

type RankInfo = {
  rank: number;
  points: number | null;
  athleteId: string | null;
  tour: "ATP" | "WTA";
  displayName: string;
};

// name-key -> ranking row, across BOTH tours. First write wins so the actual
// singles rank isn't overwritten by a duplicate-name entry.
async function loadRankings(): Promise<Record<string, RankInfo>> {
  return cachedJson<Record<string, RankInfo>>("tennis:rankings", RANK_TTL, async () => {
    const map: Record<string, RankInfo> = {};
    for (const tour of TOURS) {
      try {
        const j = await fetchJson(
          `https://site.api.espn.com/apis/site/v2/sports/tennis/${tour}/rankings`,
        );
        const ranks: any[] = j?.rankings?.[0]?.ranks || [];
        for (const r of ranks) {
          const a = r?.athlete;
          if (!a?.displayName || typeof r?.current !== "number") continue;
          const key = normName(a.displayName);
          if (map[key]) continue;
          map[key] = {
            rank: r.current,
            points: typeof r.points === "number" ? r.points : null,
            athleteId: a.id ? String(a.id) : null,
            tour: tour.toUpperCase() as "ATP" | "WTA",
            displayName: a.displayName,
          };
        }
      } catch {
        // one tour failing must not kill the other
      }
    }
    return map;
  });
}

type SbPlayer = {
  athleteId: string | null;
  country: string | null;
  tour: "ATP" | "WTA";
  displayName: string;
};
type Scoreboard = {
  players: Record<string, SbPlayer>;
  matchups: Array<{ a: string; b: string; tournament: string | null; round: string | null }>;
};

// Active tournament draws across both tours -> per-player country + athlete id,
// plus the list of scheduled/played pairings (used to label the tournament/round
// of THIS matchup). Lower-ranked players missing from the rankings list can
// still be resolved here.
async function loadScoreboard(): Promise<Scoreboard> {
  return cachedJson<Scoreboard>("tennis:scoreboard", SCORE_TTL, async () => {
    const players: Record<string, SbPlayer> = {};
    const matchups: Scoreboard["matchups"] = [];
    for (const tour of TOURS) {
      try {
        const j = await fetchJson(
          `https://site.api.espn.com/apis/site/v2/sports/tennis/${tour}/scoreboard`,
        );
        for (const e of j?.events || []) {
          const tournament = e?.name || null;
          for (const g of e?.groupings || []) {
            for (const c of g?.competitions || []) {
              const round = c?.round?.displayName || c?.round?.description || null;
              const names: string[] = [];
              for (const comp of c?.competitors || []) {
                const a = comp?.athlete;
                if (!a?.displayName) continue;
                names.push(a.displayName);
                const key = normName(a.displayName);
                if (!players[key]) {
                  // The numeric athlete id lives on the COMPETITOR (comp.id =
                  // "3481"), not on comp.athlete (which only carries a guid).
                  const athleteId = comp?.id ? String(comp.id) : a.id ? String(a.id) : null;
                  players[key] = {
                    athleteId,
                    country: a.flag?.alt || null,
                    tour: tour.toUpperCase() as "ATP" | "WTA",
                    displayName: a.displayName,
                  };
                }
              }
              if (names.length === 2) matchups.push({ a: names[0], b: names[1], tournament, round });
            }
          }
        }
      } catch {
        // one tour failing must not kill the other
      }
    }
    return { players, matchups };
  });
}

// Resolve a player's recent (this-season) results from their ESPN eventlog.
// Each eventlog item points at a competition $ref that carries both players'
// inline names + winner flag + set linescores. Returns up to 5 most-recent
// played matches, newest first. Empty on any failure (never fabricated).
async function loadRecentForm(
  athleteId: string,
  tour: "ATP" | "WTA",
): Promise<TennisRecentResult[]> {
  const year = new Date().getUTCFullYear();
  const tl = tour.toLowerCase();
  return cachedJson<TennisRecentResult[]>(
    `tennis:form:${tl}:${year}:${athleteId}`,
    FORM_TTL,
    async () => {
      let log: any;
      try {
        log = await fetchJson(
          `https://sports.core.api.espn.com/v2/sports/tennis/leagues/${tl}/seasons/${year}/athletes/${athleteId}/eventlog`,
        );
      } catch {
        return [];
      }
      const items: any[] = (log?.events?.items || []).filter(
        (i: any) => i?.played && i?.competition?.$ref,
      );
      // Resolve the tail (most-recent) competitions; cap the fan-out.
      const tail = items.slice(-8);
      const out: TennisRecentResult[] = [];
      await Promise.all(
        tail.map(async (it: any) => {
          try {
            const c = await fetchJson(it.competition.$ref.replace("http://", "https://"));
            const comps: any[] = c?.competitors || [];
            const me = comps.find((x) => String(x?.id) === String(athleteId));
            const opp = comps.find((x) => String(x?.id) !== String(athleteId));
            if (!me) return;
            // A bye is not a real match — never count it as a win or list it.
            const oppName = opp?.name || opp?.athlete?.displayName || null;
            if (oppName && /^bye$/i.test(oppName.trim())) return;
            // linescores are sometimes an inline array, sometimes a $ref
            // object we don't expand — only map real arrays, else omit scores.
            const mine: any[] = Array.isArray(me?.linescores) ? me.linescores : [];
            const theirs: any[] = Array.isArray(opp?.linescores) ? opp.linescores : [];
            const score =
              mine
                .map((ls, idx) => {
                  const o = theirs[idx];
                  return typeof ls?.value === "number" && typeof o?.value === "number"
                    ? `${ls.value}-${o.value}`
                    : null;
                })
                .filter(Boolean)
                .join(" ") || null;
            out.push({
              date: c?.date || "",
              opponent: oppName,
              win: typeof me?.winner === "boolean" ? me.winner : null,
              score,
              round: c?.round?.displayName || c?.round?.description || null,
            });
          } catch {
            // skip an unresolvable match
          }
        }),
      );
      out.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      return out.slice(0, 5);
    },
  );
}

// Recent head-to-head, derived ONLY from the two players' season eventlogs (so
// it captures this-season meetings, honestly labelled). Null when none found.
function computeH2H(home: TennisPlayer, away: TennisPlayer): TennisH2H {
  const awayKey = normName(away.resolvedName || away.name);
  const homeKey = normName(home.resolvedName || home.name);
  const meetingsMap = new Map<string, TennisRecentResult>();
  let homeWins = 0;
  let awayWins = 0;
  for (const r of home.recentForm) {
    if (r.opponent && normName(r.opponent) === awayKey) {
      meetingsMap.set(r.date || `${r.round}-${r.score}`, r);
      if (r.win === true) homeWins++;
      else if (r.win === false) awayWins++;
    }
  }
  // The away player's log may surface a meeting the home log capped out of.
  for (const r of away.recentForm) {
    if (r.opponent && normName(r.opponent) === homeKey) {
      const key = r.date || `${r.round}-${r.score}`;
      if (meetingsMap.has(key)) continue;
      // Flip to the home player's perspective.
      meetingsMap.set(key, {
        date: r.date,
        opponent: away.resolvedName || away.name,
        win: r.win === true ? false : r.win === false ? true : null,
        score: r.score
          ? r.score
              .split(" ")
              .map((s) => s.split("-").reverse().join("-"))
              .join(" ")
          : null,
        round: r.round,
      });
      if (r.win === true) awayWins++;
      else if (r.win === false) homeWins++;
    }
  }
  if (meetingsMap.size === 0) return null;
  const meetings = Array.from(meetingsMap.values()).sort((a, b) =>
    (b.date || "").localeCompare(a.date || ""),
  );
  return { homeWins, awayWins, meetings };
}

export async function buildTennisMatchup(away: string, home: string): Promise<TennisMatchup> {
  return cachedJson<TennisMatchup>(
    `tennis:matchup:${normName(away)}|${normName(home)}`,
    MATCHUP_TTL,
    async () => {
      const [rankings, sb] = await Promise.all([loadRankings(), loadScoreboard()]);

      async function build(name: string): Promise<TennisPlayer> {
        const key = normName(name);
        const rank = rankings[key];
        const sp = sb.players[key];
        const tour = rank?.tour || sp?.tour || null;
        const athleteId = rank?.athleteId || sp?.athleteId || null;
        const resolvedName = rank?.displayName || sp?.displayName || (athleteId ? name : null);
        const country = sp?.country || null;
        let recentForm: TennisRecentResult[] = [];
        if (athleteId && tour) {
          try {
            recentForm = await loadRecentForm(athleteId, tour);
          } catch {
            recentForm = [];
          }
        }
        const wins = recentForm.filter((r) => r.win === true).length;
        const losses = recentForm.filter((r) => r.win === false).length;
        return {
          name,
          resolvedName,
          athleteId,
          country,
          rank: rank?.rank ?? null,
          rankPoints: rank?.points ?? null,
          tour,
          recentForm,
          formSummary: recentForm.length ? { wins, losses } : null,
        };
      }

      const [aw, hm] = await Promise.all([build(away), build(home)]);
      const h2h = computeH2H(hm, aw);
      const m = sb.matchups.find((mm) => {
        const set = new Set([normName(mm.a), normName(mm.b)]);
        return set.has(normName(away)) && set.has(normName(home));
      });
      return { away: aw, home: hm, h2h, tournament: m?.tournament || null, round: m?.round || null };
    },
  );
}

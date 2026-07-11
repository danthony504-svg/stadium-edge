import { Router, type IRouter } from "express";
import { ESPN_SPORT_PATHS, cachedJson, rateLimit } from "../lib/sports.js";

const router: IRouter = Router();

router.use("/sports/live-odds", rateLimit({ windowMs: 60_000, max: 90, name: "live-odds" }));

type LiveOddsEntry = {
  sport: string;
  game: string;
  market: string;
  pick: string;
  odds: number;
  live: true;
  awayScore?: number | null;
  homeScore?: number | null;
  periodLabel?: string | null;
  clock?: string | null;
  startsAt?: string;
};

type LiveGameEntry = {
  sport: string;
  game: string;
  status: string;
  awayScore: number | null;
  homeScore: number | null;
  periodLabel: string | null;
  clock: string | null;
  eventId: string;
};

const nickname = (full: string) => (full || "").split(/\s+/).filter(Boolean).pop() || full;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

async function fetchEspnPickcenter(
  sport: string,
  eventId: string,
): Promise<{
  home: string | null;
  away: string | null;
  mlH: number | null;
  mlA: number | null;
  sp: number | null;
  spH: number | null;
  spA: number | null;
  tot: number | null;
  totO: number | null;
  totU: number | null;
} | null> {
  const path = ESPN_SPORT_PATHS[sport];
  if (!path) return null;
  type Pickcenter = {
    spread?: number;
    overUnder?: number;
    overOdds?: number;
    underOdds?: number;
    awayTeamOdds?: { moneyLine?: number; spreadOdds?: number };
    homeTeamOdds?: { moneyLine?: number; spreadOdds?: number };
  };
  type Summary = {
    pickcenter?: Pickcenter[];
    header?: { competitions?: Array<{ competitors?: Array<{ homeAway: "home" | "away"; team?: { displayName?: string } }> }> };
  };
  const data = await cachedJson<Summary | null>(
    `live-odds:espn:${sport}:${eventId}`,
    20_000,
    async () => {
      const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/summary?event=${eventId}`;
      const r = await fetch(url);
      if (!r.ok) return null;
      return (await r.json()) as Summary;
    },
  );
  const pc = data?.pickcenter?.[0];
  if (!pc) return null;
  const comp = data?.header?.competitions?.[0];
  const home = comp?.competitors?.find((c) => c.homeAway === "home")?.team?.displayName ?? null;
  const away = comp?.competitors?.find((c) => c.homeAway === "away")?.team?.displayName ?? null;
  return {
    home,
    away,
    mlH: num(pc.homeTeamOdds?.moneyLine),
    mlA: num(pc.awayTeamOdds?.moneyLine),
    sp: num(pc.spread),
    spH: num(pc.homeTeamOdds?.spreadOdds),
    spA: num(pc.awayTeamOdds?.spreadOdds),
    tot: num(pc.overUnder),
    totO: num(pc.overOdds),
    totU: num(pc.underOdds),
  };
}

function linesFromPickcenter(
  sport: string,
  game: string,
  liveMeta: Omit<LiveOddsEntry, "sport" | "game" | "market" | "pick" | "odds">,
  pc: NonNullable<Awaited<ReturnType<typeof fetchEspnPickcenter>>>,
): LiveOddsEntry[] {
  const out: LiveOddsEntry[] = [];
  const base = { sport, game, live: true as const, ...liveMeta };
  if (pc.home && pc.away && pc.mlH != null && pc.mlA != null) {
    out.push({ ...base, market: "Moneyline", pick: `${nickname(pc.away)} ML`, odds: pc.mlA });
    out.push({ ...base, market: "Moneyline", pick: `${nickname(pc.home)} ML`, odds: pc.mlH });
  }
  if (pc.sp != null && pc.spH != null && pc.spA != null && pc.home && pc.away) {
    const ptH = pc.sp > 0 ? ` +${pc.sp}` : ` ${pc.sp}`;
    const ptA = -pc.sp > 0 ? ` +${-pc.sp}` : ` ${-pc.sp}`;
    out.push({ ...base, market: "Spread", pick: `${nickname(pc.home)}${ptH}`, odds: pc.spH });
    out.push({ ...base, market: "Spread", pick: `${nickname(pc.away)}${ptA}`, odds: pc.spA });
  }
  if (pc.tot != null && pc.totO != null && pc.totU != null) {
    out.push({ ...base, market: "Total", pick: `Over ${pc.tot}`, odds: pc.totO });
    out.push({ ...base, market: "Total", pick: `Under ${pc.tot}`, odds: pc.totU });
  }
  return out;
}

/** Dedicated live board: in-progress games + posted ESPN pickcenter lines. */
router.get("/sports/live-odds", async (req, res): Promise<void> => {
  const sportsParam = String(req.query.sport ?? req.query.sports ?? "nba");
  const sports = sportsParam
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!sports.length) {
    res.status(400).json({ error: "sport required" });
    return;
  }

  const games: LiveGameEntry[] = [];
  const odds: LiveOddsEntry[] = [];

  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const dateRange = `${fmt(yesterday)}-${fmt(tomorrow)}`;

  await Promise.all(
    sports.map(async (sport) => {
      const path = ESPN_SPORT_PATHS[sport];
      if (!path) return;
      type ScoreboardEvent = {
        id: string;
        date: string;
        status?: { type?: { state?: string; description?: string; shortDetail?: string } };
        competitions?: Array<{
          status?: { type?: { state?: string; description?: string; shortDetail?: string } };
          competitors?: Array<{
            homeAway: "home" | "away";
            score?: string;
            team?: { displayName?: string };
          }>;
        }>;
      };
      const board = await cachedJson<{ events?: ScoreboardEvent[] } | null>(
        `live-odds:board:${sport}:${dateRange}`,
        15_000,
        async () => {
          const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${dateRange}`;
          const r = await fetch(url);
          if (!r.ok) return null;
          return (await r.json()) as { events?: ScoreboardEvent[] };
        },
      );
      for (const ev of board?.events ?? []) {
        const comp = ev.competitions?.[0];
        const state = comp?.status?.type?.state ?? ev.status?.type?.state ?? "";
        if (state !== "in") continue;
        const awayC = comp?.competitors?.find((c) => c.homeAway === "away");
        const homeC = comp?.competitors?.find((c) => c.homeAway === "home");
        const away = awayC?.team?.displayName;
        const home = homeC?.team?.displayName;
        if (!away || !home || !ev.id) continue;
        const game = `${away} @ ${home}`;
        const awayScore = num(Number(awayC?.score));
        const homeScore = num(Number(homeC?.score));
        const periodLabel = comp?.status?.type?.shortDetail ?? comp?.status?.type?.description ?? null;
        games.push({
          sport,
          game,
          status: "in",
          awayScore,
          homeScore,
          periodLabel,
          clock: null,
          eventId: ev.id,
        });
        const pc = await fetchEspnPickcenter(sport, ev.id);
        if (!pc) continue;
        const liveMeta = {
          awayScore,
          homeScore,
          periodLabel,
          clock: null,
          startsAt: ev.date,
        };
        odds.push(...linesFromPickcenter(sport, game, liveMeta, pc));
      }
    }),
  );

  res.json({ games, odds });
});

export default router;

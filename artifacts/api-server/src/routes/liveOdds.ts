import { Router, type IRouter } from "express";
import {
  ESPN_SPORT_PATHS,
  cachedJson,
  rateLimit,
} from "../lib/sports.js";
import {
  espnScoreboardDayKeys,
  mergeEspnEventsById,
} from "../lib/espnScoreboardWindow.js";
import {
  espnPickcenterProviderLastUpdate,
  extractLiveGameStateFromEspnEvent,
  type LiveScoreboardEvent,
} from "../lib/liveOddsBoard.js";

const router: IRouter = Router();

router.use("/sports/live-odds", rateLimit({ windowMs: 60_000, max: 90, name: "live-odds" }));

/** Price source for Phase 1 live board (ESPN pickcenter / DraftKings mirror). */
export const LIVE_ODDS_SOURCE = "espn_pickcenter" as const;

type LiveOddsEntry = {
  sport: string;
  game: string;
  market: string;
  pick: string;
  odds: number;
  live: true;
  eventId: string;
  awayTeam: string;
  homeTeam: string;
  awayScore: number | null;
  homeScore: number | null;
  state: "in";
  period: number | null;
  periodLabel: string | null;
  clock: string | null;
  source: typeof LIVE_ODDS_SOURCE;
  /** ISO timestamp when THIS server assembled the quote. Never a fabricated provider time. */
  fetchedAt: string;
  /**
   * Provider-native last_update when genuinely present on the upstream payload.
   * Distinct from fetchedAt. Null when the provider does not supply one.
   */
  providerLastUpdate: string | null;
  line: number | null;
  startsAt?: string | null;
};

type LiveGameEntry = {
  sport: string;
  game: string;
  status: "in";
  state: "in";
  awayTeam: string;
  homeTeam: string;
  awayScore: number | null;
  homeScore: number | null;
  period: number | null;
  periodLabel: string | null;
  clock: string | null;
  eventId: string;
  source: typeof LIVE_ODDS_SOURCE;
  fetchedAt: string;
  startsAt?: string | null;
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
  /** Raw summary blob — used only to probe for a real provider timestamp. */
  raw: unknown;
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
    header?: {
      competitions?: Array<{
        competitors?: Array<{
          homeAway: "home" | "away";
          team?: { displayName?: string };
        }>;
      }>;
    };
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
  const home =
    comp?.competitors?.find((c) => c.homeAway === "home")?.team?.displayName ?? null;
  const away =
    comp?.competitors?.find((c) => c.homeAway === "away")?.team?.displayName ?? null;
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
    raw: data,
  };
}

type LiveMeta = Omit<
  LiveOddsEntry,
  "sport" | "game" | "market" | "pick" | "odds" | "line"
>;

function linesFromPickcenter(
  sport: string,
  game: string,
  liveMeta: LiveMeta,
  pc: NonNullable<Awaited<ReturnType<typeof fetchEspnPickcenter>>>,
): LiveOddsEntry[] {
  const out: LiveOddsEntry[] = [];
  const base = { sport, game, ...liveMeta };
  if (pc.home && pc.away && pc.mlH != null && pc.mlA != null) {
    out.push({
      ...base,
      market: "Moneyline",
      pick: `${nickname(pc.away)} ML`,
      odds: pc.mlA,
      line: null,
    });
    out.push({
      ...base,
      market: "Moneyline",
      pick: `${nickname(pc.home)} ML`,
      odds: pc.mlH,
      line: null,
    });
  }
  if (pc.sp != null && pc.spH != null && pc.spA != null && pc.home && pc.away) {
    const ptH = pc.sp > 0 ? ` +${pc.sp}` : ` ${pc.sp}`;
    const ptA = -pc.sp > 0 ? ` +${-pc.sp}` : ` ${-pc.sp}`;
    out.push({
      ...base,
      market: "Spread",
      pick: `${nickname(pc.home)}${ptH}`,
      odds: pc.spH,
      line: pc.sp,
    });
    out.push({
      ...base,
      market: "Spread",
      pick: `${nickname(pc.away)}${ptA}`,
      odds: pc.spA,
      line: -pc.sp,
    });
  }
  if (pc.tot != null && pc.totO != null && pc.totU != null) {
    out.push({
      ...base,
      market: "Total",
      pick: `Over ${pc.tot}`,
      odds: pc.totO,
      line: pc.tot,
    });
    out.push({
      ...base,
      market: "Total",
      pick: `Under ${pc.tot}`,
      odds: pc.totU,
      line: pc.tot,
    });
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

  const fetchedAt = new Date().toISOString();
  const games: LiveGameEntry[] = [];
  const odds: LiveOddsEntry[] = [];
  const dayKeys = espnScoreboardDayKeys(Date.now(), 1, 1);

  await Promise.all(
    sports.map(async (sport) => {
      const path = ESPN_SPORT_PATHS[sport];
      if (!path) return;

      const dayBoards = await Promise.all(
        dayKeys.map((day) =>
          cachedJson<{ events?: LiveScoreboardEvent[] } | null>(
            `live-odds:board:${sport}:${day}`,
            15_000,
            async () => {
              const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${day}`;
              const r = await fetch(url);
              if (!r.ok) return null;
              return (await r.json()) as { events?: LiveScoreboardEvent[] };
            },
          ),
        ),
      );
      const events = mergeEspnEventsById(
        dayBoards.map((b) => b?.events ?? []),
      ) as LiveScoreboardEvent[];

      for (const ev of events) {
        const state = extractLiveGameStateFromEspnEvent(ev);
        if (!state) continue;

        // Games row is the scoreboard authority for this eventId.
        games.push({
          sport,
          game: state.matchup,
          status: "in",
          state: "in",
          awayTeam: state.awayTeam,
          homeTeam: state.homeTeam,
          awayScore: state.awayScore,
          homeScore: state.homeScore,
          period: state.period,
          periodLabel: state.periodLabel,
          clock: state.clock,
          eventId: state.eventId,
          source: LIVE_ODDS_SOURCE,
          fetchedAt,
          startsAt: state.startsAt,
        });

        const pc = await fetchEspnPickcenter(sport, state.eventId);
        if (!pc) continue;

        // Join prices to the SAME eventId as the scoreboard row — never by name alone.
        const providerLastUpdate = espnPickcenterProviderLastUpdate(pc.raw);
        const liveMeta: LiveMeta = {
          live: true,
          eventId: state.eventId,
          awayTeam: state.awayTeam,
          homeTeam: state.homeTeam,
          awayScore: state.awayScore,
          homeScore: state.homeScore,
          state: "in",
          period: state.period,
          periodLabel: state.periodLabel,
          clock: state.clock,
          source: LIVE_ODDS_SOURCE,
          fetchedAt,
          providerLastUpdate,
          startsAt: state.startsAt,
        };
        odds.push(...linesFromPickcenter(sport, state.matchup, liveMeta, pc));
      }
    }),
  );

  res.json({ games, odds, fetchedAt });
});

export default router;

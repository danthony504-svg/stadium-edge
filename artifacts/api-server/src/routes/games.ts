import { Router, type IRouter } from "express";
import { GetGamesQueryParams, GetGamesResponse } from "@workspace/api-zod";
import { ESPN_SPORT_PATHS, cachedJson } from "../lib/sports";

const router: IRouter = Router();

type EspnEvent = {
  id: string;
  name: string;
  shortName: string;
  date: string;
  status?: { type?: { description?: string; state?: string } };
  competitions?: Array<{
    venue?: { fullName?: string };
    competitors?: Array<{
      homeAway: "home" | "away";
      score?: string;
      team?: { id?: string; displayName?: string; abbreviation?: string };
    }>;
  }>;
};

router.get("/sports/games", async (req, res): Promise<void> => {
  const parsed = GetGamesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const sportId = parsed.data.sport.toLowerCase();
  const path = ESPN_SPORT_PATHS[sportId];
  if (!path) {
    res.status(400).json({ error: `Unsupported sport: ${sportId}` });
    return;
  }

  try {
    const data = await cachedJson(
      `games:${path}`,
      60 * 1000,
      async () => {
        const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard`;
        const r = await fetch(url);
        if (!r.ok) throw new Error(`ESPN ${r.status}`);
        return (await r.json()) as { events?: EspnEvent[] };
      },
    );

    const out = (data.events ?? []).map((e) => {
      const comp = e.competitions?.[0];
      const home = comp?.competitors?.find((c) => c.homeAway === "home");
      const away = comp?.competitors?.find((c) => c.homeAway === "away");
      const homeScore = home?.score != null ? parseInt(home.score, 10) : null;
      const awayScore = away?.score != null ? parseInt(away.score, 10) : null;
      return {
        id: e.id,
        sport: sportId,
        name: e.name,
        shortName: e.shortName,
        status: e.status?.type?.description ?? "Scheduled",
        startsAt: e.date,
        homeTeam: home?.team?.displayName ?? null,
        awayTeam: away?.team?.displayName ?? null,
        homeScore: Number.isFinite(homeScore) ? homeScore : null,
        awayScore: Number.isFinite(awayScore) ? awayScore : null,
        homeTeamId: home?.team?.id ?? null,
        awayTeamId: away?.team?.id ?? null,
        venue: comp?.venue?.fullName ?? null,
      };
    });

    res.json(GetGamesResponse.parse(out));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch games");
    res.json([]);
  }
});

export default router;

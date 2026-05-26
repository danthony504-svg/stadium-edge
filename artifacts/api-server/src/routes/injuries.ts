import { Router, type IRouter } from "express";
import {
  GetInjuriesQueryParams,
  GetInjuriesResponse,
} from "@workspace/api-zod";
import { ESPN_SPORT_PATHS, cachedJson } from "../lib/sports";

const router: IRouter = Router();

type RawInjuries = {
  injuries?: Array<{
    displayName?: string;
    abbreviation?: string;
    injuries?: Array<{
      athlete?: { displayName?: string; position?: { abbreviation?: string } };
      status?: string;
      details?: { detail?: string; type?: string; returnDate?: string };
      shortComment?: string;
      longComment?: string;
    }>;
  }>;
};

router.get("/sports/injuries", async (req, res): Promise<void> => {
  const parsed = GetInjuriesQueryParams.safeParse(req.query);
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
      `injuries:${path}`,
      10 * 60 * 1000,
      async () => {
        const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/injuries`;
        const r = await fetch(url);
        if (!r.ok) throw new Error(`ESPN ${r.status}`);
        return (await r.json()) as RawInjuries;
      },
    );

    const out = (data.injuries ?? []).map((team) => ({
      team: team.displayName ?? "Unknown",
      teamAbbr: team.abbreviation ?? "",
      entries: (team.injuries ?? []).map((i) => ({
        player: i.athlete?.displayName ?? "Unknown",
        position: i.athlete?.position?.abbreviation ?? null,
        status: i.status ?? "Day-To-Day",
        description:
          i.shortComment ??
          i.details?.detail ??
          i.details?.type ??
          "No description",
      })),
    }));

    res.json(GetInjuriesResponse.parse(out));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch injuries");
    res.json([]);
  }
});

export default router;
